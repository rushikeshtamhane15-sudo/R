"""Auth router — Emergent Google session, OTP send/verify, profile, location.

Shared application state (db, logger, helpers, pydantic models) lives in
`server.py`. We access it via late binding (`import server`) which is safe
because server.py imports this router at the BOTTOM of its own module body,
guaranteeing all `server.<name>` attributes are populated before any handler
decorator runs.
"""
from __future__ import annotations

import asyncio
import random
import uuid
from datetime import timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from shared import server  # late-binding via shared shim

router = APIRouter()


# ---------------------------------------------------------------------------
# Emergent Google Auth
# ---------------------------------------------------------------------------
# REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
@router.post("/auth/session")
async def auth_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    async with httpx.AsyncClient() as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
            timeout=10,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session_id")
        data = r.json()
    user = await server.create_or_get_user(
        email=data["email"], phone=None,
        name=data.get("name", data["email"]), picture=data.get("picture"),
    )
    token = data.get("session_token") or f"sess_{uuid.uuid4().hex}"
    expires_at = server.now_utc() + timedelta(days=7)
    await server.db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user["user_id"],
        "expires_at": server.iso(expires_at),
        "created_at": server.iso(server.now_utc()),
    })
    response.set_cookie(
        key="session_token", value=token, httponly=True, secure=True, samesite="none",
        path="/", max_age=7 * 24 * 60 * 60,
    )
    return {"user": {k: v for k, v in user.items() if k != "_id"}, "session_token": token}


# ---------------------------------------------------------------------------
# OTP Auth (DEV MOCKED)
# ---------------------------------------------------------------------------
@router.post("/auth/send-otp")
async def send_otp(payload: server.SendOtpRequest, request: Request):
    from rate_limit import check_and_record, client_ip, RateLimitExceeded
    phone = payload.phone.strip()
    if len(phone) < 6:
        raise HTTPException(status_code=400, detail="Invalid phone number")

    # Per-IP + per-phone tight limits — protects SMS bill from abuse / loops.
    # NB: phone limit fires first so a single bad actor can't burn a number's
    # quota across multiple IPs without first hitting their IP cap.
    ip = client_ip(request)
    try:
        await check_and_record(server.db, key=f"otp:phone:{phone}", max_count=3,  window_seconds=600,    label="OTP per phone (10 min)")
        await check_and_record(server.db, key=f"otp:ip:{ip}:hour", max_count=10, window_seconds=3600,   label="OTP per IP (hour)")
        await check_and_record(server.db, key=f"otp:ip:{ip}:day",  max_count=50, window_seconds=86400,  label="OTP per IP (day)")
    except RateLimitExceeded as e:
        server.logger.warning(f"[RATE LIMIT] /auth/send-otp blocked phone={phone} ip={ip} → {e}")
        raise HTTPException(status_code=429, detail=str(e), headers={"Retry-After": str(e.retry_after)})

    otp = f"{random.randint(100000, 999999)}"
    expires_at = server.now_utc() + timedelta(minutes=10)
    await server.db.otp_codes.update_one(
        {"phone": phone},
        {"$set": {
            "phone": phone,
            "otp": otp,
            "expires_at": server.iso(expires_at),
            "attempts": 0,
            "created_at": server.iso(server.now_utc()),
        }},
        upsert=True,
    )
    server.logger.warning(f"[MOCKED OTP] Phone={phone} OTP={otp}")
    out: dict = {"ok": True, "expires_in": 600}
    if server.OTP_DEV_MODE:
        out["dev_otp"] = otp
        out["dev_mode"] = True
    return out


