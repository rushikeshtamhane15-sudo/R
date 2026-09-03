"""iter-140.g — Factory reset + wallet auto-derive tests.

Covers:
  1. POST /api/admin/factory-reset · guardrail (missing confirm rejected).
  2. Dry-run returns preview without mutating.
  3. Apply wipes wallet_transactions, reseeds each active sub off its
     original start_date, deducts backlog based on days elapsed, syncs
     users.wallet_balance to the sub totals, writes ONE audit row per sub.
  4. Wallet-adjust auto-derive: adding ₹465 to a 30-day/₹2,800 sub extends
     end_date by +5 days and meals_left by +10, without snapping the delta.
"""
from datetime import date, datetime, timedelta, timezone
import os, uuid, requests, pytest, sys
from pathlib import Path
from pymongo import MongoClient
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ENV = dotenv_values(str(Path(__file__).resolve().parents[1] / ".env"))
MONGO = ENV["MONGO_URL"]; DB = ENV["DB_NAME"]
API = os.environ.get("EFC_API_URL") or "http://127.0.0.1:8001/api"

IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()
def D(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()

def _hdr(t): return {"Authorization": f"Bearer {t}"}

@pytest.fixture(scope="module")
def mdb():
    c = MongoClient(MONGO); db = c[DB]; yield db; c.close()

@pytest.fixture(scope="module")
def created():
    return {"users": [], "subs": [], "txns": [], "sessions": []}

@pytest.fixture(autouse=True, scope="module")
def _cleanup(mdb, created):
    yield
    mdb.users.delete_many({"user_id": {"$in": created["users"]}})
    mdb.subscriptions.delete_many({"sub_id": {"$in": created["subs"]}})
    mdb.user_sessions.delete_many({"session_token": {"$in": created["sessions"]}})
    mdb.wallet_transactions.delete_many({"user_id": {"$in": created["users"]}})

@pytest.fixture(scope="module")
def admin_token(mdb, created):
    uid = f"TEST_iter140g_admin_{uuid.uuid4().hex[:8]}"
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
    created["sessions"].append(token)
    return token

@pytest.fixture(scope="module")
def victim_token(mdb, created):
    uid = f"TEST_iter140g_user_{uuid.uuid4().hex[:8]}"
    token = f"TEST_sess_{uuid.uuid4().hex}"
    mdb.users.insert_one({
        "user_id": uid, "email": f"TEST_{uid}@example.test", "name": "TEST user",
        "role": "subscriber", "wallet_balance": 999.0,  # bogus value that reset will overwrite
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mdb.user_sessions.insert_one({
        "user_id": uid, "session_token": token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    created["users"].append(uid); created["sessions"].append(token)
    return uid, token

@pytest.fixture(scope="module")
def victim_sub(mdb, created, victim_token):
    uid, _ = victim_token
    sid = f"TEST_sub_{uuid.uuid4().hex[:10]}"
    # Sub started 8 days ago; today's tick would have run 7 times
    # but with a fresh factory reset we expect 8 days of backlog to be
    # deducted (start_date → today).
    start = TODAY - timedelta(days=8)
    mdb.subscriptions.insert_one({
        "sub_id": sid, "user_id": uid,
        "plan_id": "test", "plan_name": "test 30d",
        "service_type": "dining", "meals_total": 60, "meals_used": 40,   # inflated bogus value
        "per_day_amount": 93.33, "wallet_balance": 500.0,               # bogus
        "plan_amount": 2800.0, "amount_paid": 2800.0,
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=30)).isoformat(),
        "last_tick_date": D(1),
        "status": "active", "paused_days": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # Seed some junk transactions so we can prove they get wiped.
    for _ in range(3):
        mdb.wallet_transactions.insert_one({
            "txn_id": f"TEST_{uuid.uuid4().hex[:10]}",
            "user_id": uid, "sub_id": sid, "type": "debit",
            "amount": 46.66, "balance_after": 500.0,
            "reason": "junk pre-reset row",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    created["subs"].append(sid)
    return {"user_id": uid, "sub_id": sid, "start_date": start.isoformat()}


class TestFactoryReset:
    def test_missing_confirm_is_rejected(self, admin_token):
        r = requests.post(f"{API}/admin/factory-reset",
                          headers=_hdr(admin_token), timeout=30)
        assert r.status_code == 400, r.text

    def test_non_admin_forbidden(self, victim_token):
        _, tok = victim_token
        r = requests.post(f"{API}/admin/factory-reset?confirm=YES-DELETE-ALL",
                          headers=_hdr(tok), timeout=30)
        assert r.status_code == 403, r.text

    def test_dry_run_does_not_mutate(self, mdb, victim_sub, admin_token):
        pre_sub = mdb.subscriptions.find_one({"sub_id": victim_sub["sub_id"]}, {"_id": 0})
        pre_txn_count = mdb.wallet_transactions.count_documents({"user_id": victim_sub["user_id"]})
        r = requests.post(f"{API}/admin/factory-reset?dry_run=true",
                          headers=_hdr(admin_token), timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is True
        assert body["would_reset_users"] >= 1
        # Nothing on disk changed
        post_sub = mdb.subscriptions.find_one({"sub_id": victim_sub["sub_id"]}, {"_id": 0})
        assert pre_sub == post_sub
        assert mdb.wallet_transactions.count_documents({"user_id": victim_sub["user_id"]}) == pre_txn_count

    def test_apply_reseeds_sub_and_wipes_ledger(self, mdb, victim_sub, admin_token):
        r = requests.post(f"{API}/admin/factory-reset?confirm=YES-DELETE-ALL",
                          headers=_hdr(admin_token), timeout=120)
        assert r.status_code == 200, r.text
        # Sub was reseeded: 8 days elapsed × per_day = 8 × 93.33 = ₹746.64 deducted
        # from ₹2,800 → wallet = 2053.36. meals_used = 8 × 2 = 16. status=active.
        s = mdb.subscriptions.find_one({"sub_id": victim_sub["sub_id"]}, {"_id": 0})
        # `days_elapsed` is capped at 30 so we assert loosely on exact value.
        assert 6 <= s["meals_used"] <= 18, s
        assert 2000.0 <= s["wallet_balance"] <= 2200.0, s
        assert s["meals_total"] == 60
        assert s["status"] == "active"
        assert s["paused_days"] == 0
        assert s["scan_deducted_dates"] == {}
        # User wallet is synced to sub wallet total.
        u = mdb.users.find_one({"user_id": victim_sub["user_id"]}, {"_id": 0})
        assert abs(u["wallet_balance"] - s["wallet_balance"]) < 0.01, (u, s)
        # Only the ONE audit "System reset · reseeded 30-day plan" row remains
        # for this user (the 3 junk debits + everything else are gone).
        txns = list(mdb.wallet_transactions.find({"user_id": victim_sub["user_id"]}, {"_id": 0}))
        assert len(txns) == 1, txns
        assert txns[0]["kind"] == "factory_reset"
        assert "System reset" in txns[0]["reason"]

    def test_users_with_no_active_sub_are_zeroed(self, mdb, created, admin_token):
        # Pre-seed a user who has a bogus wallet_balance but no active sub.
        uid = f"TEST_iter140g_orphan_{uuid.uuid4().hex[:8]}"
        mdb.users.insert_one({
            "user_id": uid, "email": f"TEST_{uid}@example.test", "name": "orphan",
            "role": "subscriber", "wallet_balance": 777.77,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        created["users"].append(uid)
        r = requests.post(f"{API}/admin/factory-reset?confirm=YES-DELETE-ALL",
                          headers=_hdr(admin_token), timeout=120)
        assert r.status_code == 200, r.text
        u = mdb.users.find_one({"user_id": uid}, {"_id": 0})
        assert u["wallet_balance"] == 0.0, u


class TestWalletAdjustAutoDerive:
    """iter-140.g — adding ₹465 to a 30-day/₹2,800 sub must extend
    end_date by +5 days and meals_left by +10, without snapping the delta."""

    @pytest.fixture(scope="class")
    def uid_sid(self, mdb, created, admin_token):
        uid = f"TEST_iter140g_wa_{uuid.uuid4().hex[:8]}"
        sid = f"TEST_sub_{uuid.uuid4().hex[:10]}"
        mdb.users.insert_one({
            "user_id": uid, "email": f"TEST_{uid}@example.test", "name": "wa",
            "phone": "9999999999", "address": "test address",
            "role": "subscriber", "wallet_balance": 2800.0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        start = TODAY.isoformat()
        end = (TODAY + timedelta(days=30)).isoformat()
        mdb.subscriptions.insert_one({
            "sub_id": sid, "user_id": uid, "plan_id": "p", "plan_name": "30d",
            "service_type": "dining", "meals_total": 60, "meals_used": 0,
            "per_day_amount": 93.33, "wallet_balance": 2800.0, "plan_amount": 2800.0,
            "start_date": start, "end_date": end,
            "last_tick_date": start, "status": "active", "paused_days": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        created["users"].append(uid); created["subs"].append(sid)
        return uid, sid, end

    def test_add_465_extends_by_5_days_and_10_meals(self, mdb, uid_sid, admin_token):
        uid, sid, orig_end = uid_sid
        r = requests.post(
            f"{API}/admin/users/{uid}/wallet-adjust",
            headers={**_hdr(admin_token), "Content-Type": "application/json"},
            json={"delta": 465.0, "reason": "Top-up test — must extend +5 days +10 meals"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("auto_derived", {}).get("days") == 5, body
        assert body.get("auto_derived", {}).get("meals") == 10, body
        assert body.get("auto_derived", {}).get("applied_delta") == 465.0, body
        # Wallet has EXACTLY 2800 + 465 = 3265, not the snapped 3266.65.
        u = mdb.users.find_one({"user_id": uid}, {"_id": 0})
        assert abs(u["wallet_balance"] - 3265.0) < 0.01, u
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert abs(s["wallet_balance"] - 3265.0) < 0.01, s
        # meals_total grew by 10 so meals_left grows without touching used.
        assert s["meals_total"] == 70, s
        assert s["meals_used"] == 0, s
        # end_date pushed forward 5 days
        new_end = date.fromisoformat(s["end_date"][:10])
        old_end = date.fromisoformat(orig_end[:10])
        assert (new_end - old_end).days == 5, (new_end, old_end)

    def test_remove_465_reduces_by_5_days_and_10_meals(self, mdb, uid_sid, admin_token):
        uid, sid, _orig_end = uid_sid
        pre = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        pre_end = date.fromisoformat(pre["end_date"][:10])
        r = requests.post(
            f"{API}/admin/users/{uid}/wallet-adjust",
            headers={**_hdr(admin_token), "Content-Type": "application/json"},
            json={"delta": -465.0, "reason": "Take-back test"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert abs(s["wallet_balance"] - 2800.0) < 0.01, s
        new_end = date.fromisoformat(s["end_date"][:10])
        assert (pre_end - new_end).days == 5
        # iter-140.g — symmetric: meals_total drops back to 60, meals_used
        # stays 0. Round-trip +465 then -465 leaves counters identical to
        # the starting state.
        assert s["meals_total"] == 60, s
        assert s["meals_used"] == 0, s
