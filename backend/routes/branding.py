"""Admin-editable brand logo & header logo (independent slots).

Lets an admin swap the app-wide "brand logo" AND the top-navigation "header
logo" independently, without a redeploy. Each uploaded image is optimised
to WebP and persisted as a base64 data URL in Mongo so it survives
deployments and is instantly available on all replicas.

Endpoints:
    GET  /api/branding                       (public — returns both URLs)
    GET  /api/admin/branding                 (admin — raw settings)
    POST /api/admin/branding/logo?slot=…     (admin, multipart)
    POST /api/admin/branding/reset?slot=…    (admin — revert one slot)

`slot` accepts:
    · `brand`  → the app icon used on Footer / HeroPanel / Kiosk / …
    · `header` → the top-navigation logo (Header.jsx)
Slot defaults to `brand` for backward compatibility with earlier clients.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from shared import server  # late-binding via shared shim

router = APIRouter()

SETTINGS_KEY = "branding_settings_v1"
MAX_UPLOAD_BYTES = 2 * 1024 * 1024   # 2 MB — logos should be small
DEFAULT_BRAND_URL = "/brand-logo.jpg"    # bundled fallback for the app-wide brand mark
DEFAULT_HEADER_URL = "/brand-logo.jpg"   # bundled fallback for the header icon
DEFAULT_SPLASH_URL = "/brand-logo.jpg"   # bundled fallback for the splash screen icon

VALID_SLOTS = ("brand", "header", "splash")

_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg":  ".jpg",
    "image/png":  ".png",
    "image/webp": ".webp",
}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _load() -> dict:
    doc = await server.db.app_settings.find_one({"_id": SETTINGS_KEY}, {"_id": 0}) or {}
    return {
        "brand_logo_url":  doc.get("brand_logo_url", "") or "",
        "header_logo_url": doc.get("header_logo_url", "") or "",
        "splash_logo_url": doc.get("splash_logo_url", "") or "",
        "brand_updated_at":  doc.get("brand_updated_at"),
        "header_updated_at": doc.get("header_updated_at"),
        "splash_updated_at": doc.get("splash_updated_at"),
        "updated_at": doc.get("updated_at"),
    }


async def _save_patch(patch: dict) -> dict:
    patch["updated_at"] = _iso_now()
    await server.db.app_settings.update_one(
        {"_id": SETTINGS_KEY}, {"$set": patch}, upsert=True,
    )
    return await _load()


def _admin(user: server.User) -> None:
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")


def _validate_slot(slot: Optional[str]) -> str:
    s = (slot or "brand").lower()
    if s not in VALID_SLOTS:
        raise HTTPException(status_code=400, detail=f"slot must be one of {VALID_SLOTS}")
    return s


@router.get("/branding")
async def public_branding():
    """Public — returns current URLs for both logo slots (with fallbacks)."""
    cur = await _load()
    return {
        # Legacy field, kept for older clients: mirrors `brand_logo_url`.
        "brand_logo_url":  cur["brand_logo_url"] or DEFAULT_BRAND_URL,
        "header_logo_url": cur["header_logo_url"] or DEFAULT_HEADER_URL,
        "splash_logo_url": cur["splash_logo_url"] or DEFAULT_SPLASH_URL,
        "is_custom":        bool(cur["brand_logo_url"]),
        "is_header_custom": bool(cur["header_logo_url"]),
        "is_splash_custom": bool(cur["splash_logo_url"]),
        "brand_updated_at":  cur["brand_updated_at"],
        "header_updated_at": cur["header_updated_at"],
        "splash_updated_at": cur["splash_updated_at"],
        "updated_at": cur["updated_at"],
    }


@router.get("/admin/branding")
async def admin_branding(user: server.User = Depends(server.get_current_user)):
    _admin(user)
    return await _load()


@router.post("/admin/branding/logo")
async def admin_upload_logo(
    file: UploadFile = File(...),
    slot: Optional[str] = Query(default="brand"),
    user: server.User = Depends(server.get_current_user),
):
    _admin(user)
    s = _validate_slot(slot)
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
    field    = {"brand": "brand_logo_url", "header": "header_logo_url", "splash": "splash_logo_url"}[s]
    ts_field = {"brand": "brand_updated_at", "header": "header_updated_at", "splash": "splash_updated_at"}[s]
    saved = await _save_patch({field: data_url, ts_field: _iso_now()})
    return {
        "slot": s,
        field: saved[field],
        "bytes": len(payload),
        "updated_at": saved.get(ts_field),
    }


@router.post("/admin/branding/reset")
async def admin_reset(
    slot: Optional[str] = Query(default="brand"),
    user: server.User = Depends(server.get_current_user),
):
    _admin(user)
    s = _validate_slot(slot)
    field    = {"brand": "brand_logo_url", "header": "header_logo_url", "splash": "splash_logo_url"}[s]
    ts_field = {"brand": "brand_updated_at", "header": "header_updated_at", "splash": "splash_updated_at"}[s]
    default  = {"brand": DEFAULT_BRAND_URL, "header": DEFAULT_HEADER_URL, "splash": DEFAULT_SPLASH_URL}[s]
    saved = await _save_patch({field: "", ts_field: _iso_now()})
    return {
        "slot": s,
        field: default,
        "is_custom": False,
        "updated_at": saved.get(ts_field),
    }
