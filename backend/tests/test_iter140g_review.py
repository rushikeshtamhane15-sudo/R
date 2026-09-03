"""iter-140.g INDEPENDENT REVIEW SUITE (testing agent).

Modules covered:
  * POST /api/admin/factory-reset  — auth guard, confirm guardrail, dry-run
    purity, apply semantics (ledger wipe, per-sub reseed off original
    start_date, backlog deduction, >30d -> expired, user wallet sync,
    orphan users zeroed, exactly ONE kind='factory_reset' audit row per sub).
  * POST /api/admin/users/{id}/wallet-adjust — auto-derive with NO snapping
    (+465 -> +5 days / +10 meals / exact rupees) and its reversal, plus
    incomplete-profile guard.

NOTE: factory-reset is GLOBAL and destructive. This suite therefore runs the
apply path only twice, in one class, and reports on the whole-DB effects.
"""
from datetime import date, datetime, timedelta, timezone
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BE_ENV = dotenv_values(str(Path(__file__).resolve().parents[1] / ".env"))
FE_ENV = dotenv_values("/app/frontend/.env")
MONGO = BE_ENV["MONGO_URL"]
DBNAME = BE_ENV["DB_NAME"]
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or FE_ENV["REACT_APP_BACKEND_URL"]).rstrip("/")
API = f"{BASE}/api"

IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()
PER_DAY = 93.33
PLAN = 2800.0


def hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mdb():
    c = MongoClient(MONGO)
    yield c[DBNAME]
    c.close()


@pytest.fixture(scope="module")
def created():
    return {"users": [], "subs": [], "sessions": []}


@pytest.fixture(scope="module", autouse=True)
def _cleanup(mdb, created):
    yield
    mdb.users.delete_many({"user_id": {"$in": created["users"]}})
    mdb.subscriptions.delete_many({"sub_id": {"$in": created["subs"]}})
    mdb.user_sessions.delete_many({"session_token": {"$in": created["sessions"]}})
    mdb.wallet_transactions.delete_many({"user_id": {"$in": created["users"]}})
    mdb.wallet_overrides.delete_many({"target_user_id": {"$in": created["users"]}})


def _mk_user(mdb, created, role, wallet=0.0, complete=True):
    uid = f"TEST_i140gr_{role}_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "email": f"TEST_{uid}@example.test",
        "name": "TEST rev",
        "role": role,
        "wallet_balance": wallet,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if complete:
        doc["phone"] = "9000000000"
        doc["address"] = "TEST address 42"
    mdb.users.insert_one(doc)
    mdb.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    created["users"].append(uid)
    created["sessions"].append(tok)
    return uid, tok


def _mk_sub(mdb, created, uid, days_ago, wallet=123.45, meals_used=41, status="active"):
    sid = f"TEST_sub_{uuid.uuid4().hex[:10]}"
    start = TODAY - timedelta(days=days_ago)
    mdb.subscriptions.insert_one({
        "sub_id": sid, "user_id": uid, "plan_id": "p", "plan_name": "TEST 30d",
        "service_type": "dining", "meals_total": 60, "meals_used": meals_used,
        "per_day_amount": PER_DAY, "wallet_balance": wallet,
        "plan_amount": PLAN, "amount_paid": PLAN,
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=17)).isoformat(),  # deliberately wrong frame
        "last_tick_date": (TODAY - timedelta(days=3)).isoformat(),
        "status": status, "paused_days": 7, "user_paused": True,
        "scan_deducted_dates": {"2026-01-01": 1},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    created["subs"].append(sid)
    return sid, start


@pytest.fixture(scope="module")
def admin(mdb, created):
    return _mk_user(mdb, created, "admin")


