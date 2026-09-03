"""iter-140.b — independent review tests for the refund tool + delta idempotency.

Module under test: POST /api/admin/reconcile-double-deduct (server.py:3102)
Scenarios: past-day double charge (sub-only credit), today early-tick
(both wallets), mixed past+today for one sub, delta top-up, meals clamp,
dry_run purity, auth guard.
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
API = base_url.rstrip("/") + "/api"
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")
IST = timezone(timedelta(hours=5, minutes=30))
TODAY: date = datetime.now(IST).date()


def D(n):
    return (TODAY - timedelta(days=n)).isoformat()


@pytest.fixture(scope="module")
def mdb():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def created(mdb):
    ids = {"users": []}
    yield ids
    mdb.users.delete_many({"user_id": {"$in": ids["users"]}})
    mdb.user_sessions.delete_many({"user_id": {"$in": ids["users"]}})
    mdb.subscriptions.delete_many({"user_id": {"$in": ids["users"]}})
    mdb.wallet_transactions.delete_many({"user_id": {"$in": ids["users"]}})
    mdb.attendance.delete_many({"user_id": {"$in": ids["users"]}})


def _user(mdb, created, role="subscriber", wallet=1000.0):
    uid = f"TEST_i140b_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_sess_{uuid.uuid4().hex}"
    mdb.users.insert_one({
        "user_id": uid, "email": f"TEST_{uid}@example.test", "name": "TEST i140b",
        "role": role, "wallet_balance": wallet,
        "qr_token": f"TEST_qr_{uuid.uuid4().hex[:10]}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mdb.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    created["users"].append(uid)
    return uid, tok


def _sub(mdb, uid, *, wallet, meals_used, last_tick, per_day=100.0):
    sid = f"TEST_sub_{uuid.uuid4().hex[:10]}"
    mdb.subscriptions.insert_one({
        "sub_id": sid, "user_id": uid, "plan_id": "TEST_plan", "plan_name": "TEST Plan",
        "service_type": "dining", "meals_total": 60, "meals_used": meals_used,
        "per_day_amount": per_day, "wallet_balance": wallet,
        "start_date": (TODAY - timedelta(days=10)).isoformat(),
        "end_date": (TODAY + timedelta(days=20)).isoformat(),
        "status": "active", "paused_days": 0, "last_tick_date": last_tick,
        "scan_deducted_dates": {}, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return sid


def _txn(mdb, uid, sid, *, amount, reason, ttype="debit", balance_after=0.0, **extra):
    doc = {"txn_id": f"TEST_{uuid.uuid4().hex[:10]}", "user_id": uid, "sub_id": sid,
           "type": ttype, "amount": amount, "balance_after": balance_after,
           "reason": reason, "created_at": datetime.now(timezone.utc).isoformat()}
    doc.update(extra)
    mdb.wallet_transactions.insert_one(doc)


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token(mdb, created):
    uid, tok = _user(mdb, created, role="admin", wallet=0.0)
    return tok


def _apply(admin_token):
    r = requests.post(f"{API}/admin/reconcile-double-deduct", headers=_hdr(admin_token), timeout=180)
    assert r.status_code == 200, r.text
    return r.json()


def _dry(admin_token):
    r = requests.post(f"{API}/admin/reconcile-double-deduct?dry_run=true", headers=_hdr(admin_token), timeout=120)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- auth guard ----------
class TestAuth:
    def test_non_admin_forbidden(self, mdb, created):
        _uid, tok = _user(mdb, created)
        r = requests.post(f"{API}/admin/reconcile-double-deduct?dry_run=true", headers=_hdr(tok), timeout=60)
        assert r.status_code == 403, r.text

    def test_unauthenticated_rejected(self):
        r = requests.post(f"{API}/admin/reconcile-double-deduct?dry_run=true", timeout=60)
        assert r.status_code in (401, 403), r.text


# ---------- past-day double charge: sub-only credit ----------
class TestPastDayRefund:
    def test_past_day_refund_credits_sub_only(self, mdb, created, admin_token):
        uid, _t = _user(mdb, created, wallet=900.0)
        sid = _sub(mdb, uid, wallet=800.0, meals_used=4, last_tick=D(1))
        day = D(5)
        for meal in ("lunch", "dinner"):
            _txn(mdb, uid, sid, amount=50.0, reason=f"Scan · {meal} · {day}", balance_after=900.0)
        _txn(mdb, uid, sid, amount=100.0, reason=f"Daily deduction · {day} · 2 meals · active", balance_after=800.0)

        # dry run first — must not mutate
        dry = _dry(admin_token)
        mine = [c for c in dry["candidates"] if c["user_id"] == uid]
        assert len(mine) == 1, mine
        assert mine[0]["refund"] == 100.0 and mine[0]["meals_restore"] == 2, mine
        assert mine[0]["future"] is False
        assert "total_meals" in dry and isinstance(dry["total_meals"], int)
        assert mdb.users.find_one({"user_id": uid})["wallet_balance"] == 900.0
        assert mdb.subscriptions.find_one({"sub_id": sid})["wallet_balance"] == 800.0

        res = _apply(admin_token)
        row = [x for x in res["users"] if x["user_id"] == uid]
        assert len(row) == 1, res["users"]
        assert row[0]["refund"] == 100.0 and row[0]["meals_restored"] == 2
        u = mdb.users.find_one({"user_id": uid}, {"_id": 0})
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert u["wallet_balance"] == 900.0, "past-only refund must NOT touch user wallet"
        assert s["wallet_balance"] == 900.0, s
        assert s["meals_used"] == 2, s
        led = list(mdb.wallet_transactions.find({"user_id": uid, "kind": "double_deduct_refund"}, {"_id": 0}))
        assert len(led) == 1, led
        assert led[0]["type"] == "credit" and led[0]["amount"] == 100.0
        assert led[0]["refund_date"] == day
        assert led[0]["meals_delta"] == 2
        assert "double-deduct" in led[0]["reason"], led[0]["reason"]

        # re-run must be a no-op
        assert [c for c in _dry(admin_token)["candidates"] if c["user_id"] == uid] == []
        _apply(admin_token)
        assert mdb.users.find_one({"user_id": uid})["wallet_balance"] == 900.0
        assert mdb.subscriptions.find_one({"sub_id": sid})["wallet_balance"] == 900.0
        assert mdb.wallet_transactions.count_documents({"user_id": uid, "kind": "double_deduct_refund"}) == 1

    def test_past_day_scans_without_tick_not_refunded(self, mdb, created, admin_token):
        """Auto-paused past day: only scan rows, no tick → correct charge, no refund."""
        uid, _t = _user(mdb, created, wallet=900.0)
        sid = _sub(mdb, uid, wallet=900.0, meals_used=2, last_tick=D(1))
        day = D(4)
        for meal in ("lunch", "dinner"):
            _txn(mdb, uid, sid, amount=50.0, reason=f"Scan · {meal} · {day}", balance_after=900.0)
        assert [c for c in _dry(admin_token)["candidates"] if c["user_id"] == uid] == []


# ---------- today early-tick: BOTH wallets ----------
class TestEarlyTickRefund:
    def test_today_tick_refunds_both_wallets(self, mdb, created, admin_token):
        uid, _t = _user(mdb, created, wallet=800.0)
        sid = _sub(mdb, uid, wallet=800.0, meals_used=4, last_tick=TODAY.isoformat())
        today = TODAY.isoformat()
        _txn(mdb, uid, sid, amount=100.0, reason=f"Daily deduction · {today} · 2 meals · active", balance_after=800.0)

        dry = _dry(admin_token)
        mine = [c for c in dry["candidates"] if c["user_id"] == uid]
        assert len(mine) == 1 and mine[0]["future"] is True, mine
        assert mine[0]["refund"] == 100.0 and mine[0]["meals_restore"] == 2

        res = _apply(admin_token)
        row = [x for x in res["users"] if x["user_id"] == uid][0]
        assert row["refund"] == 100.0 and row["meals_restored"] == 2
        u = mdb.users.find_one({"user_id": uid}, {"_id": 0})
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert u["wallet_balance"] == 900.0, u
        assert s["wallet_balance"] == 900.0, s
        assert s["meals_used"] == 2, s
        led = list(mdb.wallet_transactions.find({"user_id": uid, "kind": "double_deduct_refund"}, {"_id": 0}))
        assert len(led) == 1 and "early-tick" in led[0]["reason"], led
        assert led[0]["meals_delta"] == 2
        assert [c for c in _dry(admin_token)["candidates"] if c["user_id"] == uid] == []

    def test_future_dated_tick_also_refunded(self, mdb, created, admin_token):
        uid, _t = _user(mdb, created, wallet=800.0)
        sid = _sub(mdb, uid, wallet=800.0, meals_used=2, last_tick=TODAY.isoformat())
        future = (TODAY + timedelta(days=1)).isoformat()
        _txn(mdb, uid, sid, amount=100.0, reason=f"Daily deduction · {future} · 2 meals · active", balance_after=800.0)
        res = _apply(admin_token)
        row = [x for x in res["users"] if x["user_id"] == uid]
        assert len(row) == 1, res["users"]
        assert row[0]["refund"] == 100.0
        assert mdb.users.find_one({"user_id": uid})["wallet_balance"] == 900.0
        assert mdb.subscriptions.find_one({"sub_id": sid})["wallet_balance"] == 900.0

    def test_today_tick_with_one_scan_refunds_full_tick(self, mdb, created, admin_token):
        """Today: user scanned lunch (₹50 correct) AND tick charged ₹100 →
        only the tick's ₹100 is wrong; scan charge stays."""
        uid, _t = _user(mdb, created, wallet=850.0)
        sid = _sub(mdb, uid, wallet=850.0, meals_used=3, last_tick=TODAY.isoformat())
        today = TODAY.isoformat()
        _txn(mdb, uid, sid, amount=50.0, reason=f"Scan · lunch · {today}", balance_after=950.0)
        _txn(mdb, uid, sid, amount=100.0, reason=f"Daily deduction · {today} · 2 meals · active", balance_after=850.0)
        res = _apply(admin_token)
        row = [x for x in res["users"] if x["user_id"] == uid][0]
        assert row["refund"] == 100.0, row
        assert row["meals_restored"] == 2, row
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert s["wallet_balance"] == 950.0, s
        assert s["meals_used"] == 1, s
        assert mdb.users.find_one({"user_id": uid})["wallet_balance"] == 950.0


