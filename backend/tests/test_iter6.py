"""Iteration 6: photo_url profile field + payments/order requires it + wallet works without sub."""
import os
import uuid
import asyncio
import requests
import pytest
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _iso(d):
    return d.isoformat()


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


async def _mk_sub_session(with_profile=False, with_photo=False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    uid = f"user_TEST_iter6_{uuid.uuid4().hex[:8]}"
    token = f"sess_TEST_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": uid,
        "email": f"TEST_{uid}@e.com",
        "phone": None,
        "name": "Test Sub" if with_profile else "",
        "role": "subscriber",
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "wallet_balance": 0.0,
        "created_at": _iso(now),
    }
    if with_profile:
        doc["name"] = "Test Sub"
        doc["phone"] = "9999999999"
        doc["address"] = "123 Test Lane"
    if with_photo:
        doc["photo_url"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
    await db.users.insert_one(doc)
    await db.user_sessions.insert_one({
        "session_token": token, "user_id": uid,
        "expires_at": _iso(now + timedelta(days=1)),
        "created_at": _iso(now),
    })
    client.close()
    return uid, token


async def _cleanup(uid):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await db.users.delete_many({"user_id": uid})
    await db.user_sessions.delete_many({"user_id": uid})
    client.close()


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ----- /auth/profile photo_url -----
class TestProfilePhotoUrl:
    def test_profile_accepts_and_persists_photo_url(self, api):
        uid, tok = _run(_mk_sub_session())
        try:
            small_data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZsZB7sAAAAASUVORK5CYII="
            r = api.post(f"{API}/auth/profile",
                         json={"name": "John", "phone": "9876543210", "address": "1 Some Lane",
                               "photo_url": small_data_url},
                         headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200, r.text
            data = r.json()
            assert data.get("ok") is True
            assert data["user"]["photo_url"] == small_data_url
            assert data["user"]["name"] == "John"

            r = api.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200
            # auth/me uses User model which doesn't include photo_url field
            # but the underlying doc must have it (verified above via /profile response)
        finally:
            _run(_cleanup(uid))

    def test_profile_rejects_oversized_photo(self, api):
        uid, tok = _run(_mk_sub_session())
        try:
            big = "data:image/png;base64," + ("A" * 1_300_000)
            r = api.post(f"{API}/auth/profile",
                         json={"name": "J", "phone": "9876543210", "address": "x",
                               "photo_url": big},
                         headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 413, r.text
        finally:
            _run(_cleanup(uid))


# ----- /payments/order profile completeness -----
class TestPaymentsOrderRequiresPhoto:
    def test_missing_photo_returns_400_with_message(self, api):
        uid, tok = _run(_mk_sub_session(with_profile=True, with_photo=False))
        try:
            r = api.post(f"{API}/payments/order",
                         json={"plan_id": "premium_60"},
                         headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 400, r.text
            assert "photo_url" in r.json().get("detail", "")
            assert "Profile incomplete" in r.json().get("detail", "")
        finally:
            _run(_cleanup(uid))

    def test_with_all_4_fields_proceeds(self, api):
        uid, tok = _run(_mk_sub_session(with_profile=True, with_photo=True))
        try:
            r = api.post(f"{API}/payments/order",
                         json={"plan_id": "premium_60"},
                         headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200, r.text
            d = r.json()
            assert d.get("mock") is True
            assert d.get("amount_paise") == 280000
            assert "order_id" in d
        finally:
            _run(_cleanup(uid))


# ----- /my/wallet works without subscription -----
class TestWalletNoSubscription:
    def test_wallet_returns_zero_for_user_without_sub(self, api):
        uid, tok = _run(_mk_sub_session())
        try:
            r = api.get(f"{API}/my/wallet", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200, r.text
            d = r.json()
            assert d.get("wallet_balance") == 0
            assert d.get("subscription") is None
            assert d.get("per_day_amount") == 0
        finally:
            _run(_cleanup(uid))

    def test_wallet_txns_returns_empty_for_user_without_sub(self, api):
        uid, tok = _run(_mk_sub_session())
        try:
            r = api.get(f"{API}/my/wallet/transactions",
                        headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200
            assert r.json().get("transactions") == []
        finally:
            _run(_cleanup(uid))


# ----- Iter 1-5 quick regression smoke -----
class TestRegression:
    def test_theme(self, api):
        r = api.get(f"{API}/theme")
        assert r.status_code == 200
        # primary may have been overridden by admin tests; just verify shape
        assert "primary" in r.json()["tokens"]

    def test_content_footer(self, api):
        r = api.get(f"{API}/content/footer")
        assert r.status_code == 200
        assert "efoodcare.in" in r.json()["copyright"]

    def test_plans(self, api):
        r = api.get(f"{API}/plans")
        assert r.status_code == 200
        plans = r.json()["plans"]
        assert any(p["plan_id"] == "premium_60" for p in plans)

    def test_send_otp_dev(self, api):
        r = api.post(f"{API}/auth/send-otp", json={"phone": "9999000099"})
        assert r.status_code == 200
        assert r.json().get("dev_mode") is True
        assert "dev_otp" in r.json()

    def test_menu_today(self, api):
        r = api.get(f"{API}/menu/today")
        assert r.status_code == 200
        assert "lunch_items" in r.json()

    def test_stats_today(self, api):
        r = api.get(f"{API}/stats/today")
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "lunch", "dinner", "date"):
            assert k in d

    def test_counter_qr_public(self, api):
        r = api.get(f"{API}/counter/qr/public", params={"meal": "lunch", "location": "main"})
        assert r.status_code == 200
        assert "counter_code" in r.json()
