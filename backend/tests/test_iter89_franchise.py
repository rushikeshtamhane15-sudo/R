"""iter-89 backend tests:
1) Bottom-nav CMS now has 'franchise' role key + PUT accepts it.
2) GET /admin/users + POST /admin/role unlocked for franchise_owner
   (scoped to their branch, with FRANCHISE_ASSIGNABLE_ROLES whitelist).
"""
from __future__ import annotations
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]


# --- helpers -----------------------------------------------------------------
def _otp_login(phone: str, name: str = "TEST_IT89") -> tuple[str, str]:
    r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=10)
    assert r.status_code == 200, r.text
    otp = r.json().get("dev_otp")
    assert otp, f"dev_otp missing: {r.text}"
    r2 = requests.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": phone, "otp": otp, "name": name},
        timeout=10,
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    token = body.get("session_token") or body.get("token")
    user_id = (body.get("user") or {}).get("user_id") or body.get("user_id")
    assert token and user_id, f"missing token/user_id in {body}"
    return token, user_id


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# --- fixtures ----------------------------------------------------------------
@pytest.fixture(scope="module")
def cleanup_state():
    created = {"users": [], "messes": [], "subs": []}
    yield created
    # Teardown
    for uid in created["users"]:
        db.users.delete_many({"user_id": uid})
        db.user_sessions.delete_many({"user_id": uid})
    for mid in created["messes"]:
        db.messes.delete_many({"mess_id": mid})
    for sid in created["subs"]:
        db.subscriptions.delete_many({"sub_id": sid})
    # Remove bottom-nav franchise key pollution
    db.app_config.update_one({"_id": "bottom_nav"}, {"$unset": {"franchise": ""}})


@pytest.fixture(scope="module")
def admin_session(cleanup_state):
    suffix = str(int(time.time() * 1000))[-9:]
    phone = "9" + suffix
    tok, uid = _otp_login(phone, "TEST_IT89_admin")
    db.users.update_one({"user_id": uid}, {"$set": {"role": "admin", "email": f"admin_it89_{suffix}@efoodcare.com"}})
    cleanup_state["users"].append(uid)
    return {"token": tok, "user_id": uid}


@pytest.fixture(scope="module")
def franchise_session(cleanup_state):
    suffix = str(int(time.time() * 1000) + 1)[-9:]
    phone = "8" + suffix
    tok, uid = _otp_login(phone, "TEST_IT89_franchise")
    # Promote to franchise_owner + create their mess
    branch_id = f"test_branch_it89_{suffix}"
    db.users.update_one({"user_id": uid}, {"$set": {"role": "franchise_owner", "mess_id": branch_id}})
    db.messes.insert_one({
        "mess_id": branch_id,
        "owner_user_id": uid,
        "name": "TEST IT89 Branch",
        "created_at": "2026-01-01T00:00:00Z",
    })
    cleanup_state["users"].append(uid)
    cleanup_state["messes"].append(branch_id)
    return {"token": tok, "user_id": uid, "branch_id": branch_id}


@pytest.fixture(scope="module")
def other_branch_users(cleanup_state):
    """Seed an out-of-branch admin/franchise + an in-branch subscriber."""
    out = {}
    # Out-of-branch admin user
    suffix = str(int(time.time() * 1000) + 100)[-9:]
    phone = "7" + suffix
    tok, uid = _otp_login(phone, "TEST_IT89_otheradmin")
    db.users.update_one({"user_id": uid}, {"$set": {"role": "admin", "mess_id": "other_branch_xyz"}})
    cleanup_state["users"].append(uid)
    out["other_admin_id"] = uid
    return out


@pytest.fixture(scope="module")
def subscriber_session(cleanup_state, franchise_session):
    suffix = str(int(time.time() * 1000) + 200)[-9:]
    phone = "6" + suffix
    tok, uid = _otp_login(phone, "TEST_IT89_sub")
    cleanup_state["users"].append(uid)
    # Active subscription in the franchise branch (so admin/users scoping picks it up)
    sub_id = f"sub_test_it89_{suffix}"
    db.subscriptions.insert_one({
        "sub_id": sub_id,
        "user_id": uid,
        "mess_id": franchise_session["branch_id"],
        "status": "active",
        "plan_id": "monthly_60",
        "start_date": "2026-01-01T00:00:00Z",
    })
    cleanup_state["subs"].append(sub_id)
    return {"token": tok, "user_id": uid, "phone": phone}


