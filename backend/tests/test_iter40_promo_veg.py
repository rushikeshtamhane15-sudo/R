"""Iter-40 backend tests:
- Landing promotion CRUD + start/stop + upload
- Restaurant menu veg enforcement (is_non_veg)
- Generate-image endpoints (admin-only, accept 200 or 502)
"""
import io
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
ADMIN_PHONE = "9970705391"
USER_PHONE = "9876543210"


def _login(phone: str, name: str = "Test"):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, r.text
    otp = r.json().get("dev_otp")
    assert otp, f"No dev_otp in send-otp response: {r.json()}"
    r2 = s.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": phone, "otp": otp, "name": name},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    tok = r2.json().get("session_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin_client():
    # ADMIN_PHONES should include 9876543210 in test env. Fall back: set role via mongo through send-otp + manual promote not available, so just use this phone.
    s = _login(ADMIN_PHONE, "Admin Tester")
    # Verify admin role by hitting an admin endpoint
    r = s.get(f"{BASE_URL}/api/admin/landing-promotion", timeout=10)
    if r.status_code == 403:
        pytest.skip(f"Phone {ADMIN_PHONE} is not in ADMIN_PHONES; skipping admin-required tests")
    return s


@pytest.fixture(scope="module")
def user_client():
    return _login(USER_PHONE, "Regular User")


