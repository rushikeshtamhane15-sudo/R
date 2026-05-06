"""Iter9: empty-tiffin SMS reminders + auto-expire on wallet=0 + geocode cache + dashboard preseed."""
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _ist_today():
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date().isoformat()


def _seed_session(role="admin"):
    uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
    tok = f"TEST_s_{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": uid,
        "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com",
        "phone": f"99{uuid.uuid4().int % 10**8:08d}",
        "name": f"Test {role}",
        "role": role,
        "qr_token": f"qr_TEST_{uuid.uuid4().hex[:10]}",
        "photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        "created_at": now.isoformat(),
        "wallet_balance": 0.0,
    })
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "created_at": now.isoformat(),
    })
    return uid, tok


@pytest.fixture
def admin():
    uid, tok = _seed_session("admin")
    yield {"user_id": uid, "token": tok}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_one({"session_token": tok})


# ----------- /admin/cron/run-reminders -----------
class TestReminders:
    def test_admin_only(self):
        r = requests.post(f"{BASE_URL}/api/admin/cron/run-reminders")
        assert r.status_code in (401, 403)

    def test_runs_returns_shape(self, admin):
        r = requests.post(f"{BASE_URL}/api/admin/cron/run-reminders", headers=_h(admin["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert "stub_mode" in d
        # Either we're in a reminder window or not — both responses are valid
        assert any(k in d for k in ("sent", "skipped"))

    def test_dedupe_in_window(self, admin):
        """Force a reminder window by setting lunch_open to NOW IST and lead=120 min,
        seed a tiffin holder, run reminders twice → second run should skip via dedupe."""
        ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).time()
        # Round to next minute to keep window open
        open_at = f"{(ist.hour + 1) % 24:02d}:{ist.minute:02d}"
        # Save current settings, then patch
        prev = db.delivery_settings.find_one({"_id": "active"}) or {}
        db.delivery_settings.update_one(
            {"_id": "active"},
            {"$set": {
                "lunch_dispatch_open": open_at,
                "reminder_enabled": True,
                "reminder_lead_minutes": 120,
            }},
            upsert=True,
        )
        # Seed customer with tiffin_balance + active sub
        uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
        sid = f"sub_TEST_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc)
        db.users.insert_one({
            "user_id": uid,
            "phone": f"9111{uuid.uuid4().int % 10**6:06d}",
            "name": "Tiffin Holder",
            "role": "subscriber",
            "tiffin_balance": 2,
            "created_at": now.isoformat(),
        })
        db.subscriptions.insert_one({
            "user_id": uid,
            "sub_id": sid,
            "plan_id": "premium_60",
            "plan_name": "Premium",
            "service_type": "tiffin",
            "status": "active",
            "wallet_balance": 1000.0,
            "amount_paid": 1000.0,
            "per_day_amount": 100,
            "meals_total": 60,
            "meals_used": 0,
            "paused_days": 0,
            "start_date": (now - timedelta(days=1)).isoformat(),
            "end_date": (now + timedelta(days=29)).isoformat(),
            "last_tick_date": _ist_today(),
        })
        try:
            r1 = requests.post(f"{BASE_URL}/api/admin/cron/run-reminders", headers=_h(admin["token"]))
            d1 = r1.json()
            r2 = requests.post(f"{BASE_URL}/api/admin/cron/run-reminders", headers=_h(admin["token"]))
            d2 = r2.json()
            # First call: should have included this user in 'sent'. Second: 'skipped' should grow.
            assert (d1.get("sent") or 0) >= 1, f"First reminder run did not send for our seeded user: {d1}"
            sent_log = list(db.tiffin_reminders_sent.find({"user_id": uid}))
            assert len(sent_log) == 1, f"Expected 1 reminder-sent log, got {len(sent_log)}: {sent_log}"
            assert d2.get("skipped", 0) >= 1
        finally:
            db.users.delete_one({"user_id": uid})
            db.subscriptions.delete_one({"sub_id": sid})
            db.tiffin_reminders_sent.delete_many({"user_id": uid})
            # Restore previous settings
            if prev:
                prev.pop("_id", None)
                db.delivery_settings.update_one({"_id": "active"}, {"$set": prev}, upsert=True)


# ----------- Auto-expire wallet=0 with 1-day grace -----------
class TestAutoExpire:
    def test_grace_started_then_expires(self, admin):
        sid = f"sub_TEST_{uuid.uuid4().hex[:8]}"
        uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
        now = datetime.now(timezone.utc)
        db.users.insert_one({"user_id": uid, "phone": "9000000999", "role": "subscriber", "wallet_balance": 0.0, "created_at": now.isoformat()})
        db.subscriptions.insert_one({
            "user_id": uid,
            "sub_id": sid,
            "plan_id": "premium_60",
            "plan_name": "Premium",
            "service_type": "tiffin",
            "status": "active",
            "wallet_balance": 0.0,
            "amount_paid": 1000.0,
            "per_day_amount": 100,
            "meals_total": 60,
            "meals_used": 0,
            "paused_days": 0,
            "start_date": (now - timedelta(days=1)).isoformat(),
            "end_date": (now + timedelta(days=29)).isoformat(),
            "last_tick_date": _ist_today(),
        })
        try:
            # First tick → grace window starts
            r1 = requests.post(f"{BASE_URL}/api/admin/cron/run-tick", headers=_h(admin["token"]))
            assert r1.status_code == 200, r1.text
            sub_after_1 = db.subscriptions.find_one({"sub_id": sid})
            assert sub_after_1["status"] == "active"
            assert sub_after_1.get("zero_wallet_grace_until")
            # Second tick after the grace window expired — fast-forward by setting grace_until to past
            db.subscriptions.update_one(
                {"sub_id": sid},
                {"$set": {"zero_wallet_grace_until": (now - timedelta(hours=1)).isoformat()}},
            )
            r2 = requests.post(f"{BASE_URL}/api/admin/cron/run-tick", headers=_h(admin["token"]))
            assert r2.status_code == 200
            sub_after_2 = db.subscriptions.find_one({"sub_id": sid})
            assert sub_after_2["status"] == "expired"
            assert sub_after_2.get("expired_reason") == "wallet_zero"
        finally:
            db.users.delete_one({"user_id": uid})
            db.subscriptions.delete_one({"sub_id": sid})

    def test_grace_clears_on_topup(self, admin):
        """If wallet recovers (refund/topup) before grace elapses, grace flag clears."""
        sid = f"sub_TEST_{uuid.uuid4().hex[:8]}"
        uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
        now = datetime.now(timezone.utc)
        db.users.insert_one({"user_id": uid, "phone": "9000000998", "role": "subscriber", "wallet_balance": 0.0, "created_at": now.isoformat()})
        db.subscriptions.insert_one({
            "user_id": uid,
            "sub_id": sid,
            "plan_id": "premium_60",
            "plan_name": "Premium",
            "service_type": "tiffin",
            "status": "active",
            "wallet_balance": 0.0,
            "amount_paid": 1000.0,
            "per_day_amount": 100,
            "meals_total": 60,
            "meals_used": 0,
            "paused_days": 0,
            "start_date": (now - timedelta(days=1)).isoformat(),
            "end_date": (now + timedelta(days=29)).isoformat(),
            "last_tick_date": _ist_today(),
            "zero_wallet_grace_until": (now + timedelta(hours=20)).isoformat(),
        })
        try:
            # Top up the wallet
            db.subscriptions.update_one({"sub_id": sid}, {"$set": {"wallet_balance": 500.0}})
            # Run tick — grace flag should be cleared
            requests.post(f"{BASE_URL}/api/admin/cron/run-tick", headers=_h(admin["token"]))
            sub = db.subscriptions.find_one({"sub_id": sid})
            assert sub["status"] == "active"
            assert "zero_wallet_grace_until" not in sub
        finally:
            db.users.delete_one({"user_id": uid})
            db.subscriptions.delete_one({"sub_id": sid})


# ----------- Geocode response includes status -----------
class TestGeocodeStatus:
    def test_location_returns_status(self, admin):
        # Promote admin to subscriber for the location endpoint? — endpoint is auth-only, role-agnostic
        r = requests.post(
            f"{BASE_URL}/api/auth/location",
            headers=_h(admin["token"]),
            json={"lat": 28.6139, "lng": 77.2090},  # New Delhi
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "geocode_status" in d
        assert d["geocode_status"] in ("ok", "cached", "no_pincode", "rate_limited", "error", "invalid")

    def test_location_invalid_coords(self, admin):
        r = requests.post(
            f"{BASE_URL}/api/auth/location",
            headers=_h(admin["token"]),
            json={"lat": 999.0, "lng": -999.0},
        )
        # The endpoint stores whatever comes in, but reverse-geocode flags invalid
        assert r.status_code == 200
        assert r.json()["geocode_status"] == "invalid"
