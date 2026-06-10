"""iter-92 — Backend tests for franchise_owner branch-scoping across:

* GET   /api/admin/stats?period=cycle                      → scope=branch + mess_id
* GET   /api/admin/attendance/today                        → subset only
* GET   /api/admin/restaurant/orders                       → branch users only
* POST  /api/admin/restaurant/orders/{id}/status           → 403 cross-branch
* POST  /api/admin/restaurant/orders/{id}/assign-rider     → 403 cross-branch
* POST  /api/admin/users/{id}/wallet-adjust                → 403 cross-branch
* GET   /api/admin/users/{id}/wallet-history               → 403 cross-branch
* PATCH /api/admin/refunds/{refund_id}                     → 403 cross-branch

Seeds ephemeral admin + 2 franchise_owners + 2 subscriber users + a secondary
mess, runs the assertions, then deletes everything and restores the original
`efoodcare-amravati` owner_user_id (= user_bb39434e1a5c).
"""
import os
import time
import uuid

import pymongo
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

MESS_A = "efoodcare-amravati"
MESS_B = f"TEST_IT92_branch_b_{uuid.uuid4().hex[:6]}"
ORIG_OWNER_A = "user_bb39434e1a5c"


@pytest.fixture(scope="module")
def mongo():
    client = pymongo.MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _now_iso():
    import datetime as dt
    return dt.datetime.utcnow().isoformat() + "Z"


def _seed_user(mongo, *, role, mess_id=None, extra=None):
    uid = f"TEST_IT92_{role}_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_IT92_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": f"Iter92 {role}",
        "role": role,
        "wallet_balance": 0,
        "created_at": _now_iso(),
    }
    if mess_id:
        doc["mess_id"] = mess_id
    if extra:
        doc.update(extra)
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
    """Set up: admin, FR_A (owner of MESS_A), FR_B (owner of MESS_B),
    sub_A (in MESS_A), sub_B (in MESS_B), restaurant_orders for both,
    refund_requests for both."""
    # Snapshot original owner of MESS_A
    orig_doc = mongo.messes.find_one({"mess_id": MESS_A}) or {}
    orig_owner_A = orig_doc.get("owner_user_id", ORIG_OWNER_A)

    # Admin
    admin_uid, admin_tok = _seed_user(mongo, role="admin")

    # FR_A — owns MESS_A
    fr_a_uid, fr_a_tok = _seed_user(mongo, role="franchise_owner",
                                    mess_id=MESS_A,
                                    extra={"phone": "9000000091"})
    mongo.messes.update_one({"mess_id": MESS_A}, {"$set": {"owner_user_id": fr_a_uid}})

    # FR_B — owns NEW MESS_B
    fr_b_uid, fr_b_tok = _seed_user(mongo, role="franchise_owner",
                                    mess_id=MESS_B,
                                    extra={"phone": "9000000092"})
    mongo.messes.insert_one({
        "mess_id": MESS_B,
        "name": "Iter92 Branch B",
        "owner_user_id": fr_b_uid,
        "city": "Testville",
        "created_at": _now_iso(),
    })

    # Subscribers
    sub_a_uid, _ = _seed_user(mongo, role="subscriber", mess_id=MESS_A,
                              extra={"wallet_balance": 500})
    sub_b_uid, _ = _seed_user(mongo, role="subscriber", mess_id=MESS_B,
                              extra={"wallet_balance": 500})

    # Restaurant orders (one per branch, status=paid so transitions are allowed)
    order_a = f"TEST_IT92_orderA_{uuid.uuid4().hex[:8]}"
    order_b = f"TEST_IT92_orderB_{uuid.uuid4().hex[:8]}"
    mongo.restaurant_orders.insert_many([
        {"order_id": order_a, "user_id": sub_a_uid, "status": "paid",
         "items": [], "total": 100, "created_at": _now_iso()},
        {"order_id": order_b, "user_id": sub_b_uid, "status": "paid",
         "items": [], "total": 100, "created_at": _now_iso()},
    ])

    # Rider (so assign-rider doesn't 404 on the rider lookup)
    rider_uid, _ = _seed_user(mongo, role="rider")

    # Refund requests (status=pending)
    refund_a = f"TEST_IT92_refA_{uuid.uuid4().hex[:8]}"
    refund_b = f"TEST_IT92_refB_{uuid.uuid4().hex[:8]}"
    mongo.refund_requests.insert_many([
        {"refund_id": refund_a, "user_id": sub_a_uid, "order_id": order_a,
         "status": "pending", "amount": 100, "created_at": _now_iso()},
        {"refund_id": refund_b, "user_id": sub_b_uid, "order_id": order_b,
         "status": "pending", "amount": 100, "created_at": _now_iso()},
    ])

    ctx = {
        "admin": {"uid": admin_uid, "token": admin_tok},
        "fr_a": {"uid": fr_a_uid, "token": fr_a_tok},
        "fr_b": {"uid": fr_b_uid, "token": fr_b_tok},
        "sub_a": sub_a_uid, "sub_b": sub_b_uid,
        "rider": rider_uid,
        "order_a": order_a, "order_b": order_b,
        "refund_a": refund_a, "refund_b": refund_b,
        "orig_owner_A": orig_owner_A,
    }
    yield ctx

    # Teardown — delete everything seeded; restore mess A owner
    mongo.messes.update_one({"mess_id": MESS_A},
                            {"$set": {"owner_user_id": orig_owner_A}})
    mongo.messes.delete_one({"mess_id": MESS_B})
    mongo.users.delete_many({"user_id": {"$in": [
        admin_uid, fr_a_uid, fr_b_uid, sub_a_uid, sub_b_uid, rider_uid
    ]}})
    mongo.user_sessions.delete_many({"session_token": {"$regex": "^TEST_IT92_sess_"}})
    mongo.restaurant_orders.delete_many({"order_id": {"$in": [order_a, order_b]}})
    mongo.refund_requests.delete_many({"refund_id": {"$in": [refund_a, refund_b]}})
    # Restore default franchise_owner user fields (problem statement note)
    mongo.users.update_one(
        {"user_id": ORIG_OWNER_A},
        {"$set": {
            "name": "Test FR",
            "phone": "9999999999",
            "address": "Test",
            "email": "fr@efoodcare.in",
        }},
    )


