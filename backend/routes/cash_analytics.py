"""Iter-55: Cash totals + bank-deposit tracking + admin kitchen settings.

#11 — totals across Today / This month / Year + total not-yet-deposited in bank.
#10 — admin can update kitchen lat / lng / dispatch radius.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()

IST = timezone(timedelta(hours=5, minutes=30))


def _ist_now() -> datetime:
    return datetime.now(timezone.utc).astimezone(IST)


# ---------------------------------------------------------------------------
# Cash totals
# ---------------------------------------------------------------------------
@router.get("/admin/payments/cash-totals")
async def cash_totals(user: server.User = Depends(server.get_current_user), as_mess_id: str | None = None):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    # iter-95: branch-scope by user_id when caller is franchise or admin-as-branch.
    mid = await server.effective_mess_id(user, as_mess_id)
    user_ids = await server._users_in_mess(mid)
    branch_match: dict = {"user_id": {"$in": user_ids}} if user_ids is not None else {}

    now = _ist_now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)
    year_start = today_start.replace(month=1, day=1)

    pipe = [
        {"$match": {"status": "paid", "payment_mode": "cash", **branch_match}},
        {"$addFields": {"_paid_at": {"$ifNull": ["$collected_at", "$paid_at"]}}},
        {"$match": {"_paid_at": {"$ne": None}}},
        {"$group": {
            "_id": None,
            "today": {"$sum": {"$cond": [{"$gte": ["$_paid_at", today_start.isoformat()]}, "$amount", 0]}},
            "month": {"$sum": {"$cond": [{"$gte": ["$_paid_at", month_start.isoformat()]}, "$amount", 0]}},
            "year":  {"$sum": {"$cond": [{"$gte": ["$_paid_at", year_start.isoformat()]}, "$amount", 0]}},
            "all_time": {"$sum": "$amount"},
            "count_all_time": {"$sum": 1},
        }},
    ]
    rows = await server.db.payment_orders.aggregate(pipe).to_list(1)
    summary = rows[0] if rows else {"today": 0, "month": 0, "year": 0, "all_time": 0, "count_all_time": 0}

    # Pending-to-deposit-in-bank: collected cash that hasn't been marked deposited yet.
    pend_pipe = [
        {"$match": {"status": "paid", "payment_mode": "cash", "deposited_to_bank": {"$ne": True}, **branch_match}},
        {"$group": {"_id": None, "pending": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]
    pend_rows = await server.db.payment_orders.aggregate(pend_pipe).to_list(1)
    pending_deposit = pend_rows[0] if pend_rows else {"pending": 0, "count": 0}

    return {
        "today": round(float(summary.get("today") or 0), 2),
        "month": round(float(summary.get("month") or 0), 2),
        "year": round(float(summary.get("year") or 0), 2),
        "all_time": round(float(summary.get("all_time") or 0), 2),
        "count_all_time": int(summary.get("count_all_time") or 0),
        "pending_bank_deposit": round(float(pending_deposit.get("pending") or 0), 2),
        "pending_bank_deposit_count": int(pending_deposit.get("count") or 0),
    }


@router.get("/admin/payments/cash-pending-deposit")
async def cash_pending_deposit(user: server.User = Depends(server.get_current_user), as_mess_id: str | None = None):
    """List collected cash orders that haven't been marked as deposited yet."""
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    mid = await server.effective_mess_id(user, as_mess_id)
    user_ids = await server._users_in_mess(mid)
    q: dict = {"status": "paid", "payment_mode": "cash", "deposited_to_bank": {"$ne": True}}
    if user_ids is not None:
        q["user_id"] = {"$in": user_ids}
    rows = await server.db.payment_orders.find(
        q,
        {"_id": 0, "cash_otp": 0},
    ).sort("collected_at", -1).to_list(500)
    user_ids = list({r["user_id"] for r in rows})
    users = {u["user_id"]: u async for u in server.db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1})}
    for r in rows:
        u = users.get(r["user_id"]) or {}
        r["customer_name"] = u.get("name") or ""
        r["customer_phone"] = u.get("phone") or ""
    total = sum(float(r.get("amount") or 0) for r in rows)
    return {"rows": rows, "count": len(rows), "total_amount": round(total, 2)}


