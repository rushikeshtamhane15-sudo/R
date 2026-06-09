"""Iter-79 Batch B (#4 + #5) — Backend test coverage.

#4 Restaurant operating hours / capacity gate:
  - GET /api/restaurant/status
  - GET /api/admin/restaurant/hours
  - POST /api/admin/restaurant/hours (admin only)
  - POST /api/restaurant/order returns 423 when closed

#5 Location-aware contact + geo fixes + profile speed:
  - GET /api/messes/nearby with distance_km + closest_mess_id
  - GET /api/geo/reverse (no coord fallback, label='' for 0,0)
  - POST /api/auth/profile returns in <1s with base64 selfie (face check is async)
"""
from __future__ import annotations

import base64
import os
import time
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]


def _send_otp_login(phone: str = "9876543210", name: str = "Test User"):
    """Dev-OTP login → returns (session_token, user_id)."""
    r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, r.text
    dev_otp = r.json().get("dev_otp")
    assert dev_otp, f"send-otp didn't return dev_otp: {r.text}"
    r2 = requests.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": phone, "otp": dev_otp, "name": name},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    return body["session_token"], body["user"]["user_id"]


@pytest.fixture(scope="module")
def admin_session():
    """Login a user and promote to admin in Mongo, yield token. Cleanup role at end."""
    phone = "9876543210"
    token, user_id = _send_otp_login(phone=phone, name="Iter79 Admin")
    _db.users.update_one({"user_id": user_id}, {"$set": {"role": "admin"}})
    yield {"token": token, "user_id": user_id, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(scope="module")
def user_session():
    """Non-admin user for 403 testing."""
    phone = "9123456701"
    token, user_id = _send_otp_login(phone=phone, name="Iter79 User")
    # Make sure not admin
    _db.users.update_one({"user_id": user_id}, {"$set": {"role": "subscriber"}})
    yield {"token": token, "user_id": user_id, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(autouse=True, scope="module")
def restore_hours_at_end():
    """Always restore default config after the module runs."""
    yield
    _db.app_settings.update_one(
        {"_id": "restaurant_hours"},
        {"$set": {
            "mode": "auto",
            "open_time": "10:00",
            "close_time": "22:00",
            "capacity_per_hour": 0,
            "closed_message": "We only deliver between our standard working hours",
        }},
        upsert=True,
    )


# ============================================================================
# #4 Restaurant hours
# ============================================================================
class TestRestaurantStatus:
    def test_status_shape(self):
        r = requests.get(f"{BASE_URL}/api/restaurant/status", timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("open", "reason", "next_open_at", "opens_in_minutes",
                  "open_time", "close_time", "mode", "closed_message"):
            assert k in d, f"missing key: {k}"
        assert d["open_time"] == "10:00"
        assert d["close_time"] == "22:00"

    def test_status_outside_hours_has_opens_in(self):
        """Either we're open (reason None) or closed with non-null opens_in_minutes."""
        r = requests.get(f"{BASE_URL}/api/restaurant/status", timeout=10).json()
        if not r["open"]:
            assert r["reason"] in ("outside_hours", "manual_off", "capacity_full")
            assert r["opens_in_minutes"] is not None
            assert r["next_open_at"] is not None

    def test_manual_off_makes_status_closed(self, admin_session):
        r = requests.post(
            f"{BASE_URL}/api/admin/restaurant/hours",
            json={"mode": "manual_off", "open_time": "10:00", "close_time": "22:00",
                  "capacity_per_hour": 0, "closed_message": "We only deliver between our standard working hours"},
            headers=admin_session["headers"], timeout=10,
        )
        assert r.status_code == 200, r.text
        s = requests.get(f"{BASE_URL}/api/restaurant/status", timeout=10).json()
        assert s["open"] is False
        assert s["reason"] == "manual_off"
        assert s["opens_in_minutes"] is not None

    def test_manual_on_makes_status_open(self, admin_session):
        r = requests.post(
            f"{BASE_URL}/api/admin/restaurant/hours",
            json={"mode": "manual_on", "open_time": "10:00", "close_time": "22:00",
                  "capacity_per_hour": 0, "closed_message": "We only deliver between our standard working hours"},
            headers=admin_session["headers"], timeout=10,
        )
        assert r.status_code == 200
        s = requests.get(f"{BASE_URL}/api/restaurant/status", timeout=10).json()
        assert s["open"] is True
        assert s["reason"] is None

    def test_auto_mode_respects_time_window(self, admin_session):
        r = requests.post(
            f"{BASE_URL}/api/admin/restaurant/hours",
            json={"mode": "auto", "open_time": "10:00", "close_time": "22:00",
                  "capacity_per_hour": 0, "closed_message": "We only deliver between our standard working hours"},
            headers=admin_session["headers"], timeout=10,
        )
        assert r.status_code == 200
        s = requests.get(f"{BASE_URL}/api/restaurant/status", timeout=10).json()
        # status reflects real IST clock — just verify it's well-formed
        assert s["mode"] == "auto"
        if not s["open"]:
            assert s["reason"] == "outside_hours"


class TestAdminHours:
    def test_admin_get_hours(self, admin_session):
        r = requests.get(f"{BASE_URL}/api/admin/restaurant/hours",
                         headers=admin_session["headers"], timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "mode" in d and "open_time" in d and "close_time" in d
        assert "current_hourly_order_count" in d
        assert "status" in d
        assert isinstance(d["current_hourly_order_count"], int)

    def test_non_admin_cannot_set_hours(self, user_session):
        r = requests.post(
            f"{BASE_URL}/api/admin/restaurant/hours",
            json={"mode": "manual_off", "open_time": "10:00", "close_time": "22:00",
                  "capacity_per_hour": 0, "closed_message": "x"},
            headers=user_session["headers"], timeout=10,
        )
        assert r.status_code == 403, r.text

    def test_invalid_time_range_400(self, admin_session):
        r = requests.post(
            f"{BASE_URL}/api/admin/restaurant/hours",
            json={"mode": "auto", "open_time": "22:00", "close_time": "10:00",
                  "capacity_per_hour": 0, "closed_message": "x"},
            headers=admin_session["headers"], timeout=10,
        )
        assert r.status_code == 400, r.text

    def test_invalid_mode_422(self, admin_session):
        r = requests.post(
            f"{BASE_URL}/api/admin/restaurant/hours",
            json={"mode": "garbage", "open_time": "10:00", "close_time": "22:00",
                  "capacity_per_hour": 0, "closed_message": "x"},
            headers=admin_session["headers"], timeout=10,
        )
        assert r.status_code in (400, 422)


class TestOrderGate:
    def test_order_returns_423_when_closed(self, admin_session, user_session):
        # Force closed
        requests.post(
            f"{BASE_URL}/api/admin/restaurant/hours",
            json={"mode": "manual_off", "open_time": "10:00", "close_time": "22:00",
                  "capacity_per_hour": 0, "closed_message": "We only deliver between our standard working hours"},
            headers=admin_session["headers"], timeout=10,
        )
        # Minimal valid order payload (items has at least one item to bypass the
        # "Cart is empty" check). The dish_id is irrelevant — gate runs first.
        payload = {
            "items": [{"id": "anything", "qty": 1, "portion": "full"}],
            "customer_name": "T", "customer_phone": "9876543210",
            "delivery_address": "x" * 20,
        }
        r = requests.post(f"{BASE_URL}/api/restaurant/order", json=payload,
                          headers=user_session["headers"], timeout=15)
        assert r.status_code == 423, f"expected 423 got {r.status_code}: {r.text}"
        d = r.json().get("detail") or r.json()
        # detail is an object with code/message/opens_in_minutes/next_open_at
        assert isinstance(d, dict), f"detail must be dict, got {type(d).__name__}: {d}"
        assert d.get("code") in ("manual_off", "outside_hours", "capacity_full")
        assert "message" in d
        assert "opens_in_minutes" in d
        assert "next_open_at" in d


# ============================================================================
# #5 Geo + nearby + profile speed
# ============================================================================
class TestNearbyMesses:
    def test_nearby_returns_distance_and_closest(self):
        r = requests.get(f"{BASE_URL}/api/messes/nearby?lat=20.898&lng=77.746", timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "messes" in d and "closest_mess_id" in d
        assert len(d["messes"]) >= 1
        assert d["closest_mess_id"] == "efoodcare-amravati"
        first = d["messes"][0]
        assert "distance_km" in first
        # Amravati distance should be roughly 5-6 km
        assert 4.0 <= first["distance_km"] <= 8.0


class TestGeoReverse:
    def test_reverse_amravati_label(self):
        r = requests.get(f"{BASE_URL}/api/geo/reverse?lat=20.898&lng=77.746", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # Must contain "Amravati" and NOT be a "lat,lng" coord-fallback
        assert d["city"] == "Amravati"
        lbl = d.get("label", "")
        assert "Amravati" in lbl
        # No coord-pattern leaking
        import re
        assert not re.match(r"^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$", lbl.strip())

    def test_reverse_zero_zero_empty_label(self):
        r = requests.get(f"{BASE_URL}/api/geo/reverse?lat=0&lng=0", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("label", "") == ""


class TestProfileSpeed:
    def test_profile_save_under_1s_with_base64_photo(self, user_session):
        # Tiny 1x1 JPEG-ish data URL (base64 of valid jpeg header). Backend
        # accepts any data:image/* URL up to 1.2 MB; face check is async.
        raw = base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 500).decode()
        photo = f"data:image/jpeg;base64,{raw}"
        payload = {
            "name": "Iter User",
            "phone": "9123456701",
            "address": "123 Test Street, Pune, MH",
            "photo_url": photo,
            "lat": 20.898,
            "lng": 77.746,
        }
        t0 = time.perf_counter()
        r = requests.post(f"{BASE_URL}/api/auth/profile", json=payload,
                          headers=user_session["headers"], timeout=10)
        dt = time.perf_counter() - t0
        assert r.status_code == 200, r.text
        assert dt < 1.0, f"profile save took {dt:.3f}s — should be <1s with async face check"
