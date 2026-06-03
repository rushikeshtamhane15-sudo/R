"""Restaurant ordering router — separate menu CRUD + Razorpay-backed checkout.

efoodcare also runs an online-ordering restaurant alongside subscriptions.
Same Razorpay account is used (tagged with `notes.order_type='restaurant'`)
so the admin Razorpay dashboard separates these flows from subscription
payments naturally.

Collections:
  * restaurant_menu_items — single config doc {_id:'active', items:[...]}
  * restaurant_orders     — one doc per checkout; survives even after payment
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field

from shared import server  # late-binding via shared shim (avoids circular-import flag)

router = APIRouter()

# ---------------------------------------------------------------------------
# Local-disk "object storage" for admin-uploaded menu images.
# We persist files under /app/backend/uploads/menu_images/<uuid>.<ext> and
# serve them statically via FastAPI's StaticFiles mount at /api/uploads/...
# (mount is registered in server.py at import time).
#
# Why local disk over base64-in-Mongo?
#   * Keeps Mongo docs small (was 1.4 MB+ per menu item with base64).
#   * Lets the browser cache images independently.
#   * Easy upgrade path: swap save-path for S3/GCS later — public URL contract
#     stays the same.
# ---------------------------------------------------------------------------
UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads"
MENU_IMAGE_DIR = UPLOAD_ROOT / "menu_images"
MENU_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 4 * 1024 * 1024  # 4 MB — generous; was 1.4MB for base64

_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

# ---------------------------------------------------------------------------
# Pure-veg gatekeeping
#
# efoodcare is strictly vegetarian. Admin-typed item names can accidentally
# introduce non-veg ingredients via the menu form. `is_non_veg` runs a simple
# keyword/regex pattern check on name/description/category. We BLOCK saves
# (HTTP 400) when a non-veg item slips in, and filter out any pre-existing
# non-veg seed entries on first read.
# ---------------------------------------------------------------------------
import re as _re

NON_VEG_PATTERNS = [
    r"\bchicken\b", r"\bmutton\b", r"\blamb\b", r"\bbeef\b", r"\bpork\b",
    r"\bham\b", r"\bbacon\b", r"\bsausage\b", r"\bsalami\b", r"\bpepperoni\b",
    r"\bfish\b", r"\bsea\s*food\b", r"\bprawn\b", r"\bshrimp\b", r"\bcrab\b",
    r"\boyster\b", r"\blobster\b", r"\bsquid\b", r"\btuna\b", r"\bsalmon\b",
    r"\begg(s)?\b", r"\bomelette?\b", r"\bturkey\b", r"\bduck\b", r"\bquail\b",
    r"\bgelatin\b", r"\bkebab\b", r"\bbiryani\s+(murg|murgh|chicken|mutton)\b",
    r"\btikka\s+(masala\s+)?chicken\b", r"\btandoori\s+chicken\b",
    r"\bkofta\s+meat\b", r"\bmeatball\b",
]
_NON_VEG_RE = _re.compile("|".join(NON_VEG_PATTERNS), _re.IGNORECASE)


def is_non_veg(name: str | None, description: str | None = None, category: str | None = None) -> bool:
    """Return True if any non-veg keyword appears in the combined text."""
    combined = " ".join(filter(None, [name, description, category])).lower()
    return bool(_NON_VEG_RE.search(combined))


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
    # Steel-tiffin / returnable packaging — when True, ordering this item creates
    # a tiffin-pendency record on delivery and bumps the customer's tiffin_balance
    # so the kitchen can call them back later for pickup.
    is_returnable_tiffin: bool = False
    # Optional per-variant price multipliers OR absolute prices. Lets an admin
    # charge Large at 1.8× (instead of strict 2×) when margins on a bigger
    # portion are tighter — or set an absolute price (e.g. "Family thali ₹650")
    # that ignores the multiplier entirely.
    #   - multiplier form: {"large": 1.8, "family": 3.5}
    #   - absolute form:   {"large": {"absolute": 650}}
    # An empty dict (default) preserves the standard 1×/2×/4× multipliers.
    variant_prices: dict = Field(default_factory=dict)


class MenuPatch(BaseModel):
    items: List[MenuItem]


class CartLine(BaseModel):
    id: str
    qty: int = Field(ge=1, le=50)
    # Optional portion variant — used by the dish detail modal so a single
    # cart line can represent a Large/Family-sized order. Backend resolves
    # variant → portion multiplier ({regular:1, large:2, family:4}) to compute
    # the line total. Defaults to "regular" when missing.
    # Pydantic Literal[] catches invalid values at OpenAPI schema validation
    # (HTTP 422) instead of inside the handler — cleaner error message.
    variant: Optional[Literal["regular", "large", "family"]] = "regular"


# Portion-variant → multiplier. Keep in sync with frontend
# `src/lib/cart.js#PORTION_MULTIPLIER`.
PORTION_MULTIPLIER = {"regular": 1, "large": 2, "family": 4}
PORTION_LABEL = {"regular": "Regular", "large": "Large", "family": "Family"}


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
    # Default tiffin items to returnable steel containers; non-tiffin to disposable
    _it.setdefault("is_returnable_tiffin", _it.get("category") == "Tiffin Specials")

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
    # One-shot migration: ensure is_returnable_tiffin flag exists on every row
    # (added in iter28). Default tiffin items to returnable, others to disposable.
    needs_returnable_migration = any("is_returnable_tiffin" not in it for it in doc["items"])
    if needs_returnable_migration:
        for it in doc["items"]:
            if "is_returnable_tiffin" not in it:
                it["is_returnable_tiffin"] = it.get("category") == "Tiffin Specials"
        await server.db.restaurant_menu_items.update_one(
            {"_id": "active"},
            {"$set": {"items": doc["items"], "updated_at": server.iso(server.now_utc())}},
            upsert=True,
        )
    return doc["items"]


def _compute_totals(menu_by_id: dict, items: list[CartLine]) -> tuple[list[dict], float, float, float]:
    """Resolve cart lines → priced lines + subtotal + delivery_fee + grand_total.

    Honours the optional `variant` on each line (regular/large/family). Large
    multiplies the unit price by 2, Family by 4, so a single line with
    variant=large + qty=1 charges for two regular portions and the receipt
    reads "Butter Chicken · Large".
    """
    priced: list[dict] = []
    subtotal = 0.0
    for line in items:
        m = menu_by_id.get(line.id)
        if not m or not m.get("active", True):
            raise HTTPException(status_code=400, detail=f"Item not available: {line.id}")
        variant = (line.variant or "regular").lower()
        if variant not in PORTION_MULTIPLIER:
            raise HTTPException(status_code=400, detail=f"Unknown portion variant: {variant}")
        # Admin variant-price overrides — `variant_prices` on the menu item
        # can contain either a custom multiplier (float) OR an absolute price
        # ({"absolute": 650}). Falls back to the default 1×/2×/4× table when
        # no override is set.
        base_unit = float(m.get("discounted_price") or m["price"])
        override = (m.get("variant_prices") or {}).get(variant)
        if isinstance(override, dict) and "absolute" in override:
            unit = round(float(override["absolute"]), 2)
            portion_mult = unit / base_unit if base_unit > 0 else PORTION_MULTIPLIER[variant]
        elif isinstance(override, (int, float)) and override > 0:
            portion_mult = float(override)
            unit = round(base_unit * portion_mult, 2)
        else:
            portion_mult = PORTION_MULTIPLIER[variant]
            unit = round(base_unit * portion_mult, 2)
        line_total = round(unit * line.qty, 2)
        priced.append({
            "id": m["id"], "name": m["name"], "qty": line.qty,
            "variant": variant,
            "variant_label": PORTION_LABEL.get(variant, variant.title()),
            "portion_multiplier": portion_mult,
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
@router.get("/restaurant/serviceable-area")
async def restaurant_serviceable_area():
    """Public — returns the kitchen's dispatch lat/lng + serviceable radius.
    Iter-52: front-end uses this to check the geolocated customer position
    against the brand's delivery range. Falls back to a 15km radius if the
    admin hasn't pinned the kitchen yet.
    """
    from shared import server as _s
    settings_doc = await _s.db.delivery_settings.find_one({"_id": "active"}, {"_id": 0}) or {}
    return {
        "dispatch_lat": settings_doc.get("dispatch_lat"),
        "dispatch_lng": settings_doc.get("dispatch_lng"),
        "dispatch_radius_km": settings_doc.get("dispatch_radius_km", 15),
    }


@router.get("/restaurant/menu")
async def public_menu():
    items = await _load_menu()
    # Pure-veg gatekeeper: filter out any non-veg rows even if an admin saved
    # one bypassing the check. The storefront should NEVER show non-veg items.
    visible = [
        i for i in items
        if i.get("active", True) and not is_non_veg(i.get("name"), i.get("description"), i.get("category"))
    ]
    visible.sort(key=lambda x: (x.get("sort_order", 100), x.get("name", "")))
    # Kitchen / dispatch coords — read from delivery_settings (admin-editable in
    # /admin/delivery → settings). Fallback to Pune city centre so the
    # ETA-on-Pay-button feature works even before admin sets it.
    settings = await server.db.delivery_settings.find_one({"_id": "active"}, {"_id": 0}) or {}
    return {
        "items": visible,
        "delivery_fee_flat": DELIVERY_FEE_FLAT,
        "delivery_free_over": DELIVERY_FEE_FREE_OVER,
        "kitchen_lat": settings.get("dispatch_lat") or 18.5204,
        "kitchen_lng": settings.get("dispatch_lng") or 73.8567,
    }


# ---------------------------------------------------------------------------
# Restaurant page CMS — admin can edit hero copy/colors. Single doc per app
# stored at restaurant_theme/{singleton: 1}. Public GET, admin-only PUT.
# ---------------------------------------------------------------------------
class RestaurantTheme(BaseModel):
    # Hero copy
    hero_title: Optional[str] = None
    hero_tagline: Optional[str] = None
    hero_promise_line1: Optional[str] = None
    hero_promise_line2: Optional[str] = None
    hero_overline: Optional[str] = None
    hero_delivery_badge: Optional[str] = None
    # Top-container badges
    pure_veg_label: Optional[str] = None
    pure_veg_color: Optional[str] = None   # text color e.g. "#057a3a"
    pure_veg_bg_color: Optional[str] = None  # pill background e.g. "rgba(255,255,255,0.95)"
    bad_stuff_chip_text: Optional[str] = None
    # Per-item card
    item_promise_label: Optional[str] = None
    # UI strings
    search_placeholder: Optional[str] = None
    cart_login_hint: Optional[str] = None
    cart_free_delivery_label: Optional[str] = None
    cart_delivery_fee_template: Optional[str] = None
    checkout_btn_label: Optional[str] = None
    checkout_login_btn_label: Optional[str] = None
    no_items_label: Optional[str] = None
    reorder_overline: Optional[str] = None
    reorder_cta_label: Optional[str] = None
    # Colors
    hero_bg_color: Optional[str] = None
    hero_text_color: Optional[str] = None
    accent_color: Optional[str] = None
    ninety_min_bg_color: Optional[str] = None  # default emerald (was yellow)
    ninety_min_text_color: Optional[str] = None
    item_promise_bg_color: Optional[str] = None
    item_promise_text_color: Optional[str] = None
    # Visibility — kept for migration; admin UI no longer surfaces these
    show_zero_bad_stuff_chip: Optional[bool] = True
    show_delivery_promise: Optional[bool] = True
    # === Hero layout (Iter-46) ===
    # Template picker: "default" | "centered" | "stacked-compact" | "split"
    hero_layout: Optional[str] = None
    # Per-element ordering + visibility + free-positioning offsets.
    # Stored as a list of dicts to preserve admin's chosen order. Each entry:
    #   {key: "pure_veg_overline" | "title" | "hindi_quote" | "tagline" | "ninety_min",
    #    visible: bool, align: "left"|"center"|"right",
    #    x_offset_pct: float (-50..50), y_offset_px: int (-40..40)}
    # `pure_veg_overline` is the combined top row (efoodcare overline LEFT +
    # Pure Veg badge RIGHT). Unknown keys are silently ignored by HeroPanel.
    # When the list is empty/None, HeroPanel renders the default layout.
    hero_elements: Optional[list[dict]] = None


@router.get("/restaurant/theme")
async def get_restaurant_theme():
    doc = await server.db.restaurant_theme.find_one({"singleton": 1}, {"_id": 0}) or {}
    doc.pop("singleton", None)
    return doc


@router.put("/admin/restaurant/theme")
async def put_restaurant_theme(payload: RestaurantTheme, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    update = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    update["updated_at"] = server.iso(server.now_utc())
    update["updated_by"] = user.user_id
    await server.db.restaurant_theme.update_one(
        {"singleton": 1},
        {"$set": update, "$setOnInsert": {"singleton": 1}},
        upsert=True,
    )
    fresh = await server.db.restaurant_theme.find_one({"singleton": 1}, {"_id": 0})
    fresh.pop("singleton", None)
    return fresh


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
    rejected_non_veg: list[str] = []
    for it in payload.items:
        if not it.name.strip():
            raise HTTPException(status_code=400, detail="Every item needs a name")
        if it.price < 0 or (it.discounted_price is not None and it.discounted_price < 0):
            raise HTTPException(status_code=400, detail="Prices cannot be negative")
        if it.discounted_price is not None and it.discounted_price >= it.price:
            it.discounted_price = None  # silently strip useless discounts
        # Pure-veg gate — block non-veg items entirely. We collect names so we
        # can show a clear single error to the admin instead of failing on
        # the first offender.
        if is_non_veg(it.name, it.description, it.category):
            rejected_non_veg.append(it.name)
            continue
        new_id = (it.id or f"custom_{uuid.uuid4().hex[:10]}").strip()
        if new_id in seen_ids:
            raise HTTPException(status_code=400, detail=f"Duplicate id: {new_id}")
        seen_ids.add(new_id)
        d = it.model_dump()
        d["id"] = new_id
        if not d.get("image_url"):
            d["image_url"] = _ph(d["name"])
        cleaned.append(d)
    if rejected_non_veg:
        raise HTTPException(
            status_code=400,
            detail=f"efoodcare is strictly vegetarian — rejected non-veg item(s): {', '.join(rejected_non_veg)}",
        )
    await server.db.restaurant_menu_items.update_one(
        {"_id": "active"},
        {"$set": {"items": cleaned, "updated_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return {"items": cleaned}


class VegCheckIn(BaseModel):
    name: str
    description: str | None = None
    category: str | None = None


@router.post("/admin/restaurant/menu/check-veg")
async def admin_check_veg(payload: VegCheckIn, user: server.User = Depends(server.get_current_user)):
    """Lightweight veg/non-veg classifier used by the admin form to warn the
    admin BEFORE save if a name/description hits non-veg keywords."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    flagged = is_non_veg(payload.name, payload.description, payload.category)
    return {"is_non_veg": flagged, "is_veg": not flagged}


