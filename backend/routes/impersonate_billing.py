"""Super-admin impersonation + platform-wallet top-up + billing cron — iter-158.

Endpoints:
  POST   /api/admin/impersonate/{mess_id}      → super-admin acts as mess X
  DELETE /api/admin/impersonate                → clear impersonation
  GET    /api/admin/impersonate                → current impersonation, if any

  POST   /api/mess-owner/platform-wallet/topup-order   → create Razorpay order
  POST   /api/mess-owner/platform-wallet/topup-verify  → verify + credit wallet

  POST   /api/admin/billing/run-now            → super-admin fires the cron manually
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Optional

import razorpay
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()


# ---------------------------------------------------------------- IMPERSONATE
@router.post("/admin/impersonate/{mess_id}")
async def impersonate(mess_id: str, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    m = await server.db.messes.find_one({"mess_id": mess_id}, {"_id": 0, "mess_id": 1, "name": 1})
    if not m:
        raise HTTPException(status_code=404, detail="Mess not found")
    await server.db.user_sessions.update_many(
        {"user_id": user.user_id},
        {"$set": {"impersonate_mess_id": mess_id, "impersonate_started_at": server.iso(server.now_utc())}},
    )
    return {"ok": True, "impersonating": m}


@router.delete("/admin/impersonate")
async def impersonate_clear(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.user_sessions.update_many(
        {"user_id": user.user_id},
        {"$unset": {"impersonate_mess_id": "", "impersonate_started_at": ""}},
    )
    return {"ok": True}


@router.get("/admin/impersonate")
async def impersonate_current(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    s = await server.db.user_sessions.find_one({"user_id": user.user_id, "impersonate_mess_id": {"$exists": True}}, {"_id": 0, "impersonate_mess_id": 1, "impersonate_started_at": 1})
    if not s:
        return {"active": False}
    m = await server.db.messes.find_one({"mess_id": s["impersonate_mess_id"]}, {"_id": 0, "mess_id": 1, "name": 1, "logo_url": 1})
    return {"active": True, "mess": m, "started_at": s.get("impersonate_started_at")}


# ---------------------------------------------------------------- PLATFORM WALLET TOP-UP
class TopupIn(BaseModel):
    amount: int = Field(..., ge=99, le=200000)


async def _resolve_current_mess(user: server.User, *, require_impersonation_for_admin: bool = False) -> dict:
    """Return the mess the caller is acting on: impersonated for admin, owned for franchise_owner.
    If `require_impersonation_for_admin` is True, admin MUST be impersonating — no default fallback
    (prevents accidental cross-mess writes when the admin forgets to select a mess)."""
    if user.role == "admin":
        s = await server.db.user_sessions.find_one({"user_id": user.user_id, "impersonate_mess_id": {"$exists": True}}, {"_id": 0, "impersonate_mess_id": 1})
        if s:
            m = await server.db.messes.find_one({"mess_id": s["impersonate_mess_id"]}, {"_id": 0})
            if m:
                return m
        if require_impersonation_for_admin:
            raise HTTPException(status_code=400, detail="Pick a mess first (Act as …) before running this action")
        m = await server.db.messes.find_one({"mess_id": server.DEFAULT_MESS_ID}, {"_id": 0})
        if m:
            return m
    if user.role == "franchise_owner":
        m = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0})
        if m:
            return m
    raise HTTPException(status_code=403, detail="No mess resolved for this account")


@router.post("/mess-owner/platform-wallet/topup-order")
async def wallet_topup_order(payload: TopupIn, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Mess-owner only")
    mess = await _resolve_current_mess(user, require_impersonation_for_admin=True)
    active_client, key_id, _mode = await server._resolve_razorpay_for_user({"mess_id": mess["mess_id"]})
    amount_paise = int(payload.amount) * 100
    receipt = f"pw_{uuid.uuid4().hex[:12]}"
    rzp_order = None
    if active_client is not None:
        try:
            rzp_order = active_client.order.create({
                "amount": amount_paise, "currency": "INR", "receipt": receipt, "payment_capture": 1,
                "notes": {"mess_id": mess["mess_id"], "kind": "platform_wallet_topup"},
            })
        except Exception:  # noqa: BLE001
            rzp_order = None
    order_id = rzp_order["id"] if rzp_order else f"order_mock_{uuid.uuid4().hex[:12]}"
    mock = rzp_order is None
    await server.db.platform_wallet_orders.insert_one({
        "order_id": order_id, "receipt": receipt, "mess_id": mess["mess_id"],
        "user_id": user.user_id, "amount": int(payload.amount), "amount_paise": amount_paise,
        "currency": "INR", "status": "created", "mock": mock, "created_at": server.iso(server.now_utc()),
    })
    return {"order_id": order_id, "amount_paise": amount_paise, "amount": int(payload.amount),
            "currency": "INR", "key_id": key_id or "rzp_test_MOCK", "mock": mock,
            "prefill": {"name": mess.get("name", ""), "contact": mess.get("owner_phone", "")}}


class TopupVerifyIn(BaseModel):
    order_id: str
    payment_id: Optional[str] = ""
    signature: Optional[str] = ""


@router.post("/mess-owner/platform-wallet/topup-verify")
async def wallet_topup_verify(payload: TopupVerifyIn, user: server.User = Depends(server.get_current_user)):
    order = await server.db.platform_wallet_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("user_id") != user.user_id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Not your order")
    # Signature check for real orders — REQUIRED, no bypass
    if not order.get("mock"):
        if not payload.signature or not payload.payment_id:
            raise HTTPException(status_code=400, detail="Missing Razorpay signature/payment_id")
        import hmac
        import hashlib
        mess = await server.db.messes.find_one({"mess_id": order["mess_id"]}, {"_id": 0, "razorpay_key_secret": 1})
        secret = (mess or {}).get("razorpay_key_secret") or server.RZP_SECRET
        body_str = f"{payload.order_id}|{payload.payment_id}"
        if hmac.new(secret.encode(), body_str.encode(), hashlib.sha256).hexdigest() != payload.signature:
            raise HTTPException(status_code=400, detail="Invalid Razorpay signature")
    # Credit platform wallet + record paid
    await server.db.messes.update_one({"mess_id": order["mess_id"]}, {"$inc": {"platform_wallet_balance": float(order["amount"])}})
    await server.db.platform_wallet_orders.update_one({"order_id": payload.order_id},
        {"$set": {"status": "paid", "payment_id": payload.payment_id or "", "paid_at": server.iso(server.now_utc())}})
    fresh = await server.db.messes.find_one({"mess_id": order["mess_id"]}, {"_id": 0, "platform_wallet_balance": 1})
    return {"ok": True, "new_balance": fresh.get("platform_wallet_balance", 0)}


# ---------------------------------------------------------------- BILLING CRON
async def run_platform_billing_once() -> dict:
    """Iterate every active mess, deduct monthly platform fee = active_users × rate.
    If wallet balance is negative for >grace_days, flip status to 'payment_pending'."""
    now = server.now_utc()
    processed = 0
    charged = 0
    restricted = 0
    async for m in server.db.messes.find({"status": {"$in": ["active", "payment_pending"]}}):
        mess_id = m["mess_id"]
        # Bill only once per calendar month per mess
        month_key = now.strftime("%Y-%m")
        last = m.get("platform_billed_month")
        if last == month_key and m.get("status") == "active":
            continue
        dining_rate = float(m.get("platform_charge_dining_per_user") or 100)
        tiffin_rate = float(m.get("platform_charge_tiffin_per_user") or 100)
        # Simple count for now: any active subscription counts as one user; split by plan_type if present.
        dining_users = await server.db.subscriptions.count_documents({"mess_id": mess_id, "status": "active", "$or": [{"plan_type": "dining"}, {"plan_type": {"$exists": False}}]})
        tiffin_users = await server.db.subscriptions.count_documents({"mess_id": mess_id, "status": "active", "plan_type": "tiffin"})
        bill = dining_users * dining_rate + tiffin_users * tiffin_rate
        wallet_before = float(m.get("platform_wallet_balance") or 0)
        wallet_after = round(wallet_before - bill, 2)
        grace_days = int(m.get("platform_wallet_grace_days") or 7)
        set_updates = {
            "platform_wallet_balance": wallet_after,
            "platform_billed_month": month_key,
            "platform_last_bill_amount": bill,
            "platform_last_bill_at": server.iso(now),
        }
        # If balance went negative and wasn't already negative, set overdue marker.
        if wallet_after < 0:
            if not m.get("platform_wallet_overdue_since"):
                set_updates["platform_wallet_overdue_since"] = server.iso(now)
            else:
                overdue_since = server.parse_dt(m["platform_wallet_overdue_since"])
                if (now - overdue_since).days >= grace_days:
                    set_updates["status"] = "payment_pending"
                    set_updates["restricted_at"] = server.iso(now)
                    restricted += 1
        else:
            # Cleared → unset overdue markers + restore active if not already restricted for other reasons
            set_updates["platform_wallet_overdue_since"] = None
            if m.get("status") == "payment_pending":
                set_updates["status"] = "active"
                set_updates["restricted_at"] = None
        await server.db.messes.update_one({"mess_id": mess_id}, {"$set": set_updates})
        await server.db.platform_bills.insert_one({
            "bill_id": f"pb_{uuid.uuid4().hex[:12]}", "mess_id": mess_id, "month": month_key,
            "dining_users": dining_users, "tiffin_users": tiffin_users,
            "dining_rate": dining_rate, "tiffin_rate": tiffin_rate,
            "amount": bill, "wallet_before": wallet_before, "wallet_after": wallet_after,
            "billed_at": server.iso(now),
        })
        processed += 1
        charged += bill
    return {"processed": processed, "charged_total": round(charged, 2), "restricted_count": restricted}


@router.post("/admin/billing/run-now")
async def admin_billing_run_now(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    r = await run_platform_billing_once()
    return {"ok": True, **r}
