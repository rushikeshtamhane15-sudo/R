"""iter-158h — strict mess selection at login + auto-promote mess owner.

Verifies:
  1. Non-admin login WITHOUT mess_id → HTTP 400 with clear message.
  2. Super-admin phone (ADMIN_PHONES) → allowed without mess_id.
  3. Auto-promotion: if picked mess has owner_phone == login phone and
     no owner_user_id yet, user is promoted to mess_owner and mess is
     linked.
"""
import json
import os
import time
import uuid
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_PHONE = "9970705391"
CACHE = Path("/tmp/iter158_tokens.json")


def _send_otp(phone: str) -> str:
    for _ in range(3):
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=15)
        if r.status_code == 429:
            time.sleep(60)
            continue
        assert r.status_code == 200, r.text
        return r.json()["dev_otp"]
    raise RuntimeError("otp send rate limited")


def _admin_token() -> str:
    cache = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text())
        except Exception:
            pass
    tok = cache.get(ADMIN_PHONE)
    if tok:
        rc = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        if rc.status_code == 200:
            return tok
    otp = _send_otp(ADMIN_PHONE)
    r = requests.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": ADMIN_PHONE, "otp": otp, "name": "Super"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    tok = r.json().get("session_token") or r.json().get("token")
    cache[ADMIN_PHONE] = tok
    CACHE.write_text(json.dumps(cache))
    return tok


def test_non_admin_login_without_mess_rejected():
    """A random phone number cannot log in without picking a mess."""
    phone = f"98{int(time.time()) % 100000000:08d}"
    otp = _send_otp(phone)
    r = requests.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": phone, "otp": otp, "name": "Random"},
        timeout=15,
    )
    assert r.status_code == 400
    assert "mess" in r.json().get("detail", "").lower()


def test_super_admin_login_without_mess_allowed():
    """The configured ADMIN_PHONE may log in without picking a mess."""
    tok = _admin_token()
    assert tok


def test_auto_promote_owner_on_first_login():
    """Onboard a mess with a fresh owner_phone (no user yet), then log the
    owner in and verify: mess.owner_user_id is backfilled, user role becomes
    mess_owner."""
    admin_tok = _admin_token()
    admin_headers = {"Authorization": f"Bearer {admin_tok}"}
    # Fresh phone that will not exist as a user yet
    owner_phone = f"93{int(time.time()) % 100000000:08d}"
    body = {
        "name": f"AutoPromote {uuid.uuid4().hex[:6]}",
        "slug": f"auto-{uuid.uuid4().hex[:8]}",
        "owner_phone": owner_phone,
        "city": "Testville",
        "state": "MH",
        "pincode": "440001",
        "address": "Test address, Testville, MH 440001",
        "is_franchise": True,
    }
    r = requests.post(f"{BASE_URL}/api/admin/messes", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    mess = r.json()
    mess_id = mess["mess_id"]

    # Now log in as the owner picking THIS mess.
    otp = _send_otp(owner_phone)
    r2 = requests.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": owner_phone, "otp": otp, "name": "Owner", "mess_id": mess_id},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    user = r2.json()["user"]
    assert user["role"] == "mess_owner", f"expected mess_owner, got {user['role']}"
    assert user["mess_id"] == mess_id

    # Verify the mess doc was backfilled with owner_user_id.
    rl = requests.get(f"{BASE_URL}/api/admin/messes", headers=admin_headers, timeout=15)
    row = next((m for m in rl.json()["messes"] if m["mess_id"] == mess_id), None)
    assert row is not None
    assert row.get("owner_user_id") == user["user_id"], f"owner_user_id not linked: {row}"
