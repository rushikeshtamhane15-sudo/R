"""Subscription router — read + pause/resume for end-users.

Extracted from server.py (iter-47 refactor). Subscribe + plan-purchase
endpoints stay in server.py for now (they're tightly coupled to Razorpay
order creation which lives there).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

from shared import server

router = APIRouter()


# === Iter-52: per-user tiffin food preferences ===
# Tiffin subscribers can opt in/out of specific items (rice, dal, chapati,
# sabji) so the dispatch team knows what to actually pack. Plan amount is
# unchanged — this is a premium UX touch that also reduces food waste.
ALLOWED_PREF_KEYS = {"rice", "dal", "chapati", "sabji"}


class TiffinPreferences(BaseModel):
    rice: bool = True
    dal: bool = True
    chapati: bool = True
    sabji: bool = True
    chapati_count: Optional[int] = None  # 0..8; None = plan default


@router.get("/my/tiffin/preferences")
async def get_my_tiffin_preferences(user: server.User = Depends(server.get_current_user)):
    """Return saved tiffin food prefs (defaults to all-on if never set)."""
    sub = await server.get_active_subscription(user.user_id)
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription")
    prefs = sub.get("tiffin_preferences") or {
        "rice": True, "dal": True, "chapati": True, "sabji": True, "chapati_count": None,
    }
    return prefs


@router.put("/my/tiffin/preferences")
async def update_my_tiffin_preferences(
    payload: TiffinPreferences = Body(...),
    user: server.User = Depends(server.get_current_user),
):
    """Save tiffin food preferences. Applies from the NEXT dispatch cycle —
    today's already-generated dispatch list is intentionally NOT mutated to
    avoid double-changes mid-day. Admin's roster view will pick up the new
    prefs automatically because it reads from `subscriptions.tiffin_preferences`.
    """
    sub = await server.get_active_subscription(user.user_id)
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription")
    if (sub.get("service_type") or "").lower() != "tiffin":
        raise HTTPException(
            status_code=400,
            detail="Tiffin food preferences only apply to tiffin (home-delivery) subscriptions.",
        )
    # Clamp chapati_count to 0..8 to prevent abuse
    cnt = payload.chapati_count
    if cnt is not None:
        cnt = max(0, min(8, int(cnt)))
    prefs = {
        "rice": bool(payload.rice),
        "dal": bool(payload.dal),
        "chapati": bool(payload.chapati),
        "sabji": bool(payload.sabji),
        "chapati_count": cnt,
        "updated_at": server.iso(server.now_utc()),
    }
    await server.db.subscriptions.update_one(
        {"sub_id": sub["sub_id"]},
        {"$set": {"tiffin_preferences": prefs}},
    )
    return prefs


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
