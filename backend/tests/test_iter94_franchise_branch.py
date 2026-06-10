"""iter-94 backend tests.

Scope:
- GET  /api/admin/control-tower → scope/mess_id + branch-scoped counts.
- GET  /api/franchise/me/mess   → mess details with scope=branch (FR) / global (admin).
- PATCH /api/franchise/me/kitchen → lat/lng/radius/address update on own mess.
- /admin/delivery/* and /admin/restaurant/takeaway-pendency* role gates widened
  to include franchise_owner.

All test artefacts prefixed with TEST_IT94_* and removed in teardown.
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


def _iso():
    return dt.datetime.utcnow().isoformat() + "Z"


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def mongo():
    client = pymongo.MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _seed_user(mongo, *, role, mess_id=None):
    uid = f"TEST_IT94_{role}_{uuid.uuid4().hex[:8]}"
    tok = f"TEST_IT94_sess_{uuid.uuid4().hex}"
    doc = {
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": f"Iter94 {role}",
        "role": role,
        "wallet_balance": 0,
        "created_at": _iso(),
    }
    if mess_id:
        doc["mess_id"] = mess_id
    mongo.users.insert_one(doc)
    mongo.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": "2099-01-01T00:00:00Z",
        "created_at": _iso(),
    })
    return uid, tok


@pytest.fixture(scope="module", autouse=True)
def world(mongo):
    orig = mongo.messes.find_one({"mess_id": MESS_A}) or {}
    orig_owner = orig.get("owner_user_id", "user_bb39434e1a5c")
    orig_lat = orig.get("lat")
    orig_lng = orig.get("lng")
    orig_radius = orig.get("radius_km")
    orig_address = orig.get("address")

    admin_uid, admin_tok = _seed_user(mongo, role="admin")
    fr_uid, fr_tok = _seed_user(mongo, role="franchise_owner", mess_id=MESS_A)
    sub_uid, sub_tok = _seed_user(mongo, role="subscriber", mess_id=MESS_A)

    mongo.messes.update_one({"mess_id": MESS_A},
                            {"$set": {"owner_user_id": fr_uid}})

    ctx = {
        "admin_tok": admin_tok, "admin_uid": admin_uid,
        "fr_tok": fr_tok, "fr_uid": fr_uid,
        "sub_tok": sub_tok, "sub_uid": sub_uid,
        "mess_id": MESS_A,
    }
    yield ctx

    # Restore mess + cleanup
    restore = {"owner_user_id": orig_owner}
    if orig_lat is not None:
        restore["lat"] = orig_lat
    if orig_lng is not None:
        restore["lng"] = orig_lng
    if orig_radius is not None:
        restore["radius_km"] = orig_radius
    if orig_address is not None:
        restore["address"] = orig_address
    mongo.messes.update_one({"mess_id": MESS_A}, {"$set": restore})
    mongo.users.delete_many({"user_id": {"$in": [admin_uid, fr_uid, sub_uid]}})
    mongo.user_sessions.delete_many(
        {"session_token": {"$regex": "^TEST_IT94_sess_"}})


# ── 1. Control Tower branch scoping ─────────────────────────────────────────
class TestControlTower:
    def test_admin_global(self, world):
        r = requests.get(f"{API}/admin/control-tower",
                         headers=_hdr(world["admin_tok"]), timeout=20)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j.get("scope") == "global", j
        assert j.get("mess_id") is None
        assert "live" in j and "restaurant_orders_active" in j["live"]

    def test_franchise_branch_scope(self, world):
        r = requests.get(f"{API}/admin/control-tower",
                         headers=_hdr(world["fr_tok"]), timeout=20)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j.get("scope") == "branch", j
        assert j.get("mess_id") == MESS_A

    def test_branch_count_le_global(self, world):
        ga = requests.get(f"{API}/admin/control-tower",
                          headers=_hdr(world["admin_tok"]), timeout=20).json()
        fr = requests.get(f"{API}/admin/control-tower",
                          headers=_hdr(world["fr_tok"]), timeout=20).json()
        g = ga["live"]["restaurant_orders_active"]
        b = fr["live"]["restaurant_orders_active"]
        assert b <= g, f"branch count {b} should be <= global {g}"

    def test_subscriber_blocked(self, world):
        r = requests.get(f"{API}/admin/control-tower",
                         headers=_hdr(world["sub_tok"]), timeout=20)
        assert r.status_code == 403


# ── 2. /franchise/me/mess ───────────────────────────────────────────────────
class TestFranchiseMyMess:
    def test_franchise_returns_branch(self, world):
        r = requests.get(f"{API}/franchise/me/mess",
                         headers=_hdr(world["fr_tok"]), timeout=20)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["scope"] == "branch"
        m = j["mess"]
        assert m and m.get("mess_id") == MESS_A
        # spec calls out these keys; values may be null but keys should exist
        for k in ("name", "city"):
            assert k in m, f"missing key {k} in mess: {list(m.keys())}"

    def test_admin_global(self, world):
        r = requests.get(f"{API}/franchise/me/mess",
                         headers=_hdr(world["admin_tok"]), timeout=20)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["scope"] == "global"
        assert j["mess"] is None

    def test_subscriber_403(self, world):
        r = requests.get(f"{API}/franchise/me/mess",
                         headers=_hdr(world["sub_tok"]), timeout=20)
        assert r.status_code == 403


# ── 3. PATCH /franchise/me/kitchen ──────────────────────────────────────────
class TestKitchenRadius:
    def test_franchise_updates_kitchen(self, world):
        payload = {"lat": 20.93, "lng": 77.75, "radius_km": 5,
                   "address": "TEST_IT94 kitchen address"}
        r = requests.patch(f"{API}/franchise/me/kitchen",
                           headers=_hdr(world["fr_tok"]),
                           json=payload, timeout=20)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j.get("ok") is True
        assert j["mess"]["mess_id"] == MESS_A
        # Verify via re-fetch of /franchise/me/mess
        r2 = requests.get(f"{API}/franchise/me/mess",
                          headers=_hdr(world["fr_tok"]), timeout=20)
        m = r2.json()["mess"]
        assert abs(m["lat"] - 20.93) < 1e-6
        assert abs(m["lng"] - 77.75) < 1e-6
        assert m.get("radius_km") == 5
        assert m.get("address") == "TEST_IT94 kitchen address"

    def test_invalid_coords_400(self, world):
        r = requests.patch(f"{API}/franchise/me/kitchen",
                           headers=_hdr(world["fr_tok"]),
                           json={"lat": 200, "lng": 0}, timeout=20)
        assert r.status_code == 400, r.text[:300]

    def test_radius_over_50_400(self, world):
        r = requests.patch(f"{API}/franchise/me/kitchen",
                           headers=_hdr(world["fr_tok"]),
                           json={"lat": 20.0, "lng": 77.0, "radius_km": 99},
                           timeout=20)
        assert r.status_code == 400, r.text[:300]

    def test_admin_blocked_400(self, world):
        r = requests.patch(f"{API}/franchise/me/kitchen",
                           headers=_hdr(world["admin_tok"]),
                           json={"lat": 20.0, "lng": 77.0}, timeout=20)
        assert r.status_code == 400, r.text[:300]

    def test_subscriber_403(self, world):
        r = requests.patch(f"{API}/franchise/me/kitchen",
                           headers=_hdr(world["sub_tok"]),
                           json={"lat": 20.0, "lng": 77.0}, timeout=20)
        assert r.status_code == 403


# ── 4. Delivery + takeaway-pendency role gates ─────────────────────────────
FR_200_ENDPOINTS = [
    ("GET", "/admin/delivery/today", None),
    ("GET", "/admin/delivery/boys", None),
    ("GET", "/admin/delivery/settings", None),
    ("GET", "/admin/restaurant/takeaway-pendency", None),
]


class TestFranchiseDeliveryAccess:
    @pytest.mark.parametrize("method,path,body", FR_200_ENDPOINTS)
    def test_fr_200(self, world, method, path, body):
        r = requests.request(method, f"{API}{path}",
                             headers=_hdr(world["fr_tok"]),
                             json=body, timeout=20)
        assert r.status_code == 200, f"{method} {path} -> {r.status_code}: {r.text[:300]}"

    def test_fr_takeaway_collect_not_403(self, world):
        r = requests.post(
            f"{API}/admin/restaurant/takeaway-pendency/collect",
            headers=_hdr(world["fr_tok"]),
            json={"order_id": "TEST_IT94_nonexistent"},
            timeout=20)
        assert r.status_code != 403, r.text[:300]

    def test_fr_takeaway_manual_not_403(self, world):
        r = requests.post(
            f"{API}/admin/restaurant/takeaway-pendency/manual",
            headers=_hdr(world["fr_tok"]),
            json={"phone": "9999999999", "amount": 0,
                  "items": [], "note": "TEST_IT94"},
            timeout=20)
        assert r.status_code != 403, r.text[:300]

    @pytest.mark.parametrize("method,path,body", FR_200_ENDPOINTS)
    def test_subscriber_403(self, world, method, path, body):
        r = requests.request(method, f"{API}{path}",
                             headers=_hdr(world["sub_tok"]),
                             json=body, timeout=20)
        assert r.status_code == 403


# ── 5. iter-92/93 regression — FR still has access to other ops ────────────
REG_FR_200 = [
    "/admin/raw-materials",
    "/admin/tiffin-stock",
    "/admin/payments/cash-totals",
    "/admin/kitchen-settings",
    "/admin/kitchen/recent",
    "/admin/refunds?status=pending",
]


class TestRegression:
    @pytest.mark.parametrize("path", REG_FR_200)
    def test_fr_still_200(self, world, path):
        r = requests.get(f"{API}{path}",
                         headers=_hdr(world["fr_tok"]), timeout=20)
        assert r.status_code == 200, f"{path} -> {r.status_code}"
