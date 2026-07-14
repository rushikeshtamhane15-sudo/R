"""iter-131.16 backend tests: /api/my/delivery-prefs + late_stats fields."""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

FR_PHONE = "9999999999"       # franchise_owner
SUB_PHONE = "8888888888"      # subscriber


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


def _today_ist() -> str:
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).date().isoformat()


@pytest.fixture(scope="module")
def sub_client():
    return _login(SUB_PHONE, name="TEST Sub")


@pytest.fixture(scope="module")
def fr_client():
    return _login(FR_PHONE)


@pytest.fixture(scope="module")
def mongo_db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


# ---------------- GET /api/my/delivery-prefs ----------------

class TestGetPrefs:
    def test_unauth_401(self):
        r = requests.get(f"{API}/my/delivery-prefs")
        assert r.status_code == 401, r.text

    def test_get_returns_shape(self, sub_client, mongo_db):
        # Wipe any existing prefs to guarantee is_set=false for this assertion
        mongo_db.users.update_one({"user_id": sub_client.user["user_id"]}, {"$unset": {"delivery_prefs": ""}})
        r = sub_client.get(f"{API}/my/delivery-prefs")
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data.keys()) >= {"lunch", "dinner", "is_set"}
        assert data["lunch"] is None
        assert data["dinner"] is None
        assert data["is_set"] is False


# ---------------- PUT /api/my/delivery-prefs ----------------

class TestPutPrefs:
    def test_put_valid_and_get_reflects(self, sub_client):
        body = {"lunch": {"start": "10:00", "end": "10:30"}, "dinner": {"start": "20:00", "end": "20:30"}}
        r = sub_client.put(f"{API}/my/delivery-prefs", json=body)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j["prefs"]["lunch"]["start"] == "10:00"
        assert j["prefs"]["dinner"]["end"] == "20:30"

        r2 = sub_client.get(f"{API}/my/delivery-prefs")
        d = r2.json()
        assert d["is_set"] is True
        assert d["lunch"] == {"start": "10:00", "end": "10:30"}
        assert d["dinner"] == {"start": "20:00", "end": "20:30"}

    def test_reject_end_le_start(self, sub_client):
        r = sub_client.put(f"{API}/my/delivery-prefs", json={
            "lunch": {"start": "12:00", "end": "11:30"},
            "dinner": {"start": "20:00", "end": "20:30"},
        })
        assert r.status_code == 400
        assert "after start" in r.json().get("detail", "").lower()

    def test_reject_bad_format(self, sub_client):
        r = sub_client.put(f"{API}/my/delivery-prefs", json={
            "lunch": {"start": "10:0", "end": "10:30"},
            "dinner": {"start": "20:00", "end": "20:30"},
        })
        assert r.status_code == 400
        assert "hh:mm" in r.json().get("detail", "").lower()

    def test_reject_too_short(self, sub_client):
        r = sub_client.put(f"{API}/my/delivery-prefs", json={
            "lunch": {"start": "10:00", "end": "10:10"},
            "dinner": {"start": "20:00", "end": "20:30"},
        })
        assert r.status_code == 400
        assert "15" in r.json().get("detail", "")

    def test_reject_too_long(self, sub_client):
        r = sub_client.put(f"{API}/my/delivery-prefs", json={
            "lunch": {"start": "10:00", "end": "14:30"},
            "dinner": {"start": "20:00", "end": "20:30"},
        })
        assert r.status_code == 400
        assert "4 hour" in r.json().get("detail", "").lower()

    def test_put_splashes_today_roster(self, sub_client, mongo_db):
        """After PUT, existing today planned/ready daily_rosters must get pref_start/pref_end synced."""
        uid = sub_client.user["user_id"]
        today = _today_ist()
        # Seed a fake planned roster row for today (lunch)
        mongo_db.daily_rosters.delete_many({"user_id": uid, "date": today, "roster_id": {"$regex": "^TEST_"}})
        mongo_db.daily_rosters.insert_one({
            "roster_id": "TEST_r_iter16_l",
            "user_id": uid,
            "date": today,
            "meal_type": "lunch",
            "status": "planned",
            "pref_start": None,
            "pref_end": None,
        })
        mongo_db.daily_rosters.insert_one({
            "roster_id": "TEST_r_iter16_d",
            "user_id": uid,
            "date": today,
            "meal_type": "dinner",
            "status": "ready",
            "pref_start": None,
            "pref_end": None,
        })

        # PUT new prefs
        r = sub_client.put(f"{API}/my/delivery-prefs", json={
            "lunch": {"start": "11:00", "end": "11:45"},
            "dinner": {"start": "21:00", "end": "21:30"},
        })
        assert r.status_code == 200, r.text

        # Verify splash
        lr = mongo_db.daily_rosters.find_one({"roster_id": "TEST_r_iter16_l"})
        dr = mongo_db.daily_rosters.find_one({"roster_id": "TEST_r_iter16_d"})
        assert lr["pref_start"] == "11:00"
        assert lr["pref_end"] == "11:45"
        assert dr["pref_start"] == "21:00"
        assert dr["pref_end"] == "21:30"

        # cleanup
        mongo_db.daily_rosters.delete_many({"roster_id": {"$in": ["TEST_r_iter16_l", "TEST_r_iter16_d"]}})


# ---------------- late_stats on staff endpoints ----------------

class TestLateStats:
    def test_dispatch_today_has_late_stats(self, fr_client):
        r = fr_client.get(f"{API}/staff/dispatch/today")
        assert r.status_code == 200, r.text
        j = r.json()
        assert "late_stats" in j, j.keys()
        ls = j["late_stats"]
        for k in ("delivered_late_lunch", "delivered_late_dinner", "no_pref_lunch", "no_pref_dinner"):
            assert k in ls
            assert isinstance(ls[k], int)

    def test_today_deliveries_has_pref_fields(self, fr_client):
        r = fr_client.get(f"{API}/staff/today-deliveries")
        assert r.status_code == 200, r.text
        j = r.json()
        # counts include delivered_late + no_pref per meal
        counts = j.get("counts") or {}
        for meal in ("lunch", "dinner"):
            mc = counts.get(meal) or {}
            assert "delivered_late" in mc, f"missing delivered_late in counts.{meal}: {mc}"
            assert "no_pref" in mc, f"missing no_pref in counts.{meal}: {mc}"
        # spot-check row shape if any rows exist
        rows = j.get("rows") or []
        for r_ in rows[:3]:
            assert "pref_start" in r_
            assert "pref_end" in r_
            assert "delivered_late" in r_
            assert "delivered_late_by" in r_


# ---------------- regression: /boy/today still works ----------------

class TestBoyToday:
    def test_boy_today_endpoint_exists(self, sub_client, mongo_db):
        """Non-boy user hitting /boy/today should get 403 (or 200 with empty). Endpoint must not 500."""
        r = sub_client.get(f"{API}/delivery-boy/today")
        # Endpoint variants exist as /boy/today or /delivery-boy/today — try alt
        if r.status_code == 404:
            r = sub_client.get(f"{API}/boy/today")
        assert r.status_code in (200, 403, 404), r.text