# ---------- delta idempotency / top-up ----------
class TestDeltaTopUp:
    def test_partial_prior_refund_tops_up_delta_only(self, mdb, created, admin_token):
        uid, _t = _user(mdb, created, wallet=840.0)
        sid = _sub(mdb, uid, wallet=840.0, meals_used=4, last_tick=TODAY.isoformat())
        today = TODAY.isoformat()
        _txn(mdb, uid, sid, amount=100.0, reason=f"Daily deduction · {today} · 2 meals · active", balance_after=800.0)
        _txn(mdb, uid, sid, amount=40.0, ttype="credit", balance_after=840.0,
             reason="iter-140 refund · double-deduct · older partial",
             kind="double_deduct_refund", refund_date=today, meals_delta=0)

        res = _apply(admin_token)
        row = [x for x in res["users"] if x["user_id"] == uid][0]
        assert row["refund"] == 60.0, row
        assert row["meals_restored"] == 2, row
        assert mdb.users.find_one({"user_id": uid})["wallet_balance"] == 900.0
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert s["wallet_balance"] == 900.0 and s["meals_used"] == 2, s
        assert [c for c in _dry(admin_token)["candidates"] if c["user_id"] == uid] == []

    def test_fully_refunded_prior_run_is_skipped(self, mdb, created, admin_token):
        uid, _t = _user(mdb, created, wallet=900.0)
        sid = _sub(mdb, uid, wallet=900.0, meals_used=2, last_tick=TODAY.isoformat())
        today = TODAY.isoformat()
        _txn(mdb, uid, sid, amount=100.0, reason=f"Daily deduction · {today} · 2 meals · active", balance_after=800.0)
        _txn(mdb, uid, sid, amount=100.0, ttype="credit", balance_after=900.0,
             reason=f"iter-140 refund · early-tick · {today} · +2 meal(s)",
             kind="double_deduct_refund", refund_date=today, meals_delta=2)
        assert [c for c in _dry(admin_token)["candidates"] if c["user_id"] == uid] == []


