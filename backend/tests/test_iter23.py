"""iter23 — Tests for FEATURE 2 (location persistence on order + profile)
   and FEATURE 5 (combined admin live map endpoint)."""
import os
import time
import uuid
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as fh:
            for ln in fh:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = ln.strip().split("=", 1)[1].strip('"').strip("'").rstrip("/")
    except Exception:
        pass
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

# read backend .env to get correct DB_NAME (safer)
try:
    with open("/app/backend/.env") as fh:
        for ln in fh:
            if ln.startswith("DB_NAME="):
                DB_NAME = ln.strip().split("=", 1)[1].strip('"').strip("'")
            if ln.startswith("MONGO_URL="):
                MONGO_URL = ln.strip().split("=", 1)[1].strip('"').strip("'")
except Exception:
    pass


def _seed_user(role="subscriber", phone=None, wallet_balance=0):
    """Direct mongo seed -> return (user_id, token, phone)."""
    from datetime import datetime, timezone, timedelta
    user_id = f"u_TEST_{uuid.uuid4().hex[:10]}"
    token = f"sess_TEST_{uuid.uuid4().hex[:14]}"
    phone = phone or f"9{uuid.uuid4().int % 10**9:09d}"
    now = datetime.now(timezone.utc)

    async def _do():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.users.replace_one(
            {"user_id": user_id},
            {
                "user_id": user_id, "phone": phone, "role": role,
                "name": f"TEST_{role}_{user_id[-4:]}", "wallet_balance": wallet_balance,
                "qr_token": f"qr_TEST_{uuid.uuid4().hex[:8]}",
                "created_at": now.isoformat(),
            },
            upsert=True,
        )
        await db.user_sessions.insert_one({
            "session_token": token, "user_id": user_id,
            "created_at": now.isoformat(), "expires_at": (now + timedelta(days=1)).isoformat(),
        })
        client.close()

    asyncio.run(_do())
    return user_id, token, phone


def _cleanup():
    async def _do():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        users = await db.users.find({"name": {"$regex": "^TEST_"}}, {"user_id": 1}).to_list(500)
        uids = [u["user_id"] for u in users]
        if uids:
            await db.users.delete_many({"user_id": {"$in": uids}})
            await db.user_sessions.delete_many({"user_id": {"$in": uids}})
            await db.restaurant_orders.delete_many({"user_id": {"$in": uids}})
        await db.user_sessions.delete_many({"session_token": {"$regex": "^sess_TEST_"}})
        client.close()
    asyncio.run(_do())


@pytest.fixture(scope="module", autouse=True)
def _cleanup_around():
    _cleanup()
    yield
    _cleanup()


def _hdrs(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- FEATURE 2: location persisted on order + profile ----------
class TestLocationPersisted:
    def test_post_order_saves_lat_lng_to_order_and_profile(self):
        uid, tok, phone = _seed_user("subscriber")
        # confirm /api/auth/me has no lat/lng yet
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdrs(tok))
        assert me.status_code == 200, me.text
        body = me.json()
        # API may return user nested or flat — handle both
        u = body.get("user", body)
        assert u.get("lat") in (None, 0, "")
        assert u.get("lng") in (None, 0, "")

        # Place an order with customer_lat/lng
        payload = {
            "items": [{"id": "starter_paneer_tikka", "qty": 1}],
            "name": "TEST Pin Tester",
            "phone": phone,
            "address": "TEST 123 Pin Lane",
            "customer_lat": 18.5910,
            "customer_lng": 73.7380,
        }
        r = requests.post(f"{BASE_URL}/api/restaurant/order", json=payload, headers=_hdrs(tok))
        assert r.status_code == 200, r.text
        order_id = r.json()["order_id"]

        # /api/auth/me now has lat/lng saved
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdrs(tok))
        u2 = me2.json().get("user", me2.json())
        assert abs(float(u2.get("lat") or 0) - 18.5910) < 1e-3, f"lat not saved: {u2}"
        assert abs(float(u2.get("lng") or 0) - 73.7380) < 1e-3, f"lng not saved: {u2}"

        # Order doc has customer_lat/lng (admin endpoint exposes if status allows)
        # Verify via direct mongo
        async def _check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            doc = await db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
            client.close()
            return doc
        doc = asyncio.run(_check())
        assert doc is not None
        assert abs(float(doc.get("customer_lat") or 0) - 18.5910) < 1e-3
        assert abs(float(doc.get("customer_lng") or 0) - 73.7380) < 1e-3

    def test_post_order_without_lat_falls_back_to_profile(self):
        # Seed user with existing profile lat/lng then post order WITHOUT customer_lat
        uid, tok, phone = _seed_user("subscriber")

        # Pre-populate profile lat/lng directly
        async def _set_profile():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.users.update_one({"user_id": uid}, {"$set": {"lat": 19.07, "lng": 72.87}})
            client.close()
        asyncio.run(_set_profile())

        payload = {
            "items": [{"id": "tiffin_full", "qty": 1}],
            "name": "TEST Profile Pin",
            "phone": phone,
            "address": "TEST profile addr",
        }
        r = requests.post(f"{BASE_URL}/api/restaurant/order", json=payload, headers=_hdrs(tok))
        assert r.status_code == 200, r.text
        order_id = r.json()["order_id"]

        async def _check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            doc = await db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
            client.close()
            return doc
        doc = asyncio.run(_check())
        assert abs(float(doc.get("customer_lat") or 0) - 19.07) < 1e-3
        assert abs(float(doc.get("customer_lng") or 0) - 72.87) < 1e-3


