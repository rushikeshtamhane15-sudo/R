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
    if user.role not in ("admin", "franchise_owner"):
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
    if user.role not in ("admin", "franchise_owner"):
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
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    res = await server.db.mess_menu.delete_one({"date": date})
    return {"ok": True, "deleted": res.deleted_count}


@router.get("/admin/mess-menu")
async def admin_month(month: str = Query(..., description="YYYY-MM"), user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
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
    # iter-131: extra roti add-on price (₹ per roti). Users can order more rotis
    # than the thali includes at this fixed price.
    "price_extra_roti": 10,
    # iter-131.5: admins can toggle whether lunch/dinner item lists render as
    # a horizontal 3-col grid or a single vertical list, live from the CMS
    # calendar page without needing a redeploy.
    "item_layout": "horizontal",   # "horizontal" | "list"
    "order_enabled": True,
}


# iter-131: same-day meal-time windows (IST hours, 24h). Orders for TODAY are
# only accepted while the meal window is open. Orders for TOMORROW are
# always allowed (pre-booking). Semantics:
#   · Lunch  → orderable from midnight until lunch service ends (3 pm IST).
#   · Dinner → orderable from 3 pm until dinner service ends (10 pm IST).
# Keep in sync with the UI hint in messMenuHelpers.js.
MEAL_WINDOWS_IST = {
    "lunch":  (0, 15),    # 00:00 – 15:00
    "dinner": (15, 22),   # 15:00 – 22:00
}


def _hhmm_to_hour(t: str, default: int) -> int:
    """Parse `HH:MM` → integer hour; falls back on the default on malformed input."""
    try:
        h, _m = str(t).split(":", 1)
        return max(0, min(23, int(h)))
    except Exception:
        return default


async def _meal_window_open(meal: str) -> bool:
    """Return True if `meal` is inside its currently-open window in IST.
    iter-134.d: honour the admin-configured `meal_slots` in `admin_config`
    when present; fall back to the module defaults otherwise.
    """
    try:
        doc = await server.db.admin_config.find_one({"_id": "meal_slots"}, {"_id": 0}) or {}
        m = doc.get(meal) or {}
        if m.get("start") and m.get("end"):
            start = _hhmm_to_hour(m["start"], MEAL_WINDOWS_IST[meal][0])
            end   = _hhmm_to_hour(m["end"],   MEAL_WINDOWS_IST[meal][1])
        else:
            start, end = MEAL_WINDOWS_IST.get(meal, (0, 24))
    except Exception:
        start, end = MEAL_WINDOWS_IST.get(meal, (0, 24))
    hour = _now_ist().hour
    return start <= hour < end


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
    price_extra_roti: int = Field(default=DEFAULT_CONFIG["price_extra_roti"], ge=0, le=200)
    item_layout: str = Field(default=DEFAULT_CONFIG["item_layout"], pattern="^(horizontal|list)$")
    order_enabled: bool = True


