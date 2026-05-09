"""App CMS — admin-editable global settings.

Currently:
    * Bottom navigation config (per role) — db.app_config{_id:'bottom_nav'}
    * Notification sound URL/data — db.app_config{_id:'notify_sound'}
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import server  # late-binding access to db / helpers / get_current_user / iso

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


@router.get("/bottom-nav")
async def get_bottom_nav():
    doc = await server.db.app_config.find_one({"_id": "bottom_nav"}, {"_id": 0}) or {}
    out = {}
    for role in ("subscriber", "rider", "guest"):
        out[role] = doc.get(role) or DEFAULT_BOTTOM_NAV[role]
    return out


@router.put("/admin/bottom-nav")
async def put_bottom_nav(payload: BottomNavPatch, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    update = {}
    for role in ("subscriber", "rider", "guest"):
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
# Take-away (returnable) tiffin pendency — restaurant orders that delivered with
# steel-tiffin items. Admin needs name + phone + address to call back later.
# ---------------------------------------------------------------------------
@router.get("/admin/restaurant/takeaway-pendency")
async def list_takeaway_pendency(user: server.User = Depends(server.get_current_user), collected: Optional[bool] = None):
    if user.role not in ("admin", "staff"):
        raise HTTPException(403, "Admin or staff only")
    q = {}
    if collected is not None:
        q["collected"] = collected
    rows = await server.db.restaurant_tiffin_pendency.find(q, {"_id": 0}).sort("delivered_at", -1).to_list(500)
    pending = sum(r.get("tiffin_count", 0) for r in rows if not r.get("collected"))
    return {"rows": rows, "pending_count": pending}


class CollectTakeaway(BaseModel):
    pendency_id: str
    notes: Optional[str] = None


@router.post("/admin/restaurant/takeaway-pendency/collect")
async def collect_takeaway(payload: CollectTakeaway, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff"):
        raise HTTPException(403, "Admin or staff only")
    rec = await server.db.restaurant_tiffin_pendency.find_one({"pendency_id": payload.pendency_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Pendency not found")
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
