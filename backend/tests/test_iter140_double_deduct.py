"""iter-140 — P0 wallet double-deduction fix + admin refund tool.

Covers:
  * catch_up_subscription: no deduction for TODAY (cutoff = today-1)
  * dining subs: per-meal reconcile of MISSED meals only
  * tiffin subs: per-day deduction for FINALIZED past days only
  * POST /api/admin/reconcile-double-deduct (dry_run, apply, idempotency)
"""
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")

IST = timezone(timedelta(hours=5, minutes=30))


def ist_today() -> date:
    return datetime.now(IST).date()


TODAY = ist_today()
D = lambda n: (TODAY - timedelta(days=n)).isoformat()  # noqa: E731


@pytest.fixture(scope="module")
def mdb():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def created(mdb):
    ids = {"users": [], "subs": []}
    yield ids
    mdb.users.delete_many({"user_id": {"$in": ids["users"]}})
    mdb.user_sessions.delete_many({"user_id": {"$in": ids["users"]}})
    mdb.subscriptions.delete_many({"user_id": {"$in": ids["users"]}})
    mdb.attendance.delete_many({"user_id": {"$in": ids["users"]}})
    mdb.wallet_transactions.delete_many({"user_id": {"$in": ids["users"]}})


def _seed_user(mdb, created, role="subscriber"):
    uid = f"TEST_iter140_{uuid.uuid4().hex[:8]}"
    token = f"TEST_sess_{uuid.uuid4().hex}"
    mdb.users.insert_one({
        "user_id": uid,
        "email": f"TEST_{uid}@example.test",
        "name": "TEST iter140",
        "role": role,
        "qr_token": f"TEST_qr_{uuid.uuid4().hex[:10]}",
        "wallet_balance": 1000.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mdb.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    created["users"].append(uid)
    return uid, token


def _seed_sub(mdb, created, uid, *, service_type, last_tick, scan_map=None,
              per_day=100.0, wallet=1000.0, meals_used=0, start_days_ago=10):
    sid = f"TEST_sub_{uuid.uuid4().hex[:10]}"
    mdb.subscriptions.insert_one({
        "sub_id": sid,
        "user_id": uid,
        "plan_id": "TEST_plan",
        "plan_name": "TEST Plan",
        "service_type": service_type,
        "meals_total": 60,
        "meals_used": meals_used,
        "per_day_amount": per_day,
        "wallet_balance": wallet,
        "start_date": (TODAY - timedelta(days=start_days_ago)).isoformat(),
        "end_date": (TODAY + timedelta(days=20)).isoformat(),
        "status": "active",
        "paused_days": 0,
        "last_tick_date": last_tick,
        "scan_deducted_dates": scan_map or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    created["subs"].append(sid)
    return sid


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- health ----------
class TestHealth:
    def test_api_reachable(self):
        r = requests.get(f"{API}/plans", timeout=30)
        assert r.status_code == 200, r.text


# ---------- P0 #1: tick must not charge today ----------
class TestNoDeductionForToday:
    def test_dining_scan_today_then_tick_does_not_double_charge(self, mdb, created):
        uid, token = _seed_user(mdb, created)
        # simulate a lunch scan today: per_meal (50) already deducted at kiosk
        sid = _seed_sub(mdb, created, uid, service_type="dining",
                        last_tick=D(1), scan_map={D(0): ["lunch"]},
                        wallet=950.0, meals_used=1)
        mdb.users.update_one({"user_id": uid}, {"$set": {"wallet_balance": 950.0}})

        r = requests.get(f"{API}/my/wallet", headers=_hdr(token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["wallet_balance"] == 950.0, f"tick charged again for today: {data}"
        sub = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert sub["wallet_balance"] == 950.0
        assert sub["meals_used"] == 1
        assert sub["last_tick_date"] == D(1)
        # no daily-deduction ledger row for today
        rows = list(mdb.wallet_transactions.find(
            {"user_id": uid, "reason": {"$regex": f"Daily deduction · {D(0)}"}}, {"_id": 0}))
        assert rows == [], f"unexpected daily deduction rows for today: {rows}"

    def test_dining_no_scan_today_tick_still_skips_today(self, mdb, created):
        uid, token = _seed_user(mdb, created)
        sid = _seed_sub(mdb, created, uid, service_type="dining", last_tick=D(1))
        r = requests.get(f"{API}/my/wallet", headers=_hdr(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["wallet_balance"] == 1000.0
        sub = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert sub["wallet_balance"] == 1000.0
        assert sub["meals_used"] == 0


# ---------- P0 #2: missed meals still charged (per-meal, not per-day) ----------
class TestMissedMealReconcile:
    def test_dining_yesterday_half_scanned_charges_one_per_meal(self, mdb, created):
        uid, token = _seed_user(mdb, created)
        sid = _seed_sub(mdb, created, uid, service_type="dining",
                        last_tick=D(2), scan_map={D(1): ["lunch"]},
                        wallet=950.0, meals_used=1)
        mdb.users.update_one({"user_id": uid}, {"$set": {"wallet_balance": 950.0}})
        # attendance history so the 3-day inactivity auto-pause does not trigger
        for n in (3, 2):
            mdb.attendance.insert_one({
                "att_id": f"TEST_att_{uuid.uuid4().hex[:8]}", "user_id": uid,
                "sub_id": sid, "meal_type": "lunch", "date_str": D(n),
                "checked_at": datetime.now(timezone.utc).isoformat(),
            })

        r = requests.get(f"{API}/my/wallet", headers=_hdr(token), timeout=30)
        assert r.status_code == 200, r.text
        # only the MISSED dinner of yesterday → 50 charged (not a full 100)
        assert r.json()["wallet_balance"] == 900.0, r.json()
        sub = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert sub["wallet_balance"] == 900.0
        assert sub["meals_used"] == 2
        assert sub["last_tick_date"] == D(1), "anchor must stop at yesterday"
        rows = list(mdb.wallet_transactions.find({"user_id": uid, "type": "debit"}, {"_id": 0}))
        reasons = [x["reason"] for x in rows]
        assert any("dinner missed" in x for x in reasons), reasons
        assert not any("lunch missed" in x for x in reasons), reasons
        assert not any(D(0) in x for x in reasons), f"today was touched: {reasons}"

    def test_dining_fully_scanned_day_not_charged(self, mdb, created):
        uid, token = _seed_user(mdb, created)
        sid = _seed_sub(mdb, created, uid, service_type="dining",
                        last_tick=D(2), scan_map={D(1): ["lunch", "dinner"]},
                        wallet=900.0, meals_used=2)
        mdb.users.update_one({"user_id": uid}, {"$set": {"wallet_balance": 900.0}})
        r = requests.get(f"{API}/my/wallet", headers=_hdr(token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["wallet_balance"] == 900.0
        sub = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert sub["meals_used"] == 2
        assert sub["last_tick_date"] == D(1)

    def test_tiffin_charges_finalized_past_days_only(self, mdb, created):
        uid, token = _seed_user(mdb, created)
        sid = _seed_sub(mdb, created, uid, service_type="tiffin",
                        last_tick=D(3), per_day=120.0, wallet=1000.0)
        r = requests.get(f"{API}/my/wallet", headers=_hdr(token), timeout=30)
        assert r.status_code == 200, r.text
        # days D-2 and D-1 only → 240 (today NOT charged)
        assert r.json()["wallet_balance"] == 760.0, r.json()
        sub = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert sub["wallet_balance"] == 760.0
        assert sub["meals_used"] == 4
        assert sub["last_tick_date"] == D(1)
        reasons = [x["reason"] for x in mdb.wallet_transactions.find({"user_id": uid, "type": "debit"})]
        assert len(reasons) == 2, reasons
        assert not any(D(0) in x for x in reasons), reasons


# ---------- Admin refund tool ----------
class TestReconcileDoubleDeduct:
    @pytest.fixture(scope="class")
    def admin_token(self, mdb, created):
        uid = f"TEST_iter140_admin_{uuid.uuid4().hex[:8]}"
        token = f"TEST_sess_{uuid.uuid4().hex}"
        mdb.users.insert_one({
            "user_id": uid, "email": f"TEST_{uid}@example.test", "name": "TEST admin",
            "role": "admin", "wallet_balance": 0.0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        mdb.user_sessions.insert_one({
            "user_id": uid, "session_token": token,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        created["users"].append(uid)
        return token

    @pytest.fixture(scope="class")
    def victim(self, mdb, created):
        """A dining sub carrying the pre-iter-140 double-charge ledger rows.
        iter-140 fix: dining scans DIDN'T decrement users.wallet_balance
        historically (only sub.wallet_balance) — so the user-level wallet
        was correctly at (per_day - per_day)=900 after the buggy day while
        the sub was over-charged to 800 (per_day tick + 2 per_meal scans).
        Refund credits sub only; user stays put.
        """
        uid, _tok = _seed_user(mdb, created)
        sid = _seed_sub(mdb, created, uid, service_type="dining", last_tick=D(1),
                        wallet=800.0, meals_used=4)
        mdb.users.update_one({"user_id": uid}, {"$set": {"wallet_balance": 900.0}})
        day = D(5)
        base = {"user_id": uid, "sub_id": sid, "type": "debit",
                "created_at": datetime.now(timezone.utc).isoformat()}
        for meal in ("lunch", "dinner"):
            mdb.wallet_transactions.insert_one(
                {**base, "txn_id": f"TEST_{uuid.uuid4().hex[:10]}", "amount": 50.0,
                 "balance_after": 900.0, "reason": f"Scan · {meal} · {day}"})
        mdb.wallet_transactions.insert_one(
            {**base, "txn_id": f"TEST_{uuid.uuid4().hex[:10]}", "amount": 100.0,
             "balance_after": 800.0, "reason": f"Daily deduction · {day} · 2 meals · active"})
        return {"user_id": uid, "sub_id": sid, "day": day}

    def test_requires_admin(self, mdb, created):
        _uid, token = _seed_user(mdb, created)
        r = requests.post(f"{API}/admin/reconcile-double-deduct?dry_run=true",
                          headers=_hdr(token), timeout=60)
        assert r.status_code == 403, r.text

    def test_dry_run_lists_candidate_without_mutating(self, mdb, admin_token, victim):
        r = requests.post(f"{API}/admin/reconcile-double-deduct?dry_run=true",
                          headers=_hdr(admin_token), timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["dry_run"] is True
        mine = [c for c in data["candidates"] if c["user_id"] == victim["user_id"]]
        assert len(mine) == 1, data["candidates"]
        assert mine[0]["day"] == victim["day"]
        assert mine[0]["scans"] == 2
        assert mine[0]["refund"] == 100.0
        # nothing mutated
        u = mdb.users.find_one({"user_id": victim["user_id"]}, {"_id": 0})
        s = mdb.subscriptions.find_one({"sub_id": victim["sub_id"]}, {"_id": 0})
        assert u["wallet_balance"] == 900.0
        assert s["wallet_balance"] == 800.0 and s["meals_used"] == 4
        assert mdb.wallet_transactions.count_documents(
            {"user_id": victim["user_id"], "kind": "double_deduct_refund"}) == 0

    def test_apply_credits_user_and_sub(self, mdb, admin_token, victim):
        r = requests.post(f"{API}/admin/reconcile-double-deduct",
                          headers=_hdr(admin_token), timeout=180)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True and data["touched"] >= 1
        mine = [x for x in data["users"] if x["user_id"] == victim["user_id"]]
        assert len(mine) == 1, data["users"]
        assert mine[0]["refund"] == 100.0
        assert mine[0]["meals_restored"] == 2
        u = mdb.users.find_one({"user_id": victim["user_id"]}, {"_id": 0})
        s = mdb.subscriptions.find_one({"sub_id": victim["sub_id"]}, {"_id": 0})
        assert u["wallet_balance"] == 900.0, u
        assert s["wallet_balance"] == 900.0, s
        assert s["meals_used"] == 2, s
        ledger = list(mdb.wallet_transactions.find(
            {"user_id": victim["user_id"], "kind": "double_deduct_refund"}, {"_id": 0}))
        assert len(ledger) == 1
        assert ledger[0]["type"] == "credit"
        assert ledger[0]["amount"] == 100.0
        assert ledger[0]["refund_date"] == victim["day"]

    def test_rerun_is_idempotent(self, mdb, admin_token, victim):
        dry = requests.post(f"{API}/admin/reconcile-double-deduct?dry_run=true",
                            headers=_hdr(admin_token), timeout=120)
        assert dry.status_code == 200, dry.text
        assert [c for c in dry.json()["candidates"] if c["user_id"] == victim["user_id"]] == []

        r = requests.post(f"{API}/admin/reconcile-double-deduct",
                          headers=_hdr(admin_token), timeout=180)
        assert r.status_code == 200, r.text
        assert [x for x in r.json()["users"] if x["user_id"] == victim["user_id"]] == []
        u = mdb.users.find_one({"user_id": victim["user_id"]}, {"_id": 0})
        s = mdb.subscriptions.find_one({"sub_id": victim["sub_id"]}, {"_id": 0})
        assert u["wallet_balance"] == 900.0, "second run double-refunded the user wallet"
        assert s["wallet_balance"] == 900.0, "second run double-refunded the sub wallet"
        assert s["meals_used"] == 2
        assert mdb.wallet_transactions.count_documents(
            {"user_id": victim["user_id"], "kind": "double_deduct_refund"}) == 1


# ---------- business rule: skip days 1-3 charge, day 4+ auto-pause (dining) ----------
class TestDiningSkipStreak:
    def test_days_1_3_charge_then_autopause(self, mdb, created):
        uid, token = _seed_user(mdb, created)
        sid = _seed_sub(mdb, created, uid, service_type="dining", last_tick=D(6),
                        per_day=100.0, wallet=1000.0, start_days_ago=20)
        mdb.attendance.insert_one({
            "att_id": f"TEST_att_{uuid.uuid4().hex[:8]}", "user_id": uid, "sub_id": sid,
            "meal_type": "lunch", "date_str": D(6),
            "checked_at": datetime.now(timezone.utc).isoformat(),
        })
        r = requests.get(f"{API}/my/wallet", headers=_hdr(token), timeout=30)
        assert r.status_code == 200, r.text
        # D-5, D-4, D-3 → 2 missed meals each (2×50) = 300; D-2, D-1 → auto-paused
        assert r.json()["wallet_balance"] == 700.0, r.json()
        sub = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert sub["wallet_balance"] == 700.0
        assert sub["meals_used"] == 6
        assert sub["paused_days"] == 2, sub
        assert sub["last_tick_date"] == D(1)