class MarkDepositIn(BaseModel):
    order_ids: list[str] = Field(min_items=1)
    bank_ref: str | None = None


@router.post("/admin/payments/mark-deposited")
async def mark_deposited(payload: MarkDepositIn, user: server.User = Depends(server.get_current_user), as_mess_id: str | None = None):
    """Mark a batch of cash orders as deposited in the company's bank account.
    iter-95: franchise can mark their own branch's orders. Admin can override
    via ?as_mess_id=... For both, only orders whose user_id is in scope succeed.
    """
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)
    user_ids = await server._users_in_mess(mid)
    q: dict = {"order_id": {"$in": payload.order_ids}, "status": "paid", "payment_mode": "cash"}
    if user_ids is not None:
        q["user_id"] = {"$in": user_ids}
    r = await server.db.payment_orders.update_many(
        q,
        {"$set": {
            "deposited_to_bank": True,
            "deposited_at": server.iso(server.now_utc()),
            "deposited_by": user.user_id,
            "bank_ref": (payload.bank_ref or "")[:80],
        }},
    )
    return {"updated": r.modified_count}


# ---------------------------------------------------------------------------
# Kitchen / dispatch settings
# ---------------------------------------------------------------------------
class KitchenSettingsIn(BaseModel):
    dispatch_lat: float = Field(ge=-90, le=90)
    dispatch_lng: float = Field(ge=-180, le=180)
    dispatch_radius_km: float = Field(ge=0.5, le=200)
    address_label: str | None = None


@router.get("/admin/kitchen-settings")
async def get_kitchen(user: server.User = Depends(server.get_current_user), as_mess_id: str | None = None):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    # iter-95: per-mess kitchen settings. mess_id=None ⇒ HQ-global doc.
    mid = await server.effective_mess_id(user, as_mess_id)
    doc_id = mid or "active"
    doc = await server.db.delivery_settings.find_one({"_id": doc_id}, {"_id": 0})
    if not doc and mid:
        # Fall back to HQ defaults until the branch saves its own
        doc = await server.db.delivery_settings.find_one({"_id": "active"}, {"_id": 0})
    doc = doc or {}
    return {
        "dispatch_lat": float(doc.get("dispatch_lat") or 18.5204),
        "dispatch_lng": float(doc.get("dispatch_lng") or 73.8567),
        "dispatch_radius_km": float(doc.get("dispatch_radius_km") or 15),
        "address_label": doc.get("address_label") or "Pune, Maharashtra",
        "scope": "branch" if mid else "global",
        "mess_id": mid,
    }


# Public endpoint for the frontend to know the kitchen so maps can centre + lock view.
@router.get("/kitchen-location")
async def public_kitchen():
    doc = await server.db.delivery_settings.find_one({"_id": "active"}, {"_id": 0}) or {}
    return {
        "dispatch_lat": float(doc.get("dispatch_lat") or 18.5204),
        "dispatch_lng": float(doc.get("dispatch_lng") or 73.8567),
        "dispatch_radius_km": float(doc.get("dispatch_radius_km") or 15),
        "address_label": doc.get("address_label") or "Pune, Maharashtra",
    }


@router.put("/admin/kitchen-settings")
async def set_kitchen(payload: KitchenSettingsIn, user: server.User = Depends(server.get_current_user), as_mess_id: str | None = None):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)
    doc_id = mid or "active"
    update = payload.model_dump()
    update["updated_at"] = server.iso(server.now_utc())
    await server.db.delivery_settings.update_one({"_id": doc_id}, {"$set": update}, upsert=True)
    return {"ok": True, **update, "scope": "branch" if mid else "global", "mess_id": mid}
