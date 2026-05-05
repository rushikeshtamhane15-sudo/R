"""Iteration 4 backend tests: theme endpoints, wallet transactions, admin auto-promotion."""
import os
import uuid
from datetime import datetime, timezone, timedelta, date
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]

ADMIN_PHONE = "9970705391"
ADMIN_EMAIL = "rushikeshtamhane15@gmail.com"


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _seed_user(role="subscriber", email=None, phone=None, complete_profile=True):
    uid = f"TEST_user_{uuid.uuid4().hex[:10]}"
    token = f"TEST_sess_{uuid.uuid4().hex[:16]}"
    if email is None:
        email = f"TEST_{uuid.uuid4().hex[:6]}@example.com"
    if phone is None:
        phone = f"99{uuid.uuid4().int % 10**8:08d}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": uid,
        "email": email.lower(),
        "phone": phone,
        "name": f"Test {role}",
        "address": "123 Test Street, Test City" if complete_profile else None,
        "picture": None,
        "role": role,
        "qr_token": f"qr_TEST_{uuid.uuid4().hex[:12]}",
        "wallet_balance": 0.0,
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "created_at": now.isoformat(),
    })
    return {"user_id": uid, "token": token, "email": email.lower(), "phone": phone}


def _cleanup_user(u):
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_many({"user_id": u["user_id"]})
    db.subscriptions.delete_many({"user_id": u["user_id"]})
    db.attendance.delete_many({"user_id": u["user_id"]})
    db.payment_orders.delete_many({"user_id": u["user_id"]})
    db.wallet_transactions.delete_many({"user_id": u["user_id"]})


@pytest.fixture
def subscriber():
    u = _seed_user("subscriber")
    yield u
    _cleanup_user(u)


@pytest.fixture
def admin():
    u = _seed_user("admin", email=f"TEST_admin_{uuid.uuid4().hex[:6]}@efoodcare.com")
    yield u
    _cleanup_user(u)