@router.get("/admin/mess-menu/config")
async def admin_get_config(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    return await _get_config()


@router.put("/admin/mess-menu/config")
async def admin_put_config(payload: MessMenuConfigIn, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    update = {"key": CONFIG_KEY, **payload.model_dump()}
    await server.db.app_config.update_one({"key": CONFIG_KEY}, {"$set": update}, upsert=True)
    return await _get_config()


class MessMenuOrderIn(BaseModel):
    service: str = Field(..., description="delivery | takeaway | dining")
    qty: int = Field(..., ge=1, le=20)
    date: str = Field(..., description="ISO YYYY-MM-DD")
    meal_type: str = Field(..., description="lunch | dinner")
    phone: Optional[str] = Field(default=None, description="+91 mobile (delivery only)")
    payment_method: str = Field(default="online", description="online | cash | wallet")
    note: str = ""
    # iter-131: optional add-ons / customisations
    extra_rotis: int = Field(default=0, ge=0, le=50, description="Extra rotis beyond thali (₹price_extra_roti each)")
    excluded_items: list[str] = Field(default_factory=list, description="Thali items user has opted out of (price unchanged)")


@router.post("/mess-menu/order")
async def place_mess_order(payload: MessMenuOrderIn, user: server.User = Depends(server.get_current_user)):
    if payload.service not in {"delivery", "takeaway", "dining"}:
        raise HTTPException(status_code=400, detail="Invalid service")
    if payload.meal_type not in {"lunch", "dinner"}:
        raise HTTPException(status_code=400, detail="Invalid meal_type")
    if payload.payment_method not in {"online", "cash", "wallet"}:
        raise HTTPException(status_code=400, detail="Invalid payment_method")
    # iter-73 #12: delivery requires a valid Indian +91 number (10 digits)
    delivery_phone = None
    if payload.service == "delivery":
        digits = "".join(c for c in (payload.phone or "") if c.isdigit())
        if digits.startswith("91") and len(digits) > 10:
            digits = digits[-10:]
        if len(digits) != 10 or digits[0] not in "6789":
            raise HTTPException(status_code=400, detail="Valid Indian +91 mobile number required for delivery")
        delivery_phone = digits
    cfg = await _get_config()
    if not cfg.get("order_enabled", True):
        raise HTTPException(status_code=400, detail="Mess-menu ordering is disabled")
    menu = await server.db.mess_menu.find_one({"date": payload.date}, {"_id": 0})
    if not menu or not (menu.get(payload.meal_type) or "").strip():
        raise HTTPException(status_code=400, detail=f"No {payload.meal_type} planned for {payload.date}")
    # iter-131: enforce meal-time window for SAME-day orders. Pre-orders
    # (tomorrow) are always allowed. Keeps kitchen from having to accept a
    # lunch order at 8 pm when the batch cook is already sealed.
    if payload.date == _today_ist() and not await _meal_window_open(payload.meal_type):
        start, end = MEAL_WINDOWS_IST[payload.meal_type]
        raise HTTPException(
            status_code=400,
            detail=f"{payload.meal_type.capitalize()} orders are only open "
                   f"{start}:00 – {end}:00 IST for today. Try tomorrow's menu instead.",
        )
    price_key = f"price_{payload.service}"
    unit_price = int(cfg.get(price_key) or 0)
    # iter-131: extra rotis add-on. Excluded items (opt-outs) don't change price.
    extra_rotis = int(payload.extra_rotis or 0)
    extra_roti_price = int(cfg.get("price_extra_roti") or 0)
    extra_rotis_total = extra_rotis * extra_roti_price * payload.qty
    total = unit_price * payload.qty + extra_rotis_total

    # iter-66 #2: chain with Razorpay so users can actually pay.
    # iter-73 #10: payment_method dictates flow — cash/wallet skip Razorpay.
    import uuid
    receipt = f"mm_{uuid.uuid4().hex[:12]}"
    amount_paise = int(round(total * 100))
    rzp_order = None
    needs_rzp = payload.payment_method == "online"
    if needs_rzp and getattr(server, "RZP_ENABLED", False):
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

    initial_status = "pending_collection" if payload.payment_method in ("cash", "wallet") else "pending_payment"
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
        "extra_rotis": extra_rotis,
        "extra_roti_price": extra_roti_price,
        "extra_rotis_total": extra_rotis_total,
        "excluded_items": [s.strip() for s in (payload.excluded_items or []) if s and s.strip()],
        "amount_paise": amount_paise,
        "currency": "INR",
        "status": initial_status,
        "payment_method": payload.payment_method,
        "delivery_phone": delivery_phone,
        "mock": mock,
        "note": (payload.note or "").strip(),
        "created_at": server.iso(server.now_utc()),
    }
    await server.db.mess_menu_orders.insert_one(order)

    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    checkout = None
    if needs_rzp:
        checkout = {
            "order_id": order_id,
            "amount_paise": amount_paise,
            "amount": total,
            "currency": "INR",
            "key_id": getattr(server, "RZP_KEY_ID", "rzp_test_MOCK") if getattr(server, "RZP_ENABLED", False) else "rzp_test_MOCK",
            "mock": mock,
            "name": f"efoodcare · {payload.meal_type.capitalize()} ({payload.service})",
            "description": f"{payload.qty} × {menu.get(payload.meal_type)[:80]}",
            "prefill": {"name": user_doc.get("name", ""), "email": user_doc.get("email", ""), "contact": user_doc.get("phone", "")},
        }
    return {
        "ok": True,
        "order": {k: v for k, v in order.items() if k != "_id"},
        "checkout": checkout,
    }


class KioskOrderIn(BaseModel):
    service: str = Field(..., description="takeaway | dining (delivery removed in wall-kiosk per iter-73 #14)")
    qty: int = Field(..., ge=1, le=20)
    date: str
    meal_type: str
    phone: Optional[str] = None
    payment_method: str = Field(default="cash", description="cash | online | mixed")
    cash_amount: int = Field(default=0, ge=0, description="Cash portion (mixed payments)")
    online_amount: int = Field(default=0, ge=0, description="Online portion (mixed payments)")
    note: str = ""


@router.post("/admin/kiosk/order")
async def kiosk_place_order(payload: KioskOrderIn, user: server.User = Depends(server.get_current_user)):
    """Iter-69/70/72/73 — Walk-in order placed from the admin wall-kiosk.

    iter-73 #14: wall-kiosk drops the delivery option entirely and supports
    cash / online (Paytm Dynamic QR) / mixed split-payments. Online portion
    is collected by flashing a UPI Dynamic QR pointing at the merchant VPA.
    """
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin or staff only")
    if payload.service not in {"takeaway", "dining"}:
        raise HTTPException(status_code=400, detail="Wall-kiosk supports takeaway/dining only")
    if payload.meal_type not in {"lunch", "dinner"}:
        raise HTTPException(status_code=400, detail="Invalid meal_type")
    if payload.payment_method not in {"cash", "online", "mixed"}:
        raise HTTPException(status_code=400, detail="Invalid payment_method")
    menu = await server.db.mess_menu.find_one({"date": payload.date}, {"_id": 0})
    if not menu or not (menu.get(payload.meal_type) or "").strip():
        raise HTTPException(status_code=400, detail=f"No {payload.meal_type} planned for {payload.date}")
    cfg = await _get_config()
    unit_price = int(cfg.get(f"price_{payload.service}") or 0)
    total = unit_price * payload.qty

    # iter-73 #14: split-payment validation
    cash_amount = int(payload.cash_amount or 0)
    online_amount = int(payload.online_amount or 0)
    if payload.payment_method == "cash":
        cash_amount, online_amount = total, 0
    elif payload.payment_method == "online":
        cash_amount, online_amount = 0, total
    else:  # mixed
        if cash_amount + online_amount != total:
            raise HTTPException(status_code=400, detail=f"Cash + Online must equal total ₹{total}")
        if cash_amount <= 0 or online_amount <= 0:
            raise HTTPException(status_code=400, detail="Mixed payments need both cash and online portions > 0")

    import uuid
    kiosk_token = uuid.uuid4().hex
    order_id = f"kio_{uuid.uuid4().hex[:12]}"

    # Build the dynamic QR for the online portion (if any).
    # iter-74 #1: CMS-toggle between Paytm UPI intent (no creds needed) and
    # Razorpay QR Codes API (uses existing live Razorpay creds).
    import os as _os
    provider = await _kiosk_qr_provider()
    vpa = _os.environ.get("PAYTM_VPA") or "efoodcare@paytm"
    merchant_name = "efoodcare"
    upi_qr_text = ""
    rzp_qr = None  # razorpay qrcode object when provider=razorpay
    if online_amount > 0:
        if provider == "razorpay" and getattr(server, "RZP_ENABLED", False):
            try:
                # iter-131.29: Razorpay QR Codes API requires `close_by` (an
                # expiry epoch, min 1h) for single_use QRs. Missing this was
                # silently falling back to UPI-intent — hence the reported
                # "Razorpay dynamic QR not working on kiosk" bug.
                import time as _t
                close_by_epoch = int(_t.time()) + (60 * 60 * 3)  # 3 hours
                rzp_qr = server.rzp_client.qrcode.create({
                    "type": "upi_qr",
                    "name": f"efoodcare · {order_id}",
                    "usage": "single_use",
                    "fixed_amount": True,
                    "payment_amount": online_amount * 100,  # paise
                    "description": f"{payload.qty} × {payload.meal_type} ({payload.service})"[:100],
                    "close_by": close_by_epoch,
                    "notes": {
                        "kind": "kiosk_walk_in",
                        "order_id": order_id,
                        "service": payload.service,
                        "meal_type": payload.meal_type,
                    },
                })
            except Exception as e:  # noqa: BLE001
                server.logger.warning(f"[kiosk] Razorpay QR create failed → UPI intent fallback: {e}")
                rzp_qr = None
        if rzp_qr is None:
            # paytm path OR razorpay failure — fall back to UPI intent QR
            upi_qr_text = (
                f"upi://pay?pa={vpa}&pn={merchant_name}"
                f"&am={online_amount}&tn={order_id}&cu=INR"
            )

    # An online/mixed order starts as awaiting_payment; cash-only starts as pending_collection.
    initial_status = "pending_collection" if payload.payment_method == "cash" else "awaiting_payment"

    order = {
        "order_id": order_id,
        "kind": "walk_in_kiosk",
        "user_id": None,
        "placed_by_admin_id": user.user_id,
        "phone": None,  # wall-kiosk has no delivery; we don't take phone here.
        "service": payload.service,
        "qty": payload.qty,
        "date": payload.date,
        "meal_type": payload.meal_type,
        "menu_text": menu.get(payload.meal_type),
        "unit_price": unit_price,
        "total": total,
        "currency": "INR",
        "status": initial_status,
        "payment_method": payload.payment_method,
        "cash_amount": cash_amount,
        "online_amount": online_amount,
        "online_paid": False,
        "cash_received": False,
        "note": (payload.note or "").strip(),
        "kiosk_token": kiosk_token,
        "kiosk_consumed_at": None,
        "kiosk_consumed_by": None,
        "upi_qr_text": upi_qr_text,
        "upi_vpa": vpa if (online_amount > 0 and not rzp_qr) else None,
        "qr_provider": provider if online_amount > 0 else None,
        "razorpay_qr_id": rzp_qr.get("id") if rzp_qr else None,
        "razorpay_qr_image_url": rzp_qr.get("image_url") if rzp_qr else None,
        "razorpay_qr_short_url": rzp_qr.get("short_url") if rzp_qr else None,
        "razorpay_qr_status": rzp_qr.get("status") if rzp_qr else None,
        "created_at": server.iso(server.now_utc()),
    }
    await server.db.mess_menu_orders.insert_one(order)
    # iter-134.p — assign a simple daily-sequential bill_no (globally per
    # kiosk-day, not per user) for walk-in kiosk orders so receipts read
    # "Bill #1", "Bill #2" and reset every IST midnight. Uses a
    # `daily_bill_counter` sequence keyed by date only so reprint-by-bill-no
    # is unambiguous within a day.
    try:
        today_ist = _today_ist()
        seq_id = f"bill:{today_ist}"
        seq = await server.db.daily_bill_counter.find_one_and_update(
            {"_id": seq_id},
            {"$inc": {"n": 1}, "$setOnInsert": {"date": today_ist}},
            upsert=True,
            return_document=True,
        )
        bill_no = int((seq or {}).get("n") or 1)
        await server.db.mess_menu_orders.update_one(
            {"order_id": order["order_id"]},
            {"$set": {"bill_no": bill_no, "bill_date": today_ist}},
        )
        order["bill_no"] = bill_no
        order["bill_date"] = today_ist
    except Exception as e:  # noqa: BLE001
        server.logger.warning(f"[kiosk] bill_no assign failed: {e}")
    # Render kiosk-token QR PNG for the printed receipt (anti-fraud check-in).
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
        "upi_qr_text": upi_qr_text,
        "upi_vpa": vpa if (online_amount > 0 and not rzp_qr) else None,
        "qr_provider": provider if online_amount > 0 else None,
        "razorpay_qr_id": rzp_qr.get("id") if rzp_qr else None,
        "razorpay_qr_image_url": rzp_qr.get("image_url") if rzp_qr else None,
        "razorpay_qr_short_url": rzp_qr.get("short_url") if rzp_qr else None,
    }