# ---------------- Landing promotion ----------------
class TestLandingPromotion:
    def test_public_get_shape(self):
        r = requests.get(f"{BASE_URL}/api/landing-promotion", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "promotion" in body
        # Either null (inactive) or dict with limited safe keys
        promo = body["promotion"]
        if promo is not None:
            assert "active" not in promo
            assert "image_prompt" not in promo
            for k in ("title", "body", "image_url", "cta_label", "cta_link", "accent_color"):
                assert k in promo

    def test_admin_only_endpoints_reject_anon(self):
        r = requests.get(f"{BASE_URL}/api/admin/landing-promotion", timeout=10)
        assert r.status_code in (401, 403)
        r = requests.put(f"{BASE_URL}/api/admin/landing-promotion", json={"title": "x"}, timeout=10)
        assert r.status_code in (401, 403)

    def test_admin_only_rejects_regular_user(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/admin/landing-promotion", timeout=10)
        assert r.status_code == 403

    def test_admin_put_then_start_stop_flow(self, admin_client):
        payload = {
            "active": False,
            "title": "TEST Promo",
            "body": "Iter40 test body",
            "image_url": "",
            "cta_label": "Try now",
            "cta_link": "/restaurant",
            "accent_color": "#b91c1c",
            "image_prompt": "TEST prompt",
        }
        r = admin_client.put(f"{BASE_URL}/api/admin/landing-promotion", json=payload, timeout=10)
        assert r.status_code == 200, r.text
        saved = r.json()["promotion"]
        assert saved["title"] == "TEST Promo"
        assert saved["active"] is False

        # Public should be null
        rp = requests.get(f"{BASE_URL}/api/landing-promotion", timeout=10).json()
        assert rp["promotion"] is None

        # Start
        r = admin_client.post(f"{BASE_URL}/api/admin/landing-promotion/start", timeout=10)
        assert r.status_code == 200 and r.json().get("active") is True
        rp = requests.get(f"{BASE_URL}/api/landing-promotion", timeout=10).json()
        assert rp["promotion"] is not None
        assert rp["promotion"]["title"] == "TEST Promo"
        assert "active" not in rp["promotion"]
        assert "image_prompt" not in rp["promotion"]

        # Stop
        r = admin_client.post(f"{BASE_URL}/api/admin/landing-promotion/stop", timeout=10)
        assert r.status_code == 200 and r.json().get("active") is False
        rp = requests.get(f"{BASE_URL}/api/landing-promotion", timeout=10).json()
        assert rp["promotion"] is None

    def test_admin_upload_image_then_get(self, admin_client):
        # 1x1 PNG
        png_bytes = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc\xff"
            b"\xff?\x00\x05\xfe\x02\xfe\xa75\x81\x84\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        files = {"file": ("test.png", io.BytesIO(png_bytes), "image/png")}
        r = admin_client.post(
            f"{BASE_URL}/api/admin/landing-promotion/upload-image",
            files=files,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        url = r.json()["url"]
        assert url.startswith("/api/uploads/promotions/")
        # GET should succeed
        full = f"{BASE_URL}{url}"
        rg = requests.get(full, timeout=10)
        assert rg.status_code == 200
        assert rg.content[:4] == b"\x89PNG"


# ---------------- Veg enforcement ----------------
class TestVegEnforcement:
    def test_check_veg_chicken_flagged(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/admin/restaurant/menu/check-veg",
            json={"name": "Chicken Tikka", "description": "", "category": "Starters"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_non_veg"] is True
        assert body["is_veg"] is False

    def test_check_veg_paneer_passes(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/admin/restaurant/menu/check-veg",
            json={"name": "Paneer Tikka", "description": "", "category": "Starters"},
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["is_non_veg"] is False
        assert body["is_veg"] is True

    def test_admin_save_menu_rejects_nonveg(self, admin_client):
        bad_payload = {"items": [{"id": "x1", "name": "Chicken Curry", "price": 100, "category": "Mains"}]}
        r = admin_client.put(
            f"{BASE_URL}/api/admin/restaurant/menu", json=bad_payload, timeout=10
        )
        assert r.status_code == 400, r.text
        assert "vegetarian" in r.text.lower()

    def test_public_menu_filters_nonveg(self):
        r = requests.get(f"{BASE_URL}/api/restaurant/menu", timeout=10)
        assert r.status_code == 200
        items = r.json().get("items") or r.json().get("menu") or []
        # Flatten nested if needed
        if isinstance(items, dict):
            flat = []
            for v in items.values():
                if isinstance(v, list):
                    flat.extend(v)
            items = flat
        bad_words = ("chicken", "mutton", "fish", "egg", "lamb", "beef")
        for it in items:
            name = (it.get("name") or "").lower()
            assert not any(bw in name for bw in bad_words), f"Non-veg in public menu: {name}"


# ---------------- Generate image (accept 200 or 502) ----------------
class TestGenerateImage:
    def test_menu_generate_image_nonveg_400(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/admin/restaurant/menu/generate-image",
            json={"name": "Chicken Curry", "category": "Mains", "description": ""},
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_menu_generate_image_veg_200_or_502(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/admin/restaurant/menu/generate-image",
            json={"name": "Paneer Butter Masala", "category": "Mains", "description": ""},
            timeout=60,
        )
        assert r.status_code in (200, 502), f"Unexpected: {r.status_code} {r.text}"
        if r.status_code == 200:
            url = r.json().get("url", "")
            assert "/api/uploads/menu_images/" in url, url

    def test_promo_generate_image_admin_only(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/landing-promotion/generate-image",
            json={"prompt": "test"},
            timeout=10,
        )
        assert r.status_code in (401, 403)

    def test_promo_generate_image_admin_200_or_502(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/admin/landing-promotion/generate-image",
            json={"prompt": "vegetarian thali festive"},
            timeout=60,
        )
        assert r.status_code in (200, 502), f"Unexpected: {r.status_code} {r.text}"
        if r.status_code == 200:
            url = r.json().get("url", "")
            assert "/api/uploads/promotions/" in url


# ---------------- Regression ----------------
class TestRegression:
    @pytest.mark.parametrize(
        "path",
        ["/api/restaurant/menu", "/api/restaurant/theme", "/api/restaurant/categories"],
    )
    def test_public_restaurant_endpoints(self, path):
        r = requests.get(f"{BASE_URL}{path}", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_restaurant_orders_auth(self, user_client):
        r = user_client.get(f"{BASE_URL}/api/restaurant/orders", timeout=10)
        assert r.status_code == 200
