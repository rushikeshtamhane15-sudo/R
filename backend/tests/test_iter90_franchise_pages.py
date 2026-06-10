"""iter-90 — Backend tests for franchise page-access endpoints.

Covers:
* GET  /api/admin/franchise/pages-catalog        (admin-only, 21 entries)
* GET  /api/admin/messes/{id}/franchise-pages    (defaults to all 21 when null)
* PATCH /api/admin/messes/{id}/franchise-pages   (subset save + invalid rejection)
* GET  /api/franchise/me/visible-pages           (admin → all 21; franchise → mess list)

Seeds ephemeral admin + franchise_owner sessions directly in Mongo
(avoids OTP rate-limit). Restores original franchise_visible_pages
state after the run.
"""
import os
import time
import uuid

import pymongo
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
MESS_ID = "efoodcare-amravati"
EXPECTED_CATALOG_SIZE = 21


# ── Shared mongo / session fixtures ────────────────────────────────────────

@pytest.fixture(scope="module")
def mongo():
    client = pymongo.MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module", autouse=True)
def original_pages(mongo):
    """Snapshot the mess's franchise_visible_pages so we can restore it.
    autouse=True so the snapshot is captured at module setup (before any test
    mutates it), then yielded to TestZRestore via the same module-scope
    instance."""
    doc = mongo.messes.find_one({"mess_id": MESS_ID}, {"franchise_visible_pages": 1})
    snap = doc.get("franchise_visible_pages") if doc else None
    yield snap
    # Module teardown safety net — restore even if explicit restore test was skipped.
    mongo.messes.update_one(
        {"mess_id": MESS_ID},
        {"$set": {"franchise_visible_pages": snap}},
    )


@pytest.fixture(scope="module")
def admin_session(mongo):
    user_id = f"TEST_IT90_admin_{uuid.uuid4().hex[:6]}"
    token = f"TEST_IT90_admin_sess_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@example.com",
        "name": "Iter90 Admin",
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
    """Make a NEW franchise owner pinned to MESS_ID, leaving the original
    owner_user_id alone (we set owner_user_id BACK after run)."""
    user_id = f"TEST_IT90_fr_{uuid.uuid4().hex[:6]}"
    token = f"TEST_IT90_fr_sess_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@example.com",
        "name": "Iter90 Franchise",
        "role": "franchise_owner",
        "mess_id": MESS_ID,
        "created_at": "2026-01-15T00:00:00Z",
    })
    mongo.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": "2099-01-01T00:00:00Z",
        "created_at": "2026-01-15T00:00:00Z",
    })
    # Snapshot real owner so we can restore.
    real_owner = mongo.messes.find_one({"mess_id": MESS_ID}, {"owner_user_id": 1}).get("owner_user_id")
    mongo.messes.update_one({"mess_id": MESS_ID}, {"$set": {"owner_user_id": user_id}})
    yield {"user_id": user_id, "token": token}
    mongo.messes.update_one({"mess_id": MESS_ID}, {"$set": {"owner_user_id": real_owner}})
    mongo.users.delete_one({"user_id": user_id})
    mongo.user_sessions.delete_one({"session_token": token})


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


# ── Catalog endpoint ───────────────────────────────────────────────────────

