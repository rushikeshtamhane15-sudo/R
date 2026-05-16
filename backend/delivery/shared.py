"""
Tiffin delivery system — daily roster + reconciliation.

Entities
--------
delivery_settings  : single doc {_id:'active'} with cutoff times + service pincodes
delivery_boys      : {boy_id, name, phone, active, assigned_pincodes:[]}
daily_rosters      : per-(date, meal_type, sub_id) tiffin item — see ROSTER_FIELDS
delivery_handoffs  : per-(date, meal_type, boy_id) batch — tiffins handed out vs returned

Rules
-----
* Roster auto-generated on first GET each day if not yet generated.
* A subscription is included for both 'lunch' and 'dinner' rosters every day until expiry.
* Pincode is auto-extracted from address (first 6-digit run); fallback group = 'unknown'.
* Pincodes outside service_pincodes are tagged is_outside=True so admin can exclude.
* Reconciliation: tiffins_handed = sum(items handed) ; tiffins_returned must come from items
  marked 'returned'/'undelivered'. Anything left over is flagged as `loss_count`.
* Geofence: when admin/boy marks delivered with GPS, server computes distance to customer's
  saved coords and stores it. >250m is recorded as `distance_warning=True` (not blocked).
* Customer self-confirm: customer hits /api/my/deliveries/{roster_id}/confirm to mark
  delivered without OTP — bypasses the geofence check (the customer is the witness).
"""
from __future__ import annotations

import math
import re
import secrets
from datetime import date as date_cls, datetime, time, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from logging import getLogger
logger = getLogger("efoodcare.delivery")

PIN_RE = re.compile(r"\b(\d{6})\b")
MEALS = ("lunch", "dinner")

# Default settings — admin can override via /api/admin/delivery/settings
DEFAULT_SETTINGS = {
    "lunch_cutoff": "11:00",
    "dinner_cutoff": "18:00",
    "service_pincodes": [],   # empty = treat all as in-service
    "lunch_otp_required": True,
    "dinner_otp_required": True,
    "geofence_meters": 10,
    # Slot windows — boy can only start dispatch within these IST windows
    "lunch_dispatch_open": "08:00",
    "lunch_dispatch_close": "14:00",
    "dinner_dispatch_open": "15:00",
    "dinner_dispatch_close": "22:00",
    # Kitchen / dispatch location — anchors the map and the 15km radius
    "dispatch_lat": None,
    "dispatch_lng": None,
    "dispatch_radius_km": 15,
}


def _ist_now() -> datetime:
    return now_utc().astimezone(timezone(timedelta(hours=5, minutes=30)))


def _parse_hhmm(s: str) -> tuple[int, int]:
    try:
        h, m = s.split(":")
        return int(h), int(m)
    except Exception:
        return 0, 0


def _slot_open_now(settings: dict, meal_type: str) -> tuple[bool, str]:
    """Return (is_open, reason). Reason is empty when open, otherwise a friendly hint."""
    now = _ist_now()
    cur_min = now.hour * 60 + now.minute
    if meal_type == "lunch":
        oh, om = _parse_hhmm(settings.get("lunch_dispatch_open") or "08:00")
        ch, cm = _parse_hhmm(settings.get("lunch_dispatch_close") or "14:00")
    else:
        oh, om = _parse_hhmm(settings.get("dinner_dispatch_open") or "15:00")
        ch, cm = _parse_hhmm(settings.get("dinner_dispatch_close") or "22:00")
    open_min = oh * 60 + om
    close_min = ch * 60 + cm
    if open_min <= cur_min <= close_min:
        return True, ""
    if cur_min < open_min:
        return False, f"{meal_type.capitalize()} dispatch opens at {oh:02d}:{om:02d}"
    return False, f"{meal_type.capitalize()} dispatch closed at {ch:02d}:{cm:02d}"


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return float(2 * R * math.asin(math.sqrt(a)))


# Body models — kept at module scope so FastAPI/Pydantic can fully resolve them.
class SettingsPatch(BaseModel):
    lunch_cutoff: str | None = None
    dinner_cutoff: str | None = None
    service_pincodes: list[str] | None = None
    lunch_otp_required: bool | None = None
    dinner_otp_required: bool | None = None
    geofence_meters: int | None = None
    lunch_dispatch_open: str | None = None
    lunch_dispatch_close: str | None = None
    dinner_dispatch_open: str | None = None
    dinner_dispatch_close: str | None = None
    dispatch_lat: float | None = None
    dispatch_lng: float | None = None
    dispatch_radius_km: float | None = None
    reminder_enabled: bool | None = None
    reminder_lead_minutes: int | None = None


class CollectEmpty(BaseModel):
    user_id: str
    count: int = 1
    notes: str | None = None


class BoyCreate(BaseModel):
    name: str
    phone: str
    assigned_pincodes: list[str] = Field(default_factory=list)
    active: bool = True


class BoyPatch(BaseModel):
    name: str | None = None
    phone: str | None = None
    assigned_pincodes: list[str] | None = None
    active: bool | None = None


class HandoffCreate(BaseModel):
    date: str | None = None
    meal_type: str
    delivery_boy_id: str
    roster_ids: list[str]
    tiffins_taken_full: int
    tiffins_taken_half: int


class MarkItem(BaseModel):
    status: str   # delivered | undelivered | returned
    otp: str | None = None
    notes: str | None = None
    lat: float | None = None
    lng: float | None = None


class LocationPing(BaseModel):
    lat: float
    lng: float
    accuracy: float | None = None


class DispatchStart(BaseModel):
    meal_type: str   # lunch | dinner


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


def today_local() -> str:
    """Service-day key in IST (yyyy-mm-dd)."""
    ist = timezone(timedelta(hours=5, minutes=30))
    return now_utc().astimezone(ist).date().isoformat()


def extract_pincode(address: str | None) -> str:
    if not address:
        return "unknown"
    m = PIN_RE.search(address)
    return m.group(1) if m else "unknown"


def gen_otp() -> str:
    return f"{secrets.randbelow(10000):04d}"


async def _record_empty_collection_db(db, user_id: str, count: int, notes: str | None, source: str) -> dict:
    """Decrement the user's tiffin_balance and log the movement. Used by admin + boy routers."""
    if count <= 0:
        raise HTTPException(status_code=400, detail="count must be > 0")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    held = int(user.get("tiffin_balance") or 0)
    if held <= 0:
        raise HTTPException(status_code=400, detail="No empty tiffins outstanding for this customer")
    take = min(count, held)
    await db.users.update_one({"user_id": user_id}, {"$inc": {"tiffin_balance": -take}})
    await db.tiffin_movements.insert_one({
        "ts": iso(now_utc()),
        "kind": "collected",
        "user_id": user_id,
        "delta": -take,
        "source": source,
        "notes": notes or "",
    })
    return {"ok": True, "collected": take, "remaining": max(0, held - take)}


async def _load_settings_db(db) -> dict:
    s = await db.delivery_settings.find_one({"_id": "active"}, {"_id": 0})
    if not s:
        await db.delivery_settings.insert_one({"_id": "active", **DEFAULT_SETTINGS})
        return dict(DEFAULT_SETTINGS)
    return {**DEFAULT_SETTINGS, **s}



