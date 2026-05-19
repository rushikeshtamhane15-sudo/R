"""Backend API tests for eFoodCare (iteration 3): rebrand, OTP auth, plans CRUD,
Razorpay mock, wallet, and tick/catch-up logic."""
import os
import uuid
import time
import hmac
import hashlib
from datetime import datetime, timezone, timedelta, date
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]


# ---- Seed helpers (TEST_-prefixed) ----
def _seed_user(role="subscriber", email=None, complete_profile=False):
    uid = f"TEST_user_{uuid.uuid4().hex[:10]}"
    token = f"TEST_sess_{uuid.uuid4().hex[:16]}"
    qr = f"qr_TEST_{uuid.uuid4().hex[:12]}"
    if email is None and role == "admin":
        email = f"TEST_admin_{uuid.uuid4().hex[:6]}@efoodcare.com"
    elif email is None:
        email = f"TEST_{uuid.uuid4().hex[:6]}@example.com"
    now = datetime.now(timezone.utc)
    user_doc = {
        "user_id": uid,
        "email": email.lower(),
        "phone": f"99{uuid.uuid4().int % 10**8:08d}",
        "name": f"Test {role}",
        "address": "123 Test Street, Test City" if complete_profile else None,
        "photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" if complete_profile else None,
        "picture": None,
        "role": role,
        "qr_token": qr,
        "wallet_balance": 0.0,
        "created_at": now.isoformat(),
    }
    if not complete_profile:
        # leave address empty so /payments/order returns 400
        user_doc["address"] = None
    db.users.insert_one(user_doc)
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "created_at": now.isoformat(),
    })
    return {"user_id": uid, "token": token, "qr_token": qr, "email": email.lower(), "phone": user_doc["phone"]}


def _cleanup_user(u):
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})
    db.subscriptions.delete_many({"user_id": u["user_id"]})
    db.attendance.delete_many({"user_id": u["user_id"]})
    db.payment_orders.delete_many({"user_id": u["user_id"]})


def h(token):
    return {"Authorization": f"Bearer {token}"}


# ---- Fixtures ----
@pytest.fixture
def subscriber():
    u = _seed_user("subscriber", complete_profile=False)
    yield u
    _cleanup_user(u)


@pytest.fixture
def subscriber_complete():
    u = _seed_user("subscriber", complete_profile=True)
    yield u
    _cleanup_user(u)


@pytest.fixture
def admin():
    u = _seed_user("admin", complete_profile=True)
    yield u
    _cleanup_user(u)


@pytest.fixture
def staff():
    u = _seed_user("staff", complete_profile=True)
    yield u
    _cleanup_user(u)


# ============================================================
# Root + Plans
# ============================================================
class TestRoot:
    def test_root_rebrand(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        d = r.json()
        assert d.get("message") == "efoodcare API"
        assert d.get("tagline") == "ghar se achha khana"


class TestPlans:
    def test_plans_seeded(self):
        r = requests.get(f"{BASE_URL}/api/plans")
        assert r.status_code == 200
        plans = r.json()["plans"]
        ids = {p["plan_id"]: p for p in plans}
        for pid, amount in [("premium_60", 2800.0), ("classic_60", 2600.0), ("saver_60", 1800.0)]:
            assert pid in ids, f"Missing plan {pid}"
            p = ids[pid]
            assert p["amount"] == amount
            assert p["currency"] == "INR"
            assert p["duration_days"] == 30
            assert p["meals"] == 60
            assert p["active"] is True


# ============================================================
# OTP Auth
# ============================================================
class TestOtp:
    def test_send_otp_dev(self):
        phone = "9876543210"
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("dev_mode") is True
        assert "dev_otp" in d and len(d["dev_otp"]) == 6
        # cleanup
        db.otp_codes.delete_one({"phone": phone})

    def test_verify_otp_creates_user(self):
        phone = f"99{uuid.uuid4().int % 10**8:08d}"
        send = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}).json()
        otp = send["dev_otp"]
        r = requests.post(f"{BASE_URL}/api/auth/verify-otp", json={"phone": phone, "otp": otp, "name": "OTP Test"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "session_token" in d and "user" in d
        assert d["user"]["role"] == "subscriber"
        assert d["user"]["phone"] == phone
        # cleanup
        uid = d["user"]["user_id"]
        db.users.delete_one({"user_id": uid})
        db.user_sessions.delete_many({"user_id": uid})

    def test_verify_otp_wrong(self):
        phone = f"99{uuid.uuid4().int % 10**8:08d}"
        requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone})
        r = requests.post(f"{BASE_URL}/api/auth/verify-otp", json={"phone": phone, "otp": "000000"})
        assert r.status_code == 400
        db.otp_codes.delete_one({"phone": phone})

    def test_verify_otp_too_many_attempts(self):
        phone = f"99{uuid.uuid4().int % 10**8:08d}"
        requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone})
        last = None
        for _ in range(6):
            last = requests.post(f"{BASE_URL}/api/auth/verify-otp", json={"phone": phone, "otp": "000000"})
        assert last.status_code == 429, f"Expected 429, got {last.status_code}: {last.text}"
        db.otp_codes.delete_one({"phone": phone})