# ---------- mixed past + today on the same sub ----------
class TestMixedDays:
    def test_past_and_today_split_user_vs_sub_credit(self, mdb, created, admin_token):
        uid, _t = _user(mdb, created, wallet=800.0)
        sid = _sub(mdb, uid, wallet=700.0, meals_used=6, last_tick=TODAY.isoformat())
        past = D(6)
        today = TODAY.isoformat()
        for meal in ("lunch", "dinner"):
            _txn(mdb, uid, sid, amount=50.0, reason=f"Scan · {meal} · {past}", balance_after=900.0)
        _txn(mdb, uid, sid, amount=100.0, reason=f"Daily deduction · {past} · 2 meals · active", balance_after=800.0)
        _txn(mdb, uid, sid, amount=100.0, reason=f"Daily deduction · {today} · 2 meals · active", balance_after=700.0)

        res = _apply(admin_token)
        row = [x for x in res["users"] if x["user_id"] == uid][0]
        assert row["refund"] == 200.0, row
        assert row["meals_restored"] == 4, row
        u = mdb.users.find_one({"user_id": uid}, {"_id": 0})
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert u["wallet_balance"] == 900.0, "only the today tick portion (₹100) hits the user wallet"
        assert s["wallet_balance"] == 900.0, s
        assert s["meals_used"] == 2, s
        led = list(mdb.wallet_transactions.find({"user_id": uid, "kind": "double_deduct_refund"}, {"_id": 0}))
        assert len(led) == 2, led
        kinds = sorted("early-tick" if "early-tick" in x["reason"] else "double-deduct" for x in led)
        assert kinds == ["double-deduct", "early-tick"], kinds
        assert [c for c in _dry(admin_token)["candidates"] if c["user_id"] == uid] == []


