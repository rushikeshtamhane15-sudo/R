"""Backend API tests for Mess Subscription app."""
import os
import uuid
import time
from datetime import datetime, timezone, timedelta
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]


def _seed_user(role="subscriber", email=None):
    uid = f"TEST_user_{uuid.uuid4().hex[:10]}"
    token = f"TEST_sess_{uuid.uuid4().hex[:16]}"
    qr = f"qr_TEST_{uuid.uuid4().hex[:12]}"
    email = email or f"TEST_{uuid.uuid4().hex[:6]}@example.com"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": uid, "email": email.lower(), "name": f"Test {role}",
        "picture": None, "role": role, "qr_token": qr,
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid, "session_token": token,
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "created_at": now.isoformat(),
    })
    return {"user_id": uid, "token": token, "qr_token": qr, "email": email.lower()}


def _seed_sub(user_id):
    now = datetime.now(timezone.utc)
    sub_id = f"sub_TEST_{uuid.uuid4().hex[:8]}"
    db.subscriptions.insert_one({
        "sub_id": sub_id, "user_id": user_id, "plan_id": "monthly_60",
        "plan_name": "Monthly Pass — 60 Meals", "meals_total": 60, "meals_used": 0,
        "start_date": now.isoformat(),
        "end_date": (now + timedelta(days=30)).isoformat(),
        "status": "active", "created_at": now.isoformat(),
    })
    return sub_id


@pytest.fixture(scope="module")
def subscriber():
    u = _seed_user("subscriber")
    yield u
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})


@pytest.fixture(scope="module")
def subscriber_with_sub():
    u = _seed_user("subscriber")
    sub_id = _seed_sub(u["user_id"])
    u["sub_id"] = sub_id
    yield u
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})
    db.subscriptions.delete_one({"sub_id": sub_id})
    db.attendance.delete_many({"user_id": u["user_id"]})


@pytest.fixture(scope="module")
def staff():
    u = _seed_user("staff")
    yield u
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})


@pytest.fixture(scope="module")
def admin():
    u = _seed_user("admin")
    yield u
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})


def h(token):
    return {"Authorization": f"Bearer {token}"}


