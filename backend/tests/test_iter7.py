"""Iter7: delivery-boy live tracking endpoints.
Covers:
  * GET /api/admin/delivery/live (admin-only, returns date/boys/items w/ customer_lat/lng)
  * GET /api/boy/me (403 for non-boy, boy doc for boy)
  * GET /api/boy/today (items + totals + nearest-neighbour order)
  * POST /api/boy/location (persist ping)
  * POST /api/boy/dispatch/start (+ end)
  * GET /api/my/deliveries/track (no-tracking + with-tracking shapes)
  * POST /api/admin/delivery/roster/{id}/mark geofence (near OK, far rejected 400)
"""
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


def _seed_user(role="subscriber", lat=None, lng=None, pincode="411001"):
    uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
    tok = f"TEST_s_{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": uid,
        "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com",
        "phone": f"99{uuid.uuid4().int % 10**8:08d}",
        "name": f"Test {role}",
        "address": f"1 Road, Pune {pincode}",
        "photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        "role": role,
        "qr_token": f"qr_TEST_{uuid.uuid4().hex[:10]}",
        "wallet_balance": 0.0,
        "created_at": now.isoformat(),
    }
    if lat is not None:
        doc["lat"] = lat
        doc["lng"] = lng
    db.users.insert_one(doc)
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "created_at": now.isoformat(),
    })
    return {"user_id": uid, "token": tok, "phone": doc["phone"]}


def _seed_delivery_boy(user_id: str, name="Boy X", pincodes=None):
    boy_id = f"dlv_TEST_{uuid.uuid4().hex[:8]}"
    doc = {
        "boy_id": boy_id,
        "user_id": user_id,
        "name": name,
        "phone": "9000000000",
        "assigned_pincodes": pincodes or ["411001"],
        "active": True,
        "current_lat": None, "current_lng": None, "last_ping_at": None,
        "on_trip": False, "trip_handoff_id": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db.delivery_boys.insert_one(doc)
    return boy_id


def _seed_roster_item(user_id: str, pincode="411001", meal_type="lunch", today=None, tiffin_size="full"):
    today = today or date.today().isoformat()
    rid = f"rst_TEST_{uuid.uuid4().hex[:8]}"
    db.daily_rosters.insert_one({
        "roster_id": rid,
        "user_id": user_id,
        "sub_id": f"sub_TEST_{uuid.uuid4().hex[:6]}",
        "plan_id": "premium_60",
        "plan_name": "Premium",
        "tiffin_size": tiffin_size,
        "name": "Customer",
        "phone": "9111111111",
        "address": f"1 Road {pincode}",
        "pincode": pincode,
        "is_outside": False,
        "is_unknown_pincode": False,
        "date": today,
        "meal_type": meal_type,
        "status": "planned",
        "delivery_boy_id": None,
        "handoff_id": None,
        "otp": "1234",
        "delivered_at": None,
        "notes": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return rid


@pytest.fixture
def admin_user():
    u = _seed_user("admin")
    yield u
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})


@pytest.fixture
def subscriber_user():
    u = _seed_user("subscriber", lat=18.5204, lng=73.8567, pincode="411001")
    yield u
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})


@pytest.fixture
def boy_user():
    u = _seed_user("delivery_boy")
    boy_id = _seed_delivery_boy(u["user_id"], pincodes=["411001"])
    u["boy_id"] = boy_id
    yield u
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})
    db.delivery_boys.delete_one({"boy_id": boy_id})
    db.delivery_handoffs.delete_many({"delivery_boy_id": boy_id})
    db.daily_rosters.delete_many({"delivery_boy_id": boy_id})


# ---- Admin live map ----
class TestAdminLive:
    def test_requires_admin(self, subscriber_user):
        r = requests.get(f"{BASE_URL}/api/admin/delivery/live", headers=_h(subscriber_user["token"]))
        assert r.status_code == 403

    def test_shape(self, admin_user, subscriber_user):
        rid = _seed_roster_item(subscriber_user["user_id"])
        try:
            r = requests.get(f"{BASE_URL}/api/admin/delivery/live", headers=_h(admin_user["token"]))
            assert r.status_code == 200, r.text
            d = r.json()
            assert "date" in d
            assert isinstance(d.get("boys"), list)
            assert isinstance(d.get("items"), list)
            # Find our item — must have customer_lat / customer_lng joined
            mine = [i for i in d["items"] if i["roster_id"] == rid]
            assert len(mine) == 1
            assert mine[0]["customer_lat"] == 18.5204
            assert mine[0]["customer_lng"] == 73.8567
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})


