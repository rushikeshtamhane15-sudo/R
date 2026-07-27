"""iter-131.30 backend verification:
  (1) Meal slots API (GET public + PUT admin RBAC).
  (2) Tiffin stock sync end-to-end: rider deliver of returnable tiffin decrements
      db.tiffin_stock; admin collect_takeaway increments it back.
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

client_mongo = MongoClient(MONGO_URL)
db = client_mongo[DB_NAME]


def _iso(dt):
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _mint_session(user_id: str) -> str:
    token = f"sess_test_{uuid.uuid4().hex[:16]}"
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": _iso(datetime.now(timezone.utc) + timedelta(hours=2)),
        "created_at": _iso(datetime.now(timezone.utc)),
    })
    return token


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    admin = db.users.find_one({"phone": "9199990000"}) or db.users.find_one({"role": "admin"})
    assert admin, "No admin user seeded"
    if admin.get("role") != "admin":
        db.users.update_one({"user_id": admin["user_id"]}, {"$set": {"role": "admin"}})
    return _mint_session(admin["user_id"]), admin["user_id"]


@pytest.fixture(scope="module")
def sub_user():
    u = db.users.find_one({"phone": "9333333333"})
    assert u, "Seed subscriber 9333333333 missing"
    return u


# ---------------------------------------------------------------------------
# (1) Meal slots
# ---------------------------------------------------------------------------
class TestMealSlots:
    def test_get_public_default(self):
        r = requests.get(f"{BASE_URL}/api/meal-slots", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "lunch" in data and "dinner" in data
        assert "start" in data["lunch"] and "end" in data["lunch"]

    def test_put_admin_ok(self, admin_token):
        tok, _ = admin_token
        payload = {"lunch": {"start": "12:15", "end": "15:30"}, "dinner": {"start": "19:15", "end": "22:15"}}
        r = requests.put(f"{BASE_URL}/api/admin/meal-slots", json=payload, headers=_headers(tok), timeout=10)
        assert r.status_code == 200, r.text
        # GET verifies persistence
        g = requests.get(f"{BASE_URL}/api/meal-slots", timeout=10).json()
        assert g["lunch"]["start"] == "12:15"
        assert g["dinner"]["end"] == "22:15"

    def test_put_unauth_403(self, sub_user):
        # Mint a session for the sub user (role=subscriber)
        tok = _mint_session(sub_user["user_id"])
        payload = {"lunch": {"start": "12:00", "end": "15:00"}, "dinner": {"start": "19:00", "end": "22:00"}}
        r = requests.put(f"{BASE_URL}/api/admin/meal-slots", json=payload, headers=_headers(tok), timeout=10)
        assert r.status_code == 403, r.text

    def test_put_invalid_time_400(self, admin_token):
        tok, _ = admin_token
        payload = {"lunch": {"start": "25:99", "end": "15:00"}, "dinner": {"start": "19:00", "end": "22:00"}}
        r = requests.put(f"{BASE_URL}/api/admin/meal-slots", json=payload, headers=_headers(tok), timeout=10)
        assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# (2) Tiffin stock sync end-to-end
# ---------------------------------------------------------------------------
class TestTiffinStockSync:
    """Seed stock=50 for the sub-user's mess, seed a delivered returnable-tiffin
    restaurant order manually (bypass full OTP flow) by directly writing the
    pendency row + calling decrement helper via a fresh rider deliver call.

    Since driving the full rider flow requires many state transitions, we
    instead simulate the DELIVER step by seeding an order in out_for_delivery
    state with a known OTP and calling the rider deliver endpoint.
    """

    def _seed_stock(self, mess_id, qty=50):
        sid = f"active:{mess_id}" if mess_id else "active"
        db.tiffin_stock.update_one({"_id": sid}, {"$set": {"quantity": qty, "mess_id": mess_id, "low_threshold": 20}}, upsert=True)
        return sid

    def _seed_returnable_menu(self):
        # Ensure at least one active menu item is flagged is_returnable_tiffin
        doc = db.restaurant_menu_items.find_one({"_id": "active"}) or {"_id": "active", "items": []}
        items = doc.get("items", [])
        # Inject a test tiffin item
        test_id = "TEST_returnable_tiffin_iter13130"
        items = [i for i in items if i.get("id") != test_id]
        items.append({
            "id": test_id, "name": "TEST Returnable Tiffin", "price": 100,
            "category": "Tiffin Specials", "is_returnable_tiffin": True, "available": True,
            "image": "", "description": "",
        })
        db.restaurant_menu_items.update_one({"_id": "active"}, {"$set": {"items": items}}, upsert=True)
        return test_id

    def _promote_rider(self):
        rider_uid = f"user_test_rider_{uuid.uuid4().hex[:8]}"
        db.users.insert_one({
            "user_id": rider_uid, "phone": f"9{uuid.uuid4().int % 10**9:09d}",
            "name": "TEST Rider", "role": "rider", "wallet_balance": 0.0,
            "created_at": _iso(datetime.now(timezone.utc)),
        })
        return rider_uid

    def test_deliver_and_collect_syncs_stock(self, admin_token, sub_user):
        tok, admin_uid = admin_token
        mess_id = sub_user.get("mess_id")
        sid = self._seed_stock(mess_id, qty=50)
        item_id = self._seed_returnable_menu()
        rider_uid = self._promote_rider()

        order_id = f"TEST_ord_{uuid.uuid4().hex[:10]}"
        pendency_id = f"rtp_{order_id}"
        # Clean up prior artifacts if any
        db.restaurant_tiffin_pendency.delete_many({"pendency_id": pendency_id})
        db.restaurant_orders.delete_many({"order_id": order_id})

        otp = "9911"
        db.restaurant_orders.insert_one({
            "order_id": order_id,
            "user_id": sub_user["user_id"],
            "rider_id": rider_uid,
            "status": "out_for_delivery",
            "items": [{"id": item_id, "name": "TEST Returnable Tiffin", "qty": 1, "price": 100}],
            "subtotal": 100, "delivery_fee": 0, "total": 100,
            "phone": sub_user.get("phone", ""),
            "name": sub_user.get("name", ""),
            "delivery_otp": otp,
            "delivery_otp_expires": _iso(datetime.now(timezone.utc) + timedelta(minutes=15)),
            "delivery_otp_attempts": 0,
            "created_at": _iso(datetime.now(timezone.utc)),
        })

        # Rider mints their own session
        rider_tok = _mint_session(rider_uid)

        # DELIVER
        r = requests.post(
            f"{BASE_URL}/api/rider/orders/{order_id}/deliver",
            json={"otp": otp, "payment_mode": "online"},
            headers=_headers(rider_tok), timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "delivered"

        # Verify pendency row
        pend = db.restaurant_tiffin_pendency.find_one({"pendency_id": pendency_id})
        assert pend, "Pendency row not created"
        assert pend["collected"] is False
        assert pend["tiffin_count"] == 1

        # Verify stock decremented
        stock = db.tiffin_stock.find_one({"_id": sid})
        assert stock["quantity"] == 49, f"Stock did not decrement: {stock}"
        mv = db.tiffin_stock_movements.find_one({"source": "takeaway_delivered", "reason": {"$regex": order_id}})
        assert mv, "consume movement row missing"
        assert mv["delta"] == -1
        assert mv["kind"] == "consume"

        # COLLECT via admin endpoint
        r2 = requests.post(
            f"{BASE_URL}/api/admin/restaurant/takeaway-pendency/collect",
            json={"pendency_id": pendency_id},
            headers=_headers(tok), timeout=10,
        )
        assert r2.status_code == 200, r2.text

        # Verify stock restored
        stock2 = db.tiffin_stock.find_one({"_id": sid})
        assert stock2["quantity"] == 50, f"Stock did not restore: {stock2}"
        mv2 = db.tiffin_stock_movements.find_one({"source": "takeaway_collected", "reason": {"$regex": pendency_id}})
        assert mv2, "return movement row missing"
        assert mv2["delta"] == 1
        assert mv2["kind"] == "return"

        # Pendency now collected
        pend2 = db.restaurant_tiffin_pendency.find_one({"pendency_id": pendency_id})
        assert pend2["collected"] is True

        # Cleanup
        db.restaurant_orders.delete_one({"order_id": order_id})
        db.restaurant_tiffin_pendency.delete_one({"pendency_id": pendency_id})
        db.users.delete_one({"user_id": rider_uid})
        db.user_sessions.delete_many({"user_id": rider_uid})
