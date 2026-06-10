"""Cash subscription + Partial / split payment flows.

`Cash` flow
-----------
Subscriber chooses "Pay in cash" at checkout. Backend:
  1) Creates a pending order (status="pending_cash") and a subscription
     in `status="pending_payment"` so the user shows up in admin's
     pending list. Wallet is NOT credited yet.
  2) Generates a 6-digit OTP, stored on the order. (Dev mode: OTP echoed
     in the response.)
  3) Admin (optional) can assign a staff to collect.
  4) Staff/admin enters the OTP after collecting the cash. On verify,
     subscription is activated, wallet credited, order marked paid,
     `deposit_slip_no` saved.

`Partial` flow (50% minimum upfront)
------------------------------------
At checkout, user can choose to pay only X (>= 50% of total) now via
Razorpay; the remainder is stored on the subscription as
`pending_amount`. Subscription activates with `amount_paid=down` only
(wallet credit = down). Balance can later be cleared via:
  * `POST /api/payments/partial-pay-balance` (online, generates an
    additional Razorpay order linked to the same sub)
  * `POST /api/admin/payments/partial-mark-cash-collected` (cash;
    requires OTP just like cash flow).

Admin dashboards
----------------
  * `GET /api/admin/payments/pending-cash` — pending cash orders
  * `GET /api/admin/payments/pending-partials` — subscriptions with
    pending_amount > 0
"""
from __future__ import annotations

import random
import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()

MIN_PARTIAL_FRACTION = 0.5  # user must pay >= 50% upfront

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _gen_otp() -> str:
    return f"{random.randint(0, 999999):06d}"


def _gen_slip_no() -> str:
    # SLIP-YYYYMMDD-XXXX (4-char random)
    from datetime import datetime, timezone
    return "SLIP-" + datetime.now(timezone.utc).strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:4].upper()


def _haversine_km(lat1, lon1, lat2, lon2):
    """Return great-circle distance in km."""
    from math import radians, sin, cos, asin, sqrt
    R = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * R * asin(min(1.0, sqrt(a)))


async def _enforce_serviceable_area(user_doc: dict):
    """Iter-54 #6: block subscription/restaurant purchase if user's saved
    location is outside the kitchen dispatch radius. Forces the customer to
    re-pin via /restaurant or profile flow."""
    lat = user_doc.get("lat")
    lng = user_doc.get("lng")
    if lat is None or lng is None:
        raise HTTPException(
            status_code=400,
            detail="Please pin your delivery location first — we need to confirm you are in our service area.",
            headers={"X-Action-Required": "update-location"},
        )
    settings = await server.db.delivery_settings.find_one({"_id": "active"}, {"_id": 0}) or {}
    klat = settings.get("dispatch_lat", 18.5204)
    klng = settings.get("dispatch_lng", 73.8567)
    radius_km = float(settings.get("dispatch_radius_km") or 15)
    d = _haversine_km(float(lat), float(lng), float(klat), float(klng))
    if d > radius_km:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Sorry — your location is {round(d, 1)} km from our kitchen, "
                f"outside our {round(radius_km)} km serviceable area. We currently "
                "cannot deliver to your address."
            ),
            headers={"X-Action-Required": "update-location"},
        )


async def _block_duplicate_active_plan(user_id: str, plan_id: str):
    """Iter-54 #7: a user cannot have two ACTIVE subscriptions of the same plan
    or two pending_cash orders for the same plan."""
    sub = await server.db.subscriptions.find_one(
        {"user_id": user_id, "plan_id": plan_id, "status": "active"}, {"_id": 0, "sub_id": 1},
    )
    if sub:
        raise HTTPException(
            status_code=400,
            detail=f"You already have an active '{plan_id}' subscription. Pick a different plan or wait until this one ends.",
        )
    pending = await server.db.payment_orders.find_one(
        {"user_id": user_id, "plan_id": plan_id, "status": "pending_cash"}, {"_id": 0, "order_id": 1},
    )
    if pending:
        raise HTTPException(
            status_code=400,
            detail=(
                "You already have a pending cash payment for this plan — please share "
                "the OTP with our staff to complete it, or ask an admin to cancel it before re-subscribing."
            ),
        )