# ---------- FEATURE 5: admin combined live map ----------
class TestAdminLiveRestaurant:
    def test_endpoint_returns_orders_and_riders_arrays(self):
        # Seed admin
        admin_uid, admin_tok, _ = _seed_user("admin")

        # Seed rider with location
        from datetime import datetime, timezone
        rider_uid, _, rider_phone = _seed_user("rider")
        async def _set_rider():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.users.update_one({"user_id": rider_uid}, {"$set": {
                "rider_lat": 18.55, "rider_lng": 73.85,
                "rider_location_at": datetime.now(timezone.utc).isoformat(),
            }})
            client.close()
        asyncio.run(_set_rider())

        # Seed a customer + restaurant order out_for_delivery
        cust_uid, cust_tok, cust_phone = _seed_user("subscriber")
        async def _seed_order():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            oid = f"rorder_TEST_{uuid.uuid4().hex[:10]}"
            await db.restaurant_orders.insert_one({
                "order_id": oid, "user_id": cust_uid,
                "name": "TEST live cust", "phone": cust_phone,
                "address": "TEST", "status": "out_for_delivery",
                "customer_lat": 18.50, "customer_lng": 73.90,
                "rider_lat": 18.52, "rider_lng": 73.88,
                "total": 290, "items": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            client.close()
            return oid
        oid = asyncio.run(_seed_order())

        # Hit endpoint
        r = requests.get(f"{BASE_URL}/api/admin/live/restaurant", headers=_hdrs(admin_tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "orders" in body and "riders" in body
        assert isinstance(body["orders"], list)
        assert isinstance(body["riders"], list)

        # Our seeded rider should appear
        rider_ids = [r.get("rider_id") for r in body["riders"]]
        assert rider_uid in rider_ids, f"rider not found in response: {body['riders']}"
        rider_row = next(r for r in body["riders"] if r["rider_id"] == rider_uid)
        assert rider_row.get("is_live") is True
        assert abs(rider_row["lat"] - 18.55) < 1e-3
        assert abs(rider_row["lng"] - 73.85) < 1e-3

        # Our seeded order should appear
        order_ids = [o.get("order_id") for o in body["orders"]]
        assert oid in order_ids, f"order not found: {body['orders']}"
        order_row = next(o for o in body["orders"] if o["order_id"] == oid)
        assert order_row["status"] == "out_for_delivery"
        assert abs(order_row["customer_lat"] - 18.50) < 1e-3
        assert abs(order_row["customer_lng"] - 73.90) < 1e-3

    def test_endpoint_requires_admin(self):
        _, sub_tok, _ = _seed_user("subscriber")
        r = requests.get(f"{BASE_URL}/api/admin/live/restaurant", headers=_hdrs(sub_tok))
        assert r.status_code == 403, r.text