class TestPagesCatalog:
    def test_unauth_returns_401(self):
        r = requests.get(f"{API}/admin/franchise/pages-catalog")
        assert r.status_code in (401, 403), f"got {r.status_code} body={r.text[:200]}"

    def test_franchise_role_forbidden(self, franchise_session):
        r = requests.get(f"{API}/admin/franchise/pages-catalog", headers=_hdr(franchise_session["token"]))
        assert r.status_code == 403

    def test_admin_returns_21_entries(self, admin_session):
        r = requests.get(f"{API}/admin/franchise/pages-catalog", headers=_hdr(admin_session["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "pages" in data and isinstance(data["pages"], list)
        assert len(data["pages"]) == EXPECTED_CATALOG_SIZE, f"expected {EXPECTED_CATALOG_SIZE} got {len(data['pages'])}"
        # every entry has key + label, key starts with /admin
        for p in data["pages"]:
            assert set(p.keys()) >= {"key", "label"}
            assert p["key"].startswith("/admin"), p
            assert p["label"] and isinstance(p["label"], str)


# ── GET franchise-pages (defaults to all when null) ────────────────────────

class TestGetFranchisePages:
    def test_unauth_blocked(self):
        r = requests.get(f"{API}/admin/messes/{MESS_ID}/franchise-pages")
        assert r.status_code in (401, 403)

    def test_default_returns_all_when_null(self, admin_session, mongo):
        # Force null on the mess.
        mongo.messes.update_one({"mess_id": MESS_ID}, {"$set": {"franchise_visible_pages": None}})
        r = requests.get(f"{API}/admin/messes/{MESS_ID}/franchise-pages", headers=_hdr(admin_session["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "visible_pages" in data and "catalog" in data
        assert len(data["visible_pages"]) == EXPECTED_CATALOG_SIZE
        assert len(data["catalog"]) == EXPECTED_CATALOG_SIZE
        # visible_pages should equal catalog keys order
        assert data["visible_pages"] == [p["key"] for p in data["catalog"]]

    def test_404_for_unknown_mess(self, admin_session):
        r = requests.get(f"{API}/admin/messes/__does_not_exist__/franchise-pages", headers=_hdr(admin_session["token"]))
        assert r.status_code == 404


# ── PATCH franchise-pages ──────────────────────────────────────────────────

class TestPatchFranchisePages:
    def test_save_subset_persists(self, admin_session, mongo):
        subset = ["/admin", "/admin/users", "/admin/pnl"]
        r = requests.patch(
            f"{API}/admin/messes/{MESS_ID}/franchise-pages",
            json={"visible_pages": subset},
            headers=_hdr(admin_session["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("visible_pages") == subset
        # Verify with GET.
        g = requests.get(f"{API}/admin/messes/{MESS_ID}/franchise-pages", headers=_hdr(admin_session["token"]))
        assert g.status_code == 200
        assert g.json()["visible_pages"] == subset

    def test_invalid_key_rejected_400(self, admin_session):
        r = requests.patch(
            f"{API}/admin/messes/{MESS_ID}/franchise-pages",
            json={"visible_pages": ["/admin/users", "/admin/totally-fake"]},
            headers=_hdr(admin_session["token"]),
        )
        assert r.status_code == 400, r.text

    def test_franchise_role_cannot_patch(self, franchise_session):
        r = requests.patch(
            f"{API}/admin/messes/{MESS_ID}/franchise-pages",
            json={"visible_pages": ["/admin"]},
            headers=_hdr(franchise_session["token"]),
        )
        assert r.status_code == 403


# ── /franchise/me/visible-pages ────────────────────────────────────────────

class TestMyVisiblePages:
    def test_unauth_blocked(self):
        r = requests.get(f"{API}/franchise/me/visible-pages")
        assert r.status_code in (401, 403)

    def test_admin_returns_all_21(self, admin_session):
        r = requests.get(f"{API}/franchise/me/visible-pages", headers=_hdr(admin_session["token"]))
        assert r.status_code == 200, r.text
        assert len(r.json()["visible_pages"]) == EXPECTED_CATALOG_SIZE

    def test_franchise_returns_mess_subset(self, admin_session, franchise_session):
        # Admin sets a subset, franchise should see exactly that.
        subset = ["/admin", "/admin/control-tower", "/admin/users"]
        p = requests.patch(
            f"{API}/admin/messes/{MESS_ID}/franchise-pages",
            json={"visible_pages": subset},
            headers=_hdr(admin_session["token"]),
        )
        assert p.status_code == 200
        # tiny delay just in case
        time.sleep(0.2)
        r = requests.get(f"{API}/franchise/me/visible-pages", headers=_hdr(franchise_session["token"]))
        assert r.status_code == 200, r.text
        assert sorted(r.json()["visible_pages"]) == sorted(subset)


# ── Restore mess state (run last) ──────────────────────────────────────────

class TestZRestore:
    """Class name starts with Z so pytest runs it after the above by name order."""

    def test_restore_all_pages(self, admin_session, mongo, original_pages):
        # Whatever was there originally — put it back. If null, leave it null
        # so the mess defaults to "all 21 visible".
        mongo.messes.update_one(
            {"mess_id": MESS_ID},
            {"$set": {"franchise_visible_pages": original_pages}},
        )
        doc = mongo.messes.find_one({"mess_id": MESS_ID}, {"franchise_visible_pages": 1})
        assert doc.get("franchise_visible_pages") == original_pages