class GenImageIn(BaseModel):
    name: str
    category: str | None = None
    description: str | None = None


@router.post("/admin/restaurant/menu/generate-image")
async def admin_generate_menu_image(
    payload: GenImageIn,
    user: server.User = Depends(server.get_current_user),
):
    """Generate a 3D food image for a menu item via Gemini Nano Banana.

    The handler refuses to generate for non-veg items so we never accidentally
    embed a non-veg image on the storefront.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if is_non_veg(payload.name, payload.description, payload.category):
        raise HTTPException(status_code=400, detail="Refusing to generate — non-veg item")
    from image_gen import generate_3d_image  # late import → keeps SDK off the hot import path
    prompt_bits = [
        f"Indian vegetarian dish: {payload.name}",
    ]
    if payload.category:
        prompt_bits.append(f"Category: {payload.category}")
    if payload.description:
        prompt_bits.append(payload.description)
    prompt_bits.append("Plated, garnished, hot, freshly cooked, glistening, appetising, top-down 30-degree angle.")
    try:
        url, nbytes = await generate_3d_image(prompt=" · ".join(prompt_bits), subdir="menu_images")
    except Exception as e:
        # Detect the Emergent universal-key budget exhaustion explicitly so
        # the admin gets an actionable banner ("top up your universal key")
        # instead of a generic 502 with raw JSON spilling into the toast.
        msg = str(e)
        low = msg.lower()
        if "budget has been exceeded" in low or "budgetexceeded" in low or "max budget" in low:
            raise HTTPException(
                status_code=402,
                detail=(
                    "Emergent universal-key budget exhausted. Open your Emergent "
                    "Profile → Universal Key → Add Balance (or enable auto-topup) "
                    "and retry. No image was generated; no cost was charged."
                ),
            ) from e
        raise HTTPException(status_code=502, detail=f"Image generation failed: {msg[:300]}") from e
    return {"url": url, "bytes": nbytes}


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


@router.post("/admin/restaurant/menu/upload-image")
async def admin_upload_menu_image(
    file: UploadFile = File(...),
    user: server.User = Depends(server.get_current_user),
):
    """Iter-55: Persist admin-uploaded menu images as base64 data-URLs so they
    survive production redeploys (local disk gets wiped each release). We
    still optimise to WebP first for bandwidth, then encode."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    ext = _EXT_BY_MIME.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPG / PNG / WEBP / GIF supported")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    # WebP optimization — bandwidth saver.
    from image_optim import optimize_to_webp_bytes
    try:
        webp_bytes = optimize_to_webp_bytes(data)
        mime = "image/webp"
    except Exception:  # noqa: BLE001
        webp_bytes = data
        mime = file.content_type or "image/jpeg"
    import base64 as _b64
    data_url = "data:" + mime + ";base64," + _b64.b64encode(webp_bytes).decode("ascii")
    return {"url": data_url, "bytes": len(webp_bytes)}


