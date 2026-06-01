"""Iter-52 backend tests:
  (a) GET /restaurant/serviceable-area public
  (b) GET/PUT /my/tiffin/preferences auth + tiffin-only gate
  (c) Admin roster generate snapshots tiffin_preferences onto daily_rosters
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

ADMIN_PHONE = "9970705391"
SUB_PHONE = "9876543210"


def _otp_login(phone: str, name: str | None = None) -> str | None:
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    if r.status_code == 429:
        return None
    assert r.status_code == 200, f"send-otp failed: {r.status_code} {r.text}"
    otp = r.json().get("dev_otp")
    if not otp:
        return None
    payload = {"phone": phone, "otp": otp}
    if name:
        payload["name"] = name
    rv = requests.post(f"{API}/auth/verify-otp", json=payload, timeout=15)
    assert rv.status_code == 200, f"verify-otp failed: {rv.status_code} {rv.text}"
    j = rv.json()
    return j.get("session_token") or j.get("token") or j.get("access_token")


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    tok = _otp_login(ADMIN_PHONE, "AdminIter52")
    if not tok:
        pytest.skip("admin token unavailable")
    return tok


@pytest.fixture(scope="module")
def sub_token():
    tok = _otp_login(SUB_PHONE, "SubIter52")
    if not tok:
        pytest.skip("subscriber token unavailable")
    return tok


def _mongo():
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
    db_name = os.environ.get("DB_NAME") or "test_database"
    return AsyncIOMotorClient(mongo_url), db_name


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ============================== (a) Serviceable area ==============================
class TestServiceableArea:
    def test_public_no_auth(self):
        r = requests.get(f"{API}/restaurant/serviceable-area", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # may be None if admin hasn't pinned, but key must exist
        assert "dispatch_lat" in body and "dispatch_lng" in body
        assert "dispatch_radius_km" in body
        # default radius is 15
        assert body["dispatch_radius_km"] == 15 or isinstance(body["dispatch_radius_km"], (int, float))


# ============================== (b) Tiffin preferences ==============================
class TestTiffinPreferences:
    def test_unauthorized_returns_401(self):
        r = requests.get(f"{API}/my/tiffin/preferences", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    @pytest.fixture(scope="class")
    def tiffin_sub(self, sub_token):
        """Insert a synthetic tiffin sub for the subscriber."""
        r = requests.get(f"{API}/auth/me", headers=_hdr(sub_token), timeout=15)
        assert r.status_code == 200
        me = r.json()
        user_id = me.get("user_id") or me.get("id")
        assert user_id

        async def _setup():
            client, db_name = _mongo()
            db = client[db_name]
            # Wipe other active subs to avoid clash
            await db.subscriptions.update_many(
                {"user_id": user_id, "status": "active"},
                {"$set": {"status": "expired"}},
            )
            now = datetime.now(timezone.utc)
            sub_id = f"sub_TEST52_{uuid.uuid4().hex[:8]}"
            doc = {
                "sub_id": sub_id,
                "user_id": user_id,
                "plan_id": "plan_TEST_iter52_tiffin",
                "plan_name": "TEST_iter52_tiffin",
                "amount_paid": 1000.0,
                "currency": "INR",
                "meals_total": 30,
                "meals_used": 0,
                "wallet_balance": 1000.0,
                "per_day_amount": 33.0,
                "start_date": now.isoformat(),
                "end_date": (now + timedelta(days=30)).isoformat(),
                "last_tick_date": now.strftime("%Y-%m-%d"),
                "paused_days": 0,
                "status": "active",
                "order_id": "order_TEST52",
                "service_type": "tiffin",
                "plan_type": "delivery",
                "category": "tiffin",
                "user_paused": False,
                "meal_window": "both",
                "created_at": now.isoformat(),
            }
            await db.subscriptions.insert_one(doc)
            client.close()
            return sub_id

        sub_id = _run(_setup())
        yield {"sub_id": sub_id, "user_id": user_id}

        async def _teardown():
            client, db_name = _mongo()
            db = client[db_name]
            await db.subscriptions.delete_many({"sub_id": sub_id})
            client.close()
        _run(_teardown())

    def test_get_defaults_all_true(self, sub_token, tiffin_sub):
        r = requests.get(f"{API}/my/tiffin/preferences", headers=_hdr(sub_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["rice"] is True
        assert body["dal"] is True
        assert body["chapati"] is True
        assert body["sabji"] is True

    def test_put_and_get_persistence_clamps_count(self, sub_token, tiffin_sub):
        # PUT with chapati_count=99 should clamp to 8
        payload = {"rice": False, "dal": True, "chapati": True, "sabji": True, "chapati_count": 99}
        r = requests.put(f"{API}/my/tiffin/preferences", json=payload, headers=_hdr(sub_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["rice"] is False
        assert body["chapati_count"] == 8, f"chapati_count not clamped: {body}"

        # GET returns the saved state
        g = requests.get(f"{API}/my/tiffin/preferences", headers=_hdr(sub_token), timeout=15)
        assert g.status_code == 200
        gb = g.json()
        assert gb["rice"] is False
        assert gb["dal"] is True
        assert gb["chapati_count"] == 8

    def test_put_in_range(self, sub_token, tiffin_sub):
        payload = {"rice": True, "dal": True, "chapati": True, "sabji": True, "chapati_count": 4}
        r = requests.put(f"{API}/my/tiffin/preferences", json=payload, headers=_hdr(sub_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["chapati_count"] == 4


class TestTiffinPrefsForDiningSub:
    @pytest.fixture(scope="class")
    def dining_sub(self, sub_token):
        """Convert sub to a dining (eat-in) sub instead of tiffin."""
        r = requests.get(f"{API}/auth/me", headers=_hdr(sub_token), timeout=15)
        assert r.status_code == 200
        user_id = r.json().get("user_id")

        async def _setup():
            client, db_name = _mongo()
            db = client[db_name]
            await db.subscriptions.update_many(
                {"user_id": user_id, "status": "active"},
                {"$set": {"status": "expired"}},
            )
            now = datetime.now(timezone.utc)
            sub_id = f"sub_TEST52d_{uuid.uuid4().hex[:8]}"
            doc = {
                "sub_id": sub_id,
                "user_id": user_id,
                "plan_id": "plan_TEST_iter52_dining",
                "plan_name": "TEST_iter52_dining",
                "amount_paid": 500.0,
                "currency": "INR",
                "meals_total": 30,
                "meals_used": 0,
                "wallet_balance": 500.0,
                "per_day_amount": 16.0,
                "start_date": now.isoformat(),
                "end_date": (now + timedelta(days=30)).isoformat(),
                "last_tick_date": now.strftime("%Y-%m-%d"),
                "paused_days": 0,
                "status": "active",
                "order_id": "order_TEST52d",
                "service_type": "dining",
                "plan_type": "kiosk",
                "category": "dining",
                "user_paused": False,
                "meal_window": "both",
                "created_at": now.isoformat(),
            }
            await db.subscriptions.insert_one(doc)
            client.close()
            return sub_id
        sub_id = _run(_setup())
        yield {"sub_id": sub_id}

        async def _teardown():
            client, db_name = _mongo()
            db = client[db_name]
            await db.subscriptions.delete_many({"sub_id": sub_id})
            client.close()
        _run(_teardown())

    def test_put_rejected_for_dining_sub(self, sub_token, dining_sub):
        payload = {"rice": True, "dal": True, "chapati": True, "sabji": True}
        r = requests.put(f"{API}/my/tiffin/preferences", json=payload, headers=_hdr(sub_token), timeout=15)
        assert r.status_code == 400, f"expected 400 for dining, got {r.status_code}: {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "tiffin" in detail


# ============================== (c) Roster snapshot ==============================
class TestRosterTiffinPrefsSnapshot:
    @pytest.fixture(scope="class")
    def tiffin_sub_with_prefs(self, sub_token):
        r = requests.get(f"{API}/auth/me", headers=_hdr(sub_token), timeout=15)
        assert r.status_code == 200
        user_id = r.json().get("user_id")
        async def _setup():
            client, db_name = _mongo()
            db = client[db_name]
            await db.subscriptions.update_many(
                {"user_id": user_id, "status": "active"},
                {"$set": {"status": "expired"}},
            )
            now = datetime.now(timezone.utc)
            sub_id = f"sub_TEST52r_{uuid.uuid4().hex[:8]}"
            doc = {
                "sub_id": sub_id,
                "user_id": user_id,
                "plan_id": "plan_TEST_iter52_tiffin_r",
                "plan_name": "TEST_iter52_tiffin_r",
                "amount_paid": 1000.0,
                "currency": "INR",
                "meals_total": 30,
                "meals_used": 0,
                "wallet_balance": 1000.0,
                "per_day_amount": 33.0,
                "start_date": now.isoformat(),
                "end_date": (now + timedelta(days=30)).isoformat(),
                "status": "active",
                "service_type": "tiffin",
                "plan_type": "delivery",
                "category": "tiffin",
                "user_paused": False,
                "meal_window": "both",
                "tiffin_preferences": {
                    "rice": False, "dal": True, "chapati": True, "sabji": False,
                    "chapati_count": 3,
                },
                "created_at": now.isoformat(),
            }
            await db.subscriptions.insert_one(doc)
            client.close()
            return {"sub_id": sub_id, "user_id": user_id}
        info = _run(_setup())
        yield info

        async def _teardown():
            client, db_name = _mongo()
            db = client[db_name]
            await db.subscriptions.delete_many({"sub_id": info["sub_id"]})
            tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
            await db.daily_rosters.delete_many({"sub_id": info["sub_id"], "date": tomorrow})
            client.close()
        _run(_teardown())

    def test_generate_snapshots_prefs(self, admin_token, tiffin_sub_with_prefs):
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
        r = requests.post(
            f"{API}/admin/delivery/generate",
            params={"date": tomorrow},
            headers=_hdr(admin_token),
            timeout=30,
        )
        assert r.status_code == 200, f"generate failed: {r.status_code} {r.text}"

        # Read the roster doc directly from mongo
        sub_id = tiffin_sub_with_prefs["sub_id"]
        async def _check():
            client, db_name = _mongo()
            db = client[db_name]
            docs = await db.daily_rosters.find(
                {"sub_id": sub_id, "date": tomorrow}, {"_id": 0}
            ).to_list(10)
            client.close()
            return docs
        docs = _run(_check())
        assert docs, f"no roster docs created for sub {sub_id} on {tomorrow}"
        for d in docs:
            prefs = d.get("tiffin_preferences")
            assert prefs is not None, f"tiffin_preferences missing on roster doc: {d}"
            assert prefs.get("rice") is False
            assert prefs.get("chapati_count") == 3