async def _plan_from_payload(payload):
    """Resolve plan attributes from either standard plan_id OR custom-order kwargs."""
    if payload.plan_id and not payload.plan_id.startswith("custom_"):
        plan = await server.db.plans.find_one({"plan_id": payload.plan_id, "active": True}, {"_id": 0})
        if not plan:
            raise HTTPException(status_code=400, detail="Invalid or inactive plan")
        return {
            "plan_id": plan["plan_id"], "plan_name": plan["name"],
            "amount": float(plan["amount"]), "currency": plan["currency"],
            "duration_days": int(plan["duration_days"]), "meals": int(plan["meals"]),
            "service_type": plan.get("service_type") or "dining",
            "tiffin_size": plan.get("tiffin_size"),
            "plan_type": plan.get("plan_type") or "kiosk",
            "custom": False,
        }
    # Custom: derive from days/service_type/tiffin_size
    days = int(payload.days or 0)
    if days < server.CUSTOM_MIN_DAYS or days > server.CUSTOM_MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Days must be between {server.CUSTOM_MIN_DAYS} and {server.CUSTOM_MAX_DAYS}")
    meals = days * server.MEALS_PER_DAY
    service_type = (payload.service_type or "dining")
    tiffin_size = payload.tiffin_size if service_type == "tiffin" else None
    meal_price = server.MEAL_PRICE_HALF_INR if (service_type == "tiffin" and tiffin_size == "half") else server.MEAL_PRICE_INR
    amount = round(meals * meal_price, 2)
    name_suffix = "Tiffin" if service_type == "tiffin" else "Dining"
    if service_type == "tiffin" and tiffin_size:
        name_suffix = f"{tiffin_size.capitalize()} Tiffin"
    return {
        "plan_id": f"custom_{service_type}_{days}d",
        "plan_name": f"Custom {name_suffix} — {days} day{'s' if days > 1 else ''}",
        "amount": amount, "currency": "INR",
        "duration_days": days, "meals": meals,
        "service_type": service_type, "tiffin_size": tiffin_size,
        "plan_type": "delivery" if service_type == "tiffin" else "kiosk",
        "custom": True,
    }


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class CashOrPartialIn(BaseModel):
    # Standard plan id OR custom args:
    plan_id: Optional[str] = None
    days: Optional[int] = None
    service_type: Optional[str] = None
    tiffin_size: Optional[str] = None
    # Common
    notes: Optional[str] = None


class PartialOrderIn(CashOrPartialIn):
    down_payment: float = Field(..., gt=0, description="INR upfront (>= 50% of total)")


class MixPaymentIn(CashOrPartialIn):
    online_amount: float = Field(..., gt=0, description="Pay this amount via Razorpay")
    cash_amount: float = Field(..., gt=0, description="Pay this amount in cash to staff (OTP)")


class VerifyCashOtpIn(BaseModel):
    order_id: str
    otp: str
    deposit_slip_no: Optional[str] = None


class AssignStaffIn(BaseModel):
    order_id: str
    staff_user_id: str


