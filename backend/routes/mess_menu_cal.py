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
from typing import Optional

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

    # iter-66 #2: chain with Razorpay so users can actually pay.
    import uuid
    receipt = f"mm_{uuid.uuid4().hex[:12]}"
    amount_paise = int(round(total * 100))
    rzp_order = None
    if getattr(server, "RZP_ENABLED", False):
        try:
            rzp_order = server.rzp_client.order.create({
                "amount": amount_paise, "currency": "INR", "receipt": receipt,
                "payment_capture": 1,
                "notes": {
                    "kind": "mess_menu_order",
                    "user_id": user.user_id,
                    "service": payload.service,
                    "meal_type": payload.meal_type,
                    "date": payload.date,
                    "qty": str(payload.qty),
                },
            })
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RZP/mess] order.create failed → MOCK · {e}")
            rzp_order = None
    if rzp_order is not None:
        order_id = rzp_order["id"]
        mock = False
    else:
        order_id = f"order_mock_{uuid.uuid4().hex[:14]}"
        mock = True

    order = {
        "order_id": order_id,
        "receipt": receipt,
        "user_id": user.user_id,
        "service": payload.service,
        "qty": payload.qty,
        "date": payload.date,
        "meal_type": payload.meal_type,
        "menu_text": menu.get(payload.meal_type),
        "unit_price": unit_price,
        "total": total,
        "amount_paise": amount_paise,
        "currency": "INR",
        "status": "pending_payment",
        "mock": mock,
        "note": (payload.note or "").strip(),
        "created_at": server.iso(server.now_utc()),
    }
    await server.db.mess_menu_orders.insert_one(order)

    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    return {
        "ok": True,
        "order": {k: v for k, v in order.items() if k != "_id"},
        "checkout": {
            "order_id": order_id,
            "amount_paise": amount_paise,
            "amount": total,
            "currency": "INR",
            "key_id": getattr(server, "RZP_KEY_ID", "rzp_test_MOCK") if getattr(server, "RZP_ENABLED", False) else "rzp_test_MOCK",
            "mock": mock,
            "name": f"efoodcare · {payload.meal_type.capitalize()} ({payload.service})",
            "description": f"{payload.qty} × {menu.get(payload.meal_type)[:80]}",
            "prefill": {"name": user_doc.get("name", ""), "email": user_doc.get("email", ""), "contact": user_doc.get("phone", "")},
        },
    }


class KioskOrderIn(BaseModel):
    service: str = Field(..., description="delivery | takeaway | dining")
    qty: int = Field(..., ge=1, le=20)
    date: str
    meal_type: str
    phone: Optional[str] = None
    payment_method: str = Field(default="cash", description="cash | upi")
    note: str = ""


