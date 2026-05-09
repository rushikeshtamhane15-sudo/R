"""iter25 — Restaurant theme CMS, geolocation persistence on orders, and track endpoint.

Verifies the new endpoints/features added in the unverified batch:
  * GET /api/restaurant/theme            (public, returns {} or theme doc)
  * PUT /api/admin/restaurant/theme       (admin-only, persists, returns persisted doc)
  * POST /api/restaurant/order            (persists customer_lat/customer_lng + saves on user)
  * GET /api/restaurant/orders/{id}/track (returns customer_lat/lng + delivery_otp)
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _login_otp(phone: str, name: str = "Tester"):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, r.text
    otp = r.json().get("dev_otp")
    assert otp, "dev_otp missing — DEV mode disabled?"
    r2 = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name}, timeout=15)
    assert r2.status_code == 200, r2.text
    j = r2.json()
    return j["session_token"], j["user"]


@pytest.fixture(scope="module")
def customer():
    phone = "9" + str(int(time.time()))[-9:]
    tok, u = _login_otp(phone, "TEST_iter25_cust")
    return {"token": tok, "user": u, "phone": phone}


@pytest.fixture(scope="module")
def admin_token():
    """Use ADMIN_EMAILS allowlist (admin@efoodcare.com) — login via OTP using the
    matching admin phone if configured. Else seed via mongo direct as a fallback."""
    # Try designated admin phone from env
    admin_phones_env = os.environ.get("ADMIN_PHONES", "")
    admin_phone = next((p.strip() for p in admin_phones_env.split(",") if p.strip()), "")
    if not admin_phone:
        # Promote a fresh user via Mongo as fallback (most envs allow this)
        from pymongo import MongoClient
        from dotenv import load_dotenv
        from pathlib import Path
        load_dotenv(Path("/app/backend/.env"))
        cli = MongoClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        admin_phone = "9" + str(int(time.time()))[-9:] + "0"
        admin_phone = admin_phone[:10]
        tok, u = _login_otp(admin_phone, "TEST_iter25_admin")
        db.users.update_one({"user_id": u["user_id"]}, {"$set": {"role": "admin"}})
        return tok
    tok, _ = _login_otp(admin_phone, "TEST_iter25_admin")
    return tok


# ----------------------------- THEME ENDPOINTS -----------------------------
class TestRestaurantTheme:
    def test_get_theme_public_no_auth(self):
        r = requests.get(f"{API}/restaurant/theme", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, dict), body

    def test_put_theme_requires_admin(self, customer):
        r = requests.put(
            f"{API}/admin/restaurant/theme",
            json={"hero_title": "should-not-save"},
            headers=_hdr(customer["token"]),
            timeout=10,
        )
        assert r.status_code == 403, r.text

    def test_put_theme_admin_persists(self, admin_token):
        unique = f"TEST_hero_{uuid.uuid4().hex[:6]}"
        payload = {
            "hero_title": unique,
            "hero_tagline": "test tagline",
            "accent_color": "#aa0000",
            "show_zero_bad_stuff_chip": False,
            "show_delivery_promise": True,
        }
        r = requests.put(f"{API}/admin/restaurant/theme", json=payload,
                         headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["hero_title"] == unique
        assert saved["hero_tagline"] == "test tagline"
        assert saved["accent_color"] == "#aa0000"
        assert saved["show_zero_bad_stuff_chip"] is False

        # Verify GET returns persisted state
        r2 = requests.get(f"{API}/restaurant/theme", timeout=10)
        assert r2.status_code == 200
        got = r2.json()
        assert got["hero_title"] == unique
        assert got["accent_color"] == "#aa0000"


# ----------------------------- ORDER GEO PERSIST -----------------------------
class TestOrderGeoPersistence:
    def test_create_order_with_lat_lng_persists_on_order_and_user(self, customer):
        # Pull menu so we have a valid item id
        m = requests.get(f"{API}/restaurant/menu", timeout=10).json()
        first = m["items"][0]
        lat, lng = 18.5204, 73.8567  # Pune coords
        body = {
            "items": [{"id": first["id"], "qty": 1}],
            "name": "TEST iter25",
            "phone": customer["phone"],
            "address": "TEST address line",
            "customer_lat": lat,
            "customer_lng": lng,
        }
        r = requests.post(f"{API}/restaurant/order", json=body,
                          headers=_hdr(customer["token"]), timeout=15)
        assert r.status_code == 200, r.text
        order_id = r.json()["order_id"]

        # Verify order doc has lat/lng (use my orders list)
        r2 = requests.get(f"{API}/restaurant/orders", headers=_hdr(customer["token"]), timeout=10)
        assert r2.status_code == 200
        orders = r2.json()["orders"]
        match = next((o for o in orders if o["order_id"] == order_id), None)
        assert match is not None
        assert abs(float(match["customer_lat"]) - lat) < 1e-6
        assert abs(float(match["customer_lng"]) - lng) < 1e-6

        # Verify track endpoint returns lat/lng (status is 'created' here, but
        # endpoint should still return the values regardless of status — task
        # spec says when status in ready_for_pickup/out_for_delivery it must
        # return them. We assert they are present at minimum.)
        r3 = requests.get(f"{API}/restaurant/orders/{order_id}/track",
                          headers=_hdr(customer["token"]), timeout=10)
        assert r3.status_code == 200, r3.text
        t = r3.json()
        assert "customer_lat" in t and "customer_lng" in t
        assert abs(float(t["customer_lat"]) - lat) < 1e-6
        assert abs(float(t["customer_lng"]) - lng) < 1e-6
        assert "delivery_otp" in t  # field present (may be null pre-pickup)

    def test_user_profile_lat_lng_saved_on_first_checkout(self, customer):
        # The previous test already submitted lat/lng — fetch /api/me and verify
        r = requests.get(f"{API}/auth/me", headers=_hdr(customer["token"]), timeout=10)
        assert r.status_code == 200, r.text
        u = r.json()
        # Profile auto-save: lat/lng should now be on user
        assert u.get("lat") is not None, f"user.lat not saved: {u}"
        assert u.get("lng") is not None, f"user.lng not saved: {u}"
