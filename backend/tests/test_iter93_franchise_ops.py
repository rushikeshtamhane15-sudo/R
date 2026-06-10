"""iter-93 — Backend tests: franchise_owner now has access (200, not 403)
on the operational endpoints listed in the iter-93 spec.

Endpoints under test (with FR session token expecting 200):
  GET  /api/admin/raw-materials
  PUT  /api/admin/raw-materials                       (bulk update)
  POST /api/admin/raw-materials/stock-topup
  GET  /api/admin/tiffin-stock
  GET  /api/admin/payments/cash-totals
  GET  /api/admin/payments/cash-pending-deposit
  POST /api/admin/payments/mark-deposited
  GET  /api/admin/kitchen-settings
  PUT  /api/admin/kitchen-settings
  GET  /api/admin/kitchen/recent
  GET  /api/admin/kitchen/reconcile?date=YYYY-MM-DD&tiffins=0
  POST /api/kitchen/close-out
  GET  /api/kitchen/close-out
  GET  /api/admin/refunds?status=pending
  GET  /api/admin/messes/{mess_id}/metrics
  GET  /api/counter/qr?meal=lunch
  POST /api/attendance/scan
  GET  /api/admin/bank/deposits
  POST/DELETE/poster on /api/admin/mess-menu/calendar

Regression:
  - subscriber/guest gets 403 on the same endpoints (sample subset)
  - admin still gets 200 (unchanged)
"""
import datetime as dt
import os
import uuid

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


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def mongo():
    client = pymongo.MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _seed_user(mongo, *, role, mess_id=None):
    uid = f"TEST_IT93_{role}_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_IT93_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": f"Iter93 {role}",
        "role": role,
        "wallet_balance": 0,
        "created_at": _now_iso(),
    }
    if mess_id:
        doc["mess_id"] = mess_id
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
    orig = mongo.messes.find_one({"mess_id": MESS_A}) or {}
    orig_owner = orig.get("owner_user_id", "user_bb39434e1a5c")

    admin_uid, admin_tok = _seed_user(mongo, role="admin")
    fr_uid, fr_tok = _seed_user(mongo, role="franchise_owner", mess_id=MESS_A)
    sub_uid, sub_tok = _seed_user(mongo, role="subscriber", mess_id=MESS_A)

    # Make FR the owner of MESS_A for branch-scoping checks
    mongo.messes.update_one({"mess_id": MESS_A},
                            {"$set": {"owner_user_id": fr_uid}})

    ctx = {
        "admin_tok": admin_tok, "admin_uid": admin_uid,
        "fr_tok": fr_tok, "fr_uid": fr_uid,
        "sub_tok": sub_tok, "sub_uid": sub_uid,
        "mess_id": MESS_A,
    }
    yield ctx

    # Teardown
    mongo.messes.update_one({"mess_id": MESS_A},
                            {"$set": {"owner_user_id": orig_owner}})
    mongo.users.delete_many({"user_id": {"$in": [admin_uid, fr_uid, sub_uid]}})
    mongo.user_sessions.delete_many({"session_token": {"$regex": "^TEST_IT93_sess_"}})
    # Cleanup any kitchen close-out rows we created
    mongo.kitchen_close_out.delete_many({"created_by": {"$in": [admin_uid, fr_uid]}})


# Each row: (method, path, body_or_none)
# All should return 200 for FR + admin, 403 for subscriber.
def _today():
    return dt.date.today().isoformat()


READ_ENDPOINTS = [
    ("GET", "/admin/raw-materials", None),
    ("GET", "/admin/tiffin-stock", None),
    ("GET", "/admin/payments/cash-totals", None),
    ("GET", "/admin/payments/cash-pending-deposit", None),
    ("GET", "/admin/kitchen-settings", None),
    ("GET", "/admin/kitchen/recent", None),
    ("GET", "/admin/refunds?status=pending", None),
    ("GET", "/admin/notifications/bank-deposit", None),
    ("GET", "/counter/qr?meal=lunch", None),
    ("GET", f"/kitchen/close-out?date={_today()}", None),
]