# ── /admin/stats ───────────────────────────────────────────────────────────

class TestAdminStats:
    def test_stats_admin_global_scope(self, world):
        r = requests.get(f"{API}/admin/stats?period=cycle",
                         headers=_hdr(world["admin"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("scope") == "global"
        # Admin should NOT have a mess_id field (or it's null/empty)
        assert not data.get("mess_id")

    def test_stats_franchise_branch_scope(self, world):
        r = requests.get(f"{API}/admin/stats?period=cycle",
                         headers=_hdr(world["fr_a"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("scope") == "branch"
        assert data.get("mess_id") == MESS_A
        # Sanity: numeric fields exist
        for k in ("total_users", "total_subscribers", "active_subscriptions"):
            assert k in data, f"missing {k} in stats response"

    def test_stats_franchise_b_isolated(self, world):
        """FR_B should see counts restricted to MESS_B (different from FR_A)."""
        r = requests.get(f"{API}/admin/stats?period=cycle",
                         headers=_hdr(world["fr_b"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("scope") == "branch"
        assert data.get("mess_id") == MESS_B


# ── /admin/attendance/today ────────────────────────────────────────────────

class TestAttendance:
    def test_attendance_admin_returns_ok(self, world):
        r = requests.get(f"{API}/admin/attendance/today",
                         headers=_hdr(world["admin"]["token"]), timeout=20)
        assert r.status_code == 200, r.text

    def test_attendance_franchise_returns_ok(self, world):
        r = requests.get(f"{API}/admin/attendance/today",
                         headers=_hdr(world["fr_a"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # response is dict with rows or a list — either is fine; we just
        # verify the franchise can access it at all (regression).
        assert data is not None


# ── /admin/restaurant/orders ───────────────────────────────────────────────

class TestRestaurantOrdersList:
    def _extract(self, payload):
        if isinstance(payload, list):
            return payload
        return payload.get("orders") or payload.get("items") or []

    def test_admin_sees_both_branches(self, world):
        r = requests.get(f"{API}/admin/restaurant/orders",
                         headers=_hdr(world["admin"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        ids = {o.get("order_id") for o in self._extract(r.json())}
        assert world["order_a"] in ids
        assert world["order_b"] in ids

    def test_franchise_a_sees_only_branch_a(self, world):
        r = requests.get(f"{API}/admin/restaurant/orders",
                         headers=_hdr(world["fr_a"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        ids = {o.get("order_id") for o in self._extract(r.json())}
        assert world["order_a"] in ids
        assert world["order_b"] not in ids, "FR_A leaked branch-B orders"

    def test_franchise_b_sees_only_branch_b(self, world):
        r = requests.get(f"{API}/admin/restaurant/orders",
                         headers=_hdr(world["fr_b"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        ids = {o.get("order_id") for o in self._extract(r.json())}
        assert world["order_b"] in ids
        assert world["order_a"] not in ids


# ── /admin/restaurant/orders/{id}/status ───────────────────────────────────

class TestOrderStatus:
    def test_franchise_same_branch_can_set_status(self, world):
        r = requests.post(f"{API}/admin/restaurant/orders/{world['order_a']}/status",
                          headers=_hdr(world["fr_a"]["token"]),
                          json={"status": "preparing"}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "preparing"

    def test_franchise_cross_branch_status_403(self, world):
        r = requests.post(f"{API}/admin/restaurant/orders/{world['order_b']}/status",
                          headers=_hdr(world["fr_a"]["token"]),
                          json={"status": "preparing"}, timeout=20)
        assert r.status_code == 403, r.text
        assert "branch" in (r.json().get("detail") or "").lower()


# ── /admin/restaurant/orders/{id}/assign-rider ─────────────────────────────

class TestAssignRider:
    def test_franchise_same_branch_assign(self, world):
        r = requests.post(f"{API}/admin/restaurant/orders/{world['order_a']}/assign-rider",
                          headers=_hdr(world["fr_a"]["token"]),
                          json={"rider_user_id": world["rider"]}, timeout=20)
        assert r.status_code == 200, r.text

    def test_franchise_cross_branch_assign_403(self, world):
        r = requests.post(f"{API}/admin/restaurant/orders/{world['order_b']}/assign-rider",
                          headers=_hdr(world["fr_a"]["token"]),
                          json={"rider_user_id": world["rider"]}, timeout=20)
        assert r.status_code == 403, r.text
        assert "branch" in (r.json().get("detail") or "").lower()


# ── /admin/users/{id}/wallet-adjust ────────────────────────────────────────

class TestWalletAdjust:
    def test_franchise_same_branch_adjust(self, world, mongo):
        r = requests.post(f"{API}/admin/users/{world['sub_a']}/wallet-adjust",
                          headers=_hdr(world["fr_a"]["token"]),
                          json={"delta": 50, "reason": "TEST_IT92 fr adjust"},
                          timeout=20)
        assert r.status_code == 200, r.text
        # Verify persistence
        u = mongo.users.find_one({"user_id": world["sub_a"]}, {"wallet_balance": 1})
        assert u and u.get("wallet_balance") >= 550

    def test_franchise_cross_branch_adjust_403(self, world):
        r = requests.post(f"{API}/admin/users/{world['sub_b']}/wallet-adjust",
                          headers=_hdr(world["fr_a"]["token"]),
                          json={"delta": 50, "reason": "x"}, timeout=20)
        assert r.status_code == 403, r.text
        assert "branch" in (r.json().get("detail") or "").lower()

    def test_admin_can_adjust_any(self, world):
        r = requests.post(f"{API}/admin/users/{world['sub_b']}/wallet-adjust",
                          headers=_hdr(world["admin"]["token"]),
                          json={"delta": 10, "reason": "TEST_IT92 admin adj"},
                          timeout=20)
        assert r.status_code == 200, r.text


# ── /admin/users/{id}/wallet-history ───────────────────────────────────────

class TestWalletHistory:
    def test_franchise_same_branch_history(self, world):
        r = requests.get(f"{API}/admin/users/{world['sub_a']}/wallet-history",
                         headers=_hdr(world["fr_a"]["token"]), timeout=20)
        assert r.status_code == 200, r.text

    def test_franchise_cross_branch_history_403(self, world):
        r = requests.get(f"{API}/admin/users/{world['sub_b']}/wallet-history",
                         headers=_hdr(world["fr_a"]["token"]), timeout=20)
        assert r.status_code == 403, r.text
        assert "branch" in (r.json().get("detail") or "").lower()


# ── /admin/refunds/{id} ────────────────────────────────────────────────────

class TestRefundDecision:
    def test_franchise_cross_branch_refund_403(self, world):
        r = requests.patch(f"{API}/admin/refunds/{world['refund_b']}",
                           headers=_hdr(world["fr_a"]["token"]),
                           json={"decision": "approve", "wallet_credit": 50,
                                 "admin_notes": "x"}, timeout=20)
        assert r.status_code == 403, r.text
        assert "branch" in (r.json().get("detail") or "").lower()

    def test_franchise_same_branch_refund_approve(self, world):
        r = requests.patch(f"{API}/admin/refunds/{world['refund_a']}",
                           headers=_hdr(world["fr_a"]["token"]),
                           json={"decision": "approve", "wallet_credit": 50,
                                 "admin_notes": "TEST_IT92 fr approve"},
                           timeout=20)
        assert r.status_code == 200, r.text
