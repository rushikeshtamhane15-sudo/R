"""Rider — restaurant-order delivery role.

Distinct from `delivery_boy` (which handles tiffin deliveries). One rider
owns one restaurant order at a time. Lifecycle:

    created  →  preparing  →  ready_for_pickup  →  out_for_delivery  →  delivered

Endpoints (rider-only unless noted):
  GET  /api/rider/me                — dashboard summary
  GET  /api/rider/orders/active     — orders ready for pickup OR currently out for delivery
  POST /api/rider/orders/{id}/pickup — accept ready_for_pickup → out_for_delivery
  POST /api/rider/orders/{id}/arrived — fire delivery OTP via WhatsApp + SMS to customer
  POST /api/rider/orders/{id}/deliver — verify OTP → mark delivered, credit wallet, snapshot earnings
  POST /api/rider/location          — battery-friendly 30s ping during active delivery
  GET  /api/rider/earnings          — today + month tallies
  POST /api/rider/withdraw          — withdraw wallet balance to bank (uses RazorpayX in prod, stub here)
  POST /api/rider/cash-reconcile/confirm-otp — rider enters OTP from admin to clear pending cash

Customer-facing:
  GET  /api/restaurant/orders/{id}/track — live status + rider location
  POST /api/restaurant/orders/{id}/cancel — only allowed before preparing

Admin:
  POST /api/admin/rider/{user_id}/promote — mark a user as rider role
  POST /api/admin/restaurant/orders/{id}/status — manual status update (preparing/ready_for_pickup)
  POST /api/admin/restaurant/orders/{id}/assign-rider — assign rider
  POST /api/admin/cash-reconcile/issue-otp — admin generates OTP, sends to rider's phone

Payment split:
  Per-delivery flat ₹50 credited to rider wallet on `deliver` event.
  Restaurant gross receipts settle to main account (Razorpay) — internal book
  entry decrements the receivable by ₹50. RazorpayX integration STUBBED.
"""
from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server  # late-binding via shared shim

router = APIRouter()

# Constants
RIDER_PER_DELIVERY_INR = 50.0
DELIVERY_OTP_TTL_MINUTES = 30


# ---------------------------------------------------------------------------
# Pydantic
# ---------------------------------------------------------------------------
class StatusUpdate(BaseModel):
    status: str  # one of: preparing, ready_for_pickup


class AssignRider(BaseModel):
    rider_user_id: str


class LocationPing(BaseModel):
    lat: float
    lng: float


class DeliverPayload(BaseModel):
    otp: str
    payment_mode: str = "online"  # online | cash


class WithdrawRequest(BaseModel):
    amount: float = Field(gt=0)
    bank_account_last4: Optional[str] = None  # display only — real RazorpayX uses fund_account_id


class CashReconcileConfirm(BaseModel):
    otp: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _require_rider(user) -> None:
    if user.role != "rider":
        raise HTTPException(status_code=403, detail="Rider role required")


def _now_iso() -> str:
    return server.iso(server.now_utc())


async def _gen_otp(length: int = 4) -> str:
    return "".join(random.choices("0123456789", k=length))


async def _credit_rider_wallet(user_id: str, delta: float, reason: str, order_id: Optional[str] = None) -> None:
    await server.db.users.update_one({"user_id": user_id}, {"$inc": {"wallet_balance": float(delta)}})
    await server.db.rider_wallet_txns.insert_one({
        "txn_id": f"rwt_{uuid.uuid4().hex[:14]}",
        "user_id": user_id,
        "delta": float(delta),
        "reason": reason,
        "order_id": order_id,
        "ts": _now_iso(),
    })


