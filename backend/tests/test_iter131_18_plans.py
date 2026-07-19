"""iter-131.18 — admin plan bullets v2, hero image upload, tiffin dashboard.

Backend coverage:
  * PlanUpsert accepts features_override_v2 / features_extra_v2 (list of
    {icon, text}). Invalid icons coerce to `check`, empty text dropped.
  * POST /admin/plans/{id}/hero-image — multipart upload, returns
    hero_image_url data-URL. Rejects >3MB (413) and non-image mime (400).
  * POST /admin/plans/{id}/hero-image/reset clears hero_image_url.
  * GET /api/plans exposes hero_image_url + v2 fields.
  * Both hero endpoints reject non-admin with 403.
"""
import io
import os

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_PHONE = "9000000000"
SUB_PHONE = "8888888888"


def _login(phone: str) -> str:
    s = requests.Session()
    r = s.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, r.text
    otp = r.json().get("dev_otp")
    assert otp, f"dev_otp missing: {r.text}"
    r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": "Test"}, timeout=15)
    assert r.status_code == 200, r.text
    token = s.cookies.get("session_token")
    assert token
    return token


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_PHONE)


@pytest.fixture(scope="module")
def sub_token():
    return _login(SUB_PHONE)


@pytest.fixture(scope="module")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}"})
    return s


@pytest.fixture(scope="module")
def sub_client(sub_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {sub_token}"})
    return s


@pytest.fixture(scope="module")
def test_plan(admin_client):
    """Create a throwaway plan we can safely mutate."""
    payload = {
        "plan_id": None,
        "name": "TEST_iter131_18",
        "description": "throwaway test plan",
        "amount": 100.0,
        "duration_days": 7,
        "meals": 14,
        "active": True,
        "sort_order": 999,
        "category": "tiffin",
        "meal_window": "both",
    }
    r = admin_client.post(f"{API}/admin/plans", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    plan = r.json()["plan"]
    yield plan
    # cleanup
    admin_client.delete(f"{API}/admin/plans/{plan['plan_id']}", timeout=15)


class TestBulletsV2:
    def test_upsert_features_override_v2_valid(self, admin_client, test_plan):
        payload = {
            "plan_id": test_plan["plan_id"],
            "name": test_plan["name"],
            "description": test_plan["description"],
            "amount": test_plan["amount"],
            "duration_days": test_plan["duration_days"],
            "meals": test_plan["meals"],
            "active": True,
            "sort_order": 999,
            "category": "tiffin",
            "features_override_v2": [
                {"icon": "leaf", "text": "100% pure veg"},
                {"icon": "clock", "text": "30-min delivery"},
            ],
            "features_extra_v2": [{"icon": "star", "text": "most popular"}],
        }
        r = admin_client.post(f"{API}/admin/plans", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        plan = r.json()["plan"]
        assert plan["features_override_v2"] == [
            {"icon": "leaf", "text": "100% pure veg"},
            {"icon": "clock", "text": "30-min delivery"},
        ]
        assert plan["features_extra_v2"] == [{"icon": "star", "text": "most popular"}]

    def test_invalid_icon_coerced_to_check(self, admin_client, test_plan):
        payload = {
            "plan_id": test_plan["plan_id"],
            "name": test_plan["name"], "description": "x",
            "amount": 100.0, "duration_days": 7, "meals": 14,
            "features_override_v2": [
                {"icon": "invalid_icon", "text": "bad"},
                {"icon": "LEAF", "text": "case ok"},
                {"icon": "check", "text": ""},          # empty text — dropped
                {"icon": "star", "text": "   "},       # whitespace only — dropped
            ],
        }
        r = admin_client.post(f"{API}/admin/plans", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()["plan"]["features_override_v2"]
        assert rows == [{"icon": "check", "text": "bad"}, {"icon": "leaf", "text": "case ok"}]

    def test_public_get_plans_exposes_v2_fields(self, test_plan):
        r = requests.get(f"{API}/plans", timeout=15)
        assert r.status_code == 200
        plans = r.json()["plans"]
        p = next((x for x in plans if x["plan_id"] == test_plan["plan_id"]), None)
        assert p, "test plan missing from /api/plans"
        assert "features_override_v2" in p
        assert "features_extra_v2" in p
        assert "hero_image_url" in p


class TestHeroImage:
    def _tiny_jpg(self) -> bytes:
        # Try Pillow (already used by image_optim). Fallback to minimal JPEG.
        try:
            from PIL import Image
            buf = io.BytesIO()
            Image.new("RGB", (4, 4), (255, 0, 0)).save(buf, format="JPEG")
            return buf.getvalue()
        except Exception:
            return bytes.fromhex(
                "ffd8ffe000104a46494600010100000100010000ffdb0043000806060706"
                "0506080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c"
                "20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432"
                "ffc0000b0800040004010111ffc4001f0000010501010101010100000000"
                "00000000010203040506070809ffda0008010100003f00fbd0ffd9"
            )

    def test_upload_hero_image_success(self, admin_client, test_plan):
        files = {"file": ("test.jpg", self._tiny_jpg(), "image/jpeg")}
        r = admin_client.post(
            f"{API}/admin/plans/{test_plan['plan_id']}/hero-image",
            files=files, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["plan_id"] == test_plan["plan_id"]
        assert body["hero_image_url"].startswith("data:image/")
        assert body["bytes"] > 0

        # Verify persistence via GET /api/plans
        r2 = requests.get(f"{API}/plans", timeout=15)
        p = next((x for x in r2.json()["plans"] if x["plan_id"] == test_plan["plan_id"]), None)
        assert p and (p.get("hero_image_url") or "").startswith("data:image/")

    def test_upload_rejects_bad_mime(self, admin_client, test_plan):
        files = {"file": ("test.txt", b"hello", "text/plain")}
        r = admin_client.post(
            f"{API}/admin/plans/{test_plan['plan_id']}/hero-image",
            files=files, timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_upload_rejects_oversize(self, admin_client, test_plan):
        oversize = b"x" * (3 * 1024 * 1024 + 100)
        files = {"file": ("big.jpg", oversize, "image/jpeg")}
        r = admin_client.post(
            f"{API}/admin/plans/{test_plan['plan_id']}/hero-image",
            files=files, timeout=30,
        )
        assert r.status_code == 413, r.text

    def test_reset_hero_image(self, admin_client, test_plan):
        r = admin_client.post(
            f"{API}/admin/plans/{test_plan['plan_id']}/hero-image/reset", timeout=15
        )
        assert r.status_code == 200, r.text
        assert r.json()["hero_image_url"] is None
        # Verify GET reflects
        r2 = requests.get(f"{API}/plans", timeout=15)
        p = next((x for x in r2.json()["plans"] if x["plan_id"] == test_plan["plan_id"]), None)
        assert p and p.get("hero_image_url") in (None, "")


class TestHeroImageAuth:
    def test_upload_non_admin_forbidden(self, sub_client, test_plan):
        files = {"file": ("t.jpg", b"\xff\xd8\xff", "image/jpeg")}
        r = sub_client.post(
            f"{API}/admin/plans/{test_plan['plan_id']}/hero-image",
            files=files, timeout=15,
        )
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_reset_non_admin_forbidden(self, sub_client, test_plan):
        r = sub_client.post(
            f"{API}/admin/plans/{test_plan['plan_id']}/hero-image/reset", timeout=15
        )
        assert r.status_code == 403
