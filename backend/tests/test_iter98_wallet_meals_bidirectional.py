"""iter-98 — Backend tests for bidirectional meals_delta on admin wallet-adjust.

Covers:
  * POST /api/admin/users/{id}/wallet-adjust with meals_delta < 0  → meals_used UP
  * POST /api/admin/users/{id}/wallet-adjust with meals_delta > 0  → meals_used DOWN
  * Legacy `restore_meals:1` still works (additively merged into meals_change)
  * Hard clamp: meals_used clamped to [0, meals_total]
  * Validation: 400 when all of (delta, extend_days, meals_delta, restore_meals) zero
  * Audit doc in db.wallet_overrides records meals_delta (signed) + restore_meals (max(0, .))
  * iter-92 regression: franchise_owner cross-branch wallet-adjust returns 403
  * iter-92 regression: delta ±, extend_days still work alongside meals_delta

Seeds an ephemeral admin + franchise_owner + 2 subscriber users (one per branch)
and an active subscription with meals_total=60, meals_used=0. Tears down everything.
"""
import os
import uuid
import datetime as dt

import pymongo
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

MESS_A = "efoodcare-amravati"
MESS_B = f"TEST_IT98_branch_b_{uuid.uuid4().hex[:6]}"


def _now_iso():
    return dt.datetime.utcnow().isoformat() + "Z"


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def mongo():
    c = pymongo.MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


def _seed_user(mongo, *, role, mess_id=None, extra=None):
    uid = f"TEST_IT98_{role}_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_IT98_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": f"Iter98 {role}",
        "role": role,
        "wallet_balance": 0,
        "created_at": _now_iso(),
    }
    if mess_id:
        doc["mess_id"] = mess_id
    if extra:
        doc.update(extra)
    mongo.users.insert_one(doc)
    mongo.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": "2099-01-01T00:00:00Z",
        "created_at": _now_iso(),
    })
    return uid, tok


@pytest.fixture(scope="module", autouse=True)
def world(mongo):
    # Snapshot mess A original owner so we can restore it
    orig_owner_A = (mongo.messes.find_one({"mess_id": MESS_A}) or {}).get("owner_user_id")

    admin_uid, admin_tok = _seed_user(mongo, role="admin")

    # Franchise owners
    fr_a_uid, fr_a_tok = _seed_user(mongo, role="franchise_owner", mess_id=MESS_A)
    mongo.messes.update_one({"mess_id": MESS_A}, {"$set": {"owner_user_id": fr_a_uid}})

    fr_b_uid, fr_b_tok = _seed_user(mongo, role="franchise_owner", mess_id=MESS_B)
    mongo.messes.insert_one({
        "mess_id": MESS_B, "name": "Iter98 Branch B",
        "owner_user_id": fr_b_uid, "city": "Testville",
        "created_at": _now_iso(),
    })

    # Subscriber in MESS_A (the one we will run all meal-adjust tests on)
    sub_a_uid, _ = _seed_user(mongo, role="subscriber", mess_id=MESS_A,
                              extra={"wallet_balance": 500})
    sub_id = f"TEST_IT98_sub_{uuid.uuid4().hex[:8]}"
    end_date = (dt.datetime.utcnow() + dt.timedelta(days=30)).isoformat() + "Z"
    mongo.subscriptions.insert_one({
        "sub_id": sub_id,
        "user_id": sub_a_uid,
        "mess_id": MESS_A,
        "status": "active",
        "meals_total": 60,
        "meals_used": 0,
        "wallet_balance": 500.0,
        "end_date": end_date,
        "created_at": _now_iso(),
    })

    # Subscriber in MESS_B (for cross-branch 403 regression)
    sub_b_uid, _ = _seed_user(mongo, role="subscriber", mess_id=MESS_B)

    ctx = {
        "admin_tok": admin_tok, "admin_uid": admin_uid,
        "fr_a_tok": fr_a_tok, "fr_a_uid": fr_a_uid,
        "fr_b_tok": fr_b_tok, "fr_b_uid": fr_b_uid,
        "sub_a": sub_a_uid, "sub_b": sub_b_uid,
        "sub_id": sub_id,
        "orig_owner_A": orig_owner_A,
    }
    yield ctx

    # Teardown
    if orig_owner_A:
        mongo.messes.update_one({"mess_id": MESS_A}, {"$set": {"owner_user_id": orig_owner_A}})
    mongo.messes.delete_one({"mess_id": MESS_B})
    mongo.users.delete_many({"user_id": {"$in": [
        admin_uid, fr_a_uid, fr_b_uid, sub_a_uid, sub_b_uid
    ]}})
    mongo.user_sessions.delete_many({"session_token": {"$regex": "^TEST_IT98_sess_"}})
    mongo.subscriptions.delete_one({"sub_id": sub_id})
    mongo.wallet_overrides.delete_many({"target_user_id": sub_a_uid})
    mongo.wallet_transactions.delete_many({"user_id": sub_a_uid})


def _reset_sub_meals(mongo, sub_id, used=0, total=60):
    mongo.subscriptions.update_one({"sub_id": sub_id},
                                   {"$set": {"meals_used": used, "meals_total": total}})


