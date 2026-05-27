"""Iter-51 backend tests.

Covers:
  - Plan CRUD with new fields: category + meal_window
  - /admin/content/login accepting marquee_* keys (free-form merge)
  - /admin/landing/upload-image multipart endpoint (auth + happy-path)
  - /attendance/scan meal_window enforcement (lunch-only plan rejects dinner scan)
  - routes/restaurant.py — 402 budget-exhausted code-path inspection (static)
"""
from __future__ import annotations

import io
import os
import uuid
import asyncio

import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

ADMIN_PHONE = "9970705391"
SUB_PHONE = "9876543210"


# ------------- helpers -------------
def _otp_login(phone: str, name: str | None = None) -> str | None:
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    if r.status_code == 429:
        return None
    assert r.status_code == 200, f"send-otp failed: {r.status_code} {r.text}"
    otp = r.json().get("dev_otp")
    assert otp, f"no dev_otp in response: {r.text}"
    payload = {"phone": phone, "otp": otp}
    if name:
        payload["name"] = name
    rv = requests.post(f"{API}/auth/verify-otp", json=payload, timeout=15)
    assert rv.status_code == 200, f"verify-otp failed: {rv.status_code} {rv.text}"
    j = rv.json()
    return j.get("session_token") or j.get("token") or j.get("access_token")


@pytest.fixture(scope="module")
def admin_token():
    tok = _otp_login(ADMIN_PHONE, name="AdminIter51") or os.environ.get("ADMIN_SESSION_TOKEN")
    if not tok:
        pytest.skip("admin token unavailable")
    return tok