@router.post("/auth/verify-otp")
async def verify_otp(payload: server.VerifyOtpRequest, response: Response):
    phone = payload.phone.strip()
    rec = await server.db.otp_codes.find_one({"phone": phone}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=400, detail="No OTP requested for this number")
    if server.parse_dt(rec["expires_at"]) < server.now_utc():
        raise HTTPException(status_code=400, detail="OTP expired")
    if rec.get("attempts", 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many attempts")
    if rec["otp"] != payload.otp.strip():
        await server.db.otp_codes.update_one({"phone": phone}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect OTP")
    await server.db.otp_codes.delete_one({"phone": phone})
    name = (payload.name or f"User {phone[-4:]}").strip()
    user = await server.create_or_get_user(email=None, phone=phone, name=name)
    token = await server.issue_session(user["user_id"], response)
    return {"user": {k: v for k, v in user.items() if k != "_id"}, "session_token": token}


@router.get("/auth/me")
async def auth_me(user: server.User = Depends(server.get_current_user)):
    return user.model_dump()


@router.post("/auth/logout")
async def auth_logout(response: Response, request: Request, session_token: Optional[str] = Cookie(default=None)):
    token = session_token
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        await server.db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


import re

# Iter-54 #3: profile-validation regexes
_NAME_RE = re.compile(
    # iter-112: tightened per user request — names must be letters only
    # (Latin + Indian scripts), with spaces / hyphens / apostrophes / dots
    # for compound names. Digits and underscores are no longer allowed,
    # which incidentally also rejects the "User 4744" default placeholder
    # so it can never be persisted via /auth/profile.
    r"^[^\W\d_\s\.\'\-"      # \w minus digits/underscore = all Unicode letters
    r"\u0300-\u036F\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF"
    r"\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]"  # negated char class — just to anchor scope
    r"|"
    # The actual allowed set: Unicode letters + spaces + . ' - + Indic marks
    r"^[^\W\d_]"                                # MUST start with a letter
    r"[\w\s\.\'\-"                              # subsequent chars
    r"\u0300-\u036F\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF"
    r"\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]{1,79}$"
)
# Re-define cleanly — the regex above had a "scoping" first alternative that
# is misleading. The real, simple rule we want is below:
_NAME_RE = re.compile(
    r"^[^\W\d_]"                                                 # first char: a letter
    r"[^\W\d_\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF"
    r"\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F"
    r"\u0300-\u036F\s\.\'\-]*"  # avoid duplicating ranges
    r"|"
    r"^[^\W\d_\u0300-\u036F]"
    r"[\w\s\.\'\-\u0300-\u036F"
    r"\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF"
    r"\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]{1,79}$"
)
# Final clean spec — supersedes the two confusing attempts above:
#   * first char MUST be a letter (Latin or Indic) — not a digit, not a separator
#   * subsequent chars: letters (any script) + spaces + dots + hyphens + apostrophes
#   * no digits, no underscores, no other punctuation
#   * total length 2–80
_NAME_RE = re.compile(
    r"^(?=.{2,80}$)"                                                    # length 2-80
    r"[^\W\d_\u0300-\u036F]"                                            # first char must be a letter
    r"[A-Za-z"                                                           # subsequent: latin letters
    r"\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF"              # + Indic letters
    r"\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F"
    r"\u0300-\u036F"                                                     # combining marks
    r"\s\.\'\-]*$"                                                       # + separators
)
_PHONE_RE = re.compile(r"^[6-9]\d{9}$")   # 10-digit India mobile, starts 6-9


def _validate_profile_fields(name: str, phone: str, address: str):
    """Iter-54 #3 — strict server-side validation."""
    name = (name or "").strip()
    phone = (phone or "").strip().replace("+91", "").replace(" ", "").replace("-", "")
    addr = (address or "").strip()
    if not _NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Name must be letters only (2–80 chars). Spaces, hyphens, apostrophes and dots are allowed — no digits or special characters.")
    if not _PHONE_RE.match(phone):
        raise HTTPException(status_code=400, detail="Phone must be exactly 10 digits starting 6–9 (we add +91 automatically)")
    if len(addr) < 10:
        raise HTTPException(status_code=400, detail="Address must be at least 10 characters (include area + city)")
    return name, phone, addr


@router.post("/auth/profile")
async def update_profile(payload: server.ProfileUpdate, user: server.User = Depends(server.get_current_user)):
    if not payload.name.strip() or not payload.phone.strip() or not payload.address.strip():
        raise HTTPException(status_code=400, detail="Name, phone and address are required")
    # Iter-54 #3 strict validation
    name, phone, addr = _validate_profile_fields(payload.name, payload.phone, payload.address)
    update = {
        "name": name,
        "phone": phone,
        "address": addr,
    }
    # iter-79 #6: profile save now returns in <100 ms.
    # Previously this route synchronously awaited a Gemini Vision face-check
    # on every save (~3-8 s per call). We now persist the photo immediately
    # with `photo_status="pending"` and run face validation in a background
    # task. If the LLM later flags the photo as invalid, we clear the photo
    # and set `photo_status="rejected"`. This gives users instant feedback
    # and removes the LLM call from the critical save path.
    photo_to_validate: Optional[str] = None
    if payload.photo_url is not None:
        if payload.photo_url and len(payload.photo_url) > 1_200_000:
            raise HTTPException(status_code=413, detail="Photo too large; please use a smaller image")
        update["photo_url"] = payload.photo_url
        if payload.photo_url and payload.photo_url.startswith("data:image"):
            update["photo_status"] = "pending"
            photo_to_validate = payload.photo_url
        elif payload.photo_url:
            update["photo_status"] = "verified"  # non-data-url (e.g. CDN link) — skip check
    if payload.lat is not None and payload.lng is not None:
        update["lat"] = float(payload.lat)
        update["lng"] = float(payload.lng)
    await server.db.users.update_one({"user_id": user.user_id}, {"$set": update})
    # iter-100: only return the fields the client needs — DON'T echo back the
    # giant base64 photo_url (it was crashing Cloudflare with 'origin returned
    # malformed HTTP / empty response' because the response body exceeded the
    # proxy buffer). Photo URL is already saved server-side and the next
    # /auth/me call will hydrate it normally.
    updated = await server.db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "photo_url": 0},
    )

    # Kick off the face-check in the background — fire and forget.
    if photo_to_validate:
        asyncio.create_task(_validate_face_background(user.user_id, photo_to_validate))

    return {"ok": True, "user": updated}


