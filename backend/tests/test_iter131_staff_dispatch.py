"""iter-131.15 backend tests: /staff/dispatch + /delivery-boy/ping."""
import os
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dining-atomics.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

FR_PHONE = "9999999999"       # franchise_owner (seeded)
SUB_PHONE = "8888888888"      # will be created as subscriber


def _login(phone: str, name: str = None) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/send-otp", json={"phone": phone})
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    body = {"phone": phone, "otp": otp}
    if name:
        body["name"] = name
    r = s.post(f"{API}/auth/verify-otp", json=body)
    assert r.status_code == 200, r.text
    s.user = r.json()["user"]
    return s


@pytest.fixture(scope="module")
def fr_client():
    return _login(FR_PHONE)


@pytest.fixture(scope="module")
def sub_client():
    return _login(SUB_PHONE, name="TEST Sub")


@pytest.fixture(scope="module")
def mongo_db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


# ---------------- GET /staff/dispatch/today ----------------

class TestDispatchToday:
    def test_unauth(self):
        r = requests.get(f"{API}/staff/dispatch/today")
        assert r.status_code == 401

    def test_forbidden_for_subscriber(self, sub_client):
        # ensure role is subscriber (not franchise/admin)
        me = sub_client.get(f"{API}/auth/me").json()
        assert me.get("role") in ("subscriber", "user"), f"expected subscriber, got {me.get('role')}"
        r = sub_client.get(f"{API}/staff/dispatch/today")
        assert r.status_code == 403

    def test_franchise_owner_schema(self, fr_client):
        r = fr_client.get(f"{API}/staff/dispatch/today")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "date" in data and isinstance(data["date"], str)
        assert "items" in data and isinstance(data["items"], list)
        assert "ready_stats" in data
        for meal in ("lunch", "dinner"):
            assert meal in data["ready_stats"], f"missing {meal}"
            s = data["ready_stats"][meal]
            for k in ("total", "ready", "pending"):
                assert k in s
        assert "dispatch" in data
        for k in ("lat", "lng", "radius_km"):
            assert k in data["dispatch"]
        assert "boys" in data and isinstance(data["boys"], list)


# ---------------- POST /staff/dispatch/batch-ready ----------------