# ============================================================
# Profile
# ============================================================
class TestProfile:
    def test_profile_update_ok(self, subscriber):
        r = requests.post(
            f"{BASE_URL}/api/auth/profile",
            headers=h(subscriber["token"]),
            json={"name": "New Name", "phone": "9999999999", "address": "Some address"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["user"]["name"] == "New Name"
        assert r.json()["user"]["address"] == "Some address"

    def test_profile_update_missing_field(self, subscriber):
        r = requests.post(
            f"{BASE_URL}/api/auth/profile",
            headers=h(subscriber["token"]),
            json={"name": "x", "phone": "1234567890", "address": ""},
        )
        assert r.status_code == 400


# ============================================================
# Payments (Razorpay MOCKED)
# ============================================================
class TestPayments:
    def test_order_requires_complete_profile(self, subscriber):
        r = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber["token"]),
            json={"plan_id": "premium_60"},
        )
        assert r.status_code == 400
        assert "Profile incomplete" in r.json().get("detail", "")

    def test_order_premium_mock(self, subscriber_complete):
        r = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber_complete["token"]),
            json={"plan_id": "premium_60"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["amount_paise"] == 280000
        assert d["currency"] == "INR"
        assert d["mock"] is True
        assert d["order_id"].startswith("order_mock_")
        # payment_orders record
        rec = db.payment_orders.find_one({"order_id": d["order_id"]})
        assert rec is not None and rec["status"] == "created"

    def test_order_invalid_plan(self, subscriber_complete):
        r = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber_complete["token"]),
            json={"plan_id": "nonexistent_plan"},
        )
        assert r.status_code == 400

    def test_verify_mock_creates_subscription(self, subscriber_complete):
        order = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber_complete["token"]),
            json={"plan_id": "classic_60"},
        ).json()
        v = requests.post(
            f"{BASE_URL}/api/payments/verify",
            headers=h(subscriber_complete["token"]),
            json={
                "order_id": order["order_id"],
                "razorpay_payment_id": "pay_mock_123",
                "razorpay_signature": "sig_mock",
            },
        )
        assert v.status_code == 200, v.text
        assert v.json()["status"] == "paid"
        sub_id = v.json()["sub_id"]
        sub = db.subscriptions.find_one({"sub_id": sub_id})
        assert sub is not None
        assert sub["amount_paid"] == 2600.0
        assert sub["wallet_balance"] == 2600.0
        # per_day = 2600/30 = 86.67
        assert abs(sub["per_day_amount"] - round(2600.0 / 30, 2)) < 0.01
        assert sub["status"] == "active"
        assert sub["last_tick_date"] == date.today().isoformat()
        # user wallet credited
        u = db.users.find_one({"user_id": subscriber_complete["user_id"]})
        assert u["wallet_balance"] == 2600.0