@router.post("/admin/kiosk/order")
async def kiosk_place_order(payload: KioskOrderIn, user: server.User = Depends(server.get_current_user)):
    """Iter-69/70/72 — Walk-in order placed from the admin wall-kiosk."""
    if user.role not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Admin or staff only")
    if payload.service not in {"delivery", "takeaway", "dining"}:
        raise HTTPException(status_code=400, detail="Invalid service")
    if payload.meal_type not in {"lunch", "dinner"}:
        raise HTTPException(status_code=400, detail="Invalid meal_type")
    if payload.payment_method not in {"cash", "upi"}:
        raise HTTPException(status_code=400, detail="Invalid payment_method")
    # iter-72 #5: phone is mandatory for delivery so the rider can call.
    clean_phone = (payload.phone or "").strip()
    if payload.service == "delivery":
        digits = "".join(c for c in clean_phone if c.isdigit())
        if len(digits) < 10:
            raise HTTPException(status_code=400, detail="Customer phone is required for delivery")
        clean_phone = digits
    menu = await server.db.mess_menu.find_one({"date": payload.date}, {"_id": 0})
    if not menu or not (menu.get(payload.meal_type) or "").strip():
        raise HTTPException(status_code=400, detail=f"No {payload.meal_type} planned for {payload.date}")
    cfg = await _get_config()
    unit_price = int(cfg.get(f"price_{payload.service}") or 0)
    total = unit_price * payload.qty
    import uuid
    # iter-70: single-use kiosk_token printed on the thermal receipt. Counter
    # scanner consumes it via /api/attendance/scan (prefix "kio:") — prevents
    # the staff-side fraud of serving a thali without a recorded check-in.
    kiosk_token = uuid.uuid4().hex
    order = {
        "order_id": f"kio_{uuid.uuid4().hex[:12]}",
        "kind": "walk_in_kiosk",
        "user_id": None,
        "placed_by_admin_id": user.user_id,
        "phone": clean_phone or None,
        "service": payload.service,
        "qty": payload.qty,
        "date": payload.date,
        "meal_type": payload.meal_type,
        "menu_text": menu.get(payload.meal_type),
        "unit_price": unit_price,
        "total": total,
        "currency": "INR",
        "status": "pending_collection",  # cash/upi collected at counter
        "payment_method": payload.payment_method,
        "note": (payload.note or "").strip(),
        "kiosk_token": kiosk_token,
        "kiosk_consumed_at": None,
        "kiosk_consumed_by": None,
        "created_at": server.iso(server.now_utc()),
    }
    await server.db.mess_menu_orders.insert_one(order)
    # Render QR PNG of `kio:<token>` so the printer can drop it on the receipt.
    qr_data_url = ""
    try:
        import base64
        import io
        import qrcode
        img = qrcode.make(f"kio:{kiosk_token}")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as e:  # noqa: BLE001
        server.logger.warning(f"[kiosk] QR render failed: {e}")
    return {
        "ok": True,
        "order": {k: v for k, v in order.items() if k != "_id"},
        "qr_data_url": qr_data_url,
        "qr_text": f"kio:{kiosk_token}",
    }


class MessMenuVerifyIn(BaseModel):
    order_id: str
    razorpay_payment_id: str = ""
    razorpay_signature: str = ""


@router.post("/mess-menu/order/verify")
async def verify_mess_order(payload: MessMenuVerifyIn, user: server.User = Depends(server.get_current_user)):
    order = await server.db.mess_menu_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if order.get("mock"):
        server.logger.warning(f"[MOCKED] Auto-verifying mock mess-menu order {payload.order_id}")
    else:
        try:
            server.rzp_client.utility.verify_payment_signature({
                "razorpay_order_id": payload.order_id,
                "razorpay_payment_id": payload.razorpay_payment_id,
                "razorpay_signature": payload.razorpay_signature,
            })
        except Exception as e:
            server.logger.error(f"Mess-menu signature verify failed: {e}")
            raise HTTPException(status_code=400, detail="Invalid payment signature")

    await server.db.mess_menu_orders.update_one(
        {"order_id": payload.order_id},
        {"$set": {
            "status": "paid",
            "razorpay_payment_id": payload.razorpay_payment_id,
            "razorpay_signature": payload.razorpay_signature,
            "paid_at": server.iso(server.now_utc()),
        }},
    )
    fresh = await server.db.mess_menu_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    # iter-68: clear any open cart-saver intent so the banner disappears
    try:
        from routes.cart_saver import _mark_intents_paid
        await _mark_intents_paid(fresh["user_id"], fresh["date"], fresh["meal_type"])
    except Exception as e:  # noqa: BLE001
        server.logger.warning(f"[iter-68] could not clear cart-saver intent: {e}")
    return {"ok": True, "status": fresh.get("status"), "order": fresh}


# -------- iter-72 #6: kiosk Bluetooth printer admin toggle ----------------
KIOSK_BT_KEY = "kiosk_bt_v1"
DEFAULT_BT = {"enabled": False}


class KioskBtConfigIn(BaseModel):
    enabled: bool = False


@router.get("/admin/kiosk/bt-config")
async def admin_get_kiosk_bt(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    doc = await server.db.app_config.find_one({"key": KIOSK_BT_KEY}, {"_id": 0})
    if not doc:
        return dict(DEFAULT_BT)
    return {**DEFAULT_BT, **{k: v for k, v in doc.items() if k != "key"}}


@router.put("/admin/kiosk/bt-config")
async def admin_put_kiosk_bt(payload: KioskBtConfigIn, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.app_config.update_one(
        {"key": KIOSK_BT_KEY},
        {"$set": {"key": KIOSK_BT_KEY, "enabled": bool(payload.enabled)}},
        upsert=True,
    )
    return {"enabled": bool(payload.enabled)}

