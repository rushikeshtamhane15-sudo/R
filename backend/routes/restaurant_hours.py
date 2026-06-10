"""Restaurant operating hours — iter-79 Batch B #4.

Single-document config in `restaurant_hours_config` collection controls
whether the restaurant accepts online orders. Three modes:

  - ``manual_on``  — admin force-ON. Always open. Capacity still applies.
  - ``manual_off`` — admin force-OFF. Closed regardless of hours.
  - ``auto``       — open when *now* is inside `[open_time, close_time]`
                     on the user's local day (Asia/Kolkata).

Capacity gate: if `capacity_per_hour > 0`, the kitchen also closes when the
count of restaurant_orders created in the current rolling hour exceeds the
limit (used by busy lunchtimes to throttle).

Public endpoint `GET /api/restaurant/status` is what the frontend polls.
Admin endpoints under `/api/admin/restaurant/hours` configure it.

Order creation in `routes/restaurant_orders.py` calls `_assert_open()`
which raises HTTP 423 with a user-friendly message when closed.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone, time as dtime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()

IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_OPEN = "10:00"
DEFAULT_CLOSE = "22:00"
DEFAULT_MESSAGE = "We only deliver between our standard working hours"
SETTINGS_KEY = "restaurant_hours"


def _settings_key_for_mess(mess_id: str | None) -> str:
    """iter-85: per-branch hours config — admin (no branch) uses the legacy
    key `restaurant_hours`; each mess has its own `restaurant_hours:{mess_id}`."""
    if not mess_id:
        return SETTINGS_KEY
    return f"{SETTINGS_KEY}:{mess_id}"


async def _resolve_caller_mess_id(user: "server.User") -> str | None:
    """Look up the mess_id owned by a franchise_owner. Admins return None
    so they keep using the global config (or pass mess_id explicitly)."""
    if user.role != "franchise_owner":
        return None
    doc = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
    return (doc or {}).get("mess_id")


def _hhmm_to_time(s: str) -> dtime:
    h, m = (int(x) for x in s.split(":", 1))
    return dtime(hour=h, minute=m)


async def _load_config(mess_id: str | None = None) -> dict:
    key = _settings_key_for_mess(mess_id)
    doc = await server.db.app_settings.find_one({"_id": key}, {"_id": 0})
    # Fall back to the global config if no per-branch override exists yet.
    if not doc and mess_id:
        doc = await server.db.app_settings.find_one({"_id": SETTINGS_KEY}, {"_id": 0})
    cfg = {
        "mode": "auto",
        "open_time": DEFAULT_OPEN,
        "close_time": DEFAULT_CLOSE,
        "capacity_per_hour": 0,  # 0 = unlimited
        "closed_message": DEFAULT_MESSAGE,
    }
    if doc:
        cfg.update({k: v for k, v in doc.items() if k in cfg})
    return cfg


async def _hourly_order_count(mess_id: str | None = None) -> int:
    """How many restaurant orders were created in the last 60 min (optionally
    scoped to a specific mess)."""
    since = server.now_utc() - timedelta(minutes=60)
    q: dict = {"created_at": {"$gte": server.iso(since)}}
    if mess_id:
        q["mess_id"] = mess_id
    return await server.db.restaurant_orders.count_documents(q)


def _next_open_at_ist(now_ist: datetime, open_time: dtime, close_time: dtime) -> datetime:
    """Return the next time the kitchen will open in IST.

    If `now < open_time` today → today at open_time.
    If `now > close_time` today → tomorrow at open_time.
    Else (we are inside hours but mode=manual_off / capacity full)
    → tomorrow at open_time.
    """
    today_open = now_ist.replace(hour=open_time.hour, minute=open_time.minute, second=0, microsecond=0)
    today_close = now_ist.replace(hour=close_time.hour, minute=close_time.minute, second=0, microsecond=0)
    if now_ist < today_open:
        return today_open
    if now_ist >= today_close:
        return today_open + timedelta(days=1)
    # Inside open window but forced closed → next "fresh window" is tomorrow's open.
    return today_open + timedelta(days=1)


async def _compute_status(mess_id: str | None = None) -> dict:
    cfg = await _load_config(mess_id)
    now_ist = datetime.now(IST)
    open_t = _hhmm_to_time(cfg["open_time"])
    close_t = _hhmm_to_time(cfg["close_time"])

    reason: Optional[str] = None
    is_open = True

    if cfg["mode"] == "manual_off":
        is_open = False
        reason = "manual_off"
    elif cfg["mode"] == "auto":
        if not (open_t <= now_ist.time() < close_t):
            is_open = False
            reason = "outside_hours"

    # Capacity gate applies in all open modes (manual_on + auto).
    if is_open and cfg["capacity_per_hour"] > 0:
        count = await _hourly_order_count(mess_id)
        if count >= cfg["capacity_per_hour"]:
            is_open = False
            reason = "capacity_full"

    next_open: Optional[datetime] = None
    opens_in_minutes: Optional[int] = None
    if not is_open:
        next_open = _next_open_at_ist(now_ist, open_t, close_t)
        opens_in_minutes = max(0, int((next_open - now_ist).total_seconds() // 60))

    return {
        "open": is_open,
        "reason": reason,
        "next_open_at": next_open.isoformat() if next_open else None,
        "opens_in_minutes": opens_in_minutes,
        "open_time": cfg["open_time"],
        "close_time": cfg["close_time"],
        "mode": cfg["mode"],
        "closed_message": cfg["closed_message"],
    }


async def _assert_open(mess_id: str | None = None) -> None:
    """Raise HTTP 423 with user-friendly detail if restaurant is closed.

    Called from the restaurant order creation path so we block at the
    earliest possible point (no Razorpay order generated when closed).
    """
    status = await _compute_status(mess_id)
    if not status["open"]:
        # 423 Locked maps well to "service temporarily unavailable".
        raise HTTPException(
            status_code=423,
            detail={
                "code": status["reason"] or "closed",
                "message": status["closed_message"],
                "opens_in_minutes": status["opens_in_minutes"],
                "next_open_at": status["next_open_at"],
            },
        )


# ---------------------------------------------------------------------------
# Public — used by Restaurant.jsx + popup. Accepts optional ?mess_id= to scope
# to a specific branch; defaults to the global config when omitted.
# ---------------------------------------------------------------------------
@router.get("/restaurant/status")
async def get_restaurant_status(mess_id: str | None = None):
    return await _compute_status(mess_id)


# ---------------------------------------------------------------------------
# Admin / Franchise — read / write config (scoped to the caller's branch).
# ---------------------------------------------------------------------------
class HoursConfigIn(BaseModel):
    mode: str = Field(..., pattern=r"^(manual_on|manual_off|auto)$")
    open_time: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    close_time: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    capacity_per_hour: int = Field(default=0, ge=0, le=10000)
    closed_message: str = Field(default=DEFAULT_MESSAGE, max_length=240)


@router.get("/admin/restaurant/hours")
async def admin_get_hours(mess_id: str | None = None, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    # iter-86 #2: HQ admin can pass ?mess_id= to peek at a specific branch's
    # config. Franchise owner is always pinned to their own branch.
    if user.role == "admin" and mess_id:
        branch_id = mess_id
    else:
        branch_id = await _resolve_caller_mess_id(user)
    cfg = await _load_config(branch_id)
    status = await _compute_status(branch_id)
    cfg["current_hourly_order_count"] = await _hourly_order_count(branch_id)
    cfg["status"] = status
    cfg["scope"] = "branch" if branch_id else "global"
    cfg["mess_id"] = branch_id
    return cfg


@router.post("/admin/restaurant/hours")
async def admin_set_hours(payload: HoursConfigIn, mess_id: str | None = None, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if _hhmm_to_time(payload.open_time) >= _hhmm_to_time(payload.close_time):
        raise HTTPException(status_code=400, detail="open_time must be before close_time")
    # iter-86 #2: HQ admin can pass ?mess_id= to write a specific branch's
    # config; otherwise admin writes to global. Franchise stays scoped.
    if user.role == "admin" and mess_id:
        branch_id = mess_id
    else:
        branch_id = await _resolve_caller_mess_id(user)
    key = _settings_key_for_mess(branch_id)
    await server.db.app_settings.update_one(
        {"_id": key},
        {"$set": {
            "mode": payload.mode,
            "open_time": payload.open_time,
            "close_time": payload.close_time,
            "capacity_per_hour": payload.capacity_per_hour,
            "closed_message": payload.closed_message.strip() or DEFAULT_MESSAGE,
            "mess_id": branch_id,
            "updated_at": server.iso(server.now_utc()),
            "updated_by": user.user_id,
        }},
        upsert=True,
    )
    return await _compute_status(branch_id)