# ---------------------------------------------------------------- guards
class TestFactoryResetGuards:
    def test_unauthenticated_rejected(self):
        r = requests.post(f"{API}/admin/factory-reset?confirm=YES-DELETE-ALL", timeout=30)
        assert r.status_code in (401, 403), r.text

    def test_non_admin_forbidden(self, mdb, created):
        _uid, tok = _mk_user(mdb, created, "subscriber")
        r = requests.post(f"{API}/admin/factory-reset?confirm=YES-DELETE-ALL",
                          headers=hdr(tok), timeout=30)
        assert r.status_code == 403, r.text

    def test_non_admin_forbidden_even_for_dry_run(self, mdb, created):
        _uid, tok = _mk_user(mdb, created, "subscriber")
        r = requests.post(f"{API}/admin/factory-reset?dry_run=true", headers=hdr(tok), timeout=30)
        assert r.status_code == 403, r.text

    def test_missing_confirm_400(self, admin):
        _uid, tok = admin
        r = requests.post(f"{API}/admin/factory-reset", headers=hdr(tok), timeout=30)
        assert r.status_code == 400, r.text
        assert "YES-DELETE-ALL" in r.text

    def test_wrong_confirm_400(self, admin):
        _uid, tok = admin
        r = requests.post(f"{API}/admin/factory-reset?confirm=yes-delete-all",
                          headers=hdr(tok), timeout=30)
        assert r.status_code == 400, r.text


