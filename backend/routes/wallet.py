"""Wallet router — read-only endpoints for end-users.

Extracted from server.py (iter-47 refactor).
iter-131.12: sub_id filter added to `/my/wallet/transactions` for the
             per-plan slider view in the new wallet drawer.
iter-140.k: lazy joining-credit backfill — every active sub gets a
            "Joining · <plan> · started <date>" ledger row auto-created
            the first time its owner opens the wallet, so admins don't
            have to remember to tap the backfill button.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query

from shared import server

router = APIRouter()


async def _ensure_joining_credit(user_id: str) -> None:
    """Insert a `joining_credit` row for every active sub of this user
    that doesn't already have one. Idempotent and cheap enough to run on
    each wallet fetch."""
    async for sub in server.db.subscriptions.find(
        {"user_id": user_id, "status": "active"},
        {"_id": 0, "sub_id": 1, "start_date": 1, "plan_amount": 1,
         "amount_paid": 1, "per_day_amount": 1, "plan_name": 1, "service_type": 1},
    ):
        sid = sub.get("sub_id")
        if not sid:
            continue
        already = await server.db.wallet_transactions.find_one(
            {"sub_id": sid, "kind": "joining_credit"},
            {"_id": 0, "txn_id": 1},
        )
        if already:
            continue
        start_str = str(sub.get("start_date") or "")[:10]
        if not start_str:
            continue
        plan_amount = float(
            sub.get("plan_amount")
            or sub.get("amount_paid")
            or (float(sub.get("per_day_amount") or 0) * 30)
        )
        plan_name = sub.get("plan_name") or "30-day plan"
        service_type = sub.get("service_type") or "dining"
        await server.db.wallet_transactions.insert_one({
            "txn_id": f"wtxn_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "sub_id": sid,
            "type": "credit",
            "amount": round(plan_amount, 2),
            "balance_after": round(plan_amount, 2),
            "reason": f"Joining · {plan_name} · started {start_str}",
            "created_at": f"{start_str}T00:00:00+05:30",
            "kind": "joining_credit",
            "service_type": service_type,
            "start_date": start_str,
        })


@router.get("/my/wallet")
async def my_wallet(user: server.User = Depends(server.get_current_user)):
    sub = await server.get_active_subscription(user.user_id)
    await _ensure_joining_credit(user.user_id)
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return {
        "wallet_balance": round(float(user_doc.get("wallet_balance", 0)), 2),
        "subscription": sub,
        "per_day_amount": sub["per_day_amount"] if sub else 0,
        "paused_days": sub.get("paused_days", 0) if sub else 0,
        "inactivity_threshold_days": server.INACTIVITY_THRESHOLD_DAYS,
    }


@router.get("/my/wallet/transactions")
async def my_wallet_transactions(
    sub_id: Optional[str] = Query(default=None, description="Restrict to a single subscription"),
    user: server.User = Depends(server.get_current_user),
):
    # ensure tick is up to date + joining row exists
    await server.get_active_subscription(user.user_id)
    await _ensure_joining_credit(user.user_id)
    query: dict = {"user_id": user.user_id}
    if sub_id:
        query["sub_id"] = sub_id
    txns = await server.db.wallet_transactions.find(
        query, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return {"transactions": txns}
