"""iter-132 backend tests:

1. Branding module — new `kiosk` and `splash` slots parallel to brand/header
   · GET  /api/branding returns 4 URL slots, is_*_custom flags, *_updated_at
   · POST /api/admin/branding/logo?slot=kiosk|splash uploads persist
   · POST /api/admin/branding/reset?slot=kiosk|splash reverts
   · Non-admin gets 403; invalid slot returns 400
2. Tiffin stock — /api/admin/tiffin-stock now returns `engaged` and
   `total_with_engaged` fields sourced from restaurant_tiffin_pendency.
"""
from __future__ import annotations

import io
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]

# 1x1 PNG (67 bytes)
PNG_1x1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02"
    b"\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe"
    b"\x02\xfe\xa15\x91\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _seed_user(role="admin"):
    uid = f"TEST_user_{uuid.uuid4().hex[:10]}"
    token = f"TEST_sess_{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc)
    email = f"TEST_{role}_{uuid.uuid4().hex[:6]}@efoodcare.com"
    db.users.insert_one({
        "user_id": uid, "email": email.lower(),
        "phone": f"99{uuid.uuid4().int % 10**8:08d}",
        "name": f"Test {role}", "role": role,
        "address": "123 St", "wallet_balance": 0.0,
        "qr_token": f"qr_TEST_{uuid.uuid4().hex[:12]}",
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid, "session_token": token,
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "created_at": now.isoformat(),
    })
    return {"user_id": uid, "token": token, "email": email.lower()}


def _cleanup_user(u):
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})


def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin():
    u = _seed_user("admin")
    yield u
    _cleanup_user(u)


@pytest.fixture
def subscriber():
    u = _seed_user("subscriber")
    yield u
    _cleanup_user(u)


# ============================================================
# Branding — public GET returns 4 slots with fallbacks
# ============================================================
class TestBrandingPublic:
    def test_public_branding_shape(self):
        r = requests.get(f"{BASE_URL}/api/branding")
        assert r.status_code == 200
        d = r.json()
        for k in ("brand_logo_url", "header_logo_url", "splash_logo_url", "kiosk_logo_url"):
            assert k in d, f"missing {k}"
            assert isinstance(d[k], str) and d[k]
        for k in ("is_custom", "is_header_custom", "is_splash_custom", "is_kiosk_custom"):
            assert k in d
            assert isinstance(d[k], bool)
        for k in ("brand_updated_at", "header_updated_at", "splash_updated_at", "kiosk_updated_at"):
            assert k in d  # may be None if never uploaded

    def test_public_branding_fallback_default(self):
        # Reset both new slots first to guarantee fallback
        # (using db directly to keep the test hermetic; admin flow tested below)
        db.app_settings.update_one(
            {"_id": "branding_settings_v1"},
            {"$set": {"kiosk_logo_url": "", "splash_logo_url": ""}},
            upsert=True,
        )
        r = requests.get(f"{BASE_URL}/api/branding")
        d = r.json()
        assert d["kiosk_logo_url"] == "/brand-logo.jpg"
        assert d["splash_logo_url"] == "/brand-logo.jpg"
        assert d["is_kiosk_custom"] is False
        assert d["is_splash_custom"] is False