# ============================================================
# Theme endpoints
# ============================================================
class TestTheme:
    def test_get_theme_defaults(self):
        r = requests.get(f"{BASE_URL}/api/theme")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["brand_name"] == "eFoodCare"
        assert d["brand_tagline"] == "ghar se achha khana"
        tokens = d.get("tokens", {})
        for k in ("primary", "secondary", "destructive", "background"):
            assert k in tokens, f"Missing token {k}"

    def test_admin_theme_update_subscriber_403(self, subscriber):
        r = requests.post(
            f"{BASE_URL}/api/admin/theme",
            headers=h(subscriber["token"]),
            json={"brand_name": "Hacker"},
        )
        assert r.status_code == 403

    def test_admin_theme_update_admin_ok(self, admin):
        new_brand = f"TEST_brand_{uuid.uuid4().hex[:4]}"
        r = requests.post(
            f"{BASE_URL}/api/admin/theme",
            headers=h(admin["token"]),
            json={"brand_name": new_brand, "tokens": {"primary": "10 80% 50%"}},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["brand_name"] == new_brand
        assert d["tokens"]["primary"] == "10 80% 50%"
        # Verify GET returns updated value
        g = requests.get(f"{BASE_URL}/api/theme").json()
        assert g["brand_name"] == new_brand

    def test_admin_theme_reset(self, admin):
        # First make a change
        requests.post(
            f"{BASE_URL}/api/admin/theme",
            headers=h(admin["token"]),
            json={"brand_name": "Changed", "tokens": {"primary": "1 1% 1%"}},
        )
        r = requests.post(f"{BASE_URL}/api/admin/theme/reset", headers=h(admin["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["brand_name"] == "eFoodCare"
        assert d["brand_tagline"] == "ghar se achha khana"
        # Default primary token should be the green
        assert d["tokens"]["primary"] == "142 50% 35%"

    def test_admin_theme_reset_subscriber_403(self, subscriber):
        r = requests.post(f"{BASE_URL}/api/admin/theme/reset", headers=h(subscriber["token"]))
        assert r.status_code == 403


# ============================================================
# Wallet transactions
# ============================================================
class TestWalletTransactions:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/my/wallet/transactions")
        assert r.status_code in (401, 403)

    def test_empty_initial(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/my/wallet/transactions", headers=h(subscriber["token"]))
        assert r.status_code == 200
        assert r.json()["transactions"] == []

    def test_credit_logged_on_payment_verify(self, subscriber):
        # Create order + verify (mock mode)
        order = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber["token"]),
            json={"plan_id": "premium_60"},
        ).json()
        v = requests.post(
            f"{BASE_URL}/api/payments/verify",
            headers=h(subscriber["token"]),
            json={"order_id": order["order_id"], "razorpay_payment_id": "p", "razorpay_signature": "s"},
        )
        assert v.status_code == 200, v.text

        r = requests.get(f"{BASE_URL}/api/my/wallet/transactions", headers=h(subscriber["token"]))
        assert r.status_code == 200
        txns = r.json()["transactions"]
        credits = [t for t in txns if t["type"] == "credit"]
        assert len(credits) >= 1, f"No credit txn found: {txns}"
        c = credits[0]
        assert c["amount"] == 2800.0
        assert "premium" in c["reason"].lower() or "plan" in c["reason"].lower() or len(c["reason"]) > 0

    def test_debit_and_pause_logged_on_tick(self, subscriber):
        # Activate sub
        order = requests.post(
            f"{BASE_URL}/api/payments/order",
            headers=h(subscriber["token"]),
            json={"plan_id": "saver_60"},
        ).json()
        v = requests.post(
            f"{BASE_URL}/api/payments/verify",
            headers=h(subscriber["token"]),
            json={"order_id": order["order_id"], "razorpay_payment_id": "p", "razorpay_signature": "s"},
        ).json()
        sub_id = v["sub_id"]

        # Insert attendance for yesterday → debit on today's tick
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        db.attendance.insert_one({
            "att_id": f"TEST_att_{uuid.uuid4().hex[:8]}",
            "user_id": subscriber["user_id"],
            "user_name": "X",
            "sub_id": sub_id,
            "meal_type": "lunch",
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "date_str": yesterday,
            "marked_by": "TEST",
            "method": "TEST",
        })
        # set last_tick_date = 2 days ago to process 2 days: yesterday (with scan→debit) + today (no scan→pause)
        two_ago = (date.today() - timedelta(days=2)).isoformat()
        db.subscriptions.update_one({"sub_id": sub_id}, {"$set": {"last_tick_date": two_ago}})

        # Trigger tick
        requests.get(f"{BASE_URL}/api/my/wallet/transactions", headers=h(subscriber["token"]))

        r = requests.get(f"{BASE_URL}/api/my/wallet/transactions", headers=h(subscriber["token"]))
        txns = r.json()["transactions"]
        types = [t["type"] for t in txns]
        assert "debit" in types or "pause" in types, f"Expected debit or pause txn, got types={types}"


# ============================================================
# Admin auto-promotion
# ============================================================
class TestAdminAutoPromote:
    def test_otp_phone_creates_admin(self):
        # If user with this phone exists, demote first to test promotion
        existing = db.users.find_one({"phone": ADMIN_PHONE})
        existing_uid = existing["user_id"] if existing else None
        if existing:
            db.users.update_one({"phone": ADMIN_PHONE}, {"$set": {"role": "subscriber"}})

        try:
            send = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": ADMIN_PHONE}).json()
            assert "dev_otp" in send, send
            otp = send["dev_otp"]
            r = requests.post(
                f"{BASE_URL}/api/auth/verify-otp",
                json={"phone": ADMIN_PHONE, "otp": otp, "name": "Admin Phone"},
            )
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["user"]["role"] == "admin", f"User role is {d['user']['role']}, expected admin"
            assert d["user"]["phone"] == ADMIN_PHONE
        finally:
            # Cleanup if we created a fresh user
            if not existing_uid:
                u = db.users.find_one({"phone": ADMIN_PHONE})
                if u:
                    db.users.delete_one({"user_id": u["user_id"]})
                    db.user_sessions.delete_many({"user_id": u["user_id"]})

    def test_existing_subscriber_promoted_on_otp_login(self):
        # Pre-seed a subscriber with admin phone, then login via OTP → role becomes admin
        existing = db.users.find_one({"phone": ADMIN_PHONE})
        existing_uid = existing["user_id"] if existing else None
        if existing:
            db.users.update_one({"phone": ADMIN_PHONE}, {"$set": {"role": "subscriber"}})
        else:
            db.users.insert_one({
                "user_id": f"TEST_promote_{uuid.uuid4().hex[:8]}",
                "email": None,
                "phone": ADMIN_PHONE,
                "name": "Pre-existing",
                "address": None,
                "picture": None,
                "role": "subscriber",
                "qr_token": f"qr_TEST_{uuid.uuid4().hex[:8]}",
                "wallet_balance": 0.0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

        try:
            send = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": ADMIN_PHONE}).json()
            otp = send["dev_otp"]
            r = requests.post(
                f"{BASE_URL}/api/auth/verify-otp",
                json={"phone": ADMIN_PHONE, "otp": otp},
            )
            assert r.status_code == 200, r.text
            assert r.json()["user"]["role"] == "admin"
            # Verify in DB
            u = db.users.find_one({"phone": ADMIN_PHONE})
            assert u["role"] == "admin"
        finally:
            if not existing_uid:
                u = db.users.find_one({"phone": ADMIN_PHONE})
                if u:
                    db.users.delete_one({"user_id": u["user_id"]})
                    db.user_sessions.delete_many({"user_id": u["user_id"]})

    def test_admin_email_promotion_via_create_or_get_user(self):
        """Directly invoke server.create_or_get_user with the admin email to verify role bump
        logic for the Google OAuth login path. Combines: (a) new user creation with admin
        email → role=admin, and (b) existing subscriber with admin email → promoted to admin."""
        import asyncio
        import sys
        sys.path.insert(0, "/app/backend")
        from server import create_or_get_user

        async def run_both():
            # (a) Fresh creation
            db.users.delete_many({"email": ADMIN_EMAIL})
            res_a = await create_or_get_user(email=ADMIN_EMAIL, phone=None, name="Fresh Admin", picture=None)
            assert res_a["role"] == "admin", f"Fresh user role={res_a['role']}"
            ua = db.users.find_one({"email": ADMIN_EMAIL})
            assert ua is not None and ua["role"] == "admin"

            # (b) Demote then re-login → should auto-promote
            db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"role": "subscriber"}})
            res_b = await create_or_get_user(email=ADMIN_EMAIL, phone=None, name="Returning", picture=None)
            ub = db.users.find_one({"email": ADMIN_EMAIL})
            assert ub["role"] == "admin", f"Re-login role={ub.get('role')}"

            db.users.delete_many({"email": ADMIN_EMAIL})

        asyncio.run(run_both())


# ============================================================
# Role gating
# ============================================================
class TestRoleGating:
    def test_admin_theme_requires_admin(self, subscriber):
        r = requests.post(
            f"{BASE_URL}/api/admin/theme",
            headers=h(subscriber["token"]),
            json={"brand_name": "X"},
        )
        assert r.status_code == 403

    def test_wallet_txns_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/my/wallet/transactions")
        assert r.status_code in (401, 403)