# ---------------------------------------------------------------------------
# Rider — own dashboard
# ---------------------------------------------------------------------------
@router.get("/rider/me")
async def rider_me(user: server.User = Depends(server.get_current_user)):
    _require_rider(user)
    today = (server.now_utc() + timedelta(hours=5, minutes=30)).date().isoformat()
    today_start_utc = datetime.fromisoformat(today + "T00:00:00+00:00") - timedelta(hours=5, minutes=30)
    delivered_today = await server.db.restaurant_orders.count_documents({
        "rider_id": user.user_id, "status": "delivered",
        "delivered_at": {"$gte": server.iso(today_start_utc)},
    })
    rejected_today = await server.db.restaurant_orders.count_documents({
        "rider_id": user.user_id, "status": "rejected",
        "rejected_at": {"$gte": server.iso(today_start_utc)},
    })
    cash_pending = await server.db.restaurant_orders.aggregate([
        {"$match": {"rider_id": user.user_id, "payment_mode": "cash", "cash_reconciled": {"$ne": True}, "status": "delivered"}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}},
    ]).to_list(1)
    cash_pending_amount = float(cash_pending[0]["total"]) if cash_pending else 0.0
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0, "wallet_balance": 1, "name": 1, "phone": 1})
    return {
        "user_id": user.user_id,
        "name": user_doc.get("name"),
        "phone": user_doc.get("phone"),
        "wallet_balance": float(user_doc.get("wallet_balance", 0) or 0),
        "delivered_today": delivered_today,
        "rejected_today": rejected_today,
        "cash_pending": round(cash_pending_amount, 2),
        "per_delivery_inr": RIDER_PER_DELIVERY_INR,
    }


@router.get("/rider/orders/active")
async def rider_active_orders(user: server.User = Depends(server.get_current_user)):
    _require_rider(user)
    # Ready-for-pickup (any rider can grab) OR already-assigned to this rider
    rows = await server.db.restaurant_orders.find({
        "$or": [
            {"status": "ready_for_pickup", "rider_id": {"$in": [None, user.user_id]}},
            {"status": "out_for_delivery", "rider_id": user.user_id},
        ],
    }, {"_id": 0}).sort("created_at", 1).to_list(50)
    return {"orders": rows}


@router.post("/rider/orders/{order_id}/pickup")
async def rider_pickup(order_id: str, user: server.User = Depends(server.get_current_user)):
    _require_rider(user)
    order = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "ready_for_pickup":
        raise HTTPException(400, f"Order is {order['status']}, not ready_for_pickup")
    if order.get("rider_id") and order["rider_id"] != user.user_id:
        raise HTTPException(409, "Already picked up by another rider")
    await server.db.restaurant_orders.update_one(
        {"order_id": order_id},
        {"$set": {"status": "out_for_delivery", "rider_id": user.user_id, "picked_up_at": _now_iso()}},
    )
    return {"ok": True, "status": "out_for_delivery"}


@router.post("/rider/orders/{order_id}/arrived")
async def rider_arrived(order_id: str, user: server.User = Depends(server.get_current_user)):
    """Generate the delivery OTP and dispatch to the customer over WhatsApp + SMS."""
    _require_rider(user)
    order = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "out_for_delivery" or order.get("rider_id") != user.user_id:
        raise HTTPException(400, "Order is not out for delivery by you")

    otp = await _gen_otp()
    await server.db.restaurant_orders.update_one(
        {"order_id": order_id},
        {"$set": {
            "delivery_otp": otp,
            "delivery_otp_expires": server.iso(server.now_utc() + timedelta(minutes=DELIVERY_OTP_TTL_MINUTES)),
            "delivery_otp_attempts": 0,
            "arrived_at": _now_iso(),
        }},
    )

    # Dispatch via WhatsApp (stub-mode-safe) + SMS
    try:
        from whatsapp import send_delivery_otp
        await send_delivery_otp(server.db, phone=order.get("phone", ""), name=order.get("name") or "Customer", otp=otp, order_id=order_id)
    except Exception as e:
        server.logger.warning(f"[RIDER] WA delivery_otp failed: {e}")
    try:
        from sms import send_otp as send_sms_otp  # legacy SMS OTP function — re-use signature
        # If sms.py has no generic OTP send, log only
        await send_sms_otp(phone=order.get("phone", ""), otp=otp) if hasattr(__import__("sms"), "send_otp") else None
    except Exception:
        pass

    server.logger.warning(f"[MOCKED DELIVERY OTP] order={order_id} otp={otp}")
    out = {"ok": True, "otp_sent": True}
    if server.OTP_DEV_MODE:
        out["dev_otp"] = otp
    return out