# ---------------------------------------------------------------------------
# CASH FLOW
# ---------------------------------------------------------------------------
@router.post("/payments/cash-order")
async def create_cash_order(payload: CashOrPartialIn, user: server.User = Depends(server.get_current_user)):
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    missing = [f for f in ("name", "phone", "address") if not (user_doc.get(f) or "")]
    if missing:
        raise HTTPException(status_code=400, detail=f"Profile incomplete: missing {', '.join(missing)}")
    plan = await _plan_from_payload(payload)
    # Iter-54: geo + duplicate-plan guards
    await _enforce_serviceable_area(user_doc)
    await _block_duplicate_active_plan(user.user_id, plan["plan_id"])
    otp = _gen_otp()
    order_id = f"cash_{uuid.uuid4().hex[:14]}"
    receipt = f"rcpt_{uuid.uuid4().hex[:12]}"
    fee_pct = float(server.PLATFORM_FEE_PCT)
    platform_fee = round(plan["amount"] * fee_pct / 100.0, 2)
    total = round(plan["amount"] + platform_fee, 2)
    order_doc = {
        "order_id": order_id, "receipt": receipt,
        "user_id": user.user_id, "plan_id": plan["plan_id"], "plan_name": plan["plan_name"],
        "amount": total, "base_amount": plan["amount"],
        "platform_fee": platform_fee, "platform_fee_pct": fee_pct,
        "amount_paise": int(round(total * 100)),
        "currency": plan["currency"],
        "duration_days": plan["duration_days"], "meals": plan["meals"],
        "custom": plan["custom"],
        "status": "pending_cash",
        "mock": False, "payment_mode": "cash",
        "service_type": plan["service_type"], "tiffin_size": plan["tiffin_size"],
        "plan_type": plan["plan_type"],
        "cash_otp": otp,
        "cash_otp_attempts": 0,
        "assigned_staff_id": None,
        "deposit_slip_no": None,
        "collected_by": None,
        "collected_at": None,
        "notes": (payload.notes or "")[:300],
        "created_at": server.iso(server.now_utc()),
    }
    await server.db.payment_orders.insert_one(order_doc)
    # Stub WhatsApp/SMS notify customer (dev-mode: OTP shown directly in response too)
    try:
        from sms import send_whatsapp_text  # type: ignore
        await send_whatsapp_text(user_doc.get("phone"), f"eFoodCare cash payment OTP: {otp} — share with our staff after handing over cash for {plan['plan_name']}")
    except Exception:
        pass
    return {
        "order_id": order_id,
        "amount": total,
        "base_amount": plan["amount"],
        "platform_fee": platform_fee,
        "currency": plan["currency"],
        "plan_name": plan["plan_name"],
        "duration_days": plan["duration_days"],
        "meals": plan["meals"],
        "status": "pending_cash",
        "dev_otp": otp if server.OTP_DEV_MODE else None,
        "message": "Hand cash to staff. Staff will enter the OTP we sent to your phone.",
    }


