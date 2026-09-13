"""Wall-Kiosk CMS · iter-166

Per-mess overrides for the wall-kiosk header (brand name, tagline, pure-veg
label) and the voice announcer templates (Hindi + English success lines).
Follows the same read-fallback-write-scoped pattern as iter-165 restaurant
scoping so a mess owner NEVER mutates the platform default seen by anonymous
traffic or by other tenants.

Endpoints:
    GET  /api/kiosk/cms?mess_id=<X>                 public — kiosk read
    GET  /api/admin/kiosk/cms                         scoped read for editor
    PUT  /api/admin/kiosk/cms                         mess-owner or super-admin write
    POST /api/admin/kiosk/cms/reset                   restore defaults for the caller's scope

Storage:
    Collection `kiosk_cms`
      global  → {_id: "active"}
      per-mess → {_id: f"active:{mess_id}"}

Payload fields (all optional; blank falls back to platform default):
    brand_name             (e.g. "eFoodCare · Amravati branch")
    brand_tagline          (e.g. "ghar se accha khana")
    pure_veg_label         (e.g. "100% Pure Veg · FSSAI")
    greeting_lunch_hi      (Hindi template, {name} placeholder)
    greeting_lunch_en      (English template)
    greeting_dinner_hi
    greeting_dinner_en
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from shared import server

router = APIRouter()


DEFAULTS: dict = {
    "brand_name":        "efoodcare",
    "brand_tagline":     "ghar se accha khana",
    "pure_veg_label":    "100% Pure Veg · FSSAI",
    # {name} is substituted client-side. Kept short — the wall kiosk speaks
    # this within ~2s after each successful scan.
    "greeting_lunch_hi":  "{name}, आपका लंच चेक-इन सफल हुआ। धन्यवाद।",
    "greeting_lunch_en":  "{name}, lunch check-in successful. Thank you.",
    "greeting_dinner_hi": "{name}, आपका डिनर चेक-इन सफल हुआ। धन्यवाद।",
    "greeting_dinner_en": "{name}, dinner check-in successful. Thank you.",
}

CMS_KEYS = tuple(DEFAULTS.keys())


def _doc_id(mess_id: Optional[str]) -> str:
    return f"active:{mess_id}" if mess_id else "active"


async def _load(mess_id: Optional[str]) -> dict:
    """Return the kiosk CMS for a scope with STRICT tenant isolation.
    iter-170: mess owners no longer inherit the super-admin's global edits.
    If no per-mess override exists, the mess sees the pristine DEFAULTS —
    the platform live copy is reserved for anonymous / super-admin surface.
    """
    if mess_id:
        mess_doc = await server.db.kiosk_cms.find_one({"_id": _doc_id(mess_id)}, {"_id": 0}) or {}
        return {k: (mess_doc.get(k) or DEFAULTS[k]) for k in CMS_KEYS}

    # Anonymous / super-admin surface uses the global doc layered over DEFAULTS.
    global_doc = await server.db.kiosk_cms.find_one({"_id": "active"}, {"_id": 0}) or {}
    return {k: (global_doc.get(k) or DEFAULTS[k]) for k in CMS_KEYS}


async def _save(mess_id: Optional[str], patch: dict) -> dict:
    patch["updated_at"] = server.iso(server.now_utc())
    if mess_id:
        patch["mess_id"] = mess_id
    await server.db.kiosk_cms.update_one(
        {"_id": _doc_id(mess_id)},
        {"$set": patch},
        upsert=True,
    )
    return await _load(mess_id)


class KioskCmsIn(BaseModel):
    brand_name: Optional[str] = None
    brand_tagline: Optional[str] = None
    pure_veg_label: Optional[str] = None
    greeting_lunch_hi: Optional[str] = None
    greeting_lunch_en: Optional[str] = None
    greeting_dinner_hi: Optional[str] = None
    greeting_dinner_en: Optional[str] = None


@router.get("/kiosk/cms")
async def public_kiosk_cms(mess_id: Optional[str] = Query(default=None)):
    """Anonymous / wall-kiosk read. Pass ?mess_id=<X> when the kiosk belongs
    to a tenant so it renders that mess's headline + voice templates."""
    return await _load(mess_id)


@router.get("/admin/kiosk/cms")
async def admin_get_kiosk_cms(
    as_mess_id: Optional[str] = Query(default=None),
    user: server.User = Depends(server.get_current_user),
):
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)
    d = await _load(mid)
    d["mess_id"] = mid
    return d


@router.put("/admin/kiosk/cms")
async def admin_put_kiosk_cms(
    payload: KioskCmsIn,
    as_mess_id: Optional[str] = Query(default=None),
    user: server.User = Depends(server.get_current_user),
):
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)
    # Only persist non-None fields — leave the rest blank so they inherit
    # cleanly. Trimming empty strings so a user "clearing" a field falls
    # back to the platform default instead of storing an empty override.
    patch = {}
    for k, v in payload.model_dump(exclude_none=True).items():
        s = (v or "").strip()
        patch[k] = s  # empty string = "revert to default"
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to save")
    fresh = await _save(mid, patch)
    fresh["mess_id"] = mid
    return fresh


@router.post("/admin/kiosk/cms/reset")
async def admin_reset_kiosk_cms(
    as_mess_id: Optional[str] = Query(default=None),
    user: server.User = Depends(server.get_current_user),
):
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)
    await server.db.kiosk_cms.delete_one({"_id": _doc_id(mid)})
    fresh = await _load(mid)
    fresh["mess_id"] = mid
    return fresh