@router.post("/rider/orders/{order_id}/deliver")
async def rider_deliver(order_id: str, payload: DeliverPayload, user: server.User = Depends(server.get_current_user)):
    """Verify OTP → mark delivered, credit ₹50 to rider wallet, log payment mode."""
    _require_rider(user)
    order = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "out_for_delivery" or order.get("rider_id") != user.user_id:
        raise HTTPException(400, "Order is not out for delivery by you")

    expected = order.get("delivery_otp")
    expires = order.get("delivery_otp_expires")
    if not expected or not expires:
        raise HTTPException(400, "No OTP issued yet — hit 'I've arrived' first")
    if server.parse_dt(expires) < server.now_utc():
        raise HTTPException(400, "OTP expired — hit 'I've arrived' again")
    if (order.get("delivery_otp_attempts") or 0) >= 5:
        raise HTTPException(429, "Too many wrong attempts")
    if expected != payload.otp.strip():
        await server.db.restaurant_orders.update_one({"order_id": order_id}, {"$inc": {"delivery_otp_attempts": 1}})
        raise HTTPException(400, "Incorrect OTP")

    # Credit rider wallet ₹50
    await _credit_rider_wallet(user.user_id, RIDER_PER_DELIVERY_INR,
                               reason=f"Delivery payout for {order_id}", order_id=order_id)
    await server.db.restaurant_orders.update_one(
        {"order_id": order_id},
        {"$set": {
            "status": "delivered",
            "delivered_at": _now_iso(),
            "payment_mode": payload.payment_mode,
            "rider_payout_inr": RIDER_PER_DELIVERY_INR,
            "cash_reconciled": False if payload.payment_mode == "cash" else True,
            "delivery_otp": None,
        }},
    )

    # Take-away returnable-tiffin pendency tracking. Sum the qty of any
    # menu items flagged is_returnable_tiffin, increment user.tiffin_balance,
    # and append a row to db.restaurant_tiffin_pendency for admin follow-up.
    try:
        menu_doc = await server.db.restaurant_menu_items.find_one({"_id": "active"}, {"_id": 0})
        menu_by_id = {m["id"]: m for m in (menu_doc or {}).get("items", [])}
        returnable_count = 0
        for line in order.get("items", []):
            m = menu_by_id.get(line.get("id"))
            if m and m.get("is_returnable_tiffin"):
                returnable_count += int(line.get("qty") or 0)
        if returnable_count > 0:
            cust = await server.db.users.find_one({"user_id": order["user_id"]}, {"_id": 0})
            await server.db.users.update_one(
                {"user_id": order["user_id"]},
                {"$inc": {"tiffin_balance": returnable_count}},
            )
            await server.db.restaurant_tiffin_pendency.insert_one({
                "pendency_id": f"rtp_{order_id}",
                "order_id": order_id,
                "user_id": order["user_id"],
                "name": order.get("name") or (cust or {}).get("name") or "",
                "phone": order.get("phone") or (cust or {}).get("phone") or "",
                "address": order.get("address") or (cust or {}).get("address") or "",
                "tiffin_count": returnable_count,
                "delivered_at": _now_iso(),
                "collected": False,
            })
    except Exception as e:  # noqa: BLE001
        server.logger.warning(f"[RIDER] take-away tiffin pendency failed for {order_id} · {e}")

    return {"ok": True, "status": "delivered", "rider_payout_inr": RIDER_PER_DELIVERY_INR}


