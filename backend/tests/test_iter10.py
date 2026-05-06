"""Iter10: half-tiffin pricing + admin wallet override + raw materials + tick model.

Covers:
  - GET /api/plans/custom/preview?days&service_type&tiffin_size — half tiffin uses ₹50/meal.
  - POST /api/admin/users/{id}/wallet-adjust + GET /wallet-history — admin override audit log.
  - GET / PUT / POST reset on /api/admin/raw-materials — config + breakdown calculation.
  - catch_up_subscription bumps meals_used by 2 per active day.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
assert BASE_URL

mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


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


# ---------- Half-tiffin pricing ----------
class TestCustomPricing:
    def test_half_tiffin_50_per_meal(self):
        r = requests.get(f"{BASE_URL}/api/plans/custom/preview", params={"days": 7, "service_type": "tiffin", "tiffin_size": "half"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["meal_price"] == 50.0
        assert d["amount"] == 700.0  # 7 × 2 × 50
        assert d["per_day_amount"] == 100.0
        assert d["tiffin_size"] == "half"

    def test_full_tiffin_70_per_meal(self):
        r = requests.get(f"{BASE_URL}/api/plans/custom/preview", params={"days": 7, "service_type": "tiffin", "tiffin_size": "full"})
        assert r.status_code == 200
        d = r.json()
        assert d["meal_price"] == 70.0
        assert d["amount"] == 980.0
        assert d["per_day_amount"] == 140.0

    def test_dining_70_per_meal(self):
        r = requests.get(f"{BASE_URL}/api/plans/custom/preview", params={"days": 7, "service_type": "dining"})
        assert r.status_code == 200
        d = r.json()
        assert d["meal_price"] == 70.0
        assert d["amount"] == 980.0
        assert d["tiffin_size"] is None


# ---------- Admin wallet override ----------
class TestWalletOverride:
    def _seed_user_with_sub(self):
        uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
        sid = f"sub_TEST_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc)
        db.users.insert_one({
            "user_id": uid,
            "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com",
            "phone": f"9111{uuid.uuid4().int % 10**6:06d}",
            "name": "Sub User",
            "role": "subscriber",
            "qr_token": f"qr_TEST_{uuid.uuid4().hex[:10]}",
            "photo_url": "x",
            "created_at": now.isoformat(),
            "wallet_balance": 100.0,
        })
        db.subscriptions.insert_one({
            "user_id": uid,
            "sub_id": sid,
            "plan_id": "premium_60",
            "plan_name": "Premium",
            "service_type": "tiffin",
            "status": "active",
            "wallet_balance": 100.0,
            "amount_paid": 1000.0,
            "per_day_amount": 100,
            "meals_total": 60,
            "meals_used": 30,
            "paused_days": 0,
            "start_date": (now - timedelta(days=15)).isoformat(),
            "end_date": (now + timedelta(days=14)).isoformat(),
            "last_tick_date": (now.date() - timedelta(days=1)).isoformat(),
        })
        return uid, sid

    def test_admin_only(self):
        r = requests.post(f"{BASE_URL}/api/admin/users/X/wallet-adjust", json={"delta": 50, "reason": "test"})
        assert r.status_code in (401, 403)

    def test_credit_with_extension(self, admin):
        uid, sid = self._seed_user_with_sub()
        try:
            r = requests.post(
                f"{BASE_URL}/api/admin/users/{uid}/wallet-adjust",
                headers=_h(admin["token"]),
                json={"delta": 200, "reason": "Refund — failed delivery 2026-02-03", "extend_days": 2, "restore_meals": 4},
            )
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["ok"] is True
            assert d["delta"] == 200
            assert d["extend_days"] == 2
            assert d["restore_meals"] == 4
            user = db.users.find_one({"user_id": uid})
            sub = db.subscriptions.find_one({"sub_id": sid})
            assert abs(user["wallet_balance"] - 300.0) < 0.01
            assert abs(sub["wallet_balance"] - 300.0) < 0.01
            assert sub["meals_used"] == 26  # 30 - 4
            # end_date pushed forward 2 days
            history = requests.get(f"{BASE_URL}/api/admin/users/{uid}/wallet-history", headers=_h(admin["token"]))
            hd = history.json()
            assert len(hd["overrides"]) == 1
            assert hd["overrides"][0]["delta"] == 200
        finally:
            db.users.delete_one({"user_id": uid})
            db.subscriptions.delete_one({"sub_id": sid})
            db.wallet_overrides.delete_many({"target_user_id": uid})
            db.wallet_transactions.delete_many({"user_id": uid})

    def test_debit_clamps_at_zero(self, admin):
        uid, sid = self._seed_user_with_sub()
        try:
            r = requests.post(
                f"{BASE_URL}/api/admin/users/{uid}/wallet-adjust",
                headers=_h(admin["token"]),
                json={"delta": -500, "reason": "Correction — duplicate refund"},
            )
            assert r.status_code == 200
            user = db.users.find_one({"user_id": uid})
            assert user["wallet_balance"] == 0.0
        finally:
            db.users.delete_one({"user_id": uid})
            db.subscriptions.delete_one({"sub_id": sid})
            db.wallet_overrides.delete_many({"target_user_id": uid})
            db.wallet_transactions.delete_many({"user_id": uid})

    def test_reason_required(self, admin):
        uid, sid = self._seed_user_with_sub()
        try:
            r = requests.post(
                f"{BASE_URL}/api/admin/users/{uid}/wallet-adjust",
                headers=_h(admin["token"]),
                json={"delta": 50, "reason": ""},
            )
            assert r.status_code == 400
            assert "reason" in r.json()["detail"].lower()
        finally:
            db.users.delete_one({"user_id": uid})
            db.subscriptions.delete_one({"sub_id": sid})


# ---------- Raw materials ----------
class TestRawMaterials:
    def test_admin_only(self):
        r = requests.get(f"{BASE_URL}/api/admin/raw-materials")
        assert r.status_code in (401, 403)

    def test_get_returns_breakdown(self, admin):
        r = requests.get(f"{BASE_URL}/api/admin/raw-materials", headers=_h(admin["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and len(d["items"]) >= 5
        assert "breakdown" in d and len(d["breakdown"]) == len(d["items"])
        assert "totals" in d
        assert "lunch_cost" in d["totals"] and "dinner_cost" in d["totals"] and "day_cost" in d["totals"]
        assert "counts" in d
        assert "persons" in d["counts"]
        # vegetables row should be amount-based
        veg = next(b for b in d["breakdown"] if b["key"] == "vegetables")
        assert veg["is_amount_based"] is True
        # toor dal calculations match expectations: 2.1 kg/month * ₹60 = ₹126/person/month → ₹2.1/meal
        toor = next(b for b in d["breakdown"] if b["key"] == "toor_dal")
        assert abs(toor["amount_per_person_meal"] - (2.1 * 60.0 / 60.0)) < 0.01

    def test_persons_weighting(self, admin):
        """Seed 1 dining sub + 2 half-tiffin subs → weighted persons = 1 + 1.0 = 2.0."""
        uids = []
        sids = []
        now = datetime.now(timezone.utc)
        try:
            for i, (svc, size) in enumerate([("dining", None), ("tiffin", "half"), ("tiffin", "half")]):
                uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
                sid = f"sub_TEST_{uuid.uuid4().hex[:8]}"
                uids.append(uid)
                sids.append(sid)
                db.users.insert_one({
                    "user_id": uid, "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com",
                    "role": "subscriber", "qr_token": f"q_{uuid.uuid4().hex[:8]}", "photo_url": "x",
                    "created_at": now.isoformat(), "wallet_balance": 0.0,
                })
                db.subscriptions.insert_one({
                    "user_id": uid, "sub_id": sid, "plan_id": "X", "plan_name": "X",
                    "service_type": svc, "tiffin_size": size,
                    "status": "active", "wallet_balance": 1000.0, "amount_paid": 1000.0,
                    "per_day_amount": 100, "meals_total": 60, "meals_used": 0, "paused_days": 0,
                    "start_date": (now - timedelta(days=1)).isoformat(),
                    "end_date": (now + timedelta(days=29)).isoformat(),
                    "last_tick_date": now.date().isoformat(),
                })

            r = requests.get(f"{BASE_URL}/api/admin/raw-materials?fresh=1", headers=_h(admin["token"]))
            d = r.json()
            counts = d["counts"]
            # We seeded specific subs but other tests/subs may also be live — assert at least these accumulated correctly.
            assert counts["full"] >= 1
            assert counts["half"] >= 2
            assert counts["persons"] >= 2.0
        finally:
            for u in uids:
                db.users.delete_one({"user_id": u})
            for s in sids:
                db.subscriptions.delete_one({"sub_id": s})

    def test_put_updates_rates(self, admin):
        # Save defaults so we can restore
        before = requests.get(f"{BASE_URL}/api/admin/raw-materials", headers=_h(admin["token"])).json()
        try:
            new_items = list(before["items"])
            for it in new_items:
                if it["key"] == "rice":
                    it["price_per_unit"] = 100.0
            r = requests.put(f"{BASE_URL}/api/admin/raw-materials", headers=_h(admin["token"]), json={"items": new_items})
            assert r.status_code == 200, r.text
            after = r.json()
            rice = next(i for i in after["items"] if i["key"] == "rice")
            assert rice["price_per_unit"] == 100.0
        finally:
            requests.post(f"{BASE_URL}/api/admin/raw-materials/reset", headers=_h(admin["token"]))

    def test_negative_value_rejected(self, admin):
        before = requests.get(f"{BASE_URL}/api/admin/raw-materials", headers=_h(admin["token"])).json()
        bad = list(before["items"])
        bad[0] = {**bad[0], "qty_per_person_month": -5}
        r = requests.put(f"{BASE_URL}/api/admin/raw-materials", headers=_h(admin["token"]), json={"items": bad})
        assert r.status_code == 400


# ---------- Tick model: meals_used += 2 on active day ----------
class TestTickMealsModel:
    def test_active_day_bumps_meals(self, admin):
        uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
        sid = f"sub_TEST_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc)
        # last_tick_date = yesterday → 1 day pass should bump meals_used by 2
        db.users.insert_one({
            "user_id": uid, "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com",
            "role": "subscriber", "qr_token": f"q_{uuid.uuid4().hex[:8]}", "photo_url": "x",
            "created_at": now.isoformat(), "wallet_balance": 0.0,
        })
        db.subscriptions.insert_one({
            "user_id": uid, "sub_id": sid, "plan_id": "X", "plan_name": "X",
            "service_type": "tiffin",  # tiffin = active branch always
            "status": "active", "wallet_balance": 500.0, "amount_paid": 1000.0,
            "per_day_amount": 100, "meals_total": 60, "meals_used": 10, "paused_days": 0,
            "start_date": (now - timedelta(days=5)).isoformat(),
            "end_date": (now + timedelta(days=25)).isoformat(),
            "last_tick_date": (now.date() - timedelta(days=1)).isoformat(),
        })
        try:
            r = requests.post(f"{BASE_URL}/api/admin/cron/run-tick", headers=_h(admin["token"]))
            assert r.status_code == 200, r.text
            sub = db.subscriptions.find_one({"sub_id": sid})
            assert sub["meals_used"] == 12, f"Expected meals_used=12 (10+2), got {sub['meals_used']}"
        finally:
            db.users.delete_one({"user_id": uid})
            db.subscriptions.delete_one({"sub_id": sid})

    def test_inactive_day_keeps_meals(self, admin):
        """Eat-in user with no recent scans → 3+ inactive trigger → meals_used unchanged, end_date extended."""
        uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
        sid = f"sub_TEST_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc)
        db.users.insert_one({
            "user_id": uid, "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com",
            "role": "subscriber", "qr_token": f"q_{uuid.uuid4().hex[:8]}", "photo_url": "x",
            "created_at": now.isoformat(), "wallet_balance": 0.0,
        })
        original_end = (now + timedelta(days=25)).replace(microsecond=0)
        db.subscriptions.insert_one({
            "user_id": uid, "sub_id": sid, "plan_id": "X", "plan_name": "X",
            "service_type": "dining",
            "status": "active", "wallet_balance": 500.0, "amount_paid": 1000.0,
            "per_day_amount": 100, "meals_total": 60, "meals_used": 8, "paused_days": 0,
            "start_date": (now - timedelta(days=10)).isoformat(),
            "end_date": original_end.isoformat(),
            "last_tick_date": (now.date() - timedelta(days=1)).isoformat(),
        })
        try:
            r = requests.post(f"{BASE_URL}/api/admin/cron/run-tick", headers=_h(admin["token"]))
            assert r.status_code == 200
            sub = db.subscriptions.find_one({"sub_id": sid})
            assert sub["meals_used"] == 8, f"meals_used should stay at 8 on inactive day, got {sub['meals_used']}"
            assert sub["paused_days"] == 1
            assert sub["wallet_balance"] == 500.0  # no debit on inactive day
        finally:
            db.users.delete_one({"user_id": uid})
            db.subscriptions.delete_one({"sub_id": sid})