class TestBatchReady:
    def test_unauth(self):
        r = requests.post(f"{API}/staff/dispatch/batch-ready", json={"meal_type": "lunch"})
        assert r.status_code == 401

    def test_invalid_meal(self, fr_client):
        r = fr_client.post(f"{API}/staff/dispatch/batch-ready", json={"meal_type": "brunch"})
        assert r.status_code == 400

    def test_lunch_ok(self, fr_client):
        r = fr_client.post(f"{API}/staff/dispatch/batch-ready", json={"meal_type": "lunch"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["meal_type"] == "lunch"
        assert "date" in data and "marked" in data
        assert isinstance(data["marked"], int) and data["marked"] >= 0


# ---------------- POST /staff/dispatch/roster/{id}/ready ----------------

class TestToggleReady:
    def test_unknown_id(self, fr_client):
        r = fr_client.post(f"{API}/staff/dispatch/roster/DOES_NOT_EXIST/ready", json={"ready": True})
        assert r.status_code == 404

    def test_toggle_planned_ready_and_back(self, fr_client, mongo_db):
        # Ensure at least one planned dinner item exists
        items = fr_client.get(f"{API}/staff/dispatch/today").json()["items"]
        dinner_planned = [i for i in items if i["meal_type"] == "dinner" and i["status"] == "planned"]
        if not dinner_planned:
            # revert one dinner ready item to planned via toggle first
            dinner_ready = [i for i in items if i["meal_type"] == "dinner" and i["status"] == "ready"]
            if not dinner_ready:
                pytest.skip("No dinner planned/ready items available to toggle")
            rid = dinner_ready[0]["roster_id"]
            r0 = fr_client.post(f"{API}/staff/dispatch/roster/{rid}/ready", json={"ready": False})
            assert r0.status_code == 200
        else:
            rid = dinner_planned[0]["roster_id"]

        r = fr_client.post(f"{API}/staff/dispatch/roster/{rid}/ready", json={"ready": True})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ready"
        doc = mongo_db.daily_rosters.find_one({"roster_id": rid})
        assert doc["status"] == "ready"

        r2 = fr_client.post(f"{API}/staff/dispatch/roster/{rid}/ready", json={"ready": False})
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "planned"

    def test_400_on_out_or_delivered(self, fr_client, mongo_db):
        # inject a fake delivered item (or reuse existing) to test 400
        item = mongo_db.daily_rosters.find_one({"status": {"$in": ["out", "delivered"]}})
        if not item:
            # force one to delivered temporarily
            any_item = mongo_db.daily_rosters.find_one({})
            if not any_item:
                pytest.skip("no roster items")
            rid = any_item["roster_id"]
            orig = any_item["status"]
            mongo_db.daily_rosters.update_one({"roster_id": rid}, {"$set": {"status": "delivered"}})
            try:
                r = fr_client.post(f"{API}/staff/dispatch/roster/{rid}/ready", json={"ready": True})
                assert r.status_code == 400
            finally:
                mongo_db.daily_rosters.update_one({"roster_id": rid}, {"$set": {"status": orig}})
        else:
            r = fr_client.post(f"{API}/staff/dispatch/roster/{item['roster_id']}/ready", json={"ready": True})
            assert r.status_code == 400


# ---------------- POST /delivery-boy/ping ----------------

class TestDeliveryBoyPing:
    def test_403_when_not_a_boy(self, sub_client):
        r = sub_client.post(f"{API}/delivery-boy/ping", json={"lat": 20.9, "lng": 77.7})
        assert r.status_code == 403

    def test_bounds_when_not_a_boy_still_403(self, sub_client):
        # Non-boy is blocked before validation; that's acceptable — record behavior.
        r = sub_client.post(f"{API}/delivery-boy/ping", json={"lat": 95, "lng": 200})
        assert r.status_code in (400, 403)

    def test_boy_flow(self, fr_client, mongo_db):
        # Insert a delivery_boy doc linked to fr user
        uid = fr_client.user["user_id"]
        mongo_db.delivery_boys.update_one(
            {"boy_id": "TEST_boy_iter131"},
            {"$set": {
                "boy_id": "TEST_boy_iter131",
                "user_id": uid,
                "name": "TEST Boy",
                "phone": FR_PHONE,
                "assigned_pincodes": ["444601"],
                "active": True,
                "on_trip": False,
            }},
            upsert=True,
        )
        try:
            # Invalid coords
            r_bad = fr_client.post(f"{API}/delivery-boy/ping", json={"lat": 95, "lng": 10})
            assert r_bad.status_code == 400
            r_bad2 = fr_client.post(f"{API}/delivery-boy/ping", json={"lat": 20, "lng": 200})
            assert r_bad2.status_code == 400

            # Valid
            r = fr_client.post(f"{API}/delivery-boy/ping", json={"lat": 20.93, "lng": 77.75, "accuracy": 12.0})
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("ok") is True
            assert body.get("boy_id") == "TEST_boy_iter131"

            doc = mongo_db.delivery_boys.find_one({"boy_id": "TEST_boy_iter131"})
            assert abs(doc["current_lat"] - 20.93) < 1e-6
            assert abs(doc["current_lng"] - 77.75) < 1e-6
            assert doc.get("last_ping_at")
        finally:
            mongo_db.delivery_boys.delete_one({"boy_id": "TEST_boy_iter131"})

    def test_regression_boy_location_alias(self, fr_client, mongo_db):
        # /api/boy/location should still work for a registered boy
        uid = fr_client.user["user_id"]
        mongo_db.delivery_boys.update_one(
            {"boy_id": "TEST_boy_iter131b"},
            {"$set": {
                "boy_id": "TEST_boy_iter131b", "user_id": uid, "name": "TEST Boy 2",
                "phone": FR_PHONE, "assigned_pincodes": ["444601"], "active": True, "on_trip": False,
            }},
            upsert=True,
        )
        try:
            r = fr_client.post(f"{API}/boy/location", json={"lat": 20.9, "lng": 77.7, "accuracy": 5.0})
            # Endpoint might exist under boy router — accept 200 or 404 if renamed
            assert r.status_code in (200, 204), f"boy/location regression fail: {r.status_code} {r.text[:200]}"
        finally:
            mongo_db.delivery_boys.delete_one({"boy_id": "TEST_boy_iter131b"})
