"""iter-91 — Backend tests for franchise-sections endpoints.

Covers:
* GET   /api/admin/messes/{id}/franchise-sections   (admin-only, catalog=6)
* PATCH /api/admin/messes/{id}/franchise-sections   (subset save + invalid rejection)
* GET   /api/franchise/me/visible-sections           (regression)

Seeds ephemeral admin + franchise_owner sessions directly in Mongo,
restores franchise_visible_sections after the run.
"""
import os
import uuid

import pymongo
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
MESS_ID = "efoodcare-amravati"
EXPECTED_CATALOG = 6
EXPECTED_KEYS = {"subscribers", "revenue_sub", "revenue_ord", "checkins", "capacity", "utilization"}


@pytest.fixture(scope="module")
def mongo():
    client = pymongo.MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module", autouse=True)
def original_sections(mongo):
    doc = mongo.messes.find_one({"mess_id": MESS_ID}, {"franchise_visible_sections": 1})
    snap = doc.get("franchise_visible_sections") if doc else None
    yield snap
    mongo.messes.update_one(
        {"mess_id": MESS_ID},
        {"$set": {"franchise_visible_sections": snap}},
    )


@pytest.fixture(scope="module")
def admin_session(mongo):
    user_id = f"TEST_IT91_admin_{uuid.uuid4().hex[:6]}"
    token = f"TEST_IT91_admin_sess_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@example.com",
        "name": "Iter91 Admin",
        "role": "admin",
        "created_at": "2026-01-15T00:00:00Z",
    })
    mongo.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": "2099-01-01T00:00:00Z",
        "created_at": "2026-01-15T00:00:00Z",
    })
    yield {"user_id": user_id, "token": token}
    mongo.users.delete_one({"user_id": user_id})
    mongo.user_sessions.delete_one({"session_token": token})


@pytest.fixture(scope="module")
def franchise_session(mongo):
    user_id = f"TEST_IT91_fr_{uuid.uuid4().hex[:6]}"
    token = f"TEST_IT91_fr_sess_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@example.com",
        "name": "Iter91 Franchise",
        "role": "franchise_owner",
        "mess_id": MESS_ID,
        "phone": "9000091910",
        "address": "Test 1",
        "created_at": "2026-01-15T00:00:00Z",
    })
    mongo.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": "2099-01-01T00:00:00Z",
        "created_at": "2026-01-15T00:00:00Z",
    })
    real_owner = mongo.messes.find_one({"mess_id": MESS_ID}, {"owner_user_id": 1}).get("owner_user_id")
    mongo.messes.update_one({"mess_id": MESS_ID}, {"$set": {"owner_user_id": user_id}})
    yield {"user_id": user_id, "token": token}
    mongo.messes.update_one({"mess_id": MESS_ID}, {"$set": {"owner_user_id": real_owner}})
    mongo.users.delete_one({"user_id": user_id})
    mongo.user_sessions.delete_one({"session_token": token})


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


# ── GET /admin/messes/{id}/franchise-sections ──────────────────────────────

class TestGetFranchiseSections:
    def test_unauth_blocked(self):
        r = requests.get(f"{API}/admin/messes/{MESS_ID}/franchise-sections")
        assert r.status_code in (401, 403), f"got {r.status_code}: {r.text[:200]}"

    def test_franchise_role_forbidden(self, franchise_session):
        r = requests.get(
            f"{API}/admin/messes/{MESS_ID}/franchise-sections",
            headers=_hdr(franchise_session["token"]),
        )
        assert r.status_code == 403

    def test_admin_default_returns_all_6_when_null(self, admin_session, mongo):
        mongo.messes.update_one({"mess_id": MESS_ID}, {"$set": {"franchise_visible_sections": None}})
        r = requests.get(
            f"{API}/admin/messes/{MESS_ID}/franchise-sections",
            headers=_hdr(admin_session["token"]),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "visible_sections" in data and "catalog" in data
        assert len(data["catalog"]) == EXPECTED_CATALOG
        # every catalog entry has key+label
        for s in data["catalog"]:
            assert set(s.keys()) >= {"key", "label"}
            assert s["key"] in EXPECTED_KEYS
            assert isinstance(s["label"], str) and s["label"]
        # visible_sections defaults to all 6 keys
        assert set(data["visible_sections"]) == EXPECTED_KEYS

    def test_404_for_unknown_mess(self, admin_session):
        r = requests.get(
            f"{API}/admin/messes/__nope__/franchise-sections",
            headers=_hdr(admin_session["token"]),
        )
        assert r.status_code == 404


# ── PATCH /admin/messes/{id}/franchise-sections ────────────────────────────

class TestPatchFranchiseSections:
    def test_save_subset_persists(self, admin_session):
        subset = ["subscribers", "revenue_ord", "checkins", "utilization"]
        r = requests.patch(
            f"{API}/admin/messes/{MESS_ID}/franchise-sections",
            json={"visible_sections": subset},
            headers=_hdr(admin_session["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("visible_sections") == subset
        # Verify with GET
        g = requests.get(
            f"{API}/admin/messes/{MESS_ID}/franchise-sections",
            headers=_hdr(admin_session["token"]),
        )
        assert g.status_code == 200
        assert g.json()["visible_sections"] == subset

    def test_invalid_key_rejected_400(self, admin_session):
        r = requests.patch(
            f"{API}/admin/messes/{MESS_ID}/franchise-sections",
            json={"visible_sections": ["subscribers", "bogus_section"]},
            headers=_hdr(admin_session["token"]),
        )
        assert r.status_code == 400, r.text

    def test_franchise_role_cannot_patch(self, franchise_session):
        r = requests.patch(
            f"{API}/admin/messes/{MESS_ID}/franchise-sections",
            json={"visible_sections": ["subscribers"]},
            headers=_hdr(franchise_session["token"]),
        )
        assert r.status_code == 403


# ── /franchise/me/visible-sections ────────────────────────────────────────

class TestMyVisibleSections:
    def test_unauth_blocked(self):
        r = requests.get(f"{API}/franchise/me/visible-sections")
        assert r.status_code in (401, 403)

    def test_franchise_returns_subset(self, admin_session, franchise_session):
        subset = ["subscribers", "checkins"]
        p = requests.patch(
            f"{API}/admin/messes/{MESS_ID}/franchise-sections",
            json={"visible_sections": subset},
            headers=_hdr(admin_session["token"]),
        )
        assert p.status_code == 200
        r = requests.get(
            f"{API}/franchise/me/visible-sections",
            headers=_hdr(franchise_session["token"]),
        )
        assert r.status_code == 200, r.text
        assert sorted(r.json()["visible_sections"]) == sorted(subset)


# ── Restore (run last) ─────────────────────────────────────────────────────

class TestZRestore:
    def test_restore_state(self, mongo, original_sections):
        mongo.messes.update_one(
            {"mess_id": MESS_ID},
            {"$set": {"franchise_visible_sections": original_sections}},
        )
        doc = mongo.messes.find_one({"mess_id": MESS_ID}, {"franchise_visible_sections": 1})
        assert doc.get("franchise_visible_sections") == original_sections