def _get_sub(mongo, sub_id):
    return mongo.subscriptions.find_one({"sub_id": sub_id}, {"_id": 0})


# ── Bidirectional meals_delta ─────────────────────────────────────────────

class TestMealsDeltaBidirectional:
    def test_deduct_raises_meals_used(self, world, mongo):
        _reset_sub_meals(mongo, world["sub_id"], used=0)
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "ate extra for friend", "meals_delta": -3},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["meals_delta"] == -3
        # audit "after" shows the new meals_used
        assert body["after"]["meals_used"] == 3
        # DB persistence
        assert _get_sub(mongo, world["sub_id"])["meals_used"] == 3

    def test_restore_lowers_meals_used(self, world, mongo):
        _reset_sub_meals(mongo, world["sub_id"], used=3)
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "missed checkin restore", "meals_delta": 3},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["meals_delta"] == 3
        assert body["after"]["meals_used"] == 0
        assert _get_sub(mongo, world["sub_id"])["meals_used"] == 0


class TestLegacyRestoreMeals:
    def test_legacy_restore_meals_still_works(self, world, mongo):
        _reset_sub_meals(mongo, world["sub_id"], used=5)
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "legacy field test", "restore_meals": 2},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # meals_delta in audit equals signed change (legacy field merged in)
        assert body["meals_delta"] == 2
        # restore_meals key still present + reflects max(0, meals_delta)
        assert body["restore_meals"] == 2
        assert _get_sub(mongo, world["sub_id"])["meals_used"] == 3

    def test_meals_delta_and_restore_meals_merge(self, world, mongo):
        """Both fields are additive — sending both should sum signed."""
        _reset_sub_meals(mongo, world["sub_id"], used=10)
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "merge fields",
                  "meals_delta": -1, "restore_meals": 4},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # signed sum = -1 + 4 = +3 (restore by 3)
        assert body["meals_delta"] == 3
        assert body["restore_meals"] == 3  # max(0, 3)
        assert _get_sub(mongo, world["sub_id"])["meals_used"] == 7


class TestHardClamp:
    def test_deduct_caps_at_meals_total(self, world, mongo):
        _reset_sub_meals(mongo, world["sub_id"], used=0)
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "huge deduct cap test", "meals_delta": -9999},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert _get_sub(mongo, world["sub_id"])["meals_used"] == 60  # capped at total

    def test_restore_floors_at_zero(self, world, mongo):
        # currently meals_used=60 from prev test; floor must clamp to 0
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "huge restore floor test", "meals_delta": 9999},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert _get_sub(mongo, world["sub_id"])["meals_used"] == 0


class TestValidation:
    def test_400_when_all_fields_zero(self, world):
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "noop test",
                  "extend_days": 0, "meals_delta": 0, "restore_meals": 0},
            timeout=20,
        )
        assert r.status_code == 400, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "non-zero" in detail or "extend_days" in detail or "meals_delta" in detail

    def test_400_when_reason_blank(self, world):
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "   ", "meals_delta": -1},
            timeout=20,
        )
        assert r.status_code == 400, r.text


class TestAuditPersistence:
    def test_audit_doc_records_meals_fields(self, world, mongo):
        _reset_sub_meals(mongo, world["sub_id"], used=0)
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "audit doc check", "meals_delta": -4},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        audit_id = r.json()["audit_id"]
        doc = mongo.wallet_overrides.find_one({"audit_id": audit_id}, {"_id": 0})
        assert doc is not None
        assert doc["meals_delta"] == -4
        assert doc["restore_meals"] == 0  # max(0, -4)
        assert doc["target_user_id"] == world["sub_a"]
        assert doc["admin_user_id"] == world["admin_uid"]
        assert doc["reason"] == "audit doc check"
        # before/after snapshot
        assert doc["before"]["meals_used"] == 0
        assert doc["before"]["meals_total"] == 60
        assert doc["after"]["meals_used"] == 4


class TestRegressionDeltaAndExtend:
    def test_wallet_credit_still_works(self, world, mongo):
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 100, "reason": "iter-92 credit regression"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["delta"] == 100
        assert r.json()["after"]["user_wallet"] >= 100

    def test_wallet_debit_still_works(self, world):
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": -50, "reason": "iter-92 debit regression"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["delta"] == -50

    def test_extend_days_still_works(self, world, mongo):
        before = _get_sub(mongo, world["sub_id"])["end_date"]
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "iter-92 extend regression", "extend_days": 5},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        after = _get_sub(mongo, world["sub_id"])["end_date"]
        assert after != before


class TestFranchiseScope:
    def test_fr_a_can_adjust_own_branch_user(self, world, mongo):
        _reset_sub_meals(mongo, world["sub_id"], used=2)
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["fr_a_tok"]),
            json={"delta": 0, "reason": "fr_a own branch", "meals_delta": 1},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert _get_sub(mongo, world["sub_id"])["meals_used"] == 1

    def test_fr_b_blocked_cross_branch(self, world):
        """FR_B should NOT be able to adjust a MESS_A user."""
        r = requests.post(
            f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
            headers=_hdr(world["fr_b_tok"]),
            json={"delta": 0, "reason": "cross-branch attempt", "meals_delta": -1},
            timeout=20,
        )
        assert r.status_code == 403, r.text