# ---- /boy/me ----
class TestBoyMe:
    def test_non_boy_403(self, subscriber_user):
        r = requests.get(f"{BASE_URL}/api/boy/me", headers=_h(subscriber_user["token"]))
        assert r.status_code == 403

    def test_boy_ok(self, boy_user):
        r = requests.get(f"{BASE_URL}/api/boy/me", headers=_h(boy_user["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["boy_id"] == boy_user["boy_id"]
        assert d["user_id"] == boy_user["user_id"]
        assert "411001" in d["assigned_pincodes"]


# ---- /boy/today ----
class TestBoyToday:
    def test_returns_items_totals(self, boy_user, subscriber_user):
        rid = _seed_roster_item(subscriber_user["user_id"])
        try:
            r = requests.get(f"{BASE_URL}/api/boy/today", headers=_h(boy_user["token"]))
            assert r.status_code == 200, r.text
            d = r.json()
            assert "date" in d
            assert d["boy"]["boy_id"] == boy_user["boy_id"]
            assert isinstance(d["items"], list)
            assert "totals" in d
            t = d["totals"]
            for k in ["total", "full", "half", "delivered", "pending"]:
                assert k in t, k
            # Our item is there
            assert any(i["roster_id"] == rid for i in d["items"])
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})


# ---- /boy/location ----
class TestBoyLocation:
    def test_non_boy_403(self, subscriber_user):
        r = requests.post(f"{BASE_URL}/api/boy/location",
                          headers=_h(subscriber_user["token"]),
                          json={"lat": 18.5, "lng": 73.8})
        assert r.status_code == 403

    def test_persists(self, boy_user):
        r = requests.post(f"{BASE_URL}/api/boy/location",
                          headers=_h(boy_user["token"]),
                          json={"lat": 18.5204, "lng": 73.8567, "accuracy": 10})
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        doc = db.delivery_boys.find_one({"boy_id": boy_user["boy_id"]})
        assert abs(doc["current_lat"] - 18.5204) < 1e-6
        assert abs(doc["current_lng"] - 73.8567) < 1e-6
        assert doc["last_ping_at"] is not None


# ---- dispatch/start + dispatch/end ----
class TestDispatch:
    def test_start_assigns_items(self, boy_user, subscriber_user):
        rid = _seed_roster_item(subscriber_user["user_id"], meal_type="lunch")
        try:
            r = requests.post(f"{BASE_URL}/api/boy/dispatch/start",
                              headers=_h(boy_user["token"]),
                              json={"meal_type": "lunch"})
            assert r.status_code == 200, r.text
            h = r.json()
            assert h["delivery_boy_id"] == boy_user["boy_id"]
            assert rid in h["roster_ids"]
            # roster updated
            item = db.daily_rosters.find_one({"roster_id": rid})
            assert item["delivery_boy_id"] == boy_user["boy_id"]
            assert item["status"] == "out"
            boy = db.delivery_boys.find_one({"boy_id": boy_user["boy_id"]})
            assert boy["on_trip"] is True
            # End trip
            r2 = requests.post(f"{BASE_URL}/api/boy/dispatch/end",
                               headers=_h(boy_user["token"]))
            assert r2.status_code == 200
            boy = db.delivery_boys.find_one({"boy_id": boy_user["boy_id"]})
            assert boy["on_trip"] is False
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})

    def test_start_no_items(self, boy_user):
        # boy has assigned pincodes but no rosters → expect 400
        r = requests.post(f"{BASE_URL}/api/boy/dispatch/start",
                          headers=_h(boy_user["token"]),
                          json={"meal_type": "lunch"})
        assert r.status_code == 400


# ---- /my/deliveries/track ----
class TestTrack:
    def test_no_active(self, subscriber_user):
        r = requests.get(f"{BASE_URL}/api/my/deliveries/track", headers=_h(subscriber_user["token"]))
        assert r.status_code == 200
        assert r.json() == {"tracking": False}

    def test_with_boy_position(self, subscriber_user, boy_user):
        rid = _seed_roster_item(subscriber_user["user_id"])
        db.daily_rosters.update_one(
            {"roster_id": rid},
            {"$set": {"delivery_boy_id": boy_user["boy_id"], "status": "out"}},
        )
        db.delivery_boys.update_one(
            {"boy_id": boy_user["boy_id"]},
            {"$set": {"current_lat": 18.5205, "current_lng": 73.8568,
                      "last_ping_at": datetime.now(timezone.utc).isoformat()}},
        )
        try:
            r = requests.get(f"{BASE_URL}/api/my/deliveries/track", headers=_h(subscriber_user["token"]))
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["tracking"] is True
            assert d["boy_name"] is not None
            assert d["boy_position"]["lat"] == 18.5205
            assert d["eta_minutes"] is not None
            assert d["distance_m"] is not None
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})


# ---- mark geofence ----
class TestMarkGeofence:
    def test_too_far_400(self, admin_user, subscriber_user):
        # Ensure geofence default 10m
        db.delivery_settings.update_one(
            {"_id": "active"},
            {"$set": {"geofence_meters": 10}},
            upsert=True,
        )
        rid = _seed_roster_item(subscriber_user["user_id"])
        try:
            # ~1 deg lat ≈ 111 km away
            r = requests.post(
                f"{BASE_URL}/api/admin/delivery/roster/{rid}/mark",
                headers=_h(admin_user["token"]),
                json={"status": "delivered", "lat": 19.5204, "lng": 73.8567},
            )
            assert r.status_code == 400
            assert "geofence" in r.json()["detail"].lower() or "away" in r.json()["detail"].lower()
            # item not updated
            item = db.daily_rosters.find_one({"roster_id": rid})
            assert item["status"] == "planned"
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})
            db.delivery_attempts.delete_many({"roster_id": rid})

    def test_near_ok(self, admin_user, subscriber_user):
        db.delivery_settings.update_one(
            {"_id": "active"},
            {"$set": {"geofence_meters": 10}},
            upsert=True,
        )
        rid = _seed_roster_item(subscriber_user["user_id"])
        try:
            # within ~5m (0.00004 deg ≈ 4.4m lat)
            r = requests.post(
                f"{BASE_URL}/api/admin/delivery/roster/{rid}/mark",
                headers=_h(admin_user["token"]),
                json={"status": "delivered", "lat": 18.52044, "lng": 73.8567},
            )
            assert r.status_code == 200, r.text
            item = db.daily_rosters.find_one({"roster_id": rid})
            assert item["status"] == "delivered"
            assert item["delivered_at"] is not None
            assert item["distance_m"] is not None and item["distance_m"] < 15
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})
            db.delivery_attempts.delete_many({"roster_id": rid})
