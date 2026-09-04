"""Mess-owner scoped routes — iter-143 · efoodtech SaaS.

Endpoints exposed to a logged-in mess owner (role=`franchise_owner` or
`admin` acting on their own mess). All operations are scoped to the mess
they own so a mess owner CAN'T see or edit another mess's data.

Endpoints:
  GET    /api/mess-owner/me                  → own mess doc
  PATCH  /api/mess-owner/settings            → branding, tagline, chips, contact
  POST   /api/mess-owner/logo                → upload mess logo (multipart)
  POST   /api/mess-owner/razorpay-keys       → save + validate own Razorpay keys
  GET    /api/mess-owner/razorpay-status     → live health-check of current keys
  DELETE /api/mess-owner/razorpay-keys       → remove keys (falls back to platform)
"""
from __future__ import annotations

import asyncio
import base64
from typing import Optional

import razorpay
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from shared import server

router = APIRouter()

MAX_LOGO_BYTES = 2 * 1024 * 1024
_LOGO_MIME_EXT = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


async def _get_owned_mess(user: server.User) -> dict:
    """Resolve the mess owned by the current user. 403 if none."""
    if user.role not in ("franchise_owner", "admin"):
        raise HTTPException(status_code=403, detail="Mess-owner portal only")
    # admin acting on efoodcare-amravati is a corporate mess owner — allow
    # via owner_user_id match; otherwise franchise_owner match.
    mess = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0})
    if mess:
        return mess
    if user.role == "admin":
        mess = await server.db.messes.find_one({"mess_id": server.DEFAULT_MESS_ID}, {"_id": 0})
        if mess:
            return mess
    raise HTTPException(status_code=403, detail="No mess assigned to this account")


def _redact_keys(mess: dict) -> dict:
    out = dict(mess)
    kid = (out.get("razorpay_key_id") or "").strip()
    sec = (out.get("razorpay_key_secret") or "").strip()
    out["razorpay_key_id"] = kid  # id is safe to echo
    out["razorpay_key_secret"] = ("•" * 6 + sec[-4:]) if sec else ""
    out["razorpay_configured"] = bool(kid and sec)
    return out


@router.get("/mess-owner/me")
async def mess_owner_me(user: server.User = Depends(server.get_current_user)):
    mess = await _get_owned_mess(user)
    return {"mess": _redact_keys(mess)}


@router.patch("/mess-owner/settings")
async def mess_owner_settings(
    payload: server.MessSettingsIn,
    user: server.User = Depends(server.get_current_user),
):
    mess = await _get_owned_mess(user)
    updates: dict = {}
    body = payload.model_dump(exclude_unset=True)
    # Whitelist-and-strip fields
    for key in (
        "tagline", "hero_title", "hero_subtitle", "logo_url",
        "payment_note", "manager_name", "manager_phone", "manager_email",
    ):
        if key in body and body[key] is not None:
            v = str(body[key]).strip()
            updates[key] = v[:1200]
    if "tag_chips" in body and body["tag_chips"] is not None:
        chips = []
        for c in body["tag_chips"][:16]:
            c = str(c or "").strip()
            if c:
                chips.append(c[:60])
        updates["tag_chips"] = chips
    if not updates:
        raise HTTPException(status_code=400, detail="No editable fields provided")
    updates["updated_at"] = server.iso(server.now_utc())
    await server.db.messes.update_one({"mess_id": mess["mess_id"]}, {"$set": updates})
    fresh = await server.db.messes.find_one({"mess_id": mess["mess_id"]}, {"_id": 0})
    return {"ok": True, "mess": _redact_keys(fresh)}


@router.post("/mess-owner/logo")
async def mess_owner_upload_logo(
    file: UploadFile = File(...),
    user: server.User = Depends(server.get_current_user),
):
    mess = await _get_owned_mess(user)
    ext = _LOGO_MIME_EXT.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPG / PNG / WEBP allowed")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail=f"Logo too large (max {MAX_LOGO_BYTES//(1024*1024)} MB)")
    try:
        from image_optim import optimize_to_webp_bytes
        payload = optimize_to_webp_bytes(data)
        mime = "image/webp"
    except Exception:  # noqa: BLE001
        payload = data
        mime = (file.content_type or "image/jpeg").lower()
    data_url = f"data:{mime};base64," + base64.b64encode(payload).decode("ascii")
    await server.db.messes.update_one(
        {"mess_id": mess["mess_id"]},
        {"$set": {"logo_url": data_url, "logo_updated_at": server.iso(server.now_utc()), "updated_at": server.iso(server.now_utc())}},
    )
    return {"ok": True, "logo_url": data_url, "bytes": len(payload)}


@router.post("/mess-owner/razorpay-keys")
async def mess_owner_save_razorpay(
    payload: server.MessRazorpayKeysIn,
    user: server.User = Depends(server.get_current_user),
):
    mess = await _get_owned_mess(user)
    key_id = payload.razorpay_key_id.strip()
    key_secret = payload.razorpay_key_secret.strip()
    # Validate by pinging Razorpay before saving so mess owners get instant feedback
    validation: dict = {"ok": False, "status": "error", "detail": ""}
    try:
        client = razorpay.Client(auth=(key_id, key_secret))
        await asyncio.to_thread(client.order.all, {"count": 1})
        validation = {"ok": True, "status": "live", "detail": "Razorpay authentication succeeded — payments will land in your account."}
    except razorpay.errors.BadRequestError as e:
        raise HTTPException(status_code=400, detail=f"Razorpay rejected these keys: {e}. Please re-check Key ID + Secret from your Razorpay dashboard.")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not reach Razorpay to validate: {e}")
    await server.db.messes.update_one(
        {"mess_id": mess["mess_id"]},
        {"$set": {
            "razorpay_key_id": key_id,
            "razorpay_key_secret": key_secret,
            "razorpay_saved_at": server.iso(server.now_utc()),
            "updated_at": server.iso(server.now_utc()),
        }},
    )
    return {"ok": True, "validation": validation, "razorpay_configured": True, "key_id_masked": key_id[:8] + "…"}


@router.get("/mess-owner/razorpay-status")
async def mess_owner_razorpay_status(user: server.User = Depends(server.get_current_user)):
    mess = await _get_owned_mess(user)
    kid = (mess.get("razorpay_key_id") or "").strip()
    sec = (mess.get("razorpay_key_secret") or "").strip()
    if not (kid and sec):
        return {"ok": False, "status": "not_configured", "detail": "You haven't added Razorpay keys yet. Payments will use the platform account until you connect yours.", "razorpay_configured": False}
    try:
        client = razorpay.Client(auth=(kid, sec))
        await asyncio.to_thread(client.order.all, {"count": 1})
        return {"ok": True, "status": "live", "detail": "Payments are landing directly in your Razorpay account.", "razorpay_configured": True, "key_id_masked": kid[:8] + "…"}
    except razorpay.errors.BadRequestError as e:
        return {"ok": False, "status": "auth_failed", "detail": f"Razorpay rejected these keys: {e}", "razorpay_configured": True}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status": "error", "detail": f"Razorpay check errored: {e}", "razorpay_configured": True}


@router.delete("/mess-owner/razorpay-keys")
async def mess_owner_delete_razorpay(user: server.User = Depends(server.get_current_user)):
    mess = await _get_owned_mess(user)
    await server.db.messes.update_one(
        {"mess_id": mess["mess_id"]},
        {"$unset": {"razorpay_key_id": "", "razorpay_key_secret": "", "razorpay_saved_at": ""},
         "$set": {"updated_at": server.iso(server.now_utc())}},
    )
    return {"ok": True, "razorpay_configured": False}
