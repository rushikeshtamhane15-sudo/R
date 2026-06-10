"""Iter-66 #3 — Daily mess-menu push.

CMS-toggled broadcast that fires once a day in the IST timezone window
configured by admin. Writes a single row to `mess_menu_broadcasts` keyed
by date (idempotent) so any user opening the app on the same day sees the
same message as a banner above the menu flash card.

Endpoints:
  GET  /api/mess-menu/push                — Public: today's broadcast (if any)
  GET  /api/admin/mess-menu/push/config   — Admin: CMS config
  PUT  /api/admin/mess-menu/push/config   — Admin: CMS config
  POST /api/admin/mess-menu/push/preview  — Admin: render today's message without saving
  POST /api/admin/mess-menu/push/send-now — Admin: force-send today's broadcast (testing)

Also exposes `tick_daily_menu_push(db)` — called from the background scheduler
once a minute. It checks the configured local-IST hour and broadcasts at most
once per IST date.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import server

router = APIRouter()

PUSH_CONFIG_KEY = "mess_menu_push_v1"
DEFAULT_PUSH_CONFIG = {
    "enabled": True,
    "hour_ist": 11,   # 11:00 IST
    "title_template": "Today's {meal}",
    "body_template": "{menu} · ₹{delivery_price} delivery · order in 1 tap",
    "cta_label": "Order now",
    "cta_route": "/dashboard",
}
IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist_iso():
    return datetime.now(IST).date().isoformat()


async def _get_push_config():
    doc = await server.db.app_config.find_one({"key": PUSH_CONFIG_KEY}, {"_id": 0})
    if not doc:
        return dict(DEFAULT_PUSH_CONFIG)
    return {**DEFAULT_PUSH_CONFIG, **{k: v for k, v in doc.items() if k != "key"}}


async def _build_message(forced_meal: Optional[str] = None):
    """Pulls today's menu + mess-menu CMS prices, formats title/body using
    the admin templates. Returns None if no menu is published for today.

    iter-67 #2: `forced_meal` lets admin Send now / Preview force lunch or
    dinner regardless of the IST auto-pick window. Invalid values fall back
    to the auto-pick logic.
    """
    date = _today_ist_iso()
    menu = await server.db.mess_menu.find_one({"date": date}, {"_id": 0})
    if not menu:
        return None
    cfg = await _get_push_config()
    if forced_meal in ("lunch", "dinner"):
        meal = forced_meal
    else:
        now_ist = datetime.now(IST)
        meal = "lunch"
        if now_ist.hour >= 16 and (menu.get("dinner") or "").strip():
            meal = "dinner"
        elif not (menu.get("lunch") or "").strip() and (menu.get("dinner") or "").strip():
            meal = "dinner"
    menu_text = (menu.get(meal) or "").strip()
    if not menu_text:
        return None

    # Pull mess-menu prices from the iter-65 #11 config
    mm = await server.db.app_config.find_one({"key": "mess_menu_cms_v1"}, {"_id": 0}) or {}
    delivery_price = int(mm.get("price_delivery", 140))
    takeaway_price = int(mm.get("price_takeaway", 120))
    dining_price = int(mm.get("price_dining", 100))

    ctx = {
        "meal": meal.capitalize(),
        "menu": menu_text,
        "delivery_price": delivery_price,
        "takeaway_price": takeaway_price,
        "dining_price": dining_price,
        "date": date,
    }
    title = (cfg.get("title_template") or DEFAULT_PUSH_CONFIG["title_template"]).format(**ctx)
    body = (cfg.get("body_template") or DEFAULT_PUSH_CONFIG["body_template"]).format(**ctx)
    return {
        "date": date,
        "meal": meal,
        "title": title,
        "body": body,
        "menu_text": menu_text,
        "cta_label": cfg.get("cta_label") or DEFAULT_PUSH_CONFIG["cta_label"],
        "cta_route": cfg.get("cta_route") or DEFAULT_PUSH_CONFIG["cta_route"],
        "delivery_price": delivery_price,
        "takeaway_price": takeaway_price,
        "dining_price": dining_price,
    }


async def _broadcast_now(reason: str = "scheduled", forced_meal: Optional[str] = None) -> Optional[dict]:
    msg = await _build_message(forced_meal=forced_meal)
    if not msg:
        return None
    msg["broadcast_id"] = f"mmp_{msg['date'].replace('-', '')}_{msg['meal']}"
    msg["sent_at"] = server.iso(server.now_utc())
    msg["reason"] = reason
    # Upsert so the same day's broadcast is idempotent — we don't spam users.
    await server.db.mess_menu_broadcasts.update_one(
        {"date": msg["date"]},
        {"$set": msg, "$setOnInsert": {"first_sent_at": msg["sent_at"]}},
        upsert=True,
    )
    return msg


async def tick_daily_menu_push():
    """Called from tasks.py once per minute. Fires the broadcast at the
    configured IST hour at most once per day.
    """
    cfg = await _get_push_config()
    if not cfg.get("enabled", True):
        return
    hour = int(cfg.get("hour_ist", 11))
    now_ist = datetime.now(IST)
    if now_ist.hour != hour:
        return
    today = now_ist.date().isoformat()
    existing = await server.db.mess_menu_broadcasts.find_one(
        {"date": today, "reason": {"$ne": "preview"}}, {"_id": 0, "date": 1},
    )
    if existing:
        return
    await _broadcast_now("scheduled")


# ---------------------------------------------------------------------------
# Public read
# ---------------------------------------------------------------------------
@router.get("/mess-menu/push")
async def public_today_broadcast():
    today = _today_ist_iso()
    doc = await server.db.mess_menu_broadcasts.find_one({"date": today}, {"_id": 0})
    if not doc:
        return {"broadcast": None}
    return {"broadcast": doc}


class OptInIn(BaseModel):
    opted_out: bool = False


@router.put("/mess-menu/push/opt-out")
async def set_opt_out(payload: OptInIn, user: server.User = Depends(server.get_current_user)):
    await server.db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"menu_push_opt_out": bool(payload.opted_out)}},
    )
    return {"ok": True, "opted_out": bool(payload.opted_out)}


# ---------------------------------------------------------------------------
# Admin CMS
# ---------------------------------------------------------------------------
class PushConfigIn(BaseModel):
    enabled: bool = Field(default=True)
    hour_ist: int = Field(default=11, ge=0, le=23)
    title_template: str = Field(default=DEFAULT_PUSH_CONFIG["title_template"])
    body_template: str = Field(default=DEFAULT_PUSH_CONFIG["body_template"])
    cta_label: str = Field(default=DEFAULT_PUSH_CONFIG["cta_label"])
    cta_route: str = Field(default=DEFAULT_PUSH_CONFIG["cta_route"])


@router.get("/admin/mess-menu/push/config")
async def admin_get_push_cfg(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    return await _get_push_config()


@router.put("/admin/mess-menu/push/config")
async def admin_put_push_cfg(payload: PushConfigIn, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.app_config.update_one(
        {"key": PUSH_CONFIG_KEY},
        {"$set": {"key": PUSH_CONFIG_KEY, **payload.model_dump()}},
        upsert=True,
    )
    return await _get_push_config()


@router.post("/admin/mess-menu/push/preview")
async def admin_preview(meal: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if meal is not None and meal not in ("lunch", "dinner"):
        raise HTTPException(status_code=400, detail="meal must be lunch or dinner")
    msg = await _build_message(forced_meal=meal)
    if not msg:
        raise HTTPException(status_code=400, detail="No menu published for today — cannot preview")
    return {"preview": msg}


@router.post("/admin/mess-menu/push/send-now")
async def admin_send_now(meal: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if meal is not None and meal not in ("lunch", "dinner"):
        raise HTTPException(status_code=400, detail="meal must be lunch or dinner")
    msg = await _broadcast_now("manual", forced_meal=meal)
    if not msg:
        raise HTTPException(status_code=400, detail="No menu published for today — cannot send")
    return {"ok": True, "broadcast": msg}
