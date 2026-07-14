"""Wallet router — read-only endpoints for end-users.

Extracted from server.py (iter-47 refactor).
iter-131.12: sub_id filter added to `/my/wallet/transactions` for the
             per-plan slider view in the new wallet drawer.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from shared import server

router = APIRouter()


@router.get("/my/wallet")
async def my_wallet(user: server.User = Depends(server.get_current_user)):
    sub = await server.get_active_subscription(user.user_id)
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
    # ensure tick is up to date
    await server.get_active_subscription(user.user_id)
    query: dict = {"user_id": user.user_id}
    if sub_id:
        query["sub_id"] = sub_id
    txns = await server.db.wallet_transactions.find(
        query, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return {"transactions": txns}