# ---------------------------------------------------------------- dry run
class TestFactoryResetDryRun:
    def test_dry_run_shape_and_purity(self, mdb, created, admin):
        _uid, tok = admin
        vuid, _ = _mk_user(mdb, created, "subscriber", wallet=555.0)
        sid, _start = _mk_sub(mdb, created, vuid, days_ago=8)
        pre_sub = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        pre_user = mdb.users.find_one({"user_id": vuid}, {"_id": 0})
        pre_txn_total = mdb.wallet_transactions.count_documents({})

        r = requests.post(f"{API}/admin/factory-reset?dry_run=true", headers=hdr(tok), timeout=120)
        assert r.status_code == 200, r.text
        b = r.json()
        for k in ("dry_run", "would_reset_users", "would_delete_txns", "total_deducted_after_reset"):
            assert k in b, b
        assert b["dry_run"] is True
        assert b["would_reset_users"] >= 1
        assert b["would_delete_txns"] == pre_txn_total
        assert isinstance(b["total_deducted_after_reset"], (int, float))
        # purity
        assert mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0}) == pre_sub
        assert mdb.users.find_one({"user_id": vuid}, {"_id": 0}) == pre_user
        assert mdb.wallet_transactions.count_documents({}) == pre_txn_total

    def test_dry_run_works_without_confirm(self, admin):
        _uid, tok = admin
        r = requests.post(f"{API}/admin/factory-reset?dry_run=true", headers=hdr(tok), timeout=120)
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------- apply
class TestFactoryResetApply:
    @pytest.fixture(scope="class")
    def scenario(self, mdb, created, admin):
        """Seed 4 shapes then apply the reset ONCE and return the snapshot."""
        _auid, tok = admin
        # a) started 8 days ago, active
        u8, _ = _mk_user(mdb, created, "subscriber", wallet=999.0)
        s8, st8 = _mk_sub(mdb, created, u8, days_ago=8)
        # b) started today
        u0, _ = _mk_user(mdb, created, "subscriber", wallet=1.0)
        s0, st0 = _mk_sub(mdb, created, u0, days_ago=0)
        # c) started 40 days ago -> should be expired
        u40, _ = _mk_user(mdb, created, "subscriber", wallet=1234.0)
        s40, st40 = _mk_sub(mdb, created, u40, days_ago=40)
        # d) orphan user with wallet residue, no sub
        uorph, _ = _mk_user(mdb, created, "subscriber", wallet=777.77)
        # e) user with an already-expired sub -> should be zeroed too
        uexp, _ = _mk_user(mdb, created, "subscriber", wallet=321.0)
        sexp, _ = _mk_sub(mdb, created, uexp, days_ago=5, status="expired")
        # junk ledger rows
        for uid in (u8, u0, u40, uorph):
            for _ in range(2):
                mdb.wallet_transactions.insert_one({
                    "txn_id": f"TEST_{uuid.uuid4().hex[:10]}", "user_id": uid,
                    "type": "debit", "amount": 46.66, "balance_after": 0.0,
                    "reason": "TEST junk pre-reset", "created_at": datetime.now(timezone.utc).isoformat(),
                })
        pre_total_txns = mdb.wallet_transactions.count_documents({})
        r = requests.post(f"{API}/admin/factory-reset?confirm=YES-DELETE-ALL",
                          headers=hdr(tok), timeout=180)
        assert r.status_code == 200, r.text
        return {
            "resp": r.json(), "pre_total_txns": pre_total_txns,
            "u8": u8, "s8": s8, "st8": st8,
            "u0": u0, "s0": s0, "st0": st0,
            "u40": u40, "s40": s40, "st40": st40,
            "uorph": uorph, "uexp": uexp, "sexp": sexp,
        }

    def test_response_shape(self, scenario):
        b = scenario["resp"]
        assert b["ok"] is True
        assert b["reset_users"] >= 3
        assert b["txns_deleted"] == scenario["pre_total_txns"]

    def test_ledger_wiped_except_audit_rows(self, mdb, scenario):
        # every remaining txn must be a factory_reset audit row
        non_audit = mdb.wallet_transactions.count_documents({"kind": {"$ne": "factory_reset"}})
        assert non_audit == 0, f"{non_audit} non-audit ledger rows survived the wipe"
        assert mdb.wallet_transactions.count_documents({"reason": "TEST junk pre-reset"}) == 0

    def test_8_day_sub_reseeded_off_original_start_date(self, mdb, scenario):
        s = mdb.subscriptions.find_one({"sub_id": scenario["s8"]}, {"_id": 0})
        assert s["start_date"] == scenario["st8"].isoformat()
        assert s["meals_used"] == 8 * 2, s
        assert s["meals_total"] == 60, s
        assert abs(s["wallet_balance"] - round(PLAN - 8 * PER_DAY, 2)) < 0.01, s
        assert s["status"] == "active"
        assert s["paused_days"] == 0
        assert s["user_paused"] is False
        assert s["scan_deducted_dates"] == {}
        assert s["last_tick_date"] == (TODAY - timedelta(days=1)).isoformat()
        assert s["end_date"] == (scenario["st8"] + timedelta(days=30)).isoformat()[:10] or True

    def test_end_date_is_start_plus_30(self, mdb, scenario):
        s = mdb.subscriptions.find_one({"sub_id": scenario["s8"]}, {"_id": 0})
        assert date.fromisoformat(s["end_date"][:10]) == scenario["st8"] + timedelta(days=30), s["end_date"]

    def test_today_start_sub_gets_full_plan(self, mdb, scenario):
        s = mdb.subscriptions.find_one({"sub_id": scenario["s0"]}, {"_id": 0})
        assert s["meals_used"] == 0, s
        assert abs(s["wallet_balance"] - PLAN) < 0.01, s
        assert s["status"] == "active"

    def test_over_30_day_sub_expired_and_capped(self, mdb, scenario):
        s = mdb.subscriptions.find_one({"sub_id": scenario["s40"]}, {"_id": 0})
        assert s["status"] == "expired", s
        assert s["meals_used"] == 60, s          # capped at meals_total
        assert abs(s["wallet_balance"] - max(0.0, round(PLAN - 30 * PER_DAY, 2))) < 0.01, s

    def test_user_wallet_synced_to_sub_wallet(self, mdb, scenario):
        for uk, sk in (("u8", "s8"), ("u0", "s0")):
            u = mdb.users.find_one({"user_id": scenario[uk]}, {"_id": 0})
            s = mdb.subscriptions.find_one({"sub_id": scenario[sk]}, {"_id": 0})
            assert abs(u["wallet_balance"] - s["wallet_balance"]) < 0.01, (uk, u["wallet_balance"], s["wallet_balance"])

    def test_orphan_and_expired_only_users_zeroed(self, mdb, scenario):
        assert mdb.users.find_one({"user_id": scenario["uorph"]}, {"_id": 0})["wallet_balance"] == 0.0
        assert mdb.users.find_one({"user_id": scenario["uexp"]}, {"_id": 0})["wallet_balance"] == 0.0

    def test_pre_expired_sub_left_untouched(self, mdb, scenario):
        s = mdb.subscriptions.find_one({"sub_id": scenario["sexp"]}, {"_id": 0})
        # endpoint only touches status='active' subs
        assert s["wallet_balance"] == 123.45, s
        assert s["meals_used"] == 41, s

    def test_exactly_one_audit_row_per_sub(self, mdb, scenario):
        for uk in ("u8", "u0", "u40"):
            rows = list(mdb.wallet_transactions.find({"user_id": scenario[uk]}, {"_id": 0}))
            assert len(rows) == 1, (uk, rows)
            assert rows[0]["kind"] == "factory_reset"
            assert "System reset" in rows[0]["reason"]
            assert rows[0]["actor_user_id"]
        assert mdb.wallet_transactions.count_documents({"user_id": scenario["uorph"]}) == 0

    def test_idempotent_second_run(self, mdb, scenario, admin):
        """Running it again must produce the same reseeded state (no drift)."""
        _uid, tok = admin
        before = mdb.subscriptions.find_one({"sub_id": scenario["s8"]},
                                            {"_id": 0, "wallet_balance": 1, "meals_used": 1, "end_date": 1})
        r = requests.post(f"{API}/admin/factory-reset?confirm=YES-DELETE-ALL",
                          headers=hdr(tok), timeout=180)
        assert r.status_code == 200, r.text
        after = mdb.subscriptions.find_one({"sub_id": scenario["s8"]},
                                           {"_id": 0, "wallet_balance": 1, "meals_used": 1, "end_date": 1})
        assert before == after, (before, after)
        rows = list(mdb.wallet_transactions.find({"user_id": scenario["u8"]}, {"_id": 0}))
        assert len(rows) == 1, rows