class KioskPaymentConfirmIn(BaseModel):
    order_id: str
    online_paid: bool = False
    cash_received: bool = False


@router.post("/admin/kiosk/order/confirm-payment")
async def kiosk_confirm_payment(payload: KioskPaymentConfirmIn, user: server.User = Depends(server.get_current_user)):
    """Iter-73 #14: staff marks the kiosk order paid after the customer
    completes the UPI scan and/or hands over cash. Once BOTH portions of a
    mixed payment are settled, the order transitions to pending_collection
    so the auto-print + counter check-in can proceed normally.
    """
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin or staff only")
    doc = await server.db.mess_menu_orders.find_one({"order_id": payload.order_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    if doc.get("kind") != "walk_in_kiosk":
        raise HTTPException(status_code=400, detail="Not a kiosk order")

    sets: dict = {}
    if payload.online_paid:
        sets["online_paid"] = True
        sets["online_paid_at"] = server.iso(server.now_utc())
    if payload.cash_received:
        sets["cash_received"] = True
        sets["cash_received_at"] = server.iso(server.now_utc())

    method = doc.get("payment_method", "cash")
    new_online = sets.get("online_paid", doc.get("online_paid", False)) or doc.get("online_amount", 0) == 0
    new_cash = sets.get("cash_received", doc.get("cash_received", False)) or doc.get("cash_amount", 0) == 0
    settled = False
    if method == "cash":
        settled = bool(new_cash)
    elif method == "online":
        settled = bool(new_online)
    elif method == "mixed":
        settled = bool(new_cash and new_online)
    if settled:
        sets["status"] = "pending_collection"
        sets["paid_at"] = server.iso(server.now_utc())

    await server.db.mess_menu_orders.update_one({"order_id": payload.order_id}, {"$set": sets})
    fresh = await server.db.mess_menu_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    return {"ok": True, "settled": settled, "order": fresh}


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
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    doc = await server.db.app_config.find_one({"key": KIOSK_BT_KEY}, {"_id": 0})
    if not doc:
        return dict(DEFAULT_BT)
    return {**DEFAULT_BT, **{k: v for k, v in doc.items() if k != "key"}}


@router.put("/admin/kiosk/bt-config")
async def admin_put_kiosk_bt(payload: KioskBtConfigIn, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.app_config.update_one(
        {"key": KIOSK_BT_KEY},
        {"$set": {"key": KIOSK_BT_KEY, "enabled": bool(payload.enabled)}},
        upsert=True,
    )
    return {"enabled": bool(payload.enabled)}


# -------- iter-74 #1: kiosk QR provider toggle (Paytm UPI intent | Razorpay QR) --------
KIOSK_QR_KEY = "kiosk_qr_v1"
DEFAULT_QR_CFG = {"provider": "razorpay"}  # iter-131.31: Paytm retired. Razorpay Dynamic UPI QR only.


class KioskQrProviderIn(BaseModel):
    provider: str = Field(..., description="paytm | razorpay")


@router.get("/admin/kiosk/qr-provider")
async def admin_get_kiosk_qr_provider(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    # iter-131.31: force razorpay + self-heal legacy paytm rows on read.
    doc = await server.db.app_config.find_one({"key": KIOSK_QR_KEY}, {"_id": 0})
    if doc and doc.get("provider") != "razorpay":
        try:
            await server.db.app_config.update_one(
                {"key": KIOSK_QR_KEY},
                {"$set": {"provider": "razorpay"}},
            )
        except Exception:
            pass
    return {"provider": "razorpay"}


@router.put("/admin/kiosk/qr-provider")
async def admin_put_kiosk_qr_provider(payload: KioskQrProviderIn, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    # iter-131.31: Paytm retired. Any incoming provider value is coerced to
    # razorpay so legacy admin UIs / persisted configs migrate silently.
    forced = "razorpay"
    await server.db.app_config.update_one(
        {"key": KIOSK_QR_KEY},
        {"$set": {"key": KIOSK_QR_KEY, "provider": forced}},
        upsert=True,
    )
    return {"provider": forced}


async def _kiosk_qr_provider() -> str:
    # iter-131.31: always Razorpay. Backwards-compat: also self-heal any legacy
    # paytm value in the DB so subsequent reads never resurrect it.
    doc = await server.db.app_config.find_one({"key": KIOSK_QR_KEY}, {"_id": 0})
    if doc and (doc.get("provider") != "razorpay"):
        try:
            await server.db.app_config.update_one(
                {"key": KIOSK_QR_KEY},
                {"$set": {"provider": "razorpay"}},
            )
        except Exception:
            pass
    return "razorpay"


@router.get("/admin/kiosk/order/{order_id}/payment-status")
async def kiosk_poll_payment_status(order_id: str, user: server.User = Depends(server.get_current_user)):
    """Iter-74 #1 — for Razorpay QR orders, poll Razorpay's qrcode.fetch to
    detect when `payments_amount_received` covers the order's online amount.
    Auto-marks online_paid=true on match so staff don't need to tap "Mark
    paid" manually.
    """
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    doc = await server.db.mess_menu_orders.find_one({"order_id": order_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    rzp_qr_id = doc.get("razorpay_qr_id")
    if not rzp_qr_id or not getattr(server, "RZP_ENABLED", False):
        return {"ok": True, "polled": False, "online_paid": bool(doc.get("online_paid"))}
    try:
        qr = server.rzp_client.qrcode.fetch(rzp_qr_id)
        received = int(qr.get("payments_amount_received") or 0)
        expected = int(doc.get("online_amount") or 0) * 100  # paise
        if received >= expected and not doc.get("online_paid"):
            sets = {"online_paid": True, "online_paid_at": server.iso(server.now_utc()), "razorpay_qr_status": qr.get("status")}
            method = doc.get("payment_method", "cash")
            cash_done = doc.get("cash_received", False) or doc.get("cash_amount", 0) == 0
            online_done = True
            settled = (cash_done and online_done) if method == "mixed" else online_done
            if settled:
                sets["status"] = "pending_collection"
                sets["paid_at"] = server.iso(server.now_utc())
            await server.db.mess_menu_orders.update_one({"order_id": order_id}, {"$set": sets})
            fresh = await server.db.mess_menu_orders.find_one({"order_id": order_id}, {"_id": 0})
            return {"ok": True, "polled": True, "settled": settled, "online_paid": True, "order": fresh}
        return {"ok": True, "polled": True, "settled": False, "online_paid": bool(doc.get("online_paid")), "received_paise": received, "expected_paise": expected}
    except Exception as e:  # noqa: BLE001
        server.logger.warning(f"[kiosk] Razorpay QR poll failed: {e}")
        return {"ok": True, "polled": False, "error": str(e), "online_paid": bool(doc.get("online_paid"))}



# -------- iter-135 · Reprint & today's kiosk orders --------------------------
def _render_kiosk_qr_datauri(kiosk_token: str) -> str:
    """Regenerate the printable kiosk-token QR (data URI PNG) for reprint."""
    if not kiosk_token:
        return ""
    try:
        import base64, io
        import qrcode
        img = qrcode.make(f"kio:{kiosk_token}")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as e:  # noqa: BLE001
        server.logger.warning(f"[kiosk] reprint QR render failed: {e}")
        return ""


@router.get("/admin/kiosk/orders/today")
async def admin_kiosk_orders_today(
    date: Optional[str] = Query(None, description="Override date (IST, YYYY-MM-DD). Defaults to today IST."),
    limit: int = Query(50, ge=1, le=200),
    user: server.User = Depends(server.get_current_user),
):
    """List today's walk-in kiosk orders (most recent first) so admins can
    reprint a receipt from history. Scoped to a single IST day for clarity.
    """
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    day = (date or _today_ist()).strip()
    cur = server.db.mess_menu_orders.find(
        {"kind": "walk_in_kiosk", "bill_date": day},
        {"_id": 0, "kiosk_token": 0, "razorpay_qr_image_url": 0, "razorpay_qr_short_url": 0, "upi_qr_text": 0},
    ).sort("bill_no", -1).limit(limit)
    orders = [doc async for doc in cur]
    return {"ok": True, "date": day, "count": len(orders), "orders": orders}


@router.get("/admin/kiosk/reprint/{bill_no}")
async def admin_kiosk_reprint(
    bill_no: int,
    date: Optional[str] = Query(None, description="IST day (YYYY-MM-DD). Defaults to today IST."),
    user: server.User = Depends(server.get_current_user),
):
    """Fetch a settled kiosk order by bill_no + date (defaults today) and
    return the payload the receipt modal expects (order + regenerated
    single-use kiosk-token QR PNG). Staff can now hand a customer a fresh
    print of a lost receipt in one tap.
    """
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    day = (date or _today_ist()).strip()
    doc = await server.db.mess_menu_orders.find_one(
        {"kind": "walk_in_kiosk", "bill_no": int(bill_no), "bill_date": day},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail=f"No kiosk bill #{bill_no} for {day}")
    qr_text = f"kio:{doc.get('kiosk_token') or ''}"
    qr_data_url = _render_kiosk_qr_datauri(doc.get("kiosk_token") or "")
    return {
        "ok": True,
        "order": doc,
        "qr_text": qr_text,
        "qr_data_url": qr_data_url,
    }



# -------- iter-136 · One-tap WhatsApp receipt send (Meta Cloud API) ----------
class KioskWhatsAppSendIn(BaseModel):
    order_id: str = Field(..., description="Kiosk order_id (kio_...)")
    phone: str = Field(..., description="Customer WhatsApp mobile, 10-digit or E.164")
    name: str = Field(default="", description="Optional customer name; defaults to 'Guest'")


@router.post("/admin/kiosk/whatsapp/send-receipt")
async def admin_kiosk_send_whatsapp_receipt(
    payload: KioskWhatsAppSendIn,
    user: server.User = Depends(server.get_current_user),
):
    """iter-136 — silently send the kiosk receipt via Meta WhatsApp Cloud API.
    Replaces the earlier wa.me deep-link that forced a browser/app switch.
    Falls back to stub mode (logged-only) when Meta credentials are missing.
    """
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")

    doc = await server.db.mess_menu_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    if doc.get("kind") != "walk_in_kiosk":
        raise HTTPException(status_code=400, detail="Not a kiosk order")

    from whatsapp_cloud import send_kiosk_receipt

    meal_service = f"{(doc.get('meal_type') or '').title()} · {(doc.get('service') or '').title()}".strip(" ·")
    result = await send_kiosk_receipt(
        server.db,
        phone=payload.phone,
        name=(payload.name or "").strip() or "Guest",
        bill_no=str(doc.get("bill_no") or doc.get("order_id") or ""),
        meal_service=meal_service or "Order",
        qty=str(doc.get("qty") or 1),
        total=str(doc.get("total") or 0),
    )
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("detail") or "WhatsApp send failed")
    return result
