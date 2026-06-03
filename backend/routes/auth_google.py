"""Google Sign-In — direct OAuth via Google Identity Services (NO Emergent branding).

Frontend (Login.jsx) renders @react-oauth/google's <GoogleLogin> button and
useGoogleOneTapLogin hook. Both return a credential JWT (the ID token).
This endpoint verifies that token server-side against Google's certs, extracts
the email + name + picture, and creates/logs in the user — issuing OUR own
session token so the rest of the app keeps working unchanged.

# REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from shared import server

log = logging.getLogger("efoodcare")
router = APIRouter()

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")


class GoogleSignInIn(BaseModel):
    credential: str   # ID-token JWT returned by Google Identity Services


@router.post("/auth/google/verify")
async def google_verify(payload: GoogleSignInIn, response: Response):
    """Verify Google ID token → find-or-create user → return our session token.

    The credential is a JWT signed by Google. We verify the signature, audience
    (must match our Client ID), and issuer (accounts.google.com). Anything else
    means a forged token and we 401.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google auth not configured on server")
    try:
        # Lazy import — keep google-auth out of the cold-start path.
        from google.oauth2 import id_token
        from google.auth.transport import requests as g_requests
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"google-auth missing: {e}") from e

    try:
        idinfo = id_token.verify_oauth2_token(
            payload.credential,
            g_requests.Request(),
            GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=10,
        )
    except ValueError as e:
        log.warning("[google-auth] verify failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid Google credential") from e

    if idinfo.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=401, detail="Invalid token issuer")

    email = (idinfo.get("email") or "").lower().strip()
    if not email or not idinfo.get("email_verified"):
        raise HTTPException(status_code=400, detail="Google account has no verified email")

    # Iter-56 #3: do NOT auto-fill the user's name from Google. Forcing the
    # user to type it themselves prevents accidental "John Smith" defaults
    # and ensures the address-book label matches what they want printed on
    # the tiffin slip / invoice. We still keep the Google `picture` as a
    # provisional avatar.
    name = None
    picture: Optional[str] = idinfo.get("picture")

    # Find-or-create via the existing helper that also handles phone fallbacks
    # and qr_token issuance. We pass email + picture only; phone stays None
    # so the user can still link a phone via /profile later, and `name` is
    # blank so the profile page surfaces the "Enter full name" placeholder.
    user_doc = await server.create_or_get_user(email=email, phone=None, name=name, picture=picture)

    # Record the Google subject so we can do fast google_sub-only lookups
    # on future sign-ins (and detect account hijack attempts).
    await server.db.users.update_one(
        {"user_id": user_doc["user_id"]},
        {"$set": {"google_sub": idinfo["sub"], "last_login_at": server.iso(server.now_utc())}},
    )

    token = await server.issue_session(user_doc["user_id"], response)
    return {
        "token": token,
        "user": {
            "user_id": user_doc["user_id"],
            "name": user_doc.get("name"),
            "email": user_doc.get("email"),
            "phone": user_doc.get("phone"),
            "role": user_doc.get("role", "subscriber"),
            "profile_photo_url": user_doc.get("picture") or picture or "",
        },
    }