# ============================================================
# Wallet + Subscription views
# ============================================================
class TestWallet:
    def test_my_wallet_no_sub(self, subscriber_complete):
        r = requests.get(f"{BASE_URL}/api/my/wallet", headers=h(subscriber_complete["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["wallet_balance"] == 0
        assert d["subscription"] is None
        assert d["per_day_amount"] == 0
        assert d["paused_days"] == 0

    def test_my_subscription_inactive(self, subscriber_complete):
        r = requests.get(f"{BASE_URL}/api/my/subscription", headers=h(subscriber_complete["token"]))
        assert r.status_code == 200
        assert r.json()["active"] is False


# ============================================================
# Tick / catch-up logic
# ============================================================
class TestTick:
    def test_inactivity_pauses_and_extends(self, subscriber_complete):
        # 1) Create subscription via mock payment
        order = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber_complete["token"]),
            json={"plan_id": "premium_60"},
        ).json()
        v = requests.post(
            f"{BASE_URL}/api/payments/verify",
            headers=h(subscriber_complete["token"]),
            json={"order_id": order["order_id"], "razorpay_payment_id": "p", "razorpay_signature": "s"},
        ).json()
        sub_id = v["sub_id"]
        sub = db.subscriptions.find_one({"sub_id": sub_id})
        original_end = sub["end_date"]
        original_wallet = sub["wallet_balance"]

        # 2) Set last_tick_date to 5 days ago, no attendance
        five_ago = (date.today() - timedelta(days=5)).isoformat()
        db.subscriptions.update_one({"sub_id": sub_id}, {"$set": {"last_tick_date": five_ago}})

        # 3) Hit /api/my/subscription to trigger catch-up
        r = requests.get(f"{BASE_URL}/api/my/subscription", headers=h(subscriber_complete["token"]))
        assert r.status_code == 200
        sub = db.subscriptions.find_one({"sub_id": sub_id})
        # No scans → all 5 days are paused, no deduction
        assert sub["paused_days"] >= 5
        assert sub["wallet_balance"] == original_wallet
        # end_date pushed by 5 days
        from datetime import datetime as DT
        new_end = DT.fromisoformat(sub["end_date"])
        old_end = DT.fromisoformat(original_end)
        assert (new_end - old_end).days == 5
        assert sub["last_tick_date"] == date.today().isoformat()

    def test_recent_scan_causes_deduction(self, subscriber_complete):
        # Activate sub
        order = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber_complete["token"]),
            json={"plan_id": "saver_60"},
        ).json()
        v = requests.post(
            f"{BASE_URL}/api/payments/verify",
            headers=h(subscriber_complete["token"]),
            json={"order_id": order["order_id"], "razorpay_payment_id": "p", "razorpay_signature": "s"},
        ).json()
        sub_id = v["sub_id"]
        per_day = round(1800.0 / 30, 2)

        # Insert attendance for yesterday
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        db.attendance.insert_one({
            "att_id": f"TEST_att_{uuid.uuid4().hex[:8]}",
            "user_id": subscriber_complete["user_id"],
            "user_name": "X",
            "sub_id": sub_id,
            "meal_type": "lunch",
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "date_str": yesterday,
            "marked_by": "TEST",
            "method": "TEST",
        })

        # Set last_tick_date to yesterday so today's tick processes 1 day with the recent scan in window
        db.subscriptions.update_one({"sub_id": sub_id}, {"$set": {"last_tick_date": yesterday}})

        before = db.subscriptions.find_one({"sub_id": sub_id})
        wallet_before = before["wallet_balance"]

        r = requests.get(f"{BASE_URL}/api/my/subscription", headers=h(subscriber_complete["token"]))
        assert r.status_code == 200

        after = db.subscriptions.find_one({"sub_id": sub_id})
        # Yesterday's scan is within [today-3, today) → deduction expected for today's tick
        assert abs(after["wallet_balance"] - (wallet_before - per_day)) < 0.01, \
            f"wallet before={wallet_before}, after={after['wallet_balance']}, per_day={per_day}"
        assert after["last_tick_date"] == date.today().isoformat()