# Public endpoints
class TestPublic:
    def test_root(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert "message" in r.json()

    def test_plans(self):
        r = requests.get(f"{BASE_URL}/api/plans")
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()["plans"]]
        assert "monthly_60" in ids and "weekly_14" in ids

    def test_menu_today(self):
        r = requests.get(f"{BASE_URL}/api/menu/today")
        assert r.status_code == 200
        d = r.json()
        assert "lunch_items" in d and "dinner_items" in d

    def test_me_unauth(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401


# Auth + subscriber
class TestSubscriber:
    def test_me(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=h(subscriber["token"]))
        assert r.status_code == 200
        assert r.json()["role"] == "subscriber"
        assert r.json()["user_id"] == subscriber["user_id"]

    def test_sub_inactive(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/my/subscription", headers=h(subscriber["token"]))
        assert r.status_code == 200
        assert r.json()["active"] is False

    def test_sub_active(self, subscriber_with_sub):
        r = requests.get(f"{BASE_URL}/api/my/subscription", headers=h(subscriber_with_sub["token"]))
        assert r.status_code == 200
        assert r.json()["active"] is True

    def test_qr(self, subscriber_with_sub):
        r = requests.get(f"{BASE_URL}/api/my/qr", headers=h(subscriber_with_sub["token"]))
        assert r.status_code == 200
        assert r.json()["qr_token"] == subscriber_with_sub["qr_token"]


# Attendance
class TestAttendance:
    def test_staff_scan_marks(self, staff, subscriber_with_sub):
        r = requests.post(f"{BASE_URL}/api/attendance/scan",
                          headers=h(staff["token"]),
                          json={"qr_token": subscriber_with_sub["qr_token"], "meal_type": "lunch"})
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

    def test_duplicate_scan_409(self, staff, subscriber_with_sub):
        r = requests.post(f"{BASE_URL}/api/attendance/scan",
                          headers=h(staff["token"]),
                          json={"qr_token": subscriber_with_sub["qr_token"], "meal_type": "lunch"})
        assert r.status_code == 409

    def test_invalid_qr_404(self, staff):
        r = requests.post(f"{BASE_URL}/api/attendance/scan",
                          headers=h(staff["token"]),
                          json={"qr_token": "qr_nonexistent_xxx", "meal_type": "lunch"})
        assert r.status_code == 404

    def test_counter_qr_staff_ok(self, staff):
        r = requests.get(f"{BASE_URL}/api/counter/qr", headers=h(staff["token"]))
        assert r.status_code == 200
        assert "counter_code" in r.json()

    def test_counter_qr_subscriber_403(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/counter/qr", headers=h(subscriber["token"]))
        assert r.status_code == 403

    def test_self_scan_no_sub_400(self, subscriber, staff):
        counter = requests.get(f"{BASE_URL}/api/counter/qr", headers=h(staff["token"])).json()["counter_code"]
        r = requests.post(f"{BASE_URL}/api/attendance/self-scan",
                          headers=h(subscriber["token"]),
                          json={"counter_code": counter, "meal_type": "dinner"})
        assert r.status_code == 400

    def test_self_scan_ok(self, subscriber_with_sub, staff):
        # request a dinner code so it doesn't collide with the lunch staff_scan above
        counter = requests.get(f"{BASE_URL}/api/counter/qr",
                               headers=h(staff["token"]),
                               params={"meal": "dinner"}).json()["counter_code"]
        r = requests.post(f"{BASE_URL}/api/attendance/self-scan",
                          headers=h(subscriber_with_sub["token"]),
                          json={"counter_code": counter, "meal_type": "dinner"})
        assert r.status_code == 200, r.text


# Admin
class TestAdmin:
    def test_stats_subscriber_403(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/admin/stats", headers=h(subscriber["token"]))
        assert r.status_code == 403

    def test_stats_admin(self, admin):
        r = requests.get(f"{BASE_URL}/api/admin/stats", headers=h(admin["token"]))
        assert r.status_code == 200
        d = r.json()
        for k in ["total_users", "active_subscriptions", "today_attendance", "attendance_trend"]:
            assert k in d

    def test_users(self, admin):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=h(admin["token"]))
        assert r.status_code == 200
        assert "users" in r.json()

    def test_today_attendance(self, admin):
        r = requests.get(f"{BASE_URL}/api/admin/attendance/today", headers=h(admin["token"]))
        assert r.status_code == 200

    def test_role_update(self, admin, subscriber):
        r = requests.post(f"{BASE_URL}/api/admin/role",
                          headers=h(admin["token"]),
                          json={"email": subscriber["email"], "role": "staff"})
        assert r.status_code == 200
        # revert
        db.users.update_one({"user_id": subscriber["user_id"]}, {"$set": {"role": "subscriber"}})

    def test_menu_upsert(self, admin):
        d = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
        r = requests.post(f"{BASE_URL}/api/admin/menu",
                          headers=h(admin["token"]),
                          json={"menu_date": d, "lunch_items": ["A"], "dinner_items": ["B"]})
        assert r.status_code == 200
        db.menus.delete_one({"menu_date": d})


# Stripe
class TestStripe:
    def test_checkout(self, subscriber):
        r = requests.post(f"{BASE_URL}/api/checkout",
                          headers=h(subscriber["token"]),
                          json={"plan_id": "monthly_60", "origin_url": BASE_URL})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "url" in data and "session_id" in data
        # check DB record
        tx = db.payment_transactions.find_one({"session_id": data["session_id"]})
        assert tx is not None
        assert tx["status"] == "initiated"
        # status endpoint should not 500 anymore (graceful fallback for test key)
        r2 = requests.get(f"{BASE_URL}/api/checkout/status/{data['session_id']}", headers=h(subscriber["token"]))
        assert r2.status_code == 200, f"checkout/status should return 200 gracefully, got {r2.status_code}: {r2.text}"
        body = r2.json()
        assert "payment_status" in body and "status" in body
        # cleanup
        db.payment_transactions.delete_one({"session_id": data["session_id"]})


# ---------------------------------------------------------
# Iteration 2: Counter QR upgrades — rotating HMAC, kiosk
# ---------------------------------------------------------
class TestCounterQRPublic:
    def test_public_lunch(self):
        r = requests.get(f"{BASE_URL}/api/counter/qr/public", params={"meal": "lunch", "location": "main"})
        assert r.status_code == 200, r.text
        d = r.json()
        code = d["counter_code"]
        parts = code.split(".")
        assert len(parts) == 4, f"Expected 4 dotted parts, got {parts}"
        assert parts[0] == "main"
        assert parts[1] == "lunch"
        assert d["rotation_seconds"] == 300
        assert isinstance(d["rotates_at"], int)

    def test_public_dinner(self):
        r = requests.get(f"{BASE_URL}/api/counter/qr/public", params={"meal": "dinner", "location": "main"})
        assert r.status_code == 200
        assert r.json()["counter_code"].split(".")[1] == "dinner"

    def test_public_invalid_meal(self):
        r = requests.get(f"{BASE_URL}/api/counter/qr/public", params={"meal": "invalid"})
        assert r.status_code == 400


class TestCounterQRAuth:
    def test_staff_gets_code(self, staff):
        r = requests.get(f"{BASE_URL}/api/counter/qr", headers=h(staff["token"]),
                         params={"meal": "lunch", "location": "main"})
        assert r.status_code == 200
        d = r.json()
        assert len(d["counter_code"].split(".")) == 4
        assert d["rotation_seconds"] == 300

    def test_admin_gets_code(self, admin):
        r = requests.get(f"{BASE_URL}/api/counter/qr", headers=h(admin["token"]))
        assert r.status_code == 200

    def test_subscriber_forbidden(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/counter/qr", headers=h(subscriber["token"]))
        assert r.status_code == 403


class TestStatsToday:
    def test_stats_today_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/stats/today")
        assert r.status_code == 200
        d = r.json()
        for k in ("date", "total", "lunch", "dinner"):
            assert k in d
        assert isinstance(d["total"], int)
        assert isinstance(d["lunch"], int)
        assert isinstance(d["dinner"], int)


class TestPoster:
    def test_poster_png(self):
        r = requests.get(f"{BASE_URL}/api/counter/poster", params={"meal": "lunch", "location": "main"})
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")
        assert len(r.content) > 100

    def test_poster_invalid(self):
        r = requests.get(f"{BASE_URL}/api/counter/poster", params={"meal": "foo"})
        assert r.status_code == 400


class TestSelfScanHMAC:
    def _fresh_user(self):
        u = _seed_user("subscriber")
        sid = _seed_sub(u["user_id"])
        u["sub_id"] = sid
        return u

    def _cleanup(self, u):
        db.users.delete_one({"user_id": u["user_id"]})
        db.user_sessions.delete_one({"session_token": u["token"]})
        db.subscriptions.delete_one({"sub_id": u["sub_id"]})
        db.attendance.delete_many({"user_id": u["user_id"]})

    def test_self_scan_with_hmac_lunch(self):
        u = self._fresh_user()
        try:
            code = requests.get(f"{BASE_URL}/api/counter/qr/public",
                                params={"meal": "lunch", "location": "main"}).json()["counter_code"]
            r = requests.post(f"{BASE_URL}/api/attendance/self-scan",
                              headers=h(u["token"]),
                              json={"counter_code": code, "meal_type": "lunch"})
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["meal_type"] == "lunch"
            assert "meals_left" in d and "meals_total" in d
            assert d["meals_total"] == 60
            assert d["meals_left"] == 59
        finally:
            self._cleanup(u)

    def test_self_scan_invalid_code(self):
        u = self._fresh_user()
        try:
            for bad in ("totally.invalid.code", "abc", "main.lunch.123.deadbeefdeadbeef"):
                r = requests.post(f"{BASE_URL}/api/attendance/self-scan",
                                  headers=h(u["token"]),
                                  json={"counter_code": bad, "meal_type": "lunch"})
                assert r.status_code == 400, f"{bad}: {r.text}"
                assert "Invalid or expired" in r.json().get("detail", "")
        finally:
            self._cleanup(u)

    def test_self_scan_duplicate_409(self):
        u = self._fresh_user()
        try:
            code = requests.get(f"{BASE_URL}/api/counter/qr/public",
                                params={"meal": "dinner", "location": "main"}).json()["counter_code"]
            r1 = requests.post(f"{BASE_URL}/api/attendance/self-scan",
                               headers=h(u["token"]),
                               json={"counter_code": code, "meal_type": "dinner"})
            assert r1.status_code == 200
            r2 = requests.post(f"{BASE_URL}/api/attendance/self-scan",
                               headers=h(u["token"]),
                               json={"counter_code": code, "meal_type": "dinner"})
            assert r2.status_code == 409
        finally:
            self._cleanup(u)

    def test_self_scan_uses_code_meal_not_client(self):
        """Security: even if client lies about meal_type, server uses the meal from verified code."""
        u = self._fresh_user()
        try:
            # Code is for LUNCH
            code = requests.get(f"{BASE_URL}/api/counter/qr/public",
                                params={"meal": "lunch", "location": "main"}).json()["counter_code"]
            # Client tries to send 'dinner' — should be ignored
            r = requests.post(f"{BASE_URL}/api/attendance/self-scan",
                              headers=h(u["token"]),
                              json={"counter_code": code, "meal_type": "dinner"})
            assert r.status_code == 200, r.text
            assert r.json()["meal_type"] == "lunch"
            # Verify in DB
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            rec = db.attendance.find_one({"user_id": u["user_id"], "date_str": today})
            assert rec is not None
            assert rec["meal_type"] == "lunch"
        finally:
            self._cleanup(u)
