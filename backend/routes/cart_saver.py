"""Iter-68 — Cart-saver push.

When a subscriber opens the "Order this menu" form but doesn't complete
payment, we log an intent. Five minutes later (admin-tunable), the next
poll surfaces a gentle "Your Paneer Lunch is still warm — finish in 1 tap"
banner on the user's screen.

Design choice: NO background scheduler. The cart-saver state is computed
at read time from a single `mess_menu_order_intents` row per user — keeps
the surface tiny and idempotent.

Endpoints:
  POST /api/mess-menu/order-intent          — Subscriber: log an intent on form-open
  GET  /api/me/cart-saver                   — Subscriber: returns pending banner or null
  POST /api/me/cart-saver/dismiss           — Subscriber: hide banner (per intent_id)
  GET  /api/admin/cart-saver/config         — Admin: CMS config
  PUT  /api/admin/cart-saver/config         — Admin: CMS config
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server  # late-binding via shared shim — avoids circular import on cold boot

router = APIRouter()

CONFIG_KEY = "cart_saver_v1"
DEFAULT_CONFIG = {
    "enabled": True,
    "threshold_minutes": 5,
    "title_template": "Your {meal} is still warm",
    "body_template": "{menu} · finish in 1 tap to lock {service} at ₹{total}",
    "cta_label": "Resume order",
    "cta_route": "/restaurant",
    "expire_minutes": 90,   # after this many minutes, the intent is stale + hidden
}


async def _get_config():
    doc = await server.db.app_config.find_one({"key": CONFIG_KEY}, {"_id": 0})
    if not doc:
        return dict(DEFAULT_CONFIG)
    return {**DEFAULT_CONFIG, **{k: v for k, v in doc.items() if k != "key"}}


# ---------------------------------------------------------------------------
# Subscriber endpoints
# ---------------------------------------------------------------------------
class IntentIn(BaseModel):
    service: str = Field(..., description="delivery | takeaway | dining")
    qty: int = Field(..., ge=1, le=20)
    meal_type: str = Field(..., description="lunch | dinner")
    date: str = Field(..., description="ISO YYYY-MM-DD")
    menu_text: str = Field(default="")
    total: int = Field(default=0, ge=0)


@router.post("/mess-menu/order-intent")
async def log_intent(payload: IntentIn, user: server.User = Depends(server.get_current_user)):
    if payload.service not in {"delivery", "takeaway", "dining"}:
        raise HTTPException(status_code=400, detail="Invalid service")
    if payload.meal_type not in {"lunch", "dinner"}:
        raise HTTPException(status_code=400, detail="Invalid meal_type")
    intent_id = f"int_{uuid.uuid4().hex[:14]}"
    now = server.now_utc()
    # Upsert keyed by user_id + date + meal so re-opening the form refreshes
    # the timestamp instead of stacking intents.
    await server.db.mess_menu_order_intents.update_one(
        {"user_id": user.user_id, "date": payload.date, "meal_type": payload.meal_type},
        {
            "$set": {
                "service": payload.service,
                "qty": payload.qty,
                "menu_text": payload.menu_text[:240],
                "total": payload.total,
                "updated_at": server.iso(now),
                "status": "open",
                "dismissed_at": None,
            },
            "$setOnInsert": {
                "intent_id": intent_id,
                "user_id": user.user_id,
                "date": payload.date,
                "meal_type": payload.meal_type,
                "created_at": server.iso(now),
            },
        },
        upsert=True,
    )
    return {"ok": True}


async def _mark_intents_paid(user_id: str, date: str, meal_type: str) -> None:
    """Called from the mess-menu order-verify flow to clear the intent."""
    await server.db.mess_menu_order_intents.update_one(
        {"user_id": user_id, "date": date, "meal_type": meal_type},
        {"$set": {"status": "paid", "paid_at": server.iso(server.now_utc())}},
    )


@router.get("/me/cart-saver")
async def get_cart_saver(user: server.User = Depends(server.get_current_user)):
    cfg = await _get_config()
    if not cfg.get("enabled", True):
        return {"banner": None}
    threshold = timedelta(minutes=int(cfg.get("threshold_minutes", 5)))
    expire = timedelta(minutes=int(cfg.get("expire_minutes", 90)))
    intent = await server.db.mess_menu_order_intents.find_one(
        {"user_id": user.user_id, "status": "open"},
        sort=[("updated_at", -1)],
        projection={"_id": 0},
    )
    if not intent:
        return {"banner": None}
    if intent.get("dismissed_at"):
        return {"banner": None}
    updated_at = datetime.fromisoformat(intent["updated_at"].replace("Z", "+00:00"))
    age = datetime.now(timezone.utc) - updated_at
    if age < threshold:
        return {"banner": None}
    if age > expire:
        # Mark stale so the row stops surfacing
        await server.db.mess_menu_order_intents.update_one(
            {"intent_id": intent["intent_id"]},
            {"$set": {"status": "expired"}},
        )
        return {"banner": None}
    # Compose banner
    ctx = {
        "meal": intent["meal_type"].capitalize(),
        "menu": intent.get("menu_text") or intent["meal_type"].capitalize(),
        "service": intent["service"],
        "total": intent.get("total", 0),
        "qty": intent.get("qty", 1),
    }
    title = (cfg.get("title_template") or DEFAULT_CONFIG["title_template"]).format(**ctx)
    body = (cfg.get("body_template") or DEFAULT_CONFIG["body_template"]).format(**ctx)
    return {
        "banner": {
            "intent_id": intent["intent_id"],
            "title": title,
            "body": body,
            "cta_label": cfg.get("cta_label") or DEFAULT_CONFIG["cta_label"],
            "cta_route": cfg.get("cta_route") or DEFAULT_CONFIG["cta_route"],
            "service": intent["service"],
            "qty": intent.get("qty", 1),
            "meal_type": intent["meal_type"],
            "date": intent["date"],
            "menu_text": intent.get("menu_text", ""),
            "total": intent.get("total", 0),
            "age_seconds": int(age.total_seconds()),
        }
    }


class DismissIn(BaseModel):
    intent_id: str


@router.post("/me/cart-saver/dismiss")
async def dismiss_cart_saver(payload: DismissIn, user: server.User = Depends(server.get_current_user)):
    res = await server.db.mess_menu_order_intents.update_one(
        {"intent_id": payload.intent_id, "user_id": user.user_id},
        {"$set": {"dismissed_at": server.iso(server.now_utc()), "status": "dismissed"}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Intent not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Admin CMS
# ---------------------------------------------------------------------------
class ConfigIn(BaseModel):
    enabled: bool = True
    threshold_minutes: int = Field(default=DEFAULT_CONFIG["threshold_minutes"], ge=1, le=120)
    title_template: str = DEFAULT_CONFIG["title_template"]
    body_template: str = DEFAULT_CONFIG["body_template"]
    cta_label: str = DEFAULT_CONFIG["cta_label"]
    cta_route: str = DEFAULT_CONFIG["cta_route"]
    expire_minutes: int = Field(default=DEFAULT_CONFIG["expire_minutes"], ge=5, le=24 * 60)


@router.get("/admin/cart-saver/config")
async def admin_get_cfg(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return await _get_config()


@router.put("/admin/cart-saver/config")
async def admin_put_cfg(payload: ConfigIn, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.app_config.update_one(
        {"key": CONFIG_KEY},
        {"$set": {"key": CONFIG_KEY, **payload.model_dump()}},
        upsert=True,
    )
    return await _get_config()


@router.get("/admin/cart-saver/stats")
async def admin_stats(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cutoff = (server.now_utc() - timedelta(days=30)).isoformat()
    pipe = [
        {"$match": {"created_at": {"$gte": cutoff}}},
        {"$group": {"_id": "$status", "n": {"$sum": 1}}},
    ]
    counts = {r["_id"]: r["n"] async for r in server.db.mess_menu_order_intents.aggregate(pipe)}
    return {
        "last_30_days": {
            "opened": sum(counts.values()),
            "paid": counts.get("paid", 0),
            "dismissed": counts.get("dismissed", 0),
            "expired": counts.get("expired", 0),
            "open": counts.get("open", 0),
        },
    }