@router.post("/admin/payments/cash-collect/assign")
async def cash_assign(payload: AssignStaffIn, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    staff = await server.db.users.find_one({"user_id": payload.staff_user_id}, {"_id": 0, "name": 1, "phone": 1, "role": 1})
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")
    if staff.get("role") not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=400, detail="Assignee must be admin or staff")
    r = await server.db.payment_orders.update_one(
        {"order_id": payload.order_id, "status": "pending_cash"},
        {"$set": {
            "assigned_staff_id": payload.staff_user_id,
            "assigned_staff_name": staff.get("name") or staff.get("phone"),
            "assigned_at": server.iso(server.now_utc()),
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Order not found / not pending")
    return {"ok": True}


@router.post("/admin/payments/cash-collect/resend-otp")
async def cash_resend_otp(order_id: str = Body(..., embed=True), user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    order = await server.db.payment_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("status") != "pending_cash":
        raise HTTPException(status_code=400, detail="Order not pending")
    otp = _gen_otp()
    await server.db.payment_orders.update_one(
        {"order_id": order_id},
        {"$set": {"cash_otp": otp, "cash_otp_attempts": 0, "otp_resent_at": server.iso(server.now_utc())}},
    )
    u = await server.db.users.find_one({"user_id": order["user_id"]}, {"_id": 0, "phone": 1, "name": 1})
    try:
        from sms import send_whatsapp_text  # type: ignore
        await send_whatsapp_text((u or {}).get("phone"), f"eFoodCare cash payment OTP (resent): {otp}")
    except Exception:
        pass
    return {"ok": True, "dev_otp": otp if server.OTP_DEV_MODE else None}


@router.post("/payments/cash-cancel")
async def cancel_my_cash_order(order_id: str = Body(..., embed=True), user: server.User = Depends(server.get_current_user)):
    """Iter-61 #7: subscriber can cancel their own pending_cash order if they
    raised it by mistake. Removes both the payment order entry AND the
    pending_payment subscription stub so the admin's pending list stays
    truthful in real time."""
    order = await server.db.payment_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("user_id") != user.user_id:
        raise HTTPException(status_code=403, detail="Not your order")
    if order.get("status") != "pending_cash":
        raise HTTPException(status_code=400, detail=f"Cannot cancel — order is in '{order.get('status')}' state")
    # Best-effort: nuke the matching pending subscription stub too
    sub_id = order.get("sub_id")
    if sub_id:
        await server.db.subscriptions.delete_one({"sub_id": sub_id, "status": "pending_payment"})
    await server.db.payment_orders.delete_one({"order_id": order_id})
    return {"ok": True, "order_id": order_id}


@router.post("/staff/cash-collect/verify-otp")
async def cash_verify_otp(payload: VerifyCashOtpIn, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    order = await server.db.payment_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("status") != "pending_cash":
        raise HTTPException(status_code=400, detail=f"Order is {order.get('status')}, not pending_cash")
    if (order.get("cash_otp_attempts") or 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many OTP attempts — admin must resend")
    if (payload.otp or "").strip() != (order.get("cash_otp") or ""):
        await server.db.payment_orders.update_one(
            {"order_id": payload.order_id}, {"$inc": {"cash_otp_attempts": 1}},
        )
        raise HTTPException(status_code=400, detail="Invalid OTP")
    # OTP correct → activate
    slip = payload.deposit_slip_no or _gen_slip_no()
    await server.db.payment_orders.update_one(
        {"order_id": payload.order_id},
        {"$set": {
            "deposit_slip_no": slip,
            "collected_by": user.user_id,
            "collected_at": server.iso(server.now_utc()),
            "payment_mode": "cash",
        }},
    )
    fresh = await server.db.payment_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    await server._activate_subscription(fresh)
    return {"ok": True, "deposit_slip_no": slip, "sub_id": (await server.db.payment_orders.find_one({"order_id": payload.order_id}, {"_id": 0})).get("sub_id")}


# ---------------------------------------------------------------------------
# PARTIAL / SPLIT FLOW
# ---------------------------------------------------------------------------
@router.post("/payments/partial-order")
async def create_partial_order(payload: PartialOrderIn, user: server.User = Depends(server.get_current_user)):
    """Pay a down-payment online via Razorpay. Remaining balance stored as
    `pending_amount` on the subscription after verify."""
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    missing = [f for f in ("name", "phone", "address") if not (user_doc.get(f) or "")]
    if missing:
        raise HTTPException(status_code=400, detail=f"Profile incomplete: missing {', '.join(missing)}")
    plan = await _plan_from_payload(payload)
    # Iter-54: geo + duplicate-plan guards
    await _enforce_serviceable_area(user_doc)
    await _block_duplicate_active_plan(user.user_id, plan["plan_id"])
    total = float(plan["amount"])
    down = round(float(payload.down_payment), 2)
    if down < total * MIN_PARTIAL_FRACTION:
        raise HTTPException(
            status_code=400,
            detail=f"Down payment must be at least 50% of ₹{total:.2f} (₹{round(total * MIN_PARTIAL_FRACTION, 2):.2f})",
        )
    if down > total:
        raise HTTPException(status_code=400, detail="Down payment cannot exceed plan amount")
    pending = round(total - down, 2)

    # Build a payment order for the DOWN amount + platform fee
    fee_pct = float(server.PLATFORM_FEE_PCT)
    platform_fee = round(down * fee_pct / 100.0, 2)
    payable = round(down + platform_fee, 2)
    receipt = f"rcpt_{uuid.uuid4().hex[:12]}"
    rzp_order = None
    if server.RZP_ENABLED:
        try:
            rzp_order = server.rzp_client.order.create({
                "amount": int(round(payable * 100)),
                "currency": plan["currency"],
                "receipt": receipt, "payment_capture": 1,
                "notes": {"plan_id": plan["plan_id"], "user_id": user.user_id, "partial": "true"},
            })
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RZP partial] order.create failed → MOCK · {e}")
            rzp_order = None
    if rzp_order is not None:
        order_id = rzp_order["id"]
        mock = False
    else:
        order_id = f"order_mock_{uuid.uuid4().hex[:14]}"
        mock = True
    await server.db.payment_orders.insert_one({
        "order_id": order_id, "receipt": receipt,
        "user_id": user.user_id, "plan_id": plan["plan_id"], "plan_name": plan["plan_name"],
        "amount": payable, "base_amount": down,
        "platform_fee": platform_fee, "platform_fee_pct": fee_pct,
        "amount_paise": int(round(payable * 100)),
        "currency": plan["currency"],
        "duration_days": plan["duration_days"], "meals": plan["meals"],
        "custom": plan["custom"],
        "status": "created", "mock": mock, "payment_mode": "online_partial",
        "service_type": plan["service_type"], "tiffin_size": plan["tiffin_size"],
        "plan_type": plan["plan_type"],
        # Partial-specific
        "is_partial": True,
        "partial_down": down,
        "partial_total": total,
        "partial_pending": pending,
        "created_at": server.iso(server.now_utc()),
    })
    return {
        "order_id": order_id,
        "amount": payable, "base_amount": down, "platform_fee": platform_fee,
        "currency": plan["currency"],
        "amount_paise": int(round(payable * 100)),
        "key_id": server.RZP_KEY_ID if server.RZP_ENABLED else "rzp_test_MOCK",
        "mock": mock,
        "plan_name": plan["plan_name"],
        "duration_days": plan["duration_days"], "meals": plan["meals"],
        "partial_total": total, "partial_pending": pending,
        "partial_surcharge": float(server.PARTIAL_PAYMENT_SURCHARGE_INR),
        "partial_pending_with_surcharge": round(pending + float(server.PARTIAL_PAYMENT_SURCHARGE_INR), 2),
        "prefill": {"name": user_doc.get("name", ""), "email": user_doc.get("email", ""), "contact": user_doc.get("phone", "")},
    }


@router.get("/my/partial-balance")
async def my_partial_balance(user: server.User = Depends(server.get_current_user)):
    """All active subscriptions where the user still owes money."""
    rows = await server.db.subscriptions.find(
        {"user_id": user.user_id, "pending_amount": {"$gt": 0}},
        {"_id": 0, "sub_id": 1, "plan_name": 1, "pending_amount": 1, "amount_paid": 1, "status": 1, "end_date": 1},
    ).to_list(50)
    total = sum(float(r.get("pending_amount") or 0) for r in rows)
    return {"items": rows, "total_pending": round(total, 2)}


@router.post("/payments/clear-partial-balance")
async def clear_partial_balance(sub_id: str = Body(..., embed=True), amount: float = Body(..., embed=True), user: server.User = Depends(server.get_current_user)):
    """Generate a Razorpay order for the remaining balance on a subscription.
    Wallet is NOT auto-credited again — pending_amount just zeroes out."""
    sub = await server.db.subscriptions.find_one({"sub_id": sub_id, "user_id": user.user_id}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    pending = round(float(sub.get("pending_amount") or 0), 2)
    if pending <= 0:
        raise HTTPException(status_code=400, detail="No pending balance")
    pay_amount = round(min(float(amount), pending), 2)
    if pay_amount < 1:
        raise HTTPException(status_code=400, detail="Amount too small")
    fee_pct = float(server.PLATFORM_FEE_PCT)
    platform_fee = round(pay_amount * fee_pct / 100.0, 2)
    payable = round(pay_amount + platform_fee, 2)
    receipt = f"rcpt_{uuid.uuid4().hex[:12]}"
    rzp_order = None
    if server.RZP_ENABLED:
        try:
            rzp_order = server.rzp_client.order.create({
                "amount": int(round(payable * 100)), "currency": "INR",
                "receipt": receipt, "payment_capture": 1,
                "notes": {"sub_id": sub_id, "user_id": user.user_id, "clear_partial": "true"},
            })
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RZP clear-partial] {e}")
            rzp_order = None
    order_id = rzp_order["id"] if rzp_order else f"order_mock_{uuid.uuid4().hex[:14]}"
    mock = rzp_order is None
    await server.db.payment_orders.insert_one({
        "order_id": order_id, "receipt": receipt,
        "user_id": user.user_id, "plan_id": sub["plan_id"], "plan_name": sub["plan_name"],
        "amount": payable, "base_amount": pay_amount,
        "platform_fee": platform_fee, "platform_fee_pct": fee_pct,
        "amount_paise": int(round(payable * 100)),
        "currency": "INR",
        "status": "created", "mock": mock, "payment_mode": "online_clear_partial",
        "linked_sub_id": sub_id,
        "is_partial_clear": True,
        "clear_amount": pay_amount,
        "created_at": server.iso(server.now_utc()),
    })
    return {
        "order_id": order_id, "amount": payable, "base_amount": pay_amount,
        "platform_fee": platform_fee,
        "amount_paise": int(round(payable * 100)),
        "key_id": server.RZP_KEY_ID if server.RZP_ENABLED else "rzp_test_MOCK",
        "mock": mock, "sub_id": sub_id,
    }


# ---------------------------------------------------------------------------
# Admin dashboards
# ---------------------------------------------------------------------------
@router.get("/admin/payments/pending-cash")
async def admin_pending_cash(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    rows = await server.db.payment_orders.find(
        {"status": "pending_cash"}, {"_id": 0, "cash_otp": 0},  # never expose OTP server-side
    ).sort("created_at", -1).to_list(200)
    # Enrich with user name/phone
    user_ids = list({r["user_id"] for r in rows})
    users = {u["user_id"]: u async for u in server.db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1})}
    for r in rows:
        u = users.get(r["user_id"]) or {}
        r["customer_name"] = u.get("name") or ""
        r["customer_phone"] = u.get("phone") or ""
    total_amt = sum(float(r.get("amount") or 0) for r in rows)
    return {"rows": rows, "count": len(rows), "total_amount": round(total_amt, 2)}


@router.get("/admin/payments/pending-partials")
async def admin_pending_partials(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    subs = await server.db.subscriptions.find(
        {"pending_amount": {"$gt": 0}}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    user_ids = list({s["user_id"] for s in subs})
    users = {u["user_id"]: u async for u in server.db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1})}
    for s in subs:
        u = users.get(s["user_id"]) or {}
        s["customer_name"] = u.get("name") or ""
        s["customer_phone"] = u.get("phone") or ""
    total_pending = sum(float(s.get("pending_amount") or 0) for s in subs)
    return {"rows": subs, "count": len(subs), "total_pending": round(total_pending, 2)}


@router.get("/admin/payments/staff-roster")
async def admin_staff_roster(user: server.User = Depends(server.get_current_user)):
    """List of admin+staff users for the assignment dropdown."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    staff = await server.db.users.find(
        {"role": {"$in": ["admin", "staff"]}},
        {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "role": 1},
    ).sort("name", 1).to_list(200)
    return {"staff": staff}


# ---------------------------------------------------------------------------
# Iter-54 #8: Admin can delete a stale pending_cash entry
# ---------------------------------------------------------------------------
@router.delete("/admin/payments/cash-collect/{order_id}")
async def admin_cancel_cash_entry(order_id: str, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    order = await server.db.payment_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("status") != "pending_cash":
        raise HTTPException(status_code=400, detail=f"Cannot delete — order status is '{order.get('status')}'")
    await server.db.payment_orders.update_one(
        {"order_id": order_id},
        {"$set": {
            "status": "cancelled",
            "cancelled_at": server.iso(server.now_utc()),
            "cancelled_by": user.user_id,
        }, "$unset": {"cash_otp": ""}},
    )
    return {"ok": True, "order_id": order_id}


# ---------------------------------------------------------------------------
# Iter-54 #1: My active pending-OTP cash order — surfaced on subscriber dash
# ---------------------------------------------------------------------------
@router.get("/my/pending-cash-otp")
async def my_pending_cash_otp(user: server.User = Depends(server.get_current_user)):
    """The subscriber's open pending_cash order(s) with the OTP so the
    dashboard can keep flashing it until staff verify. Limited to current
    user only — own data only."""
    rows = await server.db.payment_orders.find(
        {"user_id": user.user_id, "status": "pending_cash"}, {"_id": 0},
    ).sort("created_at", -1).to_list(20)
    return {"items": rows, "count": len(rows)}


# ---------------------------------------------------------------------------
# Iter-54 #9: Cash payment to clear partial-balance dues
# ---------------------------------------------------------------------------
@router.post("/payments/clear-partial-balance-cash")
async def clear_partial_balance_cash(sub_id: str = Body(..., embed=True), amount: float = Body(..., embed=True), user: server.User = Depends(server.get_current_user)):
    sub = await server.db.subscriptions.find_one({"sub_id": sub_id, "user_id": user.user_id}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    pending = round(float(sub.get("pending_amount") or 0), 2)
    if pending <= 0:
        raise HTTPException(status_code=400, detail="No pending balance")
    pay_amount = round(min(float(amount), pending), 2)
    if pay_amount < 1:
        raise HTTPException(status_code=400, detail="Amount too small")
    # Block duplicate pending cash-clear for the same sub
    dup = await server.db.payment_orders.find_one(
        {"user_id": user.user_id, "linked_sub_id": sub_id, "is_partial_clear": True, "status": "pending_cash"},
        {"_id": 0},
    )
    if dup:
        raise HTTPException(
            status_code=400,
            detail="You already have a pending cash payment for this subscription — share the OTP with staff to complete it.",
        )
    otp = _gen_otp()
    order_id = f"cash_{uuid.uuid4().hex[:14]}"
    receipt = f"rcpt_{uuid.uuid4().hex[:12]}"
    await server.db.payment_orders.insert_one({
        "order_id": order_id, "receipt": receipt,
        "user_id": user.user_id, "plan_id": sub["plan_id"], "plan_name": sub["plan_name"],
        "amount": pay_amount, "base_amount": pay_amount,
        "platform_fee": 0.0, "platform_fee_pct": 0.0,
        "amount_paise": int(round(pay_amount * 100)),
        "currency": "INR",
        "status": "pending_cash", "mock": False, "payment_mode": "cash",
        "linked_sub_id": sub_id,
        "is_partial_clear": True,
        "clear_amount": pay_amount,
        "cash_otp": otp, "cash_otp_attempts": 0,
        "assigned_staff_id": None,
        "deposit_slip_no": None,
        "collected_by": None,
        "collected_at": None,
        "created_at": server.iso(server.now_utc()),
    })
    return {
        "order_id": order_id,
        "amount": pay_amount,
        "currency": "INR",
        "status": "pending_cash",
        "dev_otp": otp if server.OTP_DEV_MODE else None,
        "message": "Hand cash to staff. Staff will verify the OTP we sent to your phone.",
    }



# ---------------------------------------------------------------------------
# Iter-55 #4: Mix payment — pay X online + Y in cash for the same subscription
# ---------------------------------------------------------------------------
@router.post("/payments/mix-order")
async def create_mix_order(payload: MixPaymentIn, user: server.User = Depends(server.get_current_user)):
    """User pays `online_amount` via Razorpay AND owes `cash_amount` to staff
    via OTP. Activates subscription with `amount_paid=online_amount`,
    `pending_amount=cash_amount`. The cash OTP is generated immediately."""
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    missing = [f for f in ("name", "phone", "address") if not (user_doc.get(f) or "")]
    if missing:
        raise HTTPException(status_code=400, detail=f"Profile incomplete: missing {', '.join(missing)}")
    plan = await _plan_from_payload(payload)
    await _enforce_serviceable_area(user_doc)
    await _block_duplicate_active_plan(user.user_id, plan["plan_id"])

    total = float(plan["amount"])
    online = round(float(payload.online_amount), 2)
    cash = round(float(payload.cash_amount), 2)
    summed = round(online + cash, 2)
    if abs(summed - total) > 0.5:
        raise HTTPException(
            status_code=400,
            detail=f"Mix amounts must sum to plan total ₹{total:.2f} (got ₹{summed:.2f})",
        )
    if online <= 0 or cash <= 0:
        raise HTTPException(status_code=400, detail="Both online and cash portions must be > 0")

    # Online piece: behave like a partial-order; pending_amount = cash side + ₹200 surcharge
    fee_pct = float(server.PLATFORM_FEE_PCT)
    platform_fee = round(online * fee_pct / 100.0, 2)
    payable = round(online + platform_fee, 2)
    receipt = f"rcpt_{uuid.uuid4().hex[:12]}"
    rzp_order = None
    if server.RZP_ENABLED:
        try:
            rzp_order = server.rzp_client.order.create({
                "amount": int(round(payable * 100)),
                "currency": plan["currency"],
                "receipt": receipt, "payment_capture": 1,
                "notes": {"plan_id": plan["plan_id"], "user_id": user.user_id, "mix": "true"},
            })
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RZP mix] {e}")
            rzp_order = None
    order_id = rzp_order["id"] if rzp_order else f"order_mock_{uuid.uuid4().hex[:14]}"
    mock = rzp_order is None
    await server.db.payment_orders.insert_one({
        "order_id": order_id, "receipt": receipt,
        "user_id": user.user_id, "plan_id": plan["plan_id"], "plan_name": plan["plan_name"],
        "amount": payable, "base_amount": online,
        "platform_fee": platform_fee, "platform_fee_pct": fee_pct,
        "amount_paise": int(round(payable * 100)),
        "currency": plan["currency"],
        "duration_days": plan["duration_days"], "meals": plan["meals"],
        "custom": plan["custom"],
        "status": "created", "mock": mock, "payment_mode": "mix",
        "service_type": plan["service_type"], "tiffin_size": plan["tiffin_size"],
        "plan_type": plan["plan_type"],
        # Mix-specific
        "is_partial": True,                # so activation puts the cash into pending_amount
        "partial_down": online,
        "partial_total": total,
        "partial_pending": cash,           # cash portion + later +₹200 surcharge in activation
        "mix_cash_amount": cash,
        "created_at": server.iso(server.now_utc()),
    })

    # Cash side: open the OTP record up-front so user can hand it to staff
    cash_otp = _gen_otp()
    cash_order_id = f"cash_{uuid.uuid4().hex[:14]}"
    await server.db.payment_orders.insert_one({
        "order_id": cash_order_id, "receipt": f"rcpt_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id, "plan_id": plan["plan_id"], "plan_name": plan["plan_name"] + " (cash leg)",
        "amount": cash, "base_amount": cash,
        "platform_fee": 0.0, "platform_fee_pct": 0.0,
        "amount_paise": int(round(cash * 100)),
        "currency": "INR",
        "status": "pending_cash", "mock": False, "payment_mode": "cash",
        "linked_online_order": order_id,
        "is_mix_cash_leg": True,
        "cash_otp": cash_otp, "cash_otp_attempts": 0,
        "assigned_staff_id": None, "deposit_slip_no": None,
        "collected_by": None, "collected_at": None,
        "created_at": server.iso(server.now_utc()),
    })

    return {
        "order_id": order_id,
        "amount": payable, "base_amount": online, "platform_fee": platform_fee,
        "currency": plan["currency"],
        "amount_paise": int(round(payable * 100)),
        "key_id": server.RZP_KEY_ID if server.RZP_ENABLED else "rzp_test_MOCK",
        "mock": mock,
        "plan_name": plan["plan_name"],
        "duration_days": plan["duration_days"], "meals": plan["meals"],
        "mix_cash_amount": cash, "mix_cash_otp": cash_otp if server.OTP_DEV_MODE else None,
        "mix_cash_order_id": cash_order_id,
        "prefill": {"name": user_doc.get("name", ""), "email": user_doc.get("email", ""), "contact": user_doc.get("phone", "")},
    }