# ---------------------------------------------------------------- wallet-adjust
class TestWalletAdjustNoSnap:
    @pytest.fixture(scope="class")
    def target(self, mdb, created):
        uid, _ = _mk_user(mdb, created, "subscriber", wallet=PLAN)
        sid = f"TEST_sub_{uuid.uuid4().hex[:10]}"
        start = TODAY.isoformat()
        end = (TODAY + timedelta(days=30)).isoformat()
        mdb.subscriptions.insert_one({
            "sub_id": sid, "user_id": uid, "plan_id": "p", "plan_name": "30d",
            "service_type": "dining", "meals_total": 60, "meals_used": 0,
            "per_day_amount": PER_DAY, "wallet_balance": PLAN, "plan_amount": PLAN,
            "start_date": start, "end_date": end, "last_tick_date": start,
            "status": "active", "paused_days": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        created["subs"].append(sid)
        return uid, sid, end

    def test_add_465_no_snap(self, mdb, target, admin):
        uid, sid, end = target
        _a, tok = admin
        r = requests.post(f"{API}/admin/users/{uid}/wallet-adjust", headers=hdr(tok),
                          json={"delta": 465.0, "reason": "TEST no-snap top-up"}, timeout=60)
        assert r.status_code == 200, r.text
        ad = r.json().get("auto_derived") or {}
        assert ad.get("days") == 5, ad
        assert ad.get("meals") == 10, ad
        assert abs(float(ad.get("snapped_delta")) - 465.0) < 0.001, ad
        assert abs(float(ad.get("residue"))) < 0.001, ad
        u = mdb.users.find_one({"user_id": uid}, {"_id": 0})
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert abs(u["wallet_balance"] - (PLAN + 465.0)) < 0.01, u["wallet_balance"]
        assert abs(s["wallet_balance"] - (PLAN + 465.0)) < 0.01, s["wallet_balance"]
        assert s["meals_total"] == 70, s
        assert s["meals_used"] == 0, s
        assert date.fromisoformat(s["end_date"][:10]) == date.fromisoformat(end[:10]) + timedelta(days=5)

    def test_remove_465_reverses(self, mdb, target, admin):
        uid, sid, _end = target
        _a, tok = admin
        pre = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        pre_end = date.fromisoformat(pre["end_date"][:10])
        r = requests.post(f"{API}/admin/users/{uid}/wallet-adjust", headers=hdr(tok),
                          json={"delta": -465.0, "reason": "TEST no-snap take-back"}, timeout=60)
        assert r.status_code == 200, r.text
        ad = r.json().get("auto_derived") or {}
        assert ad.get("days") == -5, ad
        assert ad.get("meals") == -10, ad
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert abs(s["wallet_balance"] - PLAN) < 0.01, s["wallet_balance"]
        u = mdb.users.find_one({"user_id": uid}, {"_id": 0})
        assert abs(u["wallet_balance"] - PLAN) < 0.01, u["wallet_balance"]
        assert date.fromisoformat(s["end_date"][:10]) == pre_end - timedelta(days=5)
        assert s["meals_used"] == 10, s

    def test_small_delta_below_one_day_no_derive(self, mdb, created, admin):
        """₹20 at ₹93.33/day rounds to 0 days -> wallet-only change."""
        _a, tok = admin
        uid, _ = _mk_user(mdb, created, "subscriber", wallet=100.0)
        sid = f"TEST_sub_{uuid.uuid4().hex[:10]}"
        mdb.subscriptions.insert_one({
            "sub_id": sid, "user_id": uid, "plan_id": "p", "plan_name": "30d",
            "service_type": "dining", "meals_total": 60, "meals_used": 0,
            "per_day_amount": PER_DAY, "wallet_balance": 100.0, "plan_amount": PLAN,
            "start_date": TODAY.isoformat(), "end_date": (TODAY + timedelta(days=30)).isoformat(),
            "last_tick_date": TODAY.isoformat(), "status": "active", "paused_days": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        created["subs"].append(sid)
        r = requests.post(f"{API}/admin/users/{uid}/wallet-adjust", headers=hdr(tok),
                          json={"delta": 20.0, "reason": "TEST tiny credit"}, timeout=60)
        assert r.status_code == 200, r.text
        ad = r.json().get("auto_derived") or {}
        assert ad.get("days") == 0, ad
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert abs(s["wallet_balance"] - 120.0) < 0.01, s
        assert s["meals_total"] == 60 and s["meals_used"] == 0, s
        assert date.fromisoformat(s["end_date"][:10]) == TODAY + timedelta(days=30)

    def test_explicit_fields_disable_autoderive(self, mdb, created, admin):
        _a, tok = admin
        uid, _ = _mk_user(mdb, created, "subscriber", wallet=500.0)
        sid = f"TEST_sub_{uuid.uuid4().hex[:10]}"
        mdb.subscriptions.insert_one({
            "sub_id": sid, "user_id": uid, "plan_id": "p", "plan_name": "30d",
            "service_type": "dining", "meals_total": 60, "meals_used": 4,
            "per_day_amount": PER_DAY, "wallet_balance": 500.0, "plan_amount": PLAN,
            "start_date": TODAY.isoformat(), "end_date": (TODAY + timedelta(days=10)).isoformat(),
            "last_tick_date": TODAY.isoformat(), "status": "active", "paused_days": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        created["subs"].append(sid)
        r = requests.post(f"{API}/admin/users/{uid}/wallet-adjust", headers=hdr(tok),
                          json={"delta": 465.0, "extend_days": 1, "reason": "TEST explicit"}, timeout=60)
        assert r.status_code == 200, r.text
        ad = r.json().get("auto_derived") or {}
        assert ad.get("days") == 0, ad
        s = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert abs(s["wallet_balance"] - 965.0) < 0.01, s
        assert date.fromisoformat(s["end_date"][:10]) == TODAY + timedelta(days=11)
        assert s["meals_total"] == 60, s

    def test_incomplete_profile_rejected(self, mdb, created, admin):
        _a, tok = admin
        uid, _ = _mk_user(mdb, created, "subscriber", wallet=10.0, complete=False)
        r = requests.post(f"{API}/admin/users/{uid}/wallet-adjust", headers=hdr(tok),
                          json={"delta": 465.0, "reason": "TEST incomplete"}, timeout=60)
        assert r.status_code == 400, r.text
        assert "profile" in r.text.lower()

    def test_missing_reason_rejected(self, mdb, target, admin):
        uid, _sid, _e = target
        _a, tok = admin
        r = requests.post(f"{API}/admin/users/{uid}/wallet-adjust", headers=hdr(tok),
                          json={"delta": 465.0, "reason": "  "}, timeout=60)
        assert r.status_code == 400, r.text

    def test_non_admin_cannot_adjust(self, mdb, created, target):
        uid, _sid, _e = target
        _u, tok = _mk_user(mdb, created, "subscriber")
        r = requests.post(f"{API}/admin/users/{uid}/wallet-adjust", headers=hdr(tok),
                          json={"delta": 100.0, "reason": "TEST hack"}, timeout=60)
        assert r.status_code == 403, r.text
