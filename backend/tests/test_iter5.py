"""Iteration 5: site content endpoints + theme defaults regression."""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _iso(d):
    return d.isoformat()


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


async def _mk_admin_session():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    uid = f"user_TEST_admin_{uuid.uuid4().hex[:8]}"
    token = f"sess_TEST_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    await db.users.insert_one({
        "user_id": uid, "email": f"TEST_{uid}@e.com", "phone": None,
        "name": "Test Admin", "role": "admin",
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "created_at": _iso(now),
    })
    await db.user_sessions.insert_one({
        "session_token": token, "user_id": uid,
        "expires_at": _iso(now + timedelta(days=1)),
        "created_at": _iso(now),
    })
    client.close()
    return uid, token


async def _mk_sub_session():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    uid = f"user_TEST_sub_{uuid.uuid4().hex[:8]}"
    token = f"sess_TEST_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    await db.users.insert_one({
        "user_id": uid, "email": f"TEST_{uid}@e.com", "phone": None,
        "name": "Test Sub", "role": "subscriber",
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "created_at": _iso(now),
    })
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


# ---------------- Content GETs (public) ----------------
class TestPublicContent:
    def test_footer(self, api):
        r = api.get(f"{API}/content/footer")
        assert r.status_code == 200
        d = r.json()
        assert d.get("copyright") == "copyright © efoodcare.in all rights reserved"
        assert d.get("tagline") == "ghar se achha khana"

    def test_privacy(self, api):
        r = api.get(f"{API}/content/privacy")
        assert r.status_code == 200
        d = r.json()
        assert d.get("title") == "Privacy Policy"
        assert isinstance(d.get("body"), str) and len(d["body"]) > 0

    def test_refund(self, api):
        r = api.get(f"{API}/content/refund")
        assert r.status_code == 200
        d = r.json()
        assert d.get("title") == "Refund Policy"
        assert isinstance(d.get("body"), str) and len(d["body"]) > 0

    def test_contact(self, api):
        r = api.get(f"{API}/content/contact")
        assert r.status_code == 200
        d = r.json()
        for k in ["title", "company", "address", "phone", "email", "hours", "map_embed_src"]:
            assert k in d, f"missing {k}"
        assert "google.com/maps" in d["map_embed_src"]

    def test_landing(self, api):
        r = api.get(f"{API}/content/landing")
        assert r.status_code == 200
        d = r.json()
        for k in ["hero_overline", "hero_title_line1", "hero_title_line2", "hero_subtitle",
                  "hero_cta_primary", "hero_cta_secondary", "hero_image_url", "sections"]:
            assert k in d, f"missing {k}"
        assert isinstance(d["sections"], list)

    def test_unknown_key_404(self, api):
        r = api.get(f"{API}/content/does_not_exist")
        assert r.status_code == 404


# ---------------- Content admin ops ----------------
class TestAdminContent:
    def test_update_requires_admin_and_persists(self, api):
        loop = asyncio.new_event_loop()
        admin_uid, admin_tok = loop.run_until_complete(_mk_admin_session())
        sub_uid, sub_tok = loop.run_until_complete(_mk_sub_session())
        try:
            # subscriber → 403
            r = api.post(f"{API}/admin/content/privacy",
                         json={"data": {"body": "X"}},
                         headers={"Authorization": f"Bearer {sub_tok}"})
            assert r.status_code == 403

            # admin → 200 merges
            unique_body = f"TEST_BODY_{uuid.uuid4().hex[:6]}"
            r = api.post(f"{API}/admin/content/privacy",
                         json={"data": {"body": unique_body}},
                         headers={"Authorization": f"Bearer {admin_tok}"})
            assert r.status_code == 200, r.text
            merged = r.json()
            assert merged["body"] == unique_body
            assert merged.get("title") == "Privacy Policy"  # preserved (merge)

            # subsequent GET reflects
            r = api.get(f"{API}/content/privacy")
            assert r.status_code == 200
            assert r.json()["body"] == unique_body

            # unknown key → 400
            r = api.post(f"{API}/admin/content/nope",
                         json={"data": {"x": 1}},
                         headers={"Authorization": f"Bearer {admin_tok}"})
            assert r.status_code == 400

            # reset restores defaults
            r = api.post(f"{API}/admin/content/privacy/reset",
                         headers={"Authorization": f"Bearer {admin_tok}"})
            assert r.status_code == 200
            assert r.json()["body"].startswith("Add your privacy policy")

            # reset unknown → 400
            r = api.post(f"{API}/admin/content/nope/reset",
                         headers={"Authorization": f"Bearer {admin_tok}"})
            assert r.status_code == 400
        finally:
            loop.run_until_complete(_cleanup(admin_uid))
            loop.run_until_complete(_cleanup(sub_uid))
            loop.close()


# ---------------- Theme regression (iter5 new defaults) ----------------
class TestThemeDefaults:
    def test_theme_new_defaults(self, api):
        r = api.get(f"{API}/theme")
        assert r.status_code == 200
        d = r.json()
        tokens = d.get("tokens", {})
        assert tokens.get("primary") == "142 50% 35%"
        assert tokens.get("foreground") == "220 55% 22%"

    def test_theme_reset_returns_new_defaults(self, api):
        loop = asyncio.new_event_loop()
        admin_uid, admin_tok = loop.run_until_complete(_mk_admin_session())
        try:
            r = api.post(f"{API}/admin/theme/reset",
                         headers={"Authorization": f"Bearer {admin_tok}"})
            assert r.status_code == 200
            d = r.json()
            assert d["tokens"]["primary"] == "142 50% 35%"
            assert d["tokens"]["foreground"] == "220 55% 22%"
        finally:
            loop.run_until_complete(_cleanup(admin_uid))
            loop.close()
