"""App CMS — admin-editable global settings.

Currently:
    * Bottom navigation config (per role) — db.app_config{_id:'bottom_nav'}
    * Notification sound URL/data — db.app_config{_id:'notify_sound'}
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server  # late-binding via shared shim

router = APIRouter()


# ---------------------------------------------------------------------------
# Bottom navigation
# ---------------------------------------------------------------------------
DEFAULT_BOTTOM_NAV: dict = {
    "subscriber": [
        {"id": "restaurant", "label": "Restaurant",   "icon": "ChefHat",         "to": "/restaurant",        "visible": True},
        {"id": "orders",     "label": "Orders",       "icon": "Receipt",         "to": "/restaurant/orders", "visible": True},
        {"id": "dashboard",  "label": "Dashboard",    "icon": "LayoutDashboard", "to": "/dashboard",         "visible": True},
        {"id": "account",    "label": "Account",      "icon": "User",            "to": "/profile",           "visible": True},
    ],
    "rider": [
        {"id": "dashboard",  "label": "Dashboard",    "icon": "Bike",            "to": "/rider",         "visible": True},
        {"id": "contact",    "label": "Contact",      "icon": "Phone",           "to": "/contact",       "visible": True},
        {"id": "logout",     "label": "Logout",       "icon": "LogOut",          "to": "__logout__",     "visible": True},
        {"id": "account",    "label": "Account",      "icon": "User",            "to": "/rider/account", "visible": True},
    ],
    "guest": [
        {"id": "restaurant", "label": "Restaurant",   "icon": "ChefHat",         "to": "/restaurant",    "visible": True},
        {"id": "subscription","label": "Plans",       "icon": "Home",            "to": "/home",          "visible": True},
        {"id": "contact",    "label": "Contact",      "icon": "Phone",           "to": "/contact",       "visible": True},
        {"id": "login",      "label": "Login",        "icon": "LogIn",           "to": "__login__",      "visible": True},
    ],
    # iter-89 #1: franchise_owner default bottom nav — CMS-editable from
    # /admin/bottom-nav-editor by HQ admin.
    # iter-92 #1: "Home" now lands on `/` (Partner Portal — the franchise
    # owner's homepage), Control Tower is a dedicated tab, and the contact
    # slot is dropped to make room.
    "franchise": [
        {"id": "fr-home",      "label": "Home",      "icon": "Home",            "to": "/",                    "visible": True},
        {"id": "fr-dashboard", "label": "Dashboard", "icon": "LayoutDashboard", "to": "/admin",               "visible": True},
        {"id": "fr-control",   "label": "Control",   "icon": "Radio",           "to": "/admin/control-tower", "visible": True},
        {"id": "fr-account",   "label": "Account",   "icon": "User",            "to": "/profile",             "visible": True},
        {"id": "fr-logout",    "label": "Logout",    "icon": "LogOut",          "to": "__logout__",           "visible": True},
    ],
}


class NavItem(BaseModel):
    id: str
    label: str
    icon: str  # lucide-react icon name
    to: str
    visible: bool = True


class BottomNavPatch(BaseModel):
    subscriber: Optional[List[NavItem]] = None
    rider: Optional[List[NavItem]] = None
    guest: Optional[List[NavItem]] = None
    franchise: Optional[List[NavItem]] = None


@router.get("/bottom-nav")
async def get_bottom_nav():
    doc = await server.db.app_config.find_one({"_id": "bottom_nav"}, {"_id": 0}) or {}
    out = {}
    for role in ("subscriber", "rider", "guest", "franchise"):
        out[role] = doc.get(role) or DEFAULT_BOTTOM_NAV[role]
    return out


@router.put("/admin/bottom-nav")
async def put_bottom_nav(payload: BottomNavPatch, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    update = {}
    for role in ("subscriber", "rider", "guest", "franchise"):
        items = getattr(payload, role)
        if items is None:
            continue
        if len(items) < 1 or len(items) > 6:
            raise HTTPException(400, f"{role}: 1–6 items required")
        update[role] = [it.model_dump() for it in items]
    if update:
        update["updated_at"] = server.iso(server.now_utc())
        update["updated_by"] = user.user_id
        await server.db.app_config.update_one(
            {"_id": "bottom_nav"},
            {"$set": update, "$setOnInsert": {"_id": "bottom_nav"}},
            upsert=True,
        )
    return await get_bottom_nav()


@router.post("/admin/bottom-nav/reset")
async def reset_bottom_nav(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    await server.db.app_config.delete_one({"_id": "bottom_nav"})
    return DEFAULT_BOTTOM_NAV


# ---------------------------------------------------------------------------
# Notification sound (admin-uploaded base64 data URL or external URL)
# ---------------------------------------------------------------------------
class NotifySoundPatch(BaseModel):
    # Either a public https URL OR a data:audio/...;base64,... data URL.
    # Stored verbatim. Frontend will fetch and play via <audio>.
    sound_url: str = Field(..., min_length=4, max_length=2_000_000)


@router.get("/notify-sound")
async def get_notify_sound():
    doc = await server.db.app_config.find_one({"_id": "notify_sound"}, {"_id": 0}) or {}
    return {"sound_url": doc.get("sound_url") or ""}


@router.put("/admin/notify-sound")
async def put_notify_sound(payload: NotifySoundPatch, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    url = payload.sound_url.strip()
    if not (url.startswith("https://") or url.startswith("data:audio/")):
        raise HTTPException(400, "Sound must be an https URL or a data:audio/...;base64,... data URL")
    await server.db.app_config.update_one(
        {"_id": "notify_sound"},
        {"$set": {"sound_url": url, "updated_at": server.iso(server.now_utc()), "updated_by": user.user_id},
         "$setOnInsert": {"_id": "notify_sound"}},
        upsert=True,
    )
    return {"sound_url": url}


@router.delete("/admin/notify-sound")
async def reset_notify_sound(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    await server.db.app_config.delete_one({"_id": "notify_sound"})
    return {"sound_url": ""}


# ---------------------------------------------------------------------------
# Persistent guest cart — synced server-side so a cart built on mobile
# appears on desktop after login. Keyed by a UUID guest_cart_token that the
# frontend stores in localStorage and sends on every cart change.
# ---------------------------------------------------------------------------
class GuestCartPatch(BaseModel):
    token: str = Field(..., min_length=8, max_length=64)
    cart: dict  # { item_id: { id, qty } }


@router.put("/guest-cart")
async def upsert_guest_cart(payload: GuestCartPatch):
    """Anyone with a valid token can read/write. Auto-expires after 14 days."""
    await server.db.guest_carts.update_one(
        {"token": payload.token},
        {"$set": {
            "token": payload.token,
            "cart": payload.cart or {},
            "updated_at": server.iso(server.now_utc()),
        }, "$setOnInsert": {"created_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return {"ok": True, "token": payload.token, "count": sum(int(line.get("qty") or 0) for line in (payload.cart or {}).values())}


@router.get("/guest-cart/{token}")
async def get_guest_cart(token: str):
    if not token or len(token) < 8:
        raise HTTPException(400, "Invalid token")
    doc = await server.db.guest_carts.find_one({"token": token}, {"_id": 0})
    if not doc:
        return {"cart": {}, "token": token}
    return {"cart": doc.get("cart") or {}, "token": token, "updated_at": doc.get("updated_at")}


# ---------------------------------------------------------------------------
# Take-away (returnable) tiffin pendency — restaurant orders that delivered with
# steel-tiffin items. Admin needs name + phone + address to call back later.
# ---------------------------------------------------------------------------
@router.get("/admin/restaurant/takeaway-pendency")
async def list_takeaway_pendency(user: server.User = Depends(server.get_current_user), collected: Optional[bool] = None, as_mess_id: Optional[str] = None):
    # iter-96 #2: branch-scope by user_id ∈ users-in-mess so franchise owners
    # only see their own branch's pendency. Admins can opt-in via ?as_mess_id.
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(403, "Admin or staff only")
    mid = await server.effective_mess_id(user, as_mess_id)
    user_ids = await server._users_in_mess(mid)
    q: dict = {} if user_ids is None else {"user_id": {"$in": user_ids}}
    if collected is not None:
        q["collected"] = collected
    rows = await server.db.restaurant_tiffin_pendency.find(q, {"_id": 0}).sort("delivered_at", -1).to_list(500)
    pending = sum(r.get("tiffin_count", 0) for r in rows if not r.get("collected"))
    return {"rows": rows, "pending_count": pending, "scope": "branch" if mid else "global", "mess_id": mid}


class CollectTakeaway(BaseModel):
    pendency_id: str
    notes: Optional[str] = None


@router.post("/admin/restaurant/takeaway-pendency/collect")
async def collect_takeaway(payload: CollectTakeaway, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(403, "Admin or staff only")
    rec = await server.db.restaurant_tiffin_pendency.find_one({"pendency_id": payload.pendency_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Pendency not found")
    # iter-96 #2: franchise can only mark THEIR branch's pendency.
    if user.role == "franchise_owner":
        m = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(403, "No mess assigned")
        u = await server.db.users.find_one({"user_id": rec.get("user_id")}, {"_id": 0, "mess_id": 1})
        if (u or {}).get("mess_id") != m["mess_id"]:
            raise HTTPException(403, "Pendency not in your branch")
    if rec.get("collected"):
        raise HTTPException(400, "Already collected")
    n = int(rec.get("tiffin_count") or 0)
    await server.db.restaurant_tiffin_pendency.update_one(
        {"pendency_id": payload.pendency_id},
        {"$set": {"collected": True, "collected_at": server.iso(server.now_utc()),
                  "collected_by": user.user_id, "collection_notes": (payload.notes or "")[:240]}},
    )
    # Decrement user.tiffin_balance — but not below 0
    if rec.get("user_id") and n > 0:
        await server.db.users.update_one(
            {"user_id": rec["user_id"], "tiffin_balance": {"$gte": n}},
            {"$inc": {"tiffin_balance": -n}},
        )
    return {"ok": True}


class ManualTakeaway(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    phone: str = Field(..., min_length=4, max_length=20)
    address: Optional[str] = Field("", max_length=400)
    tiffin_count: int = Field(..., ge=1, le=20)
    notes: Optional[str] = Field("", max_length=240)


# ---------------------------------------------------------------------------
# Hamburger header menu — admin-editable list of links shown in the drawer.
# Stored at db.app_config{_id:'header_menu'} alongside bottom_nav.
# ---------------------------------------------------------------------------
DEFAULT_HEADER_MENU: list[dict] = [
    {"id": "contact",     "label": "Contact",                "to": "/contact",                  "visible": True},
    {"id": "franchise",   "label": "Contact for Franchisee", "to": "/contact?subject=franchise", "visible": True},
    {"id": "privacy",     "label": "Privacy Policy",         "to": "/privacy",                  "visible": True},
    {"id": "refund",      "label": "Refund Policy",          "to": "/refund",                   "visible": True},
]


class HeaderMenuItem(BaseModel):
    id: str
    label: str
    to: str
    visible: bool = True


class HeaderMenuPatch(BaseModel):
    items: List[HeaderMenuItem]


@router.get("/header-menu")
async def get_header_menu():
    doc = await server.db.app_config.find_one({"_id": "header_menu"}, {"_id": 0}) or {}
    return {"items": doc.get("items") or DEFAULT_HEADER_MENU}


@router.put("/admin/header-menu")
async def put_header_menu(payload: HeaderMenuPatch, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    if len(payload.items) < 1 or len(payload.items) > 12:
        raise HTTPException(400, "1–12 items required")
    items = [it.model_dump() for it in payload.items]
    await server.db.app_config.update_one(
        {"_id": "header_menu"},
        {"$set": {"items": items, "updated_at": server.iso(server.now_utc()), "updated_by": user.user_id},
         "$setOnInsert": {"_id": "header_menu"}},
        upsert=True,
    )
    return {"items": items}


@router.post("/admin/header-menu/reset")
async def reset_header_menu(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    await server.db.app_config.delete_one({"_id": "header_menu"})
    return {"items": DEFAULT_HEADER_MENU}


# ---------------------------------------------------------------------------
# Profit & Loss tracker — daily P&L computed from revenues - expenses.
# Stored expenses at db.expenses{kind, amount, monthly}, revenues from
# subscriptions + restaurant orders.
# ---------------------------------------------------------------------------
class ExpenseConfig(BaseModel):
    salary: float = Field(0, ge=0)
    rent: float = Field(0, ge=0)
    electricity: float = Field(0, ge=0)
    loan_emi: float = Field(0, ge=0)
    other: float = Field(0, ge=0)


@router.get("/admin/pnl/expenses")
async def get_expenses(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(403, "Admin or staff only")
    doc = await server.db.app_config.find_one({"_id": "monthly_expenses"}, {"_id": 0}) or {}
    return {
        "salary": doc.get("salary", 0),
        "rent": doc.get("rent", 0),
        "electricity": doc.get("electricity", 0),
        "loan_emi": doc.get("loan_emi", 0),
        "other": doc.get("other", 0),
    }


@router.put("/admin/pnl/expenses")
async def put_expenses(payload: ExpenseConfig, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    await server.db.app_config.update_one(
        {"_id": "monthly_expenses"},
        {"$set": {**payload.model_dump(), "updated_at": server.iso(server.now_utc()), "updated_by": user.user_id},
         "$setOnInsert": {"_id": "monthly_expenses"}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/admin/pnl/daily")
async def get_pnl_daily(
    days: int = 30,
    cycle: Optional[str] = None,
    user: server.User = Depends(server.get_current_user),
):
    """Per-day P&L for the last N days OR for a billing cycle (6th→5th).

    iter-65 #8: when `cycle=YYYY-MM` is passed, window = 6 <YYYY-MM> → 5 of
    next month, matching the revenue reset cadence. Without `cycle`, falls
    back to the last `days` rows for backwards-compat.
    """
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(403, "Admin or staff only")

    from datetime import datetime, timedelta, timezone
    today = server.now_utc().date()

    if cycle:
        try:
            cy, cm = (int(x) for x in cycle.split("-"))
        except Exception:  # noqa: BLE001
            raise HTTPException(400, "cycle must be YYYY-MM")
        start = datetime(cy, cm, 6).date()
        ny = cy + (1 if cm == 12 else 0)
        nm = 1 if cm == 12 else cm + 1
        end = datetime(ny, nm, 6).date()
        days_span = (end - start).days  # 28..31
        days_used = days_span
    else:
        days_used = max(1, min(int(days), 90))
        start = today - timedelta(days=days_used - 1)
        end = today + timedelta(days=1)  # half-open
        days_span = days_used

    # Monthly fixed expenses → daily fixed cost (÷ 30)
    exp = await server.db.app_config.find_one({"_id": "monthly_expenses"}, {"_id": 0}) or {}
    monthly_fixed = float(exp.get("salary", 0)) + float(exp.get("rent", 0)) + float(exp.get("electricity", 0)) + float(exp.get("loan_emi", 0)) + float(exp.get("other", 0))
    daily_fixed = round(monthly_fixed / 30.0, 2)

    # Daily raw material cost — read from current persons & raw_materials
    try:
        rm = await server.get_raw_materials(user)  # type: ignore
        daily_raw = float(rm.get("totals", {}).get("day_cost", 0))
    except Exception:
        daily_raw = 0.0

    # Subscription revenue: sum payments {paid_at} in window
    sub_rev_pipe = [
        {"$match": {"paid_at": {"$ne": None}, "status": {"$in": ["paid", "completed"]}}},
        {"$project": {"day": {"$substr": ["$paid_at", 0, 10]}, "amount": "$amount"}},
        {"$match": {"day": {"$gte": start.isoformat(), "$lt": end.isoformat()}}},
        {"$group": {"_id": "$day", "total": {"$sum": "$amount"}}},
    ]
    sub_rows = {r["_id"]: float(r.get("total") or 0) async for r in server.db.payments.aggregate(sub_rev_pipe)}

    # Restaurant order revenue: sum of total when paid
    rest_rev_pipe = [
        {"$match": {"paid_at": {"$ne": None}, "status": {"$nin": ["cancelled", "rejected"]}}},
        {"$project": {"day": {"$substr": ["$paid_at", 0, 10]}, "total": "$total"}},
        {"$match": {"day": {"$gte": start.isoformat(), "$lt": end.isoformat()}}},
        {"$group": {"_id": "$day", "total": {"$sum": "$total"}}},
    ]
    rest_rows = {r["_id"]: float(r.get("total") or 0) async for r in server.db.restaurant_orders.aggregate(rest_rev_pipe)}

    rows = []
    cum_net = 0.0
    for i in range(days_span):
        d = (start + timedelta(days=i)).isoformat()
        sub = sub_rows.get(d, 0.0)
        rest = rest_rows.get(d, 0.0)
        rev = sub + rest
        exp_total = daily_raw + daily_fixed
        net = rev - exp_total
        cum_net += net
        rows.append({
            "date": d,
            "sub_revenue": round(sub, 2),
            "rest_revenue": round(rest, 2),
            "total_revenue": round(rev, 2),
            "raw_material_cost": round(daily_raw, 2),
            "fixed_cost": daily_fixed,
            "total_expense": round(exp_total, 2),
            "net": round(net, 2),
        })

    return {
        "rows": rows,
        "summary": {
            "days": days_used,
            "total_revenue": round(sum(r["total_revenue"] for r in rows), 2),
            "total_expense": round(sum(r["total_expense"] for r in rows), 2),
            "net": round(cum_net, 2),
            "is_profit": cum_net >= 0,
        },
        "cycle": {
            "active": bool(cycle),
            "start": start.isoformat(),
            "end": (end - timedelta(days=1)).isoformat() if cycle else today.isoformat(),
            "label": cycle if cycle else None,
        },
        "config": {
            "monthly_fixed": monthly_fixed,
            "daily_fixed": daily_fixed,
            "daily_raw_material": round(daily_raw, 2),
        },
        "expenses": exp,
        "computed_at": server.iso(server.now_utc()),
    }


@router.post("/admin/restaurant/takeaway-pendency/manual")
async def add_manual_takeaway(payload: ManualTakeaway, user: server.User = Depends(server.get_current_user)):
    """Walk-in / unknown user took a steel tiffin (no order in our system).
    Admin captures their details so we can call them back."""
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(403, "Admin or staff only")
    import uuid
    pid = f"rtp_manual_{uuid.uuid4().hex[:10]}"
    doc = {
        "pendency_id": pid,
        "order_id": None,
        "user_id": None,
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "address": (payload.address or "").strip(),
        "tiffin_count": payload.tiffin_count,
        "delivered_at": server.iso(server.now_utc()),
        "collected": False,
        "kind": "manual",
        "manual_notes": payload.notes or "",
        "added_by": user.user_id,
    }
    await server.db.restaurant_tiffin_pendency.insert_one(doc)
    return {"ok": True, "pendency_id": pid}
