"""Admin-editable landing-page promotional popup.

A single active promotion is shown via a dismissible 3D modal on the landing
page. Admin can: edit title/body/CTA, upload an image, or generate a 3D
image via Gemini Nano Banana, and start/stop the popup.

Endpoints:
    GET  /api/content/landing-promotion          (public — returns null if inactive)
    GET  /api/admin/content/landing-promotion    (admin)
    PUT  /api/admin/content/landing-promotion    (admin)
    POST /api/admin/content/landing-promotion/upload-image  (admin, multipart)
    POST /api/admin/content/landing-promotion/generate-image (admin)
    POST /api/admin/content/landing-promotion/start          (admin)
    POST /api/admin/content/landing-promotion/stop           (admin)
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from shared import server  # late-binding via shared shim

router = APIRouter()

UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads" / "promotions"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

DEFAULT_PROMO = {
    "active": False,
    "title": "🎉 Welcome offer",
    "body": "Use code FRESH10 for 10% off your first restaurant order.",
    "image_url": "",
    "cta_label": "Order now",
    "cta_link": "/restaurant",
    "accent_color": "#b91c1c",
    "image_prompt": "",
}


class Promotion(BaseModel):
    active: bool = False
    title: str = Field(default="", max_length=120)
    body: str = Field(default="", max_length=400)
    image_url: str = ""
    cta_label: str = Field(default="Order now", max_length=40)
    cta_link: str = Field(default="/restaurant", max_length=400)
    accent_color: str = Field(default="#b91c1c", max_length=12)
    image_prompt: str = ""


async def _load() -> dict:
    doc = await server.db.landing_promotion.find_one({"_id": "active"}, {"_id": 0})
    return doc or DEFAULT_PROMO.copy()


async def _save(doc: dict) -> dict:
    doc["updated_at"] = server.iso(server.now_utc())
    await server.db.landing_promotion.update_one(
        {"_id": "active"}, {"$set": doc}, upsert=True,
    )
    return doc


@router.get("/landing-promotion")
async def public_promotion():
    """Public — returns the promotion ONLY when active. Returns `null` shape
    (`{promotion: null}`) when inactive so the frontend can skip rendering."""
    doc = await _load()
    if not doc.get("active"):
        return {"promotion": None}
    # Only ship fields the popup actually needs.
    safe = {k: doc.get(k) for k in (
        "title", "body", "image_url", "cta_label", "cta_link", "accent_color",
    )}
    return {"promotion": safe}


@router.get("/admin/landing-promotion")
async def admin_get(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return {"promotion": await _load()}


@router.put("/admin/landing-promotion")
async def admin_save(payload: Promotion, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    saved = await _save(payload.model_dump())
    return {"promotion": saved}


@router.post("/admin/landing-promotion/start")
async def admin_start(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cur = await _load()
    cur["active"] = True
    await _save(cur)
    return {"active": True}


@router.post("/admin/landing-promotion/stop")
async def admin_stop(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cur = await _load()
    cur["active"] = False
    await _save(cur)
    return {"active": False}


@router.post("/admin/landing-promotion/upload-image")
async def admin_upload(file: UploadFile = File(...), user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    ext = _EXT_BY_MIME.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPG / PNG / WEBP")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB)")
    # Iter-55: persist as data-URL in Mongo for cross-deployment durability.
    import base64 as _b64
    from image_optim import optimize_to_webp_bytes
    webp = optimize_to_webp_bytes(data)
    data_url = "data:image/webp;base64," + _b64.b64encode(webp).decode("ascii")
    cur = await _load()
    cur["image_url"] = data_url
    await _save(cur)
    return {"url": data_url, "bytes": len(webp)}


class PromoImagePromptIn(BaseModel):
    prompt: Optional[str] = None


@router.post("/admin/landing-promotion/generate-image")
async def admin_generate(
    payload: PromoImagePromptIn,
    user: server.User = Depends(server.get_current_user),
):
    """Generate a 3D promotional banner via Gemini Nano Banana, using the
    admin-supplied prompt (or falling back to the current title + body)."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cur = await _load()
    prompt = (payload.prompt or "").strip() or cur.get("image_prompt") or " · ".join(
        filter(None, [cur.get("title"), cur.get("body")])
    )
    if not prompt:
        raise HTTPException(status_code=400, detail="No prompt provided")
    from image_gen import generate_3d_image
    try:
        url, _ = await generate_3d_image(
            prompt=f"Vegetarian restaurant promotional banner: {prompt}. Bright, playful, festive, premium 3D render.",
            subdir="promotions",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Image generation failed: {e}") from e
    cur["image_url"] = url
    cur["image_prompt"] = prompt
    await _save(cur)
    return {"url": url, "promotion": cur}