# ============================================================
# Branding — admin upload/reset for kiosk & splash
# ============================================================
class TestBrandingAdminSlots:
    @pytest.mark.parametrize("slot", ["kiosk", "splash"])
    def test_upload_and_reset(self, admin, slot):
        # ---- Upload ----
        files = {"file": (f"{slot}.png", io.BytesIO(PNG_1x1), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/admin/branding/logo?slot={slot}",
            headers=h(admin["token"]), files=files,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["slot"] == slot
        field = f"{slot}_logo_url"
        assert d[field].startswith("data:image/"), d[field][:40]
        assert d["updated_at"]

        # ---- GET reflects it ----
        r2 = requests.get(f"{BASE_URL}/api/branding")
        d2 = r2.json()
        assert d2[field].startswith("data:image/")
        assert d2[f"is_{slot}_custom"] is True
        assert d2[f"{slot}_updated_at"]

        # ---- Reset ----
        r3 = requests.post(
            f"{BASE_URL}/api/admin/branding/reset?slot={slot}",
            headers=h(admin["token"]),
        )
        assert r3.status_code == 200, r3.text
        d3 = r3.json()
        assert d3["slot"] == slot
        assert d3["is_custom"] is False

        # ---- GET shows fallback again ----
        r4 = requests.get(f"{BASE_URL}/api/branding")
        d4 = r4.json()
        assert d4[field] == "/brand-logo.jpg"
        assert d4[f"is_{slot}_custom"] is False

    def test_upload_invalid_slot(self, admin):
        files = {"file": ("x.png", io.BytesIO(PNG_1x1), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/admin/branding/logo?slot=footer",
            headers=h(admin["token"]), files=files,
        )
        assert r.status_code == 400
        assert "slot" in r.text.lower()

    def test_reset_invalid_slot(self, admin):
        r = requests.post(
            f"{BASE_URL}/api/admin/branding/reset?slot=nope",
            headers=h(admin["token"]),
        )
        assert r.status_code == 400

    def test_upload_non_admin_forbidden(self, subscriber):
        files = {"file": ("x.png", io.BytesIO(PNG_1x1), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/admin/branding/logo?slot=kiosk",
            headers=h(subscriber["token"]), files=files,
        )
        assert r.status_code == 403

    def test_upload_bad_mime(self, admin):
        files = {"file": ("x.txt", io.BytesIO(b"not-an-image"), "text/plain")}
        r = requests.post(
            f"{BASE_URL}/api/admin/branding/logo?slot=kiosk",
            headers=h(admin["token"]), files=files,
        )
        assert r.status_code == 400


# ============================================================
# Tiffin stock — engaged + total_with_engaged
# ============================================================
class TestTiffinStockEngaged:
    def test_get_state_has_engaged_fields(self, admin):
        r = requests.get(f"{BASE_URL}/api/admin/tiffin-stock", headers=h(admin["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "engaged" in d and isinstance(d["engaged"], int)
        assert "total_with_engaged" in d and isinstance(d["total_with_engaged"], int)
        assert "quantity" in d
        # Invariant: total_with_engaged == quantity + engaged
        assert d["total_with_engaged"] == d["quantity"] + d["engaged"]

    def test_engaged_reflects_pending_pendency(self, admin):
        # Seed 2 pending pendency records (collected != true)
        uid1 = f"TEST_pendency_{uuid.uuid4().hex[:8]}"
        uid2 = f"TEST_pendency_{uuid.uuid4().hex[:8]}"
        try:
            db.restaurant_tiffin_pendency.insert_many([
                {"user_id": uid1, "tiffin_count": 3, "collected": False},
                {"user_id": uid2, "tiffin_count": 5},  # no `collected` -> unset counts
                {"user_id": f"TEST_ignore_{uuid.uuid4().hex[:6]}", "tiffin_count": 99, "collected": True},
            ])
            r = requests.get(f"{BASE_URL}/api/admin/tiffin-stock", headers=h(admin["token"]))
            d = r.json()
            # Engaged must be >= 8 (from our two seed rows); global endpoint may see others too
            assert d["engaged"] >= 8, f"engaged={d['engaged']}, expected >= 8"
            assert d["total_with_engaged"] == d["quantity"] + d["engaged"]
        finally:
            db.restaurant_tiffin_pendency.delete_many({"user_id": {"$in": [uid1, uid2]}})
            db.restaurant_tiffin_pendency.delete_many({"user_id": {"$regex": "^TEST_ignore_"}})

    def test_non_admin_forbidden(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/admin/tiffin-stock", headers=h(subscriber["token"]))
        assert r.status_code == 403