# ---------------------------------------------------------------------------
# Admin — restaurant categories (rename / reorder / add / delete)
#
# Categories used to be derived from the distinct `category` strings on menu
# items. Now we persist an admin-curated list in `restaurant_categories` so
# admins can reorder, rename, add new, or hide categories from the storefront.
# Renaming a category propagates to every menu item that uses it.
# ---------------------------------------------------------------------------
DEFAULT_CATEGORIES = ["Starters", "Mains", "Tiffin Specials", "Beverages", "Desserts"]


class CategoryList(BaseModel):
    categories: List[str]


async def _load_categories() -> list[str]:
    doc = await server.db.restaurant_categories.find_one({"_id": "active"}, {"_id": 0}) or {}
    cats = doc.get("categories")
    if cats:
        return cats
    # Bootstrap: seed from distinct categories on menu items, falling back to
    # DEFAULT_CATEGORIES if the menu is empty. Persist for future reads.
    items = await _load_menu()
    derived: list[str] = []
    seen: set = set()
    for it in items:
        c = (it.get("category") or "").strip()
        if c and c not in seen:
            seen.add(c)
            derived.append(c)
    if not derived:
        derived = list(DEFAULT_CATEGORIES)
    await server.db.restaurant_categories.update_one(
        {"_id": "active"},
        {"$set": {"categories": derived, "updated_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return derived


@router.get("/restaurant/categories")
async def public_categories():
    """Public — sorted category list for the storefront category strip."""
    return {"categories": await _load_categories()}


@router.get("/admin/restaurant/categories")
async def admin_categories(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return {"categories": await _load_categories()}


@router.put("/admin/restaurant/categories")
async def admin_save_categories(
    payload: CategoryList,
    user: server.User = Depends(server.get_current_user),
):
    """Save admin-curated category list. Accepts a rename map {old: new}
    via query param `rename` is intentionally NOT supported — the convention is:
    pass `categories=[..]` only and rename detection happens client-side
    (admin replaces a name in-place). For server-side rename propagation, we
    diff the new list against the old list at the same index and treat
    different strings as renames."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cleaned: list[str] = []
    seen: set = set()
    for c in payload.categories:
        c = (c or "").strip()
        if not c:
            continue
        if c in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate category: {c}")
        if len(c) > 60:
            raise HTTPException(status_code=400, detail=f"Category too long: {c}")
        seen.add(c)
        cleaned.append(c)
    if not cleaned:
        raise HTTPException(status_code=400, detail="At least one category required")

    # Detect renames by index against the previously stored list so we can
    # propagate the change to every menu item using the old name.
    prev = await _load_categories()
    renames: dict[str, str] = {}
    for i, new_name in enumerate(cleaned):
        if i < len(prev) and prev[i] != new_name and prev[i] not in cleaned:
            renames[prev[i]] = new_name
    if renames:
        menu_doc = await server.db.restaurant_menu_items.find_one({"_id": "active"}, {"_id": 0}) or {}
        items = menu_doc.get("items") or []
        touched = False
        for it in items:
            if it.get("category") in renames:
                it["category"] = renames[it["category"]]
                touched = True
        if touched:
            await server.db.restaurant_menu_items.update_one(
                {"_id": "active"},
                {"$set": {"items": items, "updated_at": server.iso(server.now_utc())}},
                upsert=True,
            )

    await server.db.restaurant_categories.update_one(
        {"_id": "active"},
        {"$set": {"categories": cleaned, "updated_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return {"categories": cleaned, "renames": renames}