# --- TEST GROUP 1: Bottom-nav franchise CMS ---------------------------------
class TestBottomNavFranchise:
    def test_get_includes_franchise_default(self):
        r = requests.get(f"{BASE_URL}/api/bottom-nav", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "franchise" in data, f"franchise key missing: {list(data.keys())}"
        items = data["franchise"]
        assert isinstance(items, list) and len(items) >= 1
        ids = {it.get("id") for it in items}
        # Default ids from app_cms.py
        assert {"fr-dashboard", "fr-account", "fr-contact", "fr-home", "fr-logout"} <= ids

    def test_non_admin_put_forbidden(self, subscriber_session):
        r = requests.put(
            f"{BASE_URL}/api/admin/bottom-nav",
            headers=_hdr(subscriber_session["token"]),
            json={"franchise": [{"id": "x", "label": "X", "icon": "Home", "to": "/", "visible": True}]},
            timeout=10,
        )
        assert r.status_code == 403, r.text

    def test_admin_put_franchise_persists(self, admin_session):
        payload = {"franchise": [
            {"id": "fr-test-1", "label": "T1", "icon": "Home", "to": "/home", "visible": True},
            {"id": "fr-test-2", "label": "T2", "icon": "User", "to": "/profile", "visible": True},
        ]}
        r = requests.put(
            f"{BASE_URL}/api/admin/bottom-nav",
            headers=_hdr(admin_session["token"]),
            json=payload,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # GET should now return custom items, not the defaults
        r2 = requests.get(f"{BASE_URL}/api/bottom-nav", timeout=10)
        assert r2.status_code == 200
        items = r2.json()["franchise"]
        ids = {it["id"] for it in items}
        assert ids == {"fr-test-1", "fr-test-2"}, ids

    def test_admin_put_franchise_length_validation(self, admin_session):
        # 0 items would be invalid, but None means "don't update". Empty list = invalid.
        r = requests.put(
            f"{BASE_URL}/api/admin/bottom-nav",
            headers=_hdr(admin_session["token"]),
            json={"franchise": []},
            timeout=10,
        )
        assert r.status_code == 400, r.text


# --- TEST GROUP 2: Admin users scoping --------------------------------------
class TestAdminUsersScoping:
    def test_admin_sees_all_users(self, admin_session):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=_hdr(admin_session["token"]), timeout=15)
        assert r.status_code == 200, r.text
        users = r.json()["users"]
        assert len(users) > 1  # global

    def test_franchise_owner_scoped(self, franchise_session, subscriber_session, other_branch_users):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=_hdr(franchise_session["token"]), timeout=15)
        assert r.status_code == 200, r.text
        users = r.json()["users"]
        ids = {u.get("user_id") for u in users}
        # Must include franchise_owner themselves + the in-branch subscriber
        assert franchise_session["user_id"] in ids
        assert subscriber_session["user_id"] in ids
        # Must NOT include the out-of-branch admin
        assert other_branch_users["other_admin_id"] not in ids, (
            "Out-of-branch admin leaked into franchise-scoped users list"
        )


# --- TEST GROUP 3: Admin role assignment scoping ----------------------------
class TestAdminRoleAssignment:
    def test_franchise_can_assign_whitelisted_role(self, franchise_session, subscriber_session):
        # Assign 'staff' role to the in-branch subscriber
        r = requests.post(
            f"{BASE_URL}/api/admin/role",
            headers=_hdr(franchise_session["token"]),
            json={"phone": subscriber_session["phone"], "role": "staff"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # Verify mongo: role=staff AND mess_id=franchise branch
        u = db.users.find_one({"user_id": subscriber_session["user_id"]}, {"_id": 0, "role": 1, "mess_id": 1})
        assert u["role"] == "staff", u
        assert u["mess_id"] == franchise_session["branch_id"], u

    def test_franchise_cannot_assign_admin(self, franchise_session, subscriber_session):
        r = requests.post(
            f"{BASE_URL}/api/admin/role",
            headers=_hdr(franchise_session["token"]),
            json={"phone": subscriber_session["phone"], "role": "admin"},
            timeout=10,
        )
        assert r.status_code == 403, r.text
        assert "Franchise can only assign:" in r.json().get("detail", ""), r.text

    def test_franchise_cannot_assign_franchise_owner(self, franchise_session, subscriber_session):
        r = requests.post(
            f"{BASE_URL}/api/admin/role",
            headers=_hdr(franchise_session["token"]),
            json={"phone": subscriber_session["phone"], "role": "franchise_owner"},
            timeout=10,
        )
        assert r.status_code == 403, r.text
        assert "Franchise can only assign:" in r.json().get("detail", ""), r.text

    def test_franchise_cannot_touch_admin_target(self, franchise_session, other_branch_users, admin_session):
        # Try to demote an existing admin to subscriber as franchise_owner
        # Use the admin's user_id → look them up by their email pattern
        admin_doc = db.users.find_one({"user_id": other_branch_users["other_admin_id"]}, {"_id": 0, "phone": 1})
        assert admin_doc and admin_doc.get("phone")
        r = requests.post(
            f"{BASE_URL}/api/admin/role",
            headers=_hdr(franchise_session["token"]),
            json={"phone": admin_doc["phone"], "role": "subscriber"},
            timeout=10,
        )
        assert r.status_code == 403, r.text
        assert "Cannot change role of admin" in r.json().get("detail", ""), r.text

    def test_admin_can_still_assign_any_role(self, admin_session, subscriber_session):
        # Admin reverts the subscriber back to 'subscriber'
        r = requests.post(
            f"{BASE_URL}/api/admin/role",
            headers=_hdr(admin_session["token"]),
            json={"phone": subscriber_session["phone"], "role": "subscriber"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        u = db.users.find_one({"user_id": subscriber_session["user_id"]}, {"_id": 0, "role": 1})
        assert u["role"] == "subscriber"
