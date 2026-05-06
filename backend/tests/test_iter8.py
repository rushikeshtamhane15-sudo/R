"""Iter8 tests: slot lock, reverse-geocode pincode, empty tiffin accounting,
admin dashboard CMS endpoints, dispatch info on live/today/track payloads."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]


def _ist_today():
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date().isoformat()


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
        "pincode": pincode,
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


def _seed_delivery_boy(user_id, pincodes=None):
    boy_id = f"dlv_TEST_{uuid.uuid4().hex[:8]}"
    db.delivery_boys.insert_one({
        "boy_id": boy_id,
        "user_id": user_id,
        "name": "Boy X",
        "phone": "9000000000",
        "assigned_pincodes": pincodes or ["411001"],
        "active": True,
        "current_lat": None, "current_lng": None, "last_ping_at": None,
        "on_trip": False, "trip_handoff_id": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return boy_id


def _seed_roster(uid, pincode="411001", meal="lunch"):
    rid = f"rst_TEST_{uuid.uuid4().hex[:8]}"
    db.daily_rosters.insert_one({
        "roster_id": rid,
        "user_id": uid,
        "sub_id": f"sub_TEST_{uuid.uuid4().hex[:6]}",
        "plan_id": "premium_60",
        "plan_name": "Premium",
        "tiffin_size": "full",
        "name": "Customer",
        "phone": "9111111111",
        "address": f"1 Road {pincode}",
        "pincode": pincode,
        "is_outside": False,
        "is_unknown_pincode": False,
        "date": _ist_today(),
        "meal_type": meal,
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
    u = _seed_user("subscriber", lat=18.5204, lng=73.8567)
    yield u
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})
    db.tiffin_movements.delete_many({"user_id": u["user_id"]})


@pytest.fixture
def boy_user():
    u = _seed_user("delivery_boy")
    boy_id = _seed_delivery_boy(u["user_id"], ["411001"])
    u["boy_id"] = boy_id
    yield u
    db.users.delete_one({"user_id": u["user_id"]})
    db.user_sessions.delete_one({"session_token": u["token"]})
    db.delivery_boys.delete_one({"boy_id": boy_id})
    db.delivery_handoffs.delete_many({"delivery_boy_id": boy_id})
    db.daily_rosters.delete_many({"delivery_boy_id": boy_id})


@pytest.fixture
def reset_settings_after():
    """Snapshot settings, restore at teardown."""
    snap = db.delivery_settings.find_one({"_id": "active"})
    yield
    if snap:
        db.delivery_settings.replace_one({"_id": "active"}, snap, upsert=True)


# -------- Slot lock --------
class TestSlots:
    def test_subscriber_403(self, subscriber_user, reset_settings_after):
        r = requests.get(f"{BASE_URL}/api/boy/slots", headers=_h(subscriber_user["token"]))
        assert r.status_code == 403

    def test_boy_returns_shape_open(self, boy_user, reset_settings_after):
        db.delivery_settings.update_one(
            {"_id": "active"},
            {"$set": {"lunch_dispatch_open": "00:00", "lunch_dispatch_close": "23:59",
                      "dinner_dispatch_open": "00:00", "dinner_dispatch_close": "23:59"}},
            upsert=True,
        )
        r = requests.get(f"{BASE_URL}/api/boy/slots", headers=_h(boy_user["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "slots" in d
        for meal in ("lunch", "dinner"):
            assert meal in d["slots"]
            s = d["slots"][meal]
            assert "open" in s and "reason" in s and "window" in s
            assert s["open"] is True
            assert s["window"]["open_at"] == "00:00"

    def test_dispatch_blocked_when_closed(self, boy_user, subscriber_user, reset_settings_after):
        # set windows that cannot include "now" (either before now or after)
        db.delivery_settings.update_one(
            {"_id": "active"},
            {"$set": {"lunch_dispatch_open": "23:55", "lunch_dispatch_close": "23:59",
                      "dinner_dispatch_open": "23:55", "dinner_dispatch_close": "23:59"}},
            upsert=True,
        )
        rid = _seed_roster(subscriber_user["user_id"], meal="lunch")
        try:
            # If current IST happens to be 23:55-23:59, set window before-now to ensure closed.
            # Try first with original; if response is 200, switch to window 00:00-00:01.
            r = requests.post(f"{BASE_URL}/api/boy/dispatch/start",
                              headers=_h(boy_user["token"]),
                              json={"meal_type": "lunch"})
            if r.status_code == 200:
                # rare wall-clock collision — switch to early window then retry with a fresh roster
                db.delivery_settings.update_one(
                    {"_id": "active"},
                    {"$set": {"lunch_dispatch_open": "00:00", "lunch_dispatch_close": "00:01"}},
                )
                # roster was claimed; reset
                db.daily_rosters.update_one({"roster_id": rid},
                                            {"$set": {"delivery_boy_id": None, "status": "planned"}})
                db.delivery_boys.update_one({"boy_id": boy_user["boy_id"]},
                                            {"$set": {"on_trip": False, "trip_handoff_id": None}})
                r = requests.post(f"{BASE_URL}/api/boy/dispatch/start",
                                  headers=_h(boy_user["token"]),
                                  json={"meal_type": "lunch"})
            assert r.status_code == 400, r.text
            detail = r.json().get("detail", "").lower()
            assert "lunch" in detail and ("opens at" in detail or "closed at" in detail)
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})

    def test_dispatch_open_window_succeeds(self, boy_user, subscriber_user, reset_settings_after):
        db.delivery_settings.update_one(
            {"_id": "active"},
            {"$set": {"lunch_dispatch_open": "00:00", "lunch_dispatch_close": "23:59"}},
            upsert=True,
        )
        rid = _seed_roster(subscriber_user["user_id"], meal="lunch")
        try:
            r = requests.post(f"{BASE_URL}/api/boy/dispatch/start",
                              headers=_h(boy_user["token"]),
                              json={"meal_type": "lunch"})
            assert r.status_code == 200, r.text
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})


# -------- Reverse geocode --------
class TestLocationGeocode:
    def test_returns_pincode_or_null(self, subscriber_user):
        r = requests.post(f"{BASE_URL}/api/auth/location",
                          headers=_h(subscriber_user["token"]),
                          json={"lat": 28.6139, "lng": 77.2090})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert "pincode" in d
        # Pincode may be None due to rate limiting — acceptable per spec
        if d["pincode"] is not None:
            assert isinstance(d["pincode"], str)
            assert len(d["pincode"]) == 6 and d["pincode"].isdigit()
            # Verify saved on user doc
            u = db.users.find_one({"user_id": subscriber_user["user_id"]})
            assert u.get("pincode") == d["pincode"]


# -------- Tiffin balance accounting --------
class TestTiffinBalance:
    def test_mark_delivered_increments_balance(self, admin_user, subscriber_user):
        # Ensure generous geofence so coords match
        db.delivery_settings.update_one({"_id": "active"}, {"$set": {"geofence_meters": 100}}, upsert=True)
        rid = _seed_roster(subscriber_user["user_id"])
        try:
            # Customer is at 18.5204, 73.8567 — submit same coords
            r = requests.post(
                f"{BASE_URL}/api/admin/delivery/roster/{rid}/mark",
                headers=_h(admin_user["token"]),
                json={"status": "delivered", "lat": 18.5204, "lng": 73.8567},
            )
            assert r.status_code == 200, r.text
            u = db.users.find_one({"user_id": subscriber_user["user_id"]})
            assert int(u.get("tiffin_balance") or 0) == 1
            mv = list(db.tiffin_movements.find({"user_id": subscriber_user["user_id"], "kind": "issued"}))
            assert len(mv) == 1
            assert mv[0]["delta"] == 1

            # Re-mark same delivered item — should NOT re-increment
            r2 = requests.post(
                f"{BASE_URL}/api/admin/delivery/roster/{rid}/mark",
                headers=_h(admin_user["token"]),
                json={"status": "delivered", "lat": 18.5204, "lng": 73.8567},
            )
            assert r2.status_code == 200
            u2 = db.users.find_one({"user_id": subscriber_user["user_id"]})
            assert int(u2.get("tiffin_balance") or 0) == 1
            mv2 = list(db.tiffin_movements.find({"user_id": subscriber_user["user_id"], "kind": "issued"}))
            assert len(mv2) == 1, "Re-mark should not duplicate the issued movement"
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})
            db.delivery_attempts.delete_many({"roster_id": rid})

    def test_admin_collect_empty_decrements(self, admin_user, subscriber_user):
        db.users.update_one({"user_id": subscriber_user["user_id"]}, {"$set": {"tiffin_balance": 3}})
        r = requests.post(
            f"{BASE_URL}/api/admin/delivery/empty/collect",
            headers=_h(admin_user["token"]),
            json={"user_id": subscriber_user["user_id"], "count": 2},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["collected"] == 2
        assert d["remaining"] == 1
        u = db.users.find_one({"user_id": subscriber_user["user_id"]})
        assert int(u["tiffin_balance"]) == 1
        mv = list(db.tiffin_movements.find({"user_id": subscriber_user["user_id"], "kind": "collected"}))
        assert len(mv) == 1 and mv[0]["delta"] == -2

    def test_admin_collect_clamps_to_balance(self, admin_user, subscriber_user):
        db.users.update_one({"user_id": subscriber_user["user_id"]}, {"$set": {"tiffin_balance": 1}})
        r = requests.post(
            f"{BASE_URL}/api/admin/delivery/empty/collect",
            headers=_h(admin_user["token"]),
            json={"user_id": subscriber_user["user_id"], "count": 5},
        )
        assert r.status_code == 200, r.text
        assert r.json()["collected"] == 1
        u = db.users.find_one({"user_id": subscriber_user["user_id"]})
        assert int(u["tiffin_balance"]) == 0

    def test_boy_collect_empty(self, boy_user, subscriber_user):
        db.users.update_one({"user_id": subscriber_user["user_id"]}, {"$set": {"tiffin_balance": 2}})
        # Subscriber pincode (411001) matches boy pincode
        r = requests.post(
            f"{BASE_URL}/api/boy/empty/collect",
            headers=_h(boy_user["token"]),
            json={"user_id": subscriber_user["user_id"], "count": 1},
        )
        assert r.status_code == 200, r.text
        u = db.users.find_one({"user_id": subscriber_user["user_id"]})
        assert int(u["tiffin_balance"]) == 1

    def test_boy_collect_requires_boy(self, subscriber_user):
        r = requests.post(
            f"{BASE_URL}/api/boy/empty/collect",
            headers=_h(subscriber_user["token"]),
            json={"user_id": subscriber_user["user_id"], "count": 1},
        )
        assert r.status_code == 403

    def test_admin_empties_list(self, admin_user, subscriber_user):
        db.users.update_one({"user_id": subscriber_user["user_id"]}, {"$set": {"tiffin_balance": 4}})
        r = requests.get(f"{BASE_URL}/api/admin/delivery/empties", headers=_h(admin_user["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "users" in d and "total_outstanding" in d and "count" in d
        ids = [u["user_id"] for u in d["users"]]
        assert subscriber_user["user_id"] in ids
        # All listed users have tiffin_balance > 0
        assert all(int(u["tiffin_balance"]) > 0 for u in d["users"])

    def test_boy_empties_filters_by_pincode(self, boy_user, subscriber_user):
        # Subscriber pincode 411001 matches boy
        db.users.update_one({"user_id": subscriber_user["user_id"]}, {"$set": {"tiffin_balance": 2}})
        # Add a user in different pincode that should NOT show up
        other = _seed_user("subscriber", pincode="999999")
        db.users.update_one({"user_id": other["user_id"]}, {"$set": {"tiffin_balance": 5}})
        try:
            r = requests.get(f"{BASE_URL}/api/boy/empties", headers=_h(boy_user["token"]))
            assert r.status_code == 200, r.text
            d = r.json()
            ids = [u["user_id"] for u in d["users"]]
            assert subscriber_user["user_id"] in ids
            assert other["user_id"] not in ids
        finally:
            db.users.delete_one({"user_id": other["user_id"]})
            db.user_sessions.delete_one({"session_token": other["token"]})


# -------- Dispatch info on live/today/track --------
class TestDispatchInPayloads:
    def test_admin_live_includes_dispatch(self, admin_user, subscriber_user, reset_settings_after):
        db.delivery_settings.update_one(
            {"_id": "active"},
            {"$set": {"dispatch_lat": 18.52, "dispatch_lng": 73.85, "dispatch_radius_km": 15}},
            upsert=True,
        )
        rid = _seed_roster(subscriber_user["user_id"])
        db.users.update_one({"user_id": subscriber_user["user_id"]}, {"$set": {"tiffin_balance": 2, "pincode": "411001"}})
        try:
            r = requests.get(f"{BASE_URL}/api/admin/delivery/live", headers=_h(admin_user["token"]))
            assert r.status_code == 200, r.text
            d = r.json()
            assert "dispatch" in d
            assert d["dispatch"]["lat"] == 18.52
            assert d["dispatch"]["radius_km"] == 15
            mine = [i for i in d["items"] if i["roster_id"] == rid]
            assert mine
            assert "customer_pincode" in mine[0]
            assert "tiffin_balance" in mine[0]
            assert mine[0]["tiffin_balance"] == 2
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})

    def test_boy_today_includes_dispatch(self, boy_user, subscriber_user, reset_settings_after):
        db.delivery_settings.update_one(
            {"_id": "active"},
            {"$set": {"dispatch_lat": 18.52, "dispatch_lng": 73.85, "dispatch_radius_km": 12}},
            upsert=True,
        )
        rid = _seed_roster(subscriber_user["user_id"])
        db.users.update_one({"user_id": subscriber_user["user_id"]}, {"$set": {"tiffin_balance": 3}})
        try:
            r = requests.get(f"{BASE_URL}/api/boy/today", headers=_h(boy_user["token"]))
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["dispatch"]["radius_km"] == 12
            mine = [i for i in d["items"] if i["roster_id"] == rid]
            assert mine and mine[0]["tiffin_balance"] == 3
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})

    def test_track_includes_dispatch_and_balance(self, subscriber_user, boy_user, reset_settings_after):
        db.delivery_settings.update_one(
            {"_id": "active"},
            {"$set": {"dispatch_lat": 18.52, "dispatch_lng": 73.85, "dispatch_radius_km": 15}},
            upsert=True,
        )
        db.users.update_one({"user_id": subscriber_user["user_id"]}, {"$set": {"tiffin_balance": 4}})
        rid = _seed_roster(subscriber_user["user_id"])
        db.daily_rosters.update_one({"roster_id": rid},
                                    {"$set": {"delivery_boy_id": boy_user["boy_id"], "status": "out"}})
        db.delivery_boys.update_one({"boy_id": boy_user["boy_id"]},
                                    {"$set": {"current_lat": 18.5205, "current_lng": 73.8568,
                                              "last_ping_at": datetime.now(timezone.utc).isoformat()}})
        try:
            r = requests.get(f"{BASE_URL}/api/my/deliveries/track", headers=_h(subscriber_user["token"]))
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["tracking"] is True
            assert d["dispatch"]["radius_km"] == 15
            assert d["tiffin_balance"] == 4
        finally:
            db.daily_rosters.delete_one({"roster_id": rid})


# -------- Dashboard CMS --------
class TestDashboardConfig:
    def test_get_public_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/dashboard/config")
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("sections"), list) and len(d["sections"]) == 7
        assert isinstance(d.get("texts"), dict) and len(d["texts"]) >= 6
        assert isinstance(d.get("colors"), dict) and len(d["colors"]) >= 4
        for k in ["greeting_overline", "heading_eatin", "heading_tiffin", "subtext", "no_sub_title", "no_sub_subtext"]:
            assert k in d["texts"]
        for k in ["wallet_bg", "wallet_fg", "hero_accent", "section_card_bg"]:
            assert k in d["colors"]

    def test_patch_admin_only(self, subscriber_user):
        r = requests.patch(f"{BASE_URL}/api/admin/dashboard/config",
                           headers=_h(subscriber_user["token"]),
                           json={"texts": {"greeting_overline": "Hi"}})
        assert r.status_code == 403

    def test_patch_persists_and_order_preserved(self, admin_user):
        # Reset first
        rs = requests.post(f"{BASE_URL}/api/admin/dashboard/config/reset", headers=_h(admin_user["token"]))
        assert rs.status_code == 200
        # Reorder sections (reverse) + new texts + colors
        cur = requests.get(f"{BASE_URL}/api/dashboard/config").json()
        reversed_sections = list(reversed(cur["sections"]))
        for i, s in enumerate(reversed_sections):
            s["order"] = i
        # Toggle history off
        for s in reversed_sections:
            if s["id"] == "history":
                s["visible"] = False
        payload = {
            "sections": reversed_sections,
            "texts": {"greeting_overline": "Namaste,"},
            "colors": {"wallet_bg": "#123456"},
        }
        r = requests.patch(f"{BASE_URL}/api/admin/dashboard/config",
                           headers=_h(admin_user["token"]), json=payload)
        assert r.status_code == 200, r.text
        # Confirm via fresh GET
        d = requests.get(f"{BASE_URL}/api/dashboard/config").json()
        assert d["texts"]["greeting_overline"] == "Namaste,"
        assert d["colors"]["wallet_bg"] == "#123456"
        # Order should reflect the reversed payload (so first section in reversed_sections is first)
        first_id = reversed_sections[0]["id"]
        assert d["sections"][0]["id"] == first_id
        # history hidden
        h = next((s for s in d["sections"] if s["id"] == "history"), None)
        assert h is not None and h["visible"] is False
        # Reset back to defaults for cleanup
        rs2 = requests.post(f"{BASE_URL}/api/admin/dashboard/config/reset", headers=_h(admin_user["token"]))
        assert rs2.status_code == 200
        d2 = rs2.json()
        # After reset, history should be visible again, default order
        h2 = next((s for s in d2["sections"] if s["id"] == "history"), None)
        assert h2 is not None and h2["visible"] is True
        assert d2["texts"]["greeting_overline"] == "Hello,"

    def test_reset_admin_only(self, subscriber_user):
        r = requests.post(f"{BASE_URL}/api/admin/dashboard/config/reset",
                          headers=_h(subscriber_user["token"]))
        assert r.status_code == 403
