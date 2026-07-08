"""Admin-editable brand logo (app icon).

Lets an admin swap the "brand logo" (used everywhere except the site header
and the pure-veg FSSAI badge) without a redeploy. The uploaded image is
optimised to WebP and persisted as a base64 data URL in Mongo so it survives
deployments and is instantly available on all replicas.

Endpoints:
    GET  /api/branding                    (public — returns metadata)
    GET  /api/admin/branding              (admin)
    POST /api/admin/branding/logo         (admin, multipart)
    POST /api/admin/branding/reset        (admin — revert to bundled default)
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from shared import server  # late-binding via shared shim

router = APIRouter()

SETTINGS_KEY = "branding_settings_v1"
MAX_UPLOAD_BYTES = 2 * 1024 * 1024   # 2 MB — logos should be small
DEFAULT_LOGO_URL = "/brand-logo.jpg"  # bundled fallback served from /public

_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg":  ".jpg",
    "image/png":  ".png",
    "image/webp": ".webp",
}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _load() -> dict:
    doc = await server.db.app_settings.find_one({"_id": SETTINGS_KEY}, {"_id": 0})
    return doc or {"brand_logo_url": "", "updated_at": None}


async def _save(data: dict) -> dict:
    data["updated_at"] = _iso_now()
    await server.db.app_settings.update_one(
        {"_id": SETTINGS_KEY}, {"$set": data}, upsert=True,
    )
    return data


def _admin(user: server.User) -> None:
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")


@router.get("/branding")
async def public_branding():
    """Public — returns the current brand logo URL (or the bundled fallback)."""
    cur = await _load()
    url = cur.get("brand_logo_url") or DEFAULT_LOGO_URL
    return {
        "brand_logo_url": url,
        "is_custom": bool(cur.get("brand_logo_url")),
        "updated_at": cur.get("updated_at"),
    }


@router.get("/admin/branding")
async def admin_branding(user: server.User = Depends(server.get_current_user)):
    _admin(user)
    return await _load()


@router.post("/admin/branding/logo")
async def admin_upload_logo(
    file: UploadFile = File(...),
    user: server.User = Depends(server.get_current_user),
):
    _admin(user)
    ext = _EXT_BY_MIME.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPG / PNG / WEBP allowed")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB)",
        )
    # Optimise to WebP for compact durable storage. Falls back to raw bytes if
    # the optimiser can't be imported for any reason.
    try:
        from image_optim import optimize_to_webp_bytes
        payload = optimize_to_webp_bytes(data)
        mime = "image/webp"
    except Exception:  # noqa: BLE001
        payload = data
        mime = (file.content_type or "image/jpeg").lower()
    data_url = f"data:{mime};base64," + base64.b64encode(payload).decode("ascii")
    saved = await _save({"brand_logo_url": data_url})
    return {"brand_logo_url": saved["brand_logo_url"], "bytes": len(payload), "updated_at": saved["updated_at"]}


@router.post("/admin/branding/reset")
async def admin_reset(user: server.User = Depends(server.get_current_user)):
    _admin(user)
    saved = await _save({"brand_logo_url": ""})
    return {"brand_logo_url": DEFAULT_LOGO_URL, "is_custom": False, "updated_at": saved["updated_at"]}