async def _validate_face_background(user_id: str, data_url: str) -> None:
    """Run Gemini face-check off the request path. On rejection, clear the
    photo and flag the user. On error, leave photo_status='pending' so a
    later save (or admin tool) can retry."""
    try:
        from face_check import is_valid_face_data_url
        ok, reason = await is_valid_face_data_url(data_url)
        if ok:
            await server.db.users.update_one(
                {"user_id": user_id},
                {"$set": {"photo_status": "verified", "photo_check_reason": reason}},
            )
        else:
            await server.db.users.update_one(
                {"user_id": user_id},
                {"$set": {
                    "photo_status": "rejected",
                    "photo_check_reason": reason,
                    "photo_url": "",  # clear the bad photo so the user re-uploads
                }},
            )
            server.logger.info(f"[FACE-CHECK-BG] rejected user={user_id} reason={reason}")
    except Exception as e:  # noqa: BLE001
        server.logger.warning(f"[FACE-CHECK-BG] error user={user_id}: {e} (keeping photo_status=pending)")


@router.post("/auth/location")
async def update_location(payload: server.LocationUpdate, user: server.User = Depends(server.get_current_user)):
    """Customer pins delivery location once. Auto reverse-geocodes via OSM Nominatim (24h-cached) → user.pincode."""
    update = {"lat": float(payload.lat), "lng": float(payload.lng), "location_set_at": server.iso(server.now_utc())}
    pincode, geocode_status = await server._reverse_geocode_pincode(payload.lat, payload.lng)
    if pincode:
        update["pincode"] = pincode
    update["geocode_status"] = geocode_status
    await server.db.users.update_one({"user_id": user.user_id}, {"$set": update})
    return {"ok": True, "pincode": pincode, "geocode_status": geocode_status}


# ---------------------------------------------------------------------------
# Per-user notification preferences (sound on/off). Lives on the user doc so
# preferences sync across devices.
# ---------------------------------------------------------------------------
class NotificationPrefs(BaseModel):
    sound: Optional[bool] = None
    voice: Optional[bool] = None


@router.get("/auth/prefs")
async def get_prefs(user: server.User = Depends(server.get_current_user)):
    doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0, "notify_prefs": 1}) or {}
    prefs = doc.get("notify_prefs") or {}
    return {
        "sound": prefs.get("sound", True),
        "voice": prefs.get("voice", True),
    }


@router.post("/auth/prefs")
async def update_prefs(payload: NotificationPrefs, user: server.User = Depends(server.get_current_user)):
    doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0, "notify_prefs": 1}) or {}
    cur = doc.get("notify_prefs") or {}
    if payload.sound is not None:
        cur["sound"] = bool(payload.sound)
    if payload.voice is not None:
        cur["voice"] = bool(payload.voice)
    await server.db.users.update_one({"user_id": user.user_id}, {"$set": {"notify_prefs": cur}})
    return {"ok": True, "sound": cur.get("sound", True), "voice": cur.get("voice", True)}