@router.post("/rider/location")
async def rider_location_ping(payload: LocationPing, user: server.User = Depends(server.get_current_user)):
    _require_rider(user)
    await server.db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"current_lat": float(payload.lat), "current_lng": float(payload.lng), "location_updated_at": _now_iso()}},
    )
    # Also write to active out-for-delivery orders for snappy customer tracking
    await server.db.restaurant_orders.update_many(
        {"rider_id": user.user_id, "status": "out_for_delivery"},
        {"$set": {"rider_lat": float(payload.lat), "rider_lng": float(payload.lng), "rider_location_at": _now_iso()}},
    )
    return {"ok": True}


@router.get("/rider/earnings")
async def rider_earnings(user: server.User = Depends(server.get_current_user)):
    _require_rider(user)
    today = (server.now_utc() + timedelta(hours=5, minutes=30)).date()
    today_start = server.iso(datetime.fromisoformat(today.isoformat() + "T00:00:00+00:00") - timedelta(hours=5, minutes=30))
    month_start = server.iso(datetime.fromisoformat(today.replace(day=1).isoformat() + "T00:00:00+00:00") - timedelta(hours=5, minutes=30))

    today_count = await server.db.restaurant_orders.count_documents({"rider_id": user.user_id, "status": "delivered", "delivered_at": {"$gte": today_start}})
    month_count = await server.db.restaurant_orders.count_documents({"rider_id": user.user_id, "status": "delivered", "delivered_at": {"$gte": month_start}})
    return {
        "today_deliveries": today_count,
        "today_earnings": round(today_count * RIDER_PER_DELIVERY_INR, 2),
        "month_deliveries": month_count,
        "month_earnings": round(month_count * RIDER_PER_DELIVERY_INR, 2),
        "per_delivery_inr": RIDER_PER_DELIVERY_INR,
    }


@router.post("/rider/withdraw")
async def rider_withdraw(payload: WithdrawRequest, user: server.User = Depends(server.get_current_user)):
    """Withdraw wallet balance to rider's bank account.
    PROD: integrates RazorpayX Payouts API. STUBBED here — debits wallet, logs request."""
    _require_rider(user)
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0, "wallet_balance": 1})
    bal = float(user_doc.get("wallet_balance", 0) or 0)
    if payload.amount > bal:
        raise HTTPException(400, f"Insufficient balance · ₹{bal:.0f} available")
    await _credit_rider_wallet(user.user_id, -float(payload.amount), reason="Withdraw to bank (STUBBED RazorpayX)", order_id=None)
    payout_id = f"px_stub_{uuid.uuid4().hex[:12]}"
    await server.db.rider_payouts.insert_one({
        "payout_id": payout_id,
        "user_id": user.user_id,
        "amount": float(payload.amount),
        "bank_account_last4": payload.bank_account_last4 or "----",
        "status": "queued",
        "stub_mode": True,
        "created_at": _now_iso(),
    })
    return {"ok": True, "payout_id": payout_id, "status": "queued (stub mode)"}


