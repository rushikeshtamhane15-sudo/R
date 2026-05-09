"""iter24 — Server-backed notification preferences (sound/voice).

Endpoints under test:
  GET  /api/auth/prefs   → defaults {sound:true, voice:true}
  POST /api/auth/prefs   → persists per-user prefs, idempotent
"""
import os
import uuid
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = ""
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"

try:
    with open("/app/frontend/.env") as fh:
        for ln in fh:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.strip().split("=", 1)[1].strip('"').strip("'").rstrip("/")
except Exception:
    pass

try:
    with open("/app/backend/.env") as fh:
        for ln in fh:
            if ln.startswith("DB_NAME="):
                DB_NAME = ln.strip().split("=", 1)[1].strip('"').strip("'")
            if ln.startswith("MONGO_URL="):
                MONGO_URL = ln.strip().split("=", 1)[1].strip('"').strip("'")
except Exception:
    pass


def _seed_user(role="subscriber"):
    from datetime import datetime, timezone, timedelta
    user_id = f"u_TEST_{uuid.uuid4().hex[:10]}"
    token = f"sess_TEST_{uuid.uuid4().hex[:14]}"
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    now = datetime.now(timezone.utc)

    async def _do():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.users.replace_one(
            {"user_id": user_id},
            {
                "user_id": user_id, "phone": phone, "role": role,
                "name": f"TEST_{role}_{user_id[-4:]}", "wallet_balance": 0,
                "qr_token": f"qr_TEST_{uuid.uuid4().hex[:8]}",
                "created_at": now.isoformat(),
            },
            upsert=True,
        )
        await db.user_sessions.insert_one({
            "session_token": token, "user_id": user_id,
            "created_at": now.isoformat(), "expires_at": (now + timedelta(days=1)).isoformat(),
        })
        client.close()

    asyncio.run(_do())
    return user_id, token, phone


def _cleanup():
    async def _do():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.users.delete_many({"name": {"$regex": "^TEST_"}})
        await db.user_sessions.delete_many({"session_token": {"$regex": "^sess_TEST_"}})
        client.close()
    asyncio.run(_do())


@pytest.fixture(scope="module", autouse=True)
def _module_setup():
    assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
    yield
    _cleanup()


@pytest.fixture
def authed():
    user_id, token, phone = _seed_user()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return {"session": s, "user_id": user_id, "token": token, "phone": phone}


# -------------------- GET defaults --------------------
class TestPrefsDefaults:
    def test_unauth_get_returns_401_or_403(self):
        r = requests.get(f"{BASE_URL}/api/auth/prefs")
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text}"

    def test_unauth_post_returns_401_or_403(self):
        r = requests.post(f"{BASE_URL}/api/auth/prefs", json={"sound": False})
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text}"

    def test_default_prefs_for_new_user(self, authed):
        r = authed["session"].get(f"{BASE_URL}/api/auth/prefs")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data == {"sound": True, "voice": True}, f"Defaults wrong: {data}"


# -------------------- POST update + persistence --------------------
class TestPrefsPersistence:
    def test_post_sound_false_persists(self, authed):
        s = authed["session"]
        r = s.post(f"{BASE_URL}/api/auth/prefs", json={"sound": False})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("sound") is False
        assert body.get("voice") is True  # unchanged default

        # GET to verify persistence
        r2 = s.get(f"{BASE_URL}/api/auth/prefs")
        assert r2.status_code == 200
        assert r2.json() == {"sound": False, "voice": True}

    def test_post_voice_false_only_updates_voice(self, authed):
        s = authed["session"]
        # First set sound:false
        s.post(f"{BASE_URL}/api/auth/prefs", json={"sound": False})
        # Now set voice:false (sound should stay false)
        r = s.post(f"{BASE_URL}/api/auth/prefs", json={"voice": False})
        assert r.status_code == 200
        body = r.json()
        assert body.get("sound") is False, "sound should be preserved across partial update"
        assert body.get("voice") is False

        r2 = s.get(f"{BASE_URL}/api/auth/prefs")
        assert r2.json() == {"sound": False, "voice": False}

    def test_idempotent_setting_same_value_twice(self, authed):
        s = authed["session"]
        r1 = s.post(f"{BASE_URL}/api/auth/prefs", json={"sound": False})
        r2 = s.post(f"{BASE_URL}/api/auth/prefs", json={"sound": False})
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json().get("sound") is False

    def test_toggle_back_to_true(self, authed):
        s = authed["session"]
        s.post(f"{BASE_URL}/api/auth/prefs", json={"sound": False})
        r = s.post(f"{BASE_URL}/api/auth/prefs", json={"sound": True})
        assert r.status_code == 200
        assert r.json().get("sound") is True
        assert s.get(f"{BASE_URL}/api/auth/prefs").json() == {"sound": True, "voice": True}

    def test_per_user_isolation(self):
        # Two different users should not share prefs
        u1 = _seed_user()
        u2 = _seed_user()
        s1 = requests.Session(); s1.headers.update({"Authorization": f"Bearer {u1[1]}"})
        s2 = requests.Session(); s2.headers.update({"Authorization": f"Bearer {u2[1]}"})

        s1.post(f"{BASE_URL}/api/auth/prefs", json={"sound": False, "voice": False})

        # u1 reflects change
        assert s1.get(f"{BASE_URL}/api/auth/prefs").json() == {"sound": False, "voice": False}
        # u2 still defaults
        assert s2.get(f"{BASE_URL}/api/auth/prefs").json() == {"sound": True, "voice": True}
