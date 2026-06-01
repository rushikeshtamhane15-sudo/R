"""Admin CMS — tiffin food preferences catalog.

Lets admin (1) edit text/icon/image for the 4 built-in items (rice, dal,
chapati, sabji), (2) add CUSTOM items (e.g. "Extra salad", "Sweet/Mithai")
that appear on the subscriber dashboard, (3) toggle each item active.

The catalog is a single doc at `tiffin_pref_catalog/_id=active` so the
frontend can pull it with one round-trip.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from shared import server

router = APIRouter()


# === Schema ==================================================================
class PrefItem(BaseModel):
    key: str           # stable id used by subscribers' preferences blob
    label: str
    emoji: Optional[str] = None
    image_url: Optional[str] = None
    description: Optional[str] = None
    active: bool = True
    order: int = 0


class PrefCatalog(BaseModel):
    items: List[PrefItem]


DEFAULTS: List[dict] = [
    {"key": "rice",    "label": "Rice",    "emoji": "🍚", "image_url": None, "active": True, "order": 0},
    {"key": "dal",     "label": "Dal",     "emoji": "🍲", "image_url": None, "active": True, "order": 1},
    {"key": "chapati", "label": "Chapati", "emoji": "🫓", "image_url": None, "active": True, "order": 2},
    {"key": "sabji",   "label": "Sabji",   "emoji": "🥬", "image_url": None, "active": True, "order": 3},
]


async def _load_catalog() -> List[dict]:
    doc = await server.db.tiffin_pref_catalog.find_one({"_id": "active"}, {"_id": 0})
    items = (doc or {}).get("items") or DEFAULTS
    return sorted(items, key=lambda x: int(x.get("order") or 0))


# === Public — subscriber dashboard reads this =================================
@router.get("/tiffin-preferences/catalog")
async def get_catalog():
    items = await _load_catalog()
    return {"items": [i for i in items if i.get("active") is not False]}


# === Admin CRUD ===============================================================
@router.get("/admin/tiffin-preferences/catalog")
async def admin_get_catalog(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return {"items": await _load_catalog()}


@router.put("/admin/tiffin-preferences/catalog")
async def admin_set_catalog(payload: PrefCatalog, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    # Validate keys are unique + non-empty
    seen = set()
    cleaned = []
    for i, it in enumerate(payload.items):
        k = (it.key or "").strip().lower().replace(" ", "_")
        if not k:
            raise HTTPException(status_code=400, detail=f"Item #{i + 1} missing key")
        if k in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate key: {k}")
        seen.add(k)
        cleaned.append({
            "key": k,
            "label": (it.label or k.title()).strip()[:60],
            "emoji": (it.emoji or "").strip()[:8] or None,
            "image_url": (it.image_url or "").strip() or None,
            "description": (it.description or "").strip()[:240] or None,
            "active": bool(it.active),
            "order": int(it.order or i),
        })
    await server.db.tiffin_pref_catalog.update_one(
        {"_id": "active"},
        {"$set": {"items": cleaned, "updated_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return {"items": cleaned}


@router.post("/admin/tiffin-preferences/reset")
async def admin_reset_catalog(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.tiffin_pref_catalog.update_one(
        {"_id": "active"},
        {"$set": {"items": DEFAULTS, "updated_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return {"items": DEFAULTS}


_PREF_EXT_BY_MIME = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
}


@router.post("/admin/tiffin-preferences/upload-image")
async def admin_pref_upload_image(
    file: UploadFile = File(...),
    user: server.User = Depends(server.get_current_user),
):
    """Upload an image for a preference item. Returns the public URL."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    ext = _PREF_EXT_BY_MIME.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(status_code=400, detail="Only PNG/JPG/WEBP")
    data = await file.read()
    if len(data) > 4 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Max 4 MB")
    from pathlib import Path
    import uuid
    from image_optim import optimize_to_webp

    folder = Path(__file__).resolve().parent.parent / "uploads" / "tiffin_pref_images"
    folder.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    written = optimize_to_webp(data, folder / fname)
    final = (folder / fname.replace(ext, ".webp"))
    final_name = final.name if final.exists() else fname
    return {"url": f"/api/uploads/tiffin_pref_images/{final_name}", "bytes": written}