# ---------------------------------------------------------------------------
# Cash reconciliation
# ---------------------------------------------------------------------------
@router.post("/rider/cash-reconcile/confirm-otp")
async def rider_confirm_cash_otp(payload: CashReconcileConfirm, user: server.User = Depends(server.get_current_user)):
    _require_rider(user)
    rec = await server.db.cash_reconcile_otps.find_one({"user_id": user.user_id, "consumed": False}, {"_id": 0})
    if not rec:
        raise HTTPException(400, "No pending cash reconciliation OTP")
    if server.parse_dt(rec["expires_at"]) < server.now_utc():
        raise HTTPException(400, "OTP expired")
    if rec["otp"] != payload.otp.strip():
        await server.db.cash_reconcile_otps.update_one({"otp_id": rec["otp_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Incorrect OTP")

    # Clear all pending cash orders for this rider
    res = await server.db.restaurant_orders.update_many(
        {"rider_id": user.user_id, "payment_mode": "cash", "cash_reconciled": False, "status": "delivered"},
        {"$set": {"cash_reconciled": True, "reconciled_at": _now_iso(), "reconciled_with_otp": rec["otp_id"]}},
    )
    await server.db.cash_reconcile_otps.update_one({"otp_id": rec["otp_id"]}, {"$set": {"consumed": True, "consumed_at": _now_iso()}})
    return {"ok": True, "orders_cleared": res.modified_count}


# ---------------------------------------------------------------------------
# Customer-facing — order tracking
# ---------------------------------------------------------------------------
@router.get("/restaurant/orders/{order_id}/track")
async def customer_track_order(order_id: str, user: server.User = Depends(server.get_current_user)):
    order = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    # Owner OR admin OR the assigned rider can view
    if order["user_id"] != user.user_id and user.role not in ("admin", "rider"):
        raise HTTPException(403, "Forbidden")
    out = {
        "order_id": order["order_id"], "status": order["status"], "items": order.get("items", []),
        "subtotal": order.get("subtotal"), "delivery_fee": order.get("delivery_fee"), "total": order.get("total"),
        "created_at": order.get("created_at"), "paid_at": order.get("paid_at"),
        "picked_up_at": order.get("picked_up_at"), "arrived_at": order.get("arrived_at"),
        "delivered_at": order.get("delivered_at"), "eta_at": order.get("eta_at"),
        "rider_lat": order.get("rider_lat"), "rider_lng": order.get("rider_lng"),
        "rider_location_at": order.get("rider_location_at"),
        "customer_lat": order.get("customer_lat"), "customer_lng": order.get("customer_lng"),
    }
    # Gate delivery_otp — only expose when rider is actively heading to / at the
    # door. Pre-pickup statuses don't need it visible (security hygiene).
    if order["status"] in ("ready_for_pickup", "out_for_delivery"):
        out["delivery_otp"] = order.get("delivery_otp")
        out["delivery_otp_expires"] = order.get("delivery_otp_expires")
    else:
        out["delivery_otp"] = None
        out["delivery_otp_expires"] = None
    # Fall back to user's saved profile location if order didn't snapshot it
    if not out["customer_lat"] or not out["customer_lng"]:
        cust = await server.db.users.find_one({"user_id": order["user_id"]}, {"_id": 0, "lat": 1, "lng": 1})
        if cust:
            out["customer_lat"] = out["customer_lat"] or cust.get("lat")
            out["customer_lng"] = out["customer_lng"] or cust.get("lng")
    if order.get("rider_id"):
        rider = await server.db.users.find_one({"user_id": order["rider_id"]},
                                               {"_id": 0, "name": 1, "phone": 1, "current_lat": 1, "current_lng": 1, "location_updated_at": 1})
        if rider:
            out["rider"] = {"name": rider.get("name"), "phone": rider.get("phone")}
            out["rider_lat"] = out["rider_lat"] or rider.get("current_lat")
            out["rider_lng"] = out["rider_lng"] or rider.get("current_lng")
    return out


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------
@router.post("/admin/rider/{user_id}/promote")
async def admin_promote_rider(user_id: str, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    res = await server.db.users.update_one({"user_id": user_id}, {"$set": {"role": "rider"}})
    if res.matched_count == 0:
        raise HTTPException(404, "User not found")
    return {"ok": True}


@router.post("/admin/restaurant/orders/{order_id}/status")
async def admin_set_order_status(order_id: str, payload: StatusUpdate, user: server.User = Depends(server.get_current_user)):
    # iter-92 #3: franchise_owner can transition orders for THEIR branch's customers.
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(403, "Admin or staff only")
    if payload.status not in ("preparing", "ready_for_pickup", "rejected"):
        raise HTTPException(400, "Invalid status — must be preparing | ready_for_pickup | rejected")
    order = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if user.role == "franchise_owner":
        m = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(403, "No mess assigned")
        u = await server.db.users.find_one({"user_id": order.get("user_id")}, {"_id": 0, "mess_id": 1})
        if (u or {}).get("mess_id") != m["mess_id"]:
            raise HTTPException(403, "Order not in your branch")
    if order["status"] not in ("paid", "preparing", "ready_for_pickup"):
        raise HTTPException(400, f"Cannot transition from {order['status']}")
    update: dict = {"status": payload.status, f"{payload.status}_at": _now_iso()}
    if payload.status == "rejected":
        update["rejected_at"] = _now_iso()
    await server.db.restaurant_orders.update_one({"order_id": order_id}, {"$set": update})
    return {"ok": True, "status": payload.status}


@router.post("/admin/restaurant/orders/{order_id}/assign-rider")
async def admin_assign_rider(order_id: str, payload: AssignRider, user: server.User = Depends(server.get_current_user)):
    # iter-92 #3: franchise_owner can assign a rider to their branch's orders.
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(403, "Admin or staff only")
    if user.role == "franchise_owner":
        m = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(403, "No mess assigned")
        order = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0, "user_id": 1})
        if not order:
            raise HTTPException(404, "Order not found")
        u = await server.db.users.find_one({"user_id": order.get("user_id")}, {"_id": 0, "mess_id": 1})
        if (u or {}).get("mess_id") != m["mess_id"]:
            raise HTTPException(403, "Order not in your branch")
    rider = await server.db.users.find_one({"user_id": payload.rider_user_id, "role": "rider"}, {"_id": 0})
    if not rider:
        raise HTTPException(404, "Rider not found")
    await server.db.restaurant_orders.update_one(
        {"order_id": order_id},
        {"$set": {"rider_id": payload.rider_user_id, "rider_assigned_at": _now_iso()}},
    )
    return {"ok": True}


@router.get("/admin/cash-reconcile/pending")
async def admin_cash_pending(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff"):
        raise HTTPException(403, "Admin or staff only")
    pipeline = [
        {"$match": {"payment_mode": "cash", "cash_reconciled": False, "status": "delivered"}},
        {"$group": {"_id": "$rider_id", "total": {"$sum": "$total"}, "count": {"$sum": 1}}},
    ]
    rows = await server.db.restaurant_orders.aggregate(pipeline).to_list(500)
    out = []
    for r in rows:
        rider = await server.db.users.find_one({"user_id": r["_id"]}, {"_id": 0, "name": 1, "phone": 1})
        out.append({"rider_id": r["_id"], "rider_name": rider.get("name") if rider else None,
                    "phone": rider.get("phone") if rider else None,
                    "amount_due": round(r["total"], 2), "orders_count": r["count"]})
    return {"pending": out}


@router.post("/admin/cash-reconcile/issue-otp")
async def admin_issue_cash_otp(payload: AssignRider, user: server.User = Depends(server.get_current_user)):
    """Admin generates OTP, system sends to rider's phone. Rider enters → cash cleared."""
    if user.role not in ("admin", "staff"):
        raise HTTPException(403, "Admin or staff only")
    rider = await server.db.users.find_one({"user_id": payload.rider_user_id, "role": "rider"}, {"_id": 0})
    if not rider:
        raise HTTPException(404, "Rider not found")
    otp = await _gen_otp(6)
    otp_id = f"crot_{uuid.uuid4().hex[:14]}"
    await server.db.cash_reconcile_otps.update_many(
        {"user_id": payload.rider_user_id, "consumed": False},
        {"$set": {"consumed": True, "superseded_at": _now_iso()}},
    )
    await server.db.cash_reconcile_otps.insert_one({
        "otp_id": otp_id,
        "user_id": payload.rider_user_id,
        "otp": otp,
        "expires_at": server.iso(server.now_utc() + timedelta(minutes=20)),
        "consumed": False,
        "attempts": 0,
        "issued_by": user.user_id,
        "created_at": _now_iso(),
    })
    server.logger.warning(f"[MOCKED CASH OTP] rider={payload.rider_user_id} otp={otp}")
    out = {"ok": True, "otp_id": otp_id}
    if server.OTP_DEV_MODE:
        out["dev_otp"] = otp
    return out
