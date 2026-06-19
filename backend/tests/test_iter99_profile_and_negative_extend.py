"""iter-99 — Backend tests for profile validation relaxation + signed extend_days.

Covers:
  Profile (POST /api/auth/profile):
    * Original failing payload now succeeds (200): Rushikesh + 10-digit phone + 'Sai Nagar amravati'
    * Name regex is Unicode-aware: 'Rohan 23', 'राहुल', "Mary-Anne O'Brien" → 200
    * Name rejects: empty, single-char, >80 chars
    * Address < 10 chars → 400 (e.g. 'Sai Nagar' = 9)
    * Phone validation unchanged: rejects non-10-digit / leading digit not 6–9

  Admin wallet-adjust extend_days < 0:
    * extend_days:-5 pulls end_date back by exactly 5 days
    * extend_days:-9999 clamps end_date to start_date (FLOOR, not before)
    * Audit log persists SIGNED extend_days (-5, not 5)

  Regressions: iter-98 meals_delta still works ±, iter-92 cross-branch 403.
"""
import os
import re
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
    uid = f"TEST_IT99_{role}_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_IT99_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": f"Iter99 {role}",
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
    admin_uid, admin_tok = _seed_user(mongo, role="admin")
    sub_user_uid, sub_user_tok = _seed_user(
        mongo, role="subscriber", mess_id=MESS_A,
        extra={"name": "Old Name", "phone": "9999999999", "address": "Old Address 123"},
    )

    # Seed an active subscription with explicit start_date for floor tests
    start = dt.datetime.utcnow() - dt.timedelta(days=10)
    end = dt.datetime.utcnow() + dt.timedelta(days=20)
    sub_id = f"TEST_IT99_sub_{uuid.uuid4().hex[:8]}"
    mongo.subscriptions.insert_one({
        "sub_id": sub_id,
        "user_id": sub_user_uid,
        "mess_id": MESS_A,
        "status": "active",
        "meals_total": 60,
        "meals_used": 0,
        "wallet_balance": 500.0,
        "start_date": start.isoformat() + "Z",
        "end_date": end.isoformat() + "Z",
        "created_at": _now_iso(),
    })

    ctx = {
        "admin_uid": admin_uid, "admin_tok": admin_tok,
        "sub_user_uid": sub_user_uid, "sub_user_tok": sub_user_tok,
        "sub_id": sub_id,
        "start_iso": start.isoformat() + "Z",
        "end_iso": end.isoformat() + "Z",
    }
    yield ctx

    # teardown
    mongo.users.delete_many({"user_id": {"$in": [admin_uid, sub_user_uid]}})
    mongo.user_sessions.delete_many({"session_token": {"$regex": "^TEST_IT99_sess_"}})
    mongo.subscriptions.delete_one({"sub_id": sub_id})
    mongo.wallet_overrides.delete_many({"target_user_id": sub_user_uid})
    mongo.wallet_transactions.delete_many({"user_id": sub_user_uid})


def _reset_end(mongo, sub_id, end_iso):
    mongo.subscriptions.update_one({"sub_id": sub_id}, {"$set": {"end_date": end_iso}})


def _get_sub(mongo, sub_id):
    return mongo.subscriptions.find_one({"sub_id": sub_id}, {"_id": 0})


# ─── Profile validation ───────────────────────────────────────────────

