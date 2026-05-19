"""Subscription router — read + pause/resume for end-users.

Extracted from server.py (iter-47 refactor). Subscribe + plan-purchase
endpoints stay in server.py for now (they're tightly coupled to Razorpay
order creation which lives there).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from shared import server

router = APIRouter()


@router.get("/my/subscription")
async def my_subscription(user: server.User = Depends(server.get_current_user)):
    sub = await server.get_active_subscription(user.user_id)
    if not sub:
        return {"active": False, "subscription": None}
    return {"active": True, "subscription": sub}


@router.post("/my/subscription/pause")
async def pause_my_subscription(user: server.User = Depends(server.get_current_user)):
    """Tiffin subscriber pauses delivery — they'll be skipped in roster generation.
    Wallet keeps deducting; once continuous pause exceeds 7 days, end-date auto-extends.
    """
    sub = await server.get_active_subscription(user.user_id)
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription")
    if sub.get("service_type") != "tiffin":
        raise HTTPException(
            status_code=400,
            detail="Only tiffin subscriptions can be paused — eat-in pass auto-pauses on 3+ skipped scans.",
        )
    if sub.get("user_paused"):
        return {"ok": True, "already": True, "subscription": sub}
    await server.db.subscriptions.update_one(
        {"sub_id": sub["sub_id"]},
        {"$set": {"user_paused": True, "user_pause_started_at": server.iso(server.now_utc())}},
    )
    fresh = await server.db.subscriptions.find_one({"sub_id": sub["sub_id"]}, {"_id": 0})
    return {"ok": True, "subscription": fresh}


@router.post("/my/subscription/resume")
async def resume_my_subscription(user: server.User = Depends(server.get_current_user)):
    sub = await server.get_active_subscription(user.user_id)
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription")
    if not sub.get("user_paused"):
        return {"ok": True, "already": True, "subscription": sub}
    await server.db.subscriptions.update_one(
        {"sub_id": sub["sub_id"]},
        {"$set": {"user_paused": False, "user_pause_started_at": None}},
    )
    fresh = await server.db.subscriptions.find_one({"sub_id": sub["sub_id"]}, {"_id": 0})
    return {"ok": True, "subscription": fresh}