class TestFranchiseAccess200:
    """Franchise owner must receive 200 (not 403) on each endpoint."""

    @pytest.mark.parametrize("method,path,body", READ_ENDPOINTS)
    def test_fr_read_200(self, world, method, path, body):
        r = requests.request(method, f"{API}{path}",
                             headers=_hdr(world["fr_tok"]), timeout=20)
        assert r.status_code == 200, f"{method} {path} -> {r.status_code}: {r.text[:300]}"

    def test_fr_kitchen_reconcile(self, world):
        r = requests.get(
            f"{API}/admin/kitchen/reconcile?date={_today()}&tiffins=0",
            headers=_hdr(world["fr_tok"]), timeout=20)
        assert r.status_code == 200, r.text[:300]

    def test_fr_mess_metrics(self, world):
        r = requests.get(f"{API}/admin/messes/{world['mess_id']}/metrics",
                         headers=_hdr(world["fr_tok"]), timeout=20)
        assert r.status_code == 200, r.text[:300]

    def test_fr_put_raw_materials(self, world):
        # Empty/minimal payload — endpoint should accept and not 403.
        r = requests.put(f"{API}/admin/raw-materials",
                         headers=_hdr(world["fr_tok"]),
                         json={"items": []}, timeout=20)
        assert r.status_code != 403, r.text[:300]
        assert r.status_code < 500, r.text[:300]

    def test_fr_stock_topup(self, world):
        r = requests.post(f"{API}/admin/raw-materials/stock-topup",
                          headers=_hdr(world["fr_tok"]),
                          json={"name": "TEST_IT93_item", "qty": 1, "unit": "kg"},
                          timeout=20)
        assert r.status_code != 403, r.text[:300]

    def test_fr_mark_deposited(self, world):
        r = requests.post(f"{API}/admin/payments/mark-deposited",
                          headers=_hdr(world["fr_tok"]),
                          json={"amount": 0, "note": "TEST_IT93"},
                          timeout=20)
        # 200 or 400/422 fine — anything other than 403 confirms access granted.
        assert r.status_code != 403, r.text[:300]

    def test_fr_put_kitchen_settings(self, world):
        r = requests.put(f"{API}/admin/kitchen-settings",
                         headers=_hdr(world["fr_tok"]),
                         json={}, timeout=20)
        assert r.status_code != 403, r.text[:300]

    def test_fr_kitchen_close_out_post(self, world):
        r = requests.post(f"{API}/kitchen/close-out",
                          headers=_hdr(world["fr_tok"]),
                          json={"date": _today(), "lunch_served": 0,
                                "dinner_served": 0, "leftover": 0,
                                "notes": "TEST_IT93"},
                          timeout=20)
        assert r.status_code != 403, r.text[:300]

    def test_fr_attendance_scan(self, world):
        r = requests.post(f"{API}/attendance/scan",
                          headers=_hdr(world["fr_tok"]),
                          json={"qr_token": "TEST_IT93_invalid",
                                "meal": "lunch"},
                          timeout=20)
        # Should NOT be 403; valid 400/404 (bad QR) responses confirm gate is open.
        assert r.status_code != 403, r.text[:300]

    def test_fr_mess_menu_cal_post(self, world):
        r = requests.post(f"{API}/admin/mess-menu/calendar",
                          headers=_hdr(world["fr_tok"]),
                          json={"date": _today(),
                                "meal": "lunch",
                                "items": ["TEST_IT93 item"]},
                          timeout=20)
        assert r.status_code != 403, r.text[:300]

    def test_fr_mess_menu_cal_delete(self, world):
        r = requests.delete(
            f"{API}/admin/mess-menu/calendar?date={_today()}&meal=lunch",
            headers=_hdr(world["fr_tok"]), timeout=20)
        assert r.status_code != 403, r.text[:300]


# ── Regression: subscriber must still get 403 on these endpoints ───────────
SUB_403_SAMPLE = [
    ("GET", "/admin/raw-materials"),
    ("GET", "/admin/tiffin-stock"),
    ("GET", "/admin/payments/cash-totals"),
    ("GET", "/admin/kitchen-settings"),
    ("GET", "/admin/kitchen/recent"),
    ("GET", "/admin/notifications/bank-deposit"),
    ("GET", "/admin/refunds?status=pending"),
]


class TestSubscriber403:
    @pytest.mark.parametrize("method,path", SUB_403_SAMPLE)
    def test_subscriber_blocked(self, world, method, path):
        r = requests.request(method, f"{API}{path}",
                             headers=_hdr(world["sub_tok"]), timeout=20)
        assert r.status_code == 403, f"{method} {path} -> {r.status_code} (expected 403)"


# ── Regression: admin still gets 200 on a sample subset ───────────────────
ADMIN_200_SAMPLE = [
    ("GET", "/admin/raw-materials"),
    ("GET", "/admin/tiffin-stock"),
    ("GET", "/admin/payments/cash-totals"),
    ("GET", "/admin/kitchen-settings"),
    ("GET", "/admin/kitchen/recent"),
    ("GET", "/admin/notifications/bank-deposit"),
    ("GET", "/admin/refunds?status=pending"),
]


class TestAdmin200:
    @pytest.mark.parametrize("method,path", ADMIN_200_SAMPLE)
    def test_admin_ok(self, world, method, path):
        r = requests.request(method, f"{API}{path}",
                             headers=_hdr(world["admin_tok"]), timeout=20)
        assert r.status_code == 200, f"{method} {path} -> {r.status_code}: {r.text[:200]}"