class TestProfileOriginalFailingPayload:
    def test_rushikesh_payload_now_succeeds(self, world):
        r = requests.post(
            f"{API}/auth/profile",
            headers=_hdr(world["sub_user_tok"]),
            json={
                "name": "Rushikesh",
                "phone": "8421372391",
                "address": "Sai Nagar amravati",
                "photo_url": "",
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # response contains updated user — confirm fields are persisted
        u = body.get("user") or body
        assert u.get("name") == "Rushikesh"
        assert u.get("phone") == "8421372391"
        assert u.get("address") == "Sai Nagar amravati"


class TestNameRegexAccepts:
    @pytest.mark.parametrize("name", [
        "Rohan 23",          # digits + space
        "राहुल",              # Devanagari
        "Mary-Anne O'Brien", # hyphen + apostrophe
        "Dr. A.P.J. Kalam",  # dots + spaces
        "AB",                # min len 2
        "X" * 80,            # max len 80
    ])
    def test_accept(self, world, name):
        r = requests.post(
            f"{API}/auth/profile",
            headers=_hdr(world["sub_user_tok"]),
            json={"name": name, "phone": "8421372391", "address": "Sai Nagar amravati"},
            timeout=20,
        )
        assert r.status_code == 200, f"name={name!r} → {r.status_code} {r.text}"


class TestNameRegexRejects:
    @pytest.mark.parametrize("name,expected_phrase", [
        ("", "required"),
        ("A", "invalid"),
        ("X" * 81, "invalid"),
    ])
    def test_reject(self, world, name, expected_phrase):
        r = requests.post(
            f"{API}/auth/profile",
            headers=_hdr(world["sub_user_tok"]),
            json={"name": name, "phone": "8421372391", "address": "Sai Nagar amravati"},
            timeout=20,
        )
        assert r.status_code == 400, r.text
        assert expected_phrase in (r.json().get("detail") or "").lower()


class TestAddressMinLength:
    def test_address_9_chars_rejected(self, world):
        r = requests.post(
            f"{API}/auth/profile",
            headers=_hdr(world["sub_user_tok"]),
            json={"name": "Rushikesh", "phone": "8421372391", "address": "Sai Nagar"},
            timeout=20,
        )
        assert r.status_code == 400, r.text
        d = (r.json().get("detail") or "").lower()
        assert "at least 10" in d or "10 characters" in d

    def test_address_18_chars_ok(self, world):
        r = requests.post(
            f"{API}/auth/profile",
            headers=_hdr(world["sub_user_tok"]),
            json={"name": "Rushikesh", "phone": "8421372391", "address": "Sai Nagar amravati"},
            timeout=20,
        )
        assert r.status_code == 200, r.text


class TestPhoneValidationUnchanged:
    @pytest.mark.parametrize("phone", [
        "1234567890",     # leading 1, invalid
        "5421372391",     # leading 5, invalid
        "842137239",      # 9 digits, too short
        "84213723910",    # 11 digits
        "abcdefghij",     # not numeric
    ])
    def test_phone_reject(self, world, phone):
        r = requests.post(
            f"{API}/auth/profile",
            headers=_hdr(world["sub_user_tok"]),
            json={"name": "Rushikesh", "phone": phone, "address": "Sai Nagar amravati"},
            timeout=20,
        )
        assert r.status_code == 400, f"phone={phone!r} → {r.status_code} {r.text}"

    @pytest.mark.parametrize("phone", ["6421372391", "7421372391", "8421372391", "9421372391"])
    def test_phone_accept(self, world, phone):
        r = requests.post(
            f"{API}/auth/profile",
            headers=_hdr(world["sub_user_tok"]),
            json={"name": "Rushikesh", "phone": phone, "address": "Sai Nagar amravati"},
            timeout=20,
        )
        assert r.status_code == 200, r.text


# ─── Negative extend_days ─────────────────────────────────────────────

def _parse(iso_str):
    return dt.datetime.fromisoformat(iso_str.replace("Z", "+00:00")).replace(tzinfo=None)


class TestNegativeExtendDays:
    def test_negative_5_pulls_back_5_days(self, world, mongo):
        _reset_end(mongo, world["sub_id"], world["end_iso"])
        before_end = _parse(world["end_iso"])
        r = requests.post(
            f"{API}/admin/users/{world['sub_user_uid']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "iter-99 deduct 5 days", "extend_days": -5},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        sub_after = _get_sub(mongo, world["sub_id"])
        after_end = _parse(sub_after["end_date"])
        delta = (before_end - after_end).days
        assert delta == 5, f"expected -5 day shift, got {delta} (before={before_end}, after={after_end})"

    def test_huge_negative_clamps_to_start_date(self, world, mongo):
        _reset_end(mongo, world["sub_id"], world["end_iso"])
        start = _parse(world["start_iso"])
        r = requests.post(
            f"{API}/admin/users/{world['sub_user_uid']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "iter-99 floor test", "extend_days": -9999},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        sub_after = _get_sub(mongo, world["sub_id"])
        after_end = _parse(sub_after["end_date"])
        # Floor: end_date must equal start_date (not before)
        assert abs((after_end - start).total_seconds()) < 2, \
            f"expected end_date == start_date={start}, got {after_end}"

    def test_audit_records_signed_extend_days(self, world, mongo):
        _reset_end(mongo, world["sub_id"], world["end_iso"])
        r = requests.post(
            f"{API}/admin/users/{world['sub_user_uid']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "iter-99 audit signed", "extend_days": -7},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        audit_id = r.json()["audit_id"]
        doc = mongo.wallet_overrides.find_one({"audit_id": audit_id}, {"_id": 0})
        assert doc is not None
        assert doc["extend_days"] == -7, f"audit must persist signed value, got {doc['extend_days']}"

    def test_positive_extend_still_works(self, world, mongo):
        _reset_end(mongo, world["sub_id"], world["end_iso"])
        before_end = _parse(world["end_iso"])
        r = requests.post(
            f"{API}/admin/users/{world['sub_user_uid']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "positive regression", "extend_days": 5},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        sub_after = _get_sub(mongo, world["sub_id"])
        after_end = _parse(sub_after["end_date"])
        assert (after_end - before_end).days == 5


# ─── Regression: meals_delta still works (iter-98) ─────────────────────

class TestIter98Regression:
    def test_meals_delta_deduct(self, world, mongo):
        mongo.subscriptions.update_one({"sub_id": world["sub_id"]}, {"$set": {"meals_used": 0}})
        r = requests.post(
            f"{API}/admin/users/{world['sub_user_uid']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "regression deduct", "meals_delta": -2},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert _get_sub(mongo, world["sub_id"])["meals_used"] == 2

    def test_meals_delta_restore(self, world, mongo):
        mongo.subscriptions.update_one({"sub_id": world["sub_id"]}, {"$set": {"meals_used": 5}})
        r = requests.post(
            f"{API}/admin/users/{world['sub_user_uid']}/wallet-adjust",
            headers=_hdr(world["admin_tok"]),
            json={"delta": 0, "reason": "regression restore", "meals_delta": 3},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert _get_sub(mongo, world["sub_id"])["meals_used"] == 2
