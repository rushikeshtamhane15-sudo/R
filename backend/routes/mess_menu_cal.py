"""Iter-62 #8: Day-wise mess menu calendar.

Admin pre-fills the entire month's lunch + dinner menu day by day. Backend
serves today's entry to the user dashboard + restaurant page; before 7 AM
local IST we serve "tomorrow's preview" so the user sees what's coming.

Endpoints:
  POST   /api/admin/mess-menu/upsert       admin upsert one date
  POST   /api/admin/mess-menu/bulk         admin upsert many dates at once
  DELETE /api/admin/mess-menu/{date}       admin remove a date
  GET    /api/admin/mess-menu?month=YYYY-MM   admin month feed
  GET    /api/mess-menu/today              public — today's menu + early-bird preview
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()

# Default to IST so the 7am cutover matches what mess customers experience
_IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist() -> str:
    return datetime.now(_IST).date().isoformat()


def _now_ist():
    return datetime.now(_IST)


class MessMenuIn(BaseModel):
    date: str = Field(..., description="ISO YYYY-MM-DD")
    lunch: str = ""
    dinner: str = ""
    note: str = ""


class BulkIn(BaseModel):
    items: list[MessMenuIn]


def _strip(doc: dict | None) -> dict | None:
    if not doc:
        return None
    doc.pop("_id", None)
    return doc


@router.post("/admin/mess-menu/upsert")
async def upsert_one(payload: MessMenuIn, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    try:
        datetime.fromisoformat(payload.date)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    doc = {
        "date": payload.date,
        "lunch": (payload.lunch or "").strip(),
        "dinner": (payload.dinner or "").strip(),
        "note": (payload.note or "").strip(),
        "updated_at": server.iso(server.now_utc()),
        "updated_by": user.user_id,
    }
    await server.db.mess_menu.update_one({"date": payload.date}, {"$set": doc}, upsert=True)
    return {"ok": True, **doc}


@router.post("/admin/mess-menu/bulk")
async def upsert_bulk(payload: BulkIn, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if len(payload.items) > 62:
        raise HTTPException(status_code=400, detail="Cap is 62 days per bulk call")
    n = 0
    for it in payload.items:
        try:
            datetime.fromisoformat(it.date)
        except Exception:  # noqa: BLE001
            continue
        await server.db.mess_menu.update_one(
            {"date": it.date},
            {"$set": {
                "date": it.date,
                "lunch": (it.lunch or "").strip(),
                "dinner": (it.dinner or "").strip(),
                "note": (it.note or "").strip(),
                "updated_at": server.iso(server.now_utc()),
                "updated_by": user.user_id,
            }},
            upsert=True,
        )
        n += 1
    return {"ok": True, "upserted": n}


@router.delete("/admin/mess-menu/{date}")
async def remove_one(date: str, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    res = await server.db.mess_menu.delete_one({"date": date})
    return {"ok": True, "deleted": res.deleted_count}


@router.get("/admin/mess-menu")
async def admin_month(month: str = Query(..., description="YYYY-MM"), user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    try:
        start = datetime.strptime(month + "-01", "%Y-%m-%d").date()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    # last day of month
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    items = []
    async for doc in server.db.mess_menu.find(
        {"date": {"$gte": start.isoformat(), "$lt": end.isoformat()}},
        {"_id": 0},
    ).sort("date", 1):
        items.append(doc)
    return {"month": month, "items": items}


@router.get("/mess-menu/today")
async def public_today(include_next: int = Query(0, ge=0, le=1)):
    """Returns today's menu. Before 07:00 IST, also returns the preview for
    today (i.e. what's coming for the day ahead). After 07:00 IST we just
    return today's record — unless ?include_next=1 forces the next-day fetch
    for the dashboard / restaurant Today vs Tomorrow toggle (#7).

    Also includes the iter-65 #11 mess-menu CMS config (background color +
    per-service prices) so the user-facing flash card can render with admin
    overrides instantly.
    """
    now = _now_ist()
    today = now.date().isoformat()
    tomorrow = (now.date() + timedelta(days=1)).isoformat()
    today_doc = _strip(await server.db.mess_menu.find_one({"date": today}, {"_id": 0}))
    tomorrow_doc = _strip(await server.db.mess_menu.find_one({"date": tomorrow}, {"_id": 0}))
    # Early-bird window: 0:00-07:00 IST — also surface tomorrow's preview
    early_bird = now.hour < 7
    config = await _get_config()
    return {
        "today": today,
        "tomorrow": tomorrow,
        "early_bird": early_bird,
        "current": today_doc,
        "next": tomorrow_doc if (early_bird or include_next) else None,
        "config": config,
    }


# -------- iter-65 #11: mess-menu CMS config + Order Now ---------------------
CONFIG_KEY = "mess_menu_cms_v1"
DEFAULT_CONFIG = {
    "bg_gradient_from": "#047857",
    "bg_gradient_mid": "#059669",
    "bg_gradient_to": "#065f46",
    "text_color": "#ecfdf5",
    "price_delivery": 140,
    "price_takeaway": 120,
    "price_dining": 100,
    "order_enabled": True,
}


async def _get_config() -> dict:
    doc = await server.db.app_config.find_one({"key": CONFIG_KEY}, {"_id": 0})
    if not doc:
        return dict(DEFAULT_CONFIG)
    return {**DEFAULT_CONFIG, **{k: v for k, v in doc.items() if k != "key"}}


class MessMenuConfigIn(BaseModel):
    bg_gradient_from: str = Field(default=DEFAULT_CONFIG["bg_gradient_from"])
    bg_gradient_mid: str = Field(default=DEFAULT_CONFIG["bg_gradient_mid"])
    bg_gradient_to: str = Field(default=DEFAULT_CONFIG["bg_gradient_to"])
    text_color: str = Field(default=DEFAULT_CONFIG["text_color"])
    price_delivery: int = Field(default=DEFAULT_CONFIG["price_delivery"], ge=0, le=2000)
    price_takeaway: int = Field(default=DEFAULT_CONFIG["price_takeaway"], ge=0, le=2000)
    price_dining: int = Field(default=DEFAULT_CONFIG["price_dining"], ge=0, le=2000)
    order_enabled: bool = True


@router.get("/admin/mess-menu/config")
async def admin_get_config(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return await _get_config()


@router.put("/admin/mess-menu/config")
async def admin_put_config(payload: MessMenuConfigIn, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    update = {"key": CONFIG_KEY, **payload.model_dump()}
    await server.db.app_config.update_one({"key": CONFIG_KEY}, {"$set": update}, upsert=True)
    return await _get_config()


class MessMenuOrderIn(BaseModel):
    service: str = Field(..., description="delivery | takeaway | dining")
    qty: int = Field(..., ge=1, le=20)
    date: str = Field(..., description="ISO YYYY-MM-DD")
    meal_type: str = Field(..., description="lunch | dinner")
    note: str = ""


@router.post("/mess-menu/order")
async def place_mess_order(payload: MessMenuOrderIn, user: server.User = Depends(server.get_current_user)):
    if payload.service not in {"delivery", "takeaway", "dining"}:
        raise HTTPException(status_code=400, detail="Invalid service")
    if payload.meal_type not in {"lunch", "dinner"}:
        raise HTTPException(status_code=400, detail="Invalid meal_type")
    cfg = await _get_config()
    if not cfg.get("order_enabled", True):
        raise HTTPException(status_code=400, detail="Mess-menu ordering is disabled")
    menu = await server.db.mess_menu.find_one({"date": payload.date}, {"_id": 0})
    if not menu or not (menu.get(payload.meal_type) or "").strip():
        raise HTTPException(status_code=400, detail=f"No {payload.meal_type} planned for {payload.date}")
    price_key = f"price_{payload.service}"
    unit_price = int(cfg.get(price_key) or 0)
    total = unit_price * payload.qty
    import uuid
    order = {
        "order_id": f"mm_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "service": payload.service,
        "qty": payload.qty,
        "date": payload.date,
        "meal_type": payload.meal_type,
        "menu_text": menu.get(payload.meal_type),
        "unit_price": unit_price,
        "total": total,
        "status": "pending_payment",
        "note": (payload.note or "").strip(),
        "created_at": server.iso(server.now_utc()),
    }
    await server.db.mess_menu_orders.insert_one(order)
    return {"ok": True, "order": {k: v for k, v in order.items() if k != "_id"}}
