"""Restaurant ordering router — separate menu CRUD + Razorpay-backed checkout.

eFoodCare also runs an online-ordering restaurant alongside subscriptions.
Same Razorpay account is used (tagged with `notes.order_type='restaurant'`)
so the admin Razorpay dashboard separates these flows from subscription
payments naturally.

Collections:
  * restaurant_menu_items — single config doc {_id:'active', items:[...]}
  * restaurant_orders     — one doc per checkout; survives even after payment
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import server  # late-binding access to db/logger/helpers/models

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class MenuItem(BaseModel):
    id: str
    name: str
    description: str = ""
    image_url: str = ""
    price: float
    discounted_price: Optional[float] = None
    category: str = "Mains"
    active: bool = True
    sort_order: int = 100


class MenuPatch(BaseModel):
    items: List[MenuItem]


class CartLine(BaseModel):
    id: str
    qty: int = Field(ge=1, le=50)


class CreateRestaurantOrder(BaseModel):
    items: List[CartLine]
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    apply_wallet: bool = False  # if true, deduct as much as possible from wallet
    customer_lat: Optional[float] = None
    customer_lng: Optional[float] = None


class VerifyRestaurantPayment(BaseModel):
    order_id: str
    razorpay_payment_id: Optional[str] = ""
    razorpay_signature: Optional[str] = ""


# ---------------------------------------------------------------------------
# Defaults — 15 menu items seeded on first load
# ---------------------------------------------------------------------------
def _ph(name: str) -> str:
    """Brand-red placeholder image with item name. Admin replaces via menu manager."""
    safe = name.replace(" ", "+").replace("&", "%26")
    return f"https://placehold.co/640x420/a02323/ffffff?text={safe}&font=montserrat"


DEFAULT_MENU: list[dict] = [
    # Starters
    {"id": "starter_paneer_tikka",   "name": "Paneer Tikka",        "category": "Starters",        "description": "Smoky tandoor paneer cubes marinated in yogurt and spices.", "price": 280, "discounted_price": 240, "sort_order": 10, "image_url": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=640&q=70&auto=format&fit=crop"},
    {"id": "starter_hara_bhara",     "name": "Hara Bhara Kebab",    "category": "Starters",        "description": "Spinach + green peas patties pan-fried until crisp.",        "price": 220, "discounted_price": 190, "sort_order": 20, "image_url": "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=640&q=70&auto=format&fit=crop"},
    {"id": "starter_spring_rolls",   "name": "Veg Spring Rolls",    "category": "Starters",        "description": "Crispy rolls stuffed with shredded veggies and noodles.",     "price": 200, "discounted_price": 170, "sort_order": 30, "image_url": "https://images.unsplash.com/photo-1606471191009-63994c53433b?w=640&q=70&auto=format&fit=crop"},
    {"id": "starter_chicken_65",     "name": "Chicken 65",          "category": "Starters",        "description": "Spicy South-Indian fried chicken with curry leaves.",        "price": 320, "discounted_price": 280, "sort_order": 40, "image_url": "https://images.unsplash.com/photo-1626500155302-6f7d8a59a35c?w=640&q=70&auto=format&fit=crop"},
    # Mains
    {"id": "main_paneer_butter",     "name": "Paneer Butter Masala","category": "Mains",           "description": "Rich tomato-cashew gravy with cottage cheese cubes.",        "price": 320, "discounted_price": 280, "sort_order": 110, "image_url": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=640&q=70&auto=format&fit=crop"},
    {"id": "main_dal_makhani",       "name": "Dal Makhani",         "category": "Mains",           "description": "Slow-cooked black urad with cream and butter.",              "price": 260, "discounted_price": 220, "sort_order": 120, "image_url": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=640&q=70&auto=format&fit=crop"},
    {"id": "main_veg_biryani",       "name": "Veg Biryani",         "category": "Mains",           "description": "Fragrant basmati layered with vegetables and saffron.",      "price": 280, "discounted_price": 240, "sort_order": 130, "image_url": "https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=640&q=70&auto=format&fit=crop"},
    {"id": "main_butter_chicken",    "name": "Butter Chicken",      "category": "Mains",           "description": "Boneless chicken in a velvety tomato-butter gravy.",         "price": 380, "discounted_price": 330, "sort_order": 140, "image_url": "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=640&q=70&auto=format&fit=crop"},
    {"id": "main_tava_veg",          "name": "Tava Veg Special",    "category": "Mains",           "description": "Mixed vegetables sautéed on iron griddle with garam masala.","price": 260, "discounted_price": 220, "sort_order": 150, "image_url": "https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=640&q=70&auto=format&fit=crop"},
    # Tiffin Specials
    {"id": "tiffin_full",            "name": "Full Veg Tiffin",     "category": "Tiffin Specials", "description": "4 chapatis · 1 sabzi · dal · rice · pickle · sweet.",        "price": 110, "discounted_price": 99,  "sort_order": 210, "image_url": "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=640&q=70&auto=format&fit=crop"},
    {"id": "tiffin_half",            "name": "Half Veg Tiffin",     "category": "Tiffin Specials", "description": "2 chapatis · 1 sabzi · dal · rice · pickle.",                "price": 65,  "discounted_price": 50,  "sort_order": 220, "image_url": "https://images.unsplash.com/photo-1567337710282-00832b415979?w=640&q=70&auto=format&fit=crop"},
    {"id": "tiffin_thali",           "name": "Special Thali",       "category": "Tiffin Specials", "description": "5 chapatis · 2 sabzis · dal · rice · raita · sweet · papad.","price": 180, "discounted_price": 150, "sort_order": 230, "image_url": "https://images.unsplash.com/photo-1542367592-8849eb950fd8?w=640&q=70&auto=format&fit=crop"},
    # Beverages
    {"id": "bev_masala_chai",        "name": "Masala Chai",         "category": "Beverages",       "description": "Cutting chai with cardamom, ginger and clove.",              "price": 35,  "discounted_price": 25,  "sort_order": 310, "image_url": "https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=640&q=70&auto=format&fit=crop"},
    {"id": "bev_mango_lassi",        "name": "Mango Lassi",         "category": "Beverages",       "description": "Thick yogurt smoothie with Alphonso mango pulp.",            "price": 90,  "discounted_price": 75,  "sort_order": 320, "image_url": "https://images.unsplash.com/photo-1626128665085-483747621778?w=640&q=70&auto=format&fit=crop"},
    # Desserts
    {"id": "dessert_gulab_jamun",    "name": "Gulab Jamun (2 pcs)", "category": "Desserts",        "description": "Khoya dumplings soaked in cardamom-rose syrup.",             "price": 80,  "discounted_price": 60,  "sort_order": 410, "image_url": "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=640&q=70&auto=format&fit=crop"},
]
for _it in DEFAULT_MENU:
    _it.setdefault("active", True)

DELIVERY_FEE_FREE_OVER = 500  # ₹ — free delivery above this
DELIVERY_FEE_FLAT = 50          # ₹ — flat below threshold


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _load_menu() -> list[dict]:
    doc = await server.db.restaurant_menu_items.find_one({"_id": "active"}, {"_id": 0})
    if not doc or not doc.get("items"):
        await server.db.restaurant_menu_items.update_one(
            {"_id": "active"},
            {"$set": {"items": DEFAULT_MENU, "updated_at": server.iso(server.now_utc())}},
            upsert=True,
        )
        return DEFAULT_MENU
    # One-shot migration: if existing items still use placehold.co (the old seed),
    # upgrade those rows to the latest DEFAULT_MENU image URLs by id.
    if any("placehold.co" in (it.get("image_url") or "") for it in doc["items"]):
        defaults_by_id = {d["id"]: d for d in DEFAULT_MENU}
        upgraded = []
        for it in doc["items"]:
            if "placehold.co" in (it.get("image_url") or "") and it.get("id") in defaults_by_id:
                it = {**it, "image_url": defaults_by_id[it["id"]].get("image_url", it["image_url"])}
            upgraded.append(it)
        await server.db.restaurant_menu_items.update_one(
            {"_id": "active"},
            {"$set": {"items": upgraded, "updated_at": server.iso(server.now_utc())}},
            upsert=True,
        )
        return upgraded
    return doc["items"]


def _compute_totals(menu_by_id: dict, items: list[CartLine]) -> tuple[list[dict], float, float, float]:
    """Resolve cart lines → priced lines + subtotal + delivery_fee + grand_total."""
    priced: list[dict] = []
    subtotal = 0.0
    for line in items:
        m = menu_by_id.get(line.id)
        if not m or not m.get("active", True):
            raise HTTPException(status_code=400, detail=f"Item not available: {line.id}")
        unit = float(m.get("discounted_price") or m["price"])
        line_total = round(unit * line.qty, 2)
        priced.append({
            "id": m["id"], "name": m["name"], "qty": line.qty,
            "unit_price": unit, "line_total": line_total,
            "image_url": m.get("image_url", ""),
        })
        subtotal += line_total
    subtotal = round(subtotal, 2)
    delivery_fee = 0.0 if subtotal >= DELIVERY_FEE_FREE_OVER else float(DELIVERY_FEE_FLAT)
    total = round(subtotal + delivery_fee, 2)
    return priced, subtotal, delivery_fee, total


# ---------------------------------------------------------------------------
# Public — menu read
# ---------------------------------------------------------------------------
@router.get("/restaurant/menu")
async def public_menu():
    items = await _load_menu()
    visible = [i for i in items if i.get("active", True)]
    visible.sort(key=lambda x: (x.get("sort_order", 100), x.get("name", "")))
    return {
        "items": visible,
        "delivery_fee_flat": DELIVERY_FEE_FLAT,
        "delivery_free_over": DELIVERY_FEE_FREE_OVER,
    }


# ---------------------------------------------------------------------------
# Admin — full menu CRUD
# ---------------------------------------------------------------------------
@router.get("/admin/restaurant/menu")
async def admin_menu(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return {"items": await _load_menu()}


@router.put("/admin/restaurant/menu")
async def admin_save_menu(payload: MenuPatch, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    seen_ids: set = set()
    cleaned: list[dict] = []
    for it in payload.items:
        if not it.name.strip():
            raise HTTPException(status_code=400, detail="Every item needs a name")
        if it.price < 0 or (it.discounted_price is not None and it.discounted_price < 0):
            raise HTTPException(status_code=400, detail="Prices cannot be negative")
        if it.discounted_price is not None and it.discounted_price >= it.price:
            it.discounted_price = None  # silently strip useless discounts
        new_id = (it.id or f"custom_{uuid.uuid4().hex[:10]}").strip()
        if new_id in seen_ids:
            raise HTTPException(status_code=400, detail=f"Duplicate id: {new_id}")
        seen_ids.add(new_id)
        d = it.model_dump()
        d["id"] = new_id
        if not d.get("image_url"):
            d["image_url"] = _ph(d["name"])
        cleaned.append(d)
    await server.db.restaurant_menu_items.update_one(
        {"_id": "active"},
        {"$set": {"items": cleaned, "updated_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return {"items": cleaned}


@router.post("/admin/restaurant/menu/reset")
async def admin_reset_menu(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.restaurant_menu_items.update_one(
        {"_id": "active"},
        {"$set": {"items": DEFAULT_MENU, "updated_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return {"items": DEFAULT_MENU}


# ---------------------------------------------------------------------------
# Order checkout — creates Razorpay order, persists cart, returns payment intent
# ---------------------------------------------------------------------------
@router.post("/restaurant/order")
async def create_restaurant_order(payload: CreateRestaurantOrder, user: server.User = Depends(server.get_current_user)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    menu = await _load_menu()
    menu_by_id = {m["id"]: m for m in menu}
    priced, subtotal, delivery_fee, total = _compute_totals(menu_by_id, payload.items)

    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0})

    # Wallet redemption: cap at wallet_balance, applied BEFORE Razorpay so
    # the gateway only ever charges the remaining amount.
    wallet_avail = round(float((user_doc or {}).get("wallet_balance") or 0), 2)
    wallet_used = 0.0
    if payload.apply_wallet and wallet_avail > 0:
        wallet_used = min(wallet_avail, total)
    payable = round(total - wallet_used, 2)

    order_id = f"rorder_{uuid.uuid4().hex[:18]}"
    rzp_order_id = order_id  # default to our id (mock mode)
    mock = True
    razorpay_options = None
    full_wallet_payment = wallet_used > 0 and payable <= 0

    # Try real Razorpay; fall back to mock if disabled / errors.
    if server.RZP_ENABLED and server.rzp_client and not full_wallet_payment:
        try:
            rzp = server.rzp_client.order.create(dict(
                amount=int(round(payable * 100)),
                currency="INR",
                receipt=order_id[:40],
                payment_capture=1,
                notes={"order_type": "restaurant", "user_id": user.user_id, "internal_id": order_id},
            ))
            rzp_order_id = rzp["id"]
            mock = False
            razorpay_options = {
                "key": server.RZP_KEY_ID,
                "amount": rzp["amount"],
                "currency": rzp["currency"],
                "order_id": rzp_order_id,
                "name": "eFoodCare Restaurant",
                "description": f"{len(payload.items)} item(s)",
                "prefill": {
                    "name": (payload.name or user_doc.get("name") or "")[:40],
                    "contact": (payload.phone or user_doc.get("phone") or "")[:15],
                    "email": (user_doc.get("email") or "")[:60],
                },
            }
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RESTAURANT] Razorpay create_order failed → mock fallback · {e}")

    doc = {
        "order_id": order_id,
        "razorpay_order_id": rzp_order_id,
        "user_id": user.user_id,
        "items": priced,
        "subtotal": subtotal,
        "delivery_fee": delivery_fee,
        "total": total,
        "wallet_used": wallet_used,
        "payable": payable,
        "status": "created",
        "mock": mock,
        "name": payload.name or user_doc.get("name") or "",
        "phone": payload.phone or user_doc.get("phone") or "",
        "address": payload.address or user_doc.get("address") or "",
        "customer_lat": payload.customer_lat if payload.customer_lat is not None else user_doc.get("lat"),
        "customer_lng": payload.customer_lng if payload.customer_lng is not None else user_doc.get("lng"),
        "notes": (payload.notes or "")[:500],
        "created_at": server.iso(server.now_utc()),
    }
    await server.db.restaurant_orders.insert_one(dict(doc))

    # Auto-save delivery details to the user's profile so future checkouts
    # are pre-filled. Only update fields the user actually typed in this checkout
    # AND that are missing/different on their profile.
    profile_updates = {}
    if payload.name and (user_doc.get("name") or "").strip() != payload.name.strip():
        profile_updates["name"] = payload.name.strip()
    if payload.phone and (user_doc.get("phone") or "").strip() != payload.phone.strip():
        profile_updates["phone"] = payload.phone.strip()
    if payload.address and (user_doc.get("address") or "").strip() != payload.address.strip():
        profile_updates["address"] = payload.address.strip()
    if payload.customer_lat is not None and payload.customer_lng is not None:
        profile_updates["lat"] = float(payload.customer_lat)
        profile_updates["lng"] = float(payload.customer_lng)
    if profile_updates:
        try:
            await server.db.users.update_one({"user_id": user.user_id}, {"$set": profile_updates})
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RESTAURANT] profile auto-save skipped · {e}")

    return {
        "order_id": order_id,
        "razorpay": razorpay_options,  # null in mock mode → frontend auto-verifies
        "mock": mock or full_wallet_payment,
        "subtotal": subtotal,
        "delivery_fee": delivery_fee,
        "total": total,
        "wallet_used": wallet_used,
        "payable": payable,
        "items": priced,
    }


@router.post("/restaurant/verify")
async def verify_restaurant_payment(payload: VerifyRestaurantPayment, user: server.User = Depends(server.get_current_user)):
    order = await server.db.restaurant_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if order.get("mock"):
        server.logger.warning(f"[MOCKED RESTAURANT] auto-verifying {payload.order_id}")
    else:
        try:
            server.rzp_client.utility.verify_payment_signature({
                "razorpay_order_id": order["razorpay_order_id"],
                "razorpay_payment_id": payload.razorpay_payment_id,
                "razorpay_signature": payload.razorpay_signature,
            })
        except Exception as e:  # noqa: BLE001
            server.logger.error(f"[RESTAURANT] signature verify failed: {e}")
            raise HTTPException(status_code=400, detail="Invalid payment signature")

    await server.db.restaurant_orders.update_one(
        {"order_id": payload.order_id},
        {"$set": {
            "status": "paid",
            "razorpay_payment_id": payload.razorpay_payment_id or "",
            "paid_at": server.iso(server.now_utc()),
            # ETA: 35-45 min from now
            "eta_at": server.iso(server.now_utc() + timedelta(minutes=40)),
        }},
    )
    # Deduct wallet AFTER order is confirmed paid (debit and ledger entry)
    wallet_used = round(float(order.get("wallet_used") or 0), 2)
    if wallet_used > 0:
        u = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
        new_bal = round(float(u.get("wallet_balance") or 0) - wallet_used, 2)
        if new_bal < 0:
            server.logger.warning(f"[RESTAURANT] wallet went negative on {payload.order_id} — clamping to 0")
            new_bal = 0.0
        await server.db.users.update_one(
            {"user_id": user.user_id},
            {"$inc": {"wallet_balance": -wallet_used}},
        )
        try:
            await server._log_wallet_txn(
                user.user_id, None, "debit", wallet_used, new_bal,
                f"Restaurant order payment · {payload.order_id}",
            )
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RESTAURANT] wallet txn log failed: {e}")
    fresh = await server.db.restaurant_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    # Fire WhatsApp order confirmation (stub-mode safe)
    try:
        from whatsapp import send_restaurant_order_confirmation
        import asyncio
        if fresh.get("phone"):
            asyncio.create_task(send_restaurant_order_confirmation(
                server.db,
                phone=fresh["phone"],
                name=fresh.get("name") or "there",
                order_id=fresh["order_id"],
                total=float(fresh.get("total", 0)),
                eta_minutes=40,
            ))
    except Exception as e:
        server.logger.warning(f"[WA] restaurant order confirmation enqueue failed: {e}")
    return {"ok": True, "order": fresh}


# ---------------------------------------------------------------------------
# Order history
# ---------------------------------------------------------------------------
@router.get("/restaurant/orders")
async def my_orders(user: server.User = Depends(server.get_current_user), limit: int = 20):
    limit = max(1, min(100, int(limit)))
    rows = await server.db.restaurant_orders.find(
        {"user_id": user.user_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return {"orders": rows}


@router.get("/admin/restaurant/orders")
async def admin_orders(user: server.User = Depends(server.get_current_user), limit: int = 50):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    limit = max(1, min(500, int(limit)))
    rows = await server.db.restaurant_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"orders": rows}


# ---------------------------------------------------------------------------
# Combined live map for admin — tiffin delivery boys + restaurant riders +
# in-flight restaurant orders + their customer pins. Frontend renders all on
# one screen so ops can see everything at a glance.
# ---------------------------------------------------------------------------
@router.get("/admin/live/restaurant")
async def admin_live_restaurant(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    # Active in-flight restaurant orders only (out_for_delivery / ready_for_pickup / preparing)
    statuses = ["paid", "preparing", "ready_for_pickup", "out_for_delivery"]
    orders = await server.db.restaurant_orders.find(
        {"status": {"$in": statuses}}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    # Riders with recent location pings (last 10 min)
    cutoff = server.iso(server.now_utc() - timedelta(minutes=10))
    rider_docs = await server.db.users.find(
        {"role": "rider"}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "rider_lat": 1, "rider_lng": 1, "rider_location_at": 1},
    ).to_list(200)
    riders = [
        {
            "rider_id": r["user_id"], "name": r.get("name"), "phone": r.get("phone"),
            "lat": r.get("rider_lat"), "lng": r.get("rider_lng"),
            "location_at": r.get("rider_location_at"),
            "is_live": bool(r.get("rider_lat") and r.get("rider_location_at") and r.get("rider_location_at") >= cutoff),
        }
        for r in rider_docs if r.get("rider_lat") is not None
    ]
    # Sanitise orders to only the fields the map needs
    out_orders = [
        {
            "order_id": o["order_id"], "status": o["status"], "user_id": o.get("user_id"),
            "name": o.get("name"), "phone": o.get("phone"), "address": o.get("address"),
            "total": o.get("total"), "rider_id": o.get("rider_id"),
            "rider_lat": o.get("rider_lat"), "rider_lng": o.get("rider_lng"),
            "customer_lat": o.get("customer_lat"), "customer_lng": o.get("customer_lng"),
            "created_at": o.get("created_at"),
        }
        for o in orders
    ]
    return {"orders": out_orders, "riders": riders}


# ---------------------------------------------------------------------------
# Customer-initiated cancel — only allowed while status == "paid" (kitchen
# hasn't started yet). Auto-credits the order total back to the user's wallet.
# ---------------------------------------------------------------------------
@router.post("/restaurant/orders/{order_id}/cancel")
async def customer_cancel_order(order_id: str, user: server.User = Depends(server.get_current_user)):
    order = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if order.get("status") != "paid":
        raise HTTPException(
            status_code=400,
            detail="Order can no longer be cancelled — kitchen has already started or it has been delivered.",
        )

    refund_amount = round(float(order.get("total") or 0), 2)
    now_iso = server.iso(server.now_utc())

    # Credit user wallet (refunds always land in the smart wallet for instant reuse).
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    new_balance = round(float(user_doc.get("wallet_balance") or 0) + refund_amount, 2)
    await server.db.users.update_one(
        {"user_id": user.user_id},
        {"$inc": {"wallet_balance": refund_amount}},
    )
    await server._log_wallet_txn(
        user.user_id, None, "credit", refund_amount, new_balance,
        f"Restaurant order cancellation refund · {order_id}",
    )

    await server.db.restaurant_orders.update_one(
        {"order_id": order_id},
        {"$set": {
            "status": "cancelled",
            "cancelled_at": now_iso,
            "cancelled_by": "customer",
            "refund_amount": refund_amount,
            "refund_mode": "wallet",
        }},
    )
    fresh = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
    return {"ok": True, "order": fresh, "refund_amount": refund_amount, "wallet_balance": new_balance}