# ---------- meals clamp edge case ----------
class TestMealsClamp:
    def test_meals_restore_clamped_to_meals_used(self, mdb, created, admin_token):
        """meals_used is only 1 while the tool owes 2 meals. Wallet refund must
        still be full; meals_used must floor at 0 (never negative)."""
        uid, _t = _user(mdb, created, wallet=800.0)
        sid = _sub(mdb, uid, wallet=800.0, meals_used=1, last_tick=TODAY.isoformat())
        today = TODAY.isoformat()
        _txn(mdb, uid, sid, amount=100.0, reason=f"Daily deduction · {today} · 2 meals · active", balance_after=800.0)
        res = _apply(admin_token)
        row = [x for x in res["users"] if x["user_id"] == uid][0]
        assert row["refund"] == 100.0, row
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert s["meals_used"] == 0, s
        assert s["wallet_balance"] == 900.0, s
        assert row["meals_restored"] == 1, row
        # documented: ledger meals_delta records the OWED 2, response says 1
        led = mdb.wallet_transactions.find_one({"user_id": uid, "kind": "double_deduct_refund"}, {"_id": 0})
        assert led["meals_delta"] in (1, 2), led
        # no residual candidate after clamp
        assert [c for c in _dry(admin_token)["candidates"] if c["user_id"] == uid] == []