# ============================================================
# Admin Plan CRUD
# ============================================================
class TestAdminPlans:
    def test_list_plans_subscriber_403(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/admin/plans", headers=h(subscriber["token"]))
        assert r.status_code == 403

    def test_list_plans_admin(self, admin):
        r = requests.get(f"{BASE_URL}/api/admin/plans", headers=h(admin["token"]))
        assert r.status_code == 200
        assert "plans" in r.json()

    def test_create_update_delete_plan(self, admin):
        plan_id = f"TEST_plan_{uuid.uuid4().hex[:6]}"
        try:
            # Create
            r = requests.post(
                f"{BASE_URL}/api/admin/plans",
                headers=h(admin["token"]),
                json={
                    "plan_id": plan_id,
                    "name": "Test Plan",
                    "description": "Desc",
                    "amount": 999.0,
                    "currency": "INR",
                    "duration_days": 30,
                    "meals": 60,
                    "active": True,
                    "sort_order": 50,
                },
            )
            assert r.status_code == 200, r.text
            assert r.json()["plan"]["plan_id"] == plan_id
            # Update
            r2 = requests.post(
                f"{BASE_URL}/api/admin/plans",
                headers=h(admin["token"]),
                json={
                    "plan_id": plan_id,
                    "name": "Updated",
                    "description": "Desc",
                    "amount": 1999.0,
                    "currency": "INR",
                    "duration_days": 30,
                    "meals": 60,
                    "active": False,
                    "sort_order": 50,
                },
            )
            assert r2.status_code == 200
            assert r2.json()["plan"]["amount"] == 1999.0
            assert r2.json()["plan"]["active"] is False
            # Inactive plan should NOT appear in /api/plans
            pub = requests.get(f"{BASE_URL}/api/plans").json()["plans"]
            assert all(p["plan_id"] != plan_id for p in pub)
            # Delete
            d = requests.delete(f"{BASE_URL}/api/admin/plans/{plan_id}", headers=h(admin["token"]))
            assert d.status_code == 200
            d2 = requests.delete(f"{BASE_URL}/api/admin/plans/{plan_id}", headers=h(admin["token"]))
            assert d2.status_code == 404
        finally:
            db.plans.delete_one({"plan_id": plan_id})

    def test_admin_stats_inr(self, admin):
        r = requests.get(f"{BASE_URL}/api/admin/stats", headers=h(admin["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d.get("currency") == "INR"
        assert "revenue" in d


# ============================================================
# Self-scan with HMAC (regression check post-refactor)
# ============================================================
class TestSelfScanHMAC:
    def test_self_scan_works(self, subscriber_complete):
        # Activate subscription so self-scan is allowed
        order = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber_complete["token"]),
            json={"plan_id": "premium_60"},
        ).json()
        requests.post(
            f"{BASE_URL}/api/payments/verify",
            headers=h(subscriber_complete["token"]),
            json={"order_id": order["order_id"], "razorpay_payment_id": "p", "razorpay_signature": "s"},
        )
        code = requests.get(f"{BASE_URL}/api/counter/qr/public",
                            params={"meal": "lunch", "location": "main"}).json()["counter_code"]
        r = requests.post(f"{BASE_URL}/api/attendance/self-scan",
                          headers=h(subscriber_complete["token"]),
                          json={"counter_code": code})
        assert r.status_code == 200, r.text
        assert r.json()["meal_type"] == "lunch"


# ============================================================
# Webhook idempotency
# ============================================================
class TestWebhook:
    def test_webhook_no_event_received(self):
        # No keys configured → returns received True for any payload that's parsable
        r = requests.post(f"{BASE_URL}/api/webhook/razorpay", json={"event": "ping"})
        assert r.status_code == 200
        assert r.json().get("received") is True

    def test_webhook_payment_captured_idempotent(self, subscriber_complete):
        # Create order
        order = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber_complete["token"]),
            json={"plan_id": "saver_60"},
        ).json()
        order_id = order["order_id"]

        payload = {
            "event": "payment.captured",
            "payload": {"payment": {"entity": {"order_id": order_id}}}
        }
        r1 = requests.post(f"{BASE_URL}/api/webhook/razorpay", json=payload)
        r2 = requests.post(f"{BASE_URL}/api/webhook/razorpay", json=payload)
        assert r1.status_code == 200 and r2.status_code == 200

        subs = list(db.subscriptions.find({"order_id": order_id}))
        assert len(subs) == 1, f"Expected 1 subscription (idempotent), got {len(subs)}"
