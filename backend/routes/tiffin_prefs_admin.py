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
    page_title: Optional[str] = None
    page_subtitle: Optional[str] = None


DEFAULTS: List[dict] = [
    {"key": "rice",    "label": "Rice",    "emoji": "🍚", "image_url": None, "active": True, "order": 0},
    {"key": "dal",     "label": "Dal",     "emoji": "🍲", "image_url": None, "active": True, "order": 1},
    {"key": "chapati", "label": "Chapati", "emoji": "🫓", "image_url": None, "active": True, "order": 2},
    {"key": "sabji",   "label": "Sabji",   "emoji": "🥬", "image_url": None, "active": True, "order": 3},
]

DEFAULT_TITLE = "Today's tiffin preferences"
DEFAULT_SUBTITLE = "Tell us what you'd love on the plate today."


async def _load_catalog() -> dict:
    doc = await server.db.tiffin_pref_catalog.find_one({"_id": "active"}, {"_id": 0}) or {}
    items = doc.get("items") or DEFAULTS
    return {
        "items": sorted(items, key=lambda x: int(x.get("order") or 0)),
        "page_title": doc.get("page_title") or DEFAULT_TITLE,
        "page_subtitle": doc.get("page_subtitle") or DEFAULT_SUBTITLE,
    }


# === Public — subscriber dashboard reads this =================================
@router.get("/tiffin-preferences/catalog")
async def get_catalog():
    data = await _load_catalog()
    data["items"] = [i for i in data["items"] if i.get("active") is not False]
    return data


# === Admin CRUD ===============================================================
@router.get("/admin/tiffin-preferences/catalog")
async def admin_get_catalog(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return await _load_catalog()


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
    update_doc = {
        "items": cleaned,
        "page_title": (payload.page_title or DEFAULT_TITLE).strip()[:120],
        "page_subtitle": (payload.page_subtitle or DEFAULT_SUBTITLE).strip()[:300],
        "updated_at": server.iso(server.now_utc()),
    }
    await server.db.tiffin_pref_catalog.update_one(
        {"_id": "active"}, {"$set": update_doc}, upsert=True,
    )
    return {"items": cleaned, "page_title": update_doc["page_title"], "page_subtitle": update_doc["page_subtitle"]}


@router.post("/admin/tiffin-preferences/reset")
async def admin_reset_catalog(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.tiffin_pref_catalog.update_one(
        {"_id": "active"},
        {"$set": {
            "items": DEFAULTS,
            "page_title": DEFAULT_TITLE,
            "page_subtitle": DEFAULT_SUBTITLE,
            "updated_at": server.iso(server.now_utc()),
        }},
        upsert=True,
    )
    return {"items": DEFAULTS, "page_title": DEFAULT_TITLE, "page_subtitle": DEFAULT_SUBTITLE}


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
