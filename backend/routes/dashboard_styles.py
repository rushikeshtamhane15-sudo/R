"""Iter-56: Admin CMS for subscriber-dashboard tile colors.

The two payment tiles on the subscriber dashboard (PendingCashOtpFlash +
PendingDuesCard) use editable backgrounds / text colours so the brand can be
tuned without a redeploy.

Singleton doc at db.dashboard_styles/_id='active'.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()

DEFAULTS = {
    "dues_bg": "",         # empty = inherit card-3d-amber default
    "dues_text": "",
    "otp_bg": "",
    "otp_text": "",
}


@router.get("/dashboard-styles")
async def get_styles():
    """Public — every logged-in subscriber needs it; no auth required for read."""
    doc = await server.db.dashboard_styles.find_one({"_id": "active"}, {"_id": 0}) or {}
    return {**DEFAULTS, **doc}


class DashStylesIn(BaseModel):
    dues_bg: str = Field(default="", max_length=200)
    dues_text: str = Field(default="", max_length=200)
    otp_bg: str = Field(default="", max_length=200)
    otp_text: str = Field(default="", max_length=200)


@router.put("/admin/dashboard-styles")
async def set_styles(payload: DashStylesIn, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.dashboard_styles.update_one(
        {"_id": "active"}, {"$set": payload.model_dump()}, upsert=True,
    )
    return {"ok": True, **payload.model_dump()}