@pytest.fixture(scope="module")
def sub_token():
    tok = _otp_login(SUB_PHONE, name="SubIter51") or os.environ.get("SUB_SESSION_TOKEN")
    if not tok:
        pytest.skip("subscriber token unavailable")
    return tok


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ============== (1) Plan CRUD with category + meal_window ==============
class TestPlanBifurcation:
    created_plan_id: str | None = None

    def test_create_tiffin_dinner_plan(self, admin_token):
        payload = {
            "name": "TEST_iter51_tiffin_dinner",
            "description": "iter-51 test plan",
            "amount": 1234.0,
            "currency": "INR",
            "duration_days": 7,
            "meals": 7,
            "active": True,
            "sort_order": 999,
            "category": "tiffin",
            "meal_window": "dinner",
        }
        r = requests.post(f"{API}/admin/plans", json=payload, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
        body = r.json()
        plan = body["plan"]
        assert plan["category"] == "tiffin"
        assert plan["meal_window"] == "dinner"
        assert plan["name"] == "TEST_iter51_tiffin_dinner"
        TestPlanBifurcation.created_plan_id = plan["plan_id"]

    def test_admin_list_includes_new_plan(self, admin_token):
        pid = TestPlanBifurcation.created_plan_id
        assert pid, "no plan_id from previous test"
        r = requests.get(f"{API}/admin/plans", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        plans = r.json()["plans"]
        found = next((p for p in plans if p["plan_id"] == pid), None)
        assert found is not None, "new plan missing from admin list"
        assert found["category"] == "tiffin"
        assert found["meal_window"] == "dinner"

    def test_public_plans_includes_active_plan(self):
        pid = TestPlanBifurcation.created_plan_id
        if not pid:
            pytest.skip("create test was skipped; nothing to look up")
        r = requests.get(f"{API}/plans", timeout=15)
        assert r.status_code == 200
        plans = r.json()["plans"]
        found = next((p for p in plans if p["plan_id"] == pid), None)
        assert found is not None, "new active plan missing from public list"
        assert found.get("category") == "tiffin"
        assert found.get("meal_window") == "dinner"

    def test_delete_plan(self, admin_token):
        pid = TestPlanBifurcation.created_plan_id
        assert pid
        r = requests.delete(f"{API}/admin/plans/{pid}", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        # Confirm gone
        r2 = requests.get(f"{API}/admin/plans", headers=_hdr(admin_token), timeout=15)
        plans = r2.json()["plans"]
        assert not any(p["plan_id"] == pid for p in plans), "plan still present after delete"


# ============== (2) /admin/content/login marquee_* free-form merge ==============
class TestLoginContentMarquee:
    def test_post_marquee_keys_and_get(self, admin_token):
        body = {
            "data": {
                "marquee_bg_color": "#0066ff",
                "marquee_speed_seconds": 18,
                "marquee_pills": "NO MSG|NO SUGAR",
                "marquee_show": True,
            }
        }
        r = requests.post(f"{API}/admin/content/login", json=body, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, f"post failed: {r.status_code} {r.text}"
        merged = r.json()
        assert merged.get("marquee_bg_color") == "#0066ff"
        assert merged.get("marquee_speed_seconds") == 18
        assert merged.get("marquee_pills") == "NO MSG|NO SUGAR"

        # Public GET should return the same
        g = requests.get(f"{API}/content/login", timeout=15)
        assert g.status_code == 200
        data = g.json()
        assert data.get("marquee_bg_color") == "#0066ff"
        assert data.get("marquee_speed_seconds") == 18
        assert data.get("marquee_pills") == "NO MSG|NO SUGAR"
        assert data.get("marquee_show") is True

    def test_cleanup_marquee_overrides(self, admin_token):
        # Reset by stamping defaults (empty string for marquee keys) — keeps other content intact
        body = {
            "data": {
                "marquee_bg_color": "",
                "marquee_speed_seconds": "",
                "marquee_pills": "",
                "marquee_show": "",
            }
        }
        r = requests.post(f"{API}/admin/content/login", json=body, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200


# ============== (3) /admin/landing/upload-image multipart ==============
# Minimal valid PNG (1x1 transparent)
_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestLandingUpload:
    def test_unauth_rejected(self):
        files = {"file": ("test.png", io.BytesIO(_PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/admin/landing/upload-image", files=files, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_admin_upload_success(self, admin_token):
        files = {"file": ("test.png", io.BytesIO(_PNG_BYTES), "image/png")}
        headers = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{API}/admin/landing/upload-image", files=files, headers=headers, timeout=20)
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        body = r.json()
        assert "url" in body and body["url"].startswith("/api/uploads/landing_images/")
        assert "bytes" in body and isinstance(body["bytes"], int) and body["bytes"] > 0

    def test_bad_mime_rejected(self, admin_token):
        files = {"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")}
        headers = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{API}/admin/landing/upload-image", files=files, headers=headers, timeout=15)
        assert r.status_code == 400


# ============== (4) meal_window enforcement on /attendance/scan ==============
class TestMealWindowEnforcement:
    """Inject a synthetic subscription doc with meal_window='lunch' via direct
    mongo write (lets us test enforcement without going through the full
    Razorpay→verify→subscribe pipeline, which would need live keys).
    """
    sub_id: str | None = None
    user_id: str | None = None
    qr_token: str | None = None
    cleanup_plan_id: str | None = None

    @pytest.fixture(scope="class")
    def synthetic_sub(self, admin_token, sub_token):
        # Fetch subscriber user info to get user_id + qr_token
        r = requests.get(f"{API}/auth/me", headers=_hdr(sub_token), timeout=15)
        assert r.status_code == 200, f"me failed: {r.text}"
        me = r.json()
        user_id = me.get("user_id") or me.get("id")
        qr_token = me.get("qr_token")
        assert user_id and qr_token, f"missing user_id/qr_token: {me}"

        # Connect to mongo and write a lunch-only synthetic subscription
        import importlib, sys
        sys.path.insert(0, "/app/backend")
        from motor.motor_asyncio import AsyncIOMotorClient

        mongo_url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
        db_name = os.environ.get("DB_NAME") or "test_database"

        async def _setup():
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            # Wipe any existing active sub for this user to avoid conflict
            await db.subscriptions.update_many(
                {"user_id": user_id, "status": "active"},
                {"$set": {"status": "expired"}},
            )
            # Wipe today's attendance for this user
            from datetime import datetime, timezone, timedelta
            now = datetime.now(timezone.utc)
            future = now + timedelta(days=7)
            today = now.strftime("%Y-%m-%d")
            await db.attendance.delete_many({"user_id": user_id, "date_str": today})

            sub_id = f"sub_TEST_{uuid.uuid4().hex[:8]}"
            sub_doc = {
                "sub_id": sub_id,
                "user_id": user_id,
                "plan_id": "plan_TEST_iter51_lunch",
                "plan_name": "TEST_iter51_lunch_only",
                "amount_paid": 100.0,
                "currency": "INR",
                "meals_total": 7,
                "meals_used": 0,
                "wallet_balance": 100.0,
                "per_day_amount": 14.28,
                "start_date": now.isoformat(),
                "end_date": future.isoformat(),
                "last_tick_date": today,
                "paused_days": 0,
                "status": "active",
                "order_id": "order_TEST_iter51",
                "is_custom": False,
                "service_type": "dining",
                "plan_type": "kiosk",
                "user_paused": False,
                "meal_window": "lunch",
                "category": "dining",
                "created_at": now.isoformat(),
            }
            await db.subscriptions.insert_one(sub_doc)
            client.close()
            return sub_id

        loop = asyncio.new_event_loop()
        try:
            sub_id = loop.run_until_complete(_setup())
        finally:
            loop.close()

        TestMealWindowEnforcement.sub_id = sub_id
        TestMealWindowEnforcement.user_id = user_id
        TestMealWindowEnforcement.qr_token = qr_token

        yield {"sub_id": sub_id, "user_id": user_id, "qr_token": qr_token}

        # Teardown — purge synthetic sub + any attendance from this test
        async def _teardown():
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            await db.subscriptions.delete_many({"sub_id": sub_id})
            from datetime import datetime, timezone
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            await db.attendance.delete_many({"user_id": user_id, "date_str": today})
            client.close()

        loop2 = asyncio.new_event_loop()
        try:
            loop2.run_until_complete(_teardown())
        finally:
            loop2.close()

    def test_dinner_scan_rejected_on_lunch_only(self, admin_token, synthetic_sub):
        """A lunch-only sub scanned for dinner → 403 with explicit message."""
        body = {"qr_token": synthetic_sub["qr_token"], "meal_type": "dinner"}
        r = requests.post(f"{API}/attendance/scan", json=body, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        msg = r.json().get("detail", "")
        assert "lunch-only" in msg.lower() or "lunch only" in msg.lower(), f"unexpected detail: {msg}"

    def test_lunch_scan_succeeds_on_lunch_only(self, admin_token, synthetic_sub):
        body = {"qr_token": synthetic_sub["qr_token"], "meal_type": "lunch"}
        r = requests.post(f"{API}/attendance/scan", json=body, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        body_resp = r.json()
        assert body_resp.get("ok") is True
        assert body_resp.get("record", {}).get("meal_type") == "lunch"


# ============== (5) Static inspection of 402 budget-exhausted path ==============
def test_restaurant_route_has_402_budget_path():
    """Confirm the 402 BudgetExceeded code path exists in routes/restaurant.py."""
    p = "/app/backend/routes/restaurant.py"
    with open(p, "r") as f:
        src = f.read()
    assert "status_code=402" in src
    assert "budget has been exceeded" in src.lower()
    assert "generate-image" in src
