"""Iter-68 — Cart-saver push tests.

Covers:
* POST /mess-menu/order-intent logs an intent (upserts on re-open).
* GET /me/cart-saver returns null when intent is fresh, banner when >= threshold,
  null after dismiss, null after expire, null after marked paid.
* POST /me/cart-saver/dismiss requires owner; 404 for unknown intent.
* GET/PUT /admin/cart-saver/config — admin only, persists; subscriber 403.
* /mess-menu/order/verify clears the intent (status=paid).
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "test_database")
IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist() -> str:
    return datetime.now(IST).date().isoformat()


async def _mk_user(db, role: str = "subscriber"):
    uid = f"user_iter68_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": f"Iter68 {role}",
        "email": f"iter68_{uuid.uuid4().hex[:4]}@efoodcare.com", "role": role,
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _cleanup(db, toks, uids):
    if toks:
        await db.user_sessions.delete_many({"session_token": {"$in": toks}})
    if uids:
        await db.users.delete_many({"user_id": {"$in": uids}})
        await db.mess_menu_order_intents.delete_many({"user_id": {"$in": uids}})
        await db.mess_menu_orders.delete_many({"user_id": {"$in": uids}})


def _payload(date=None, meal="lunch"):
    return {
        "service": "delivery",
        "qty": 2,
        "meal_type": meal,
        "date": date or _today_ist(),
        "menu_text": "Iter68 Paneer Lunch",
        "total": 280,
    }


@pytest.mark.asyncio
async def test_intent_then_no_banner_before_threshold():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_user(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            h = {"Authorization": f"Bearer {tok}"}
            r = await c.post("/api/mess-menu/order-intent", headers=h, json=_payload())
            assert r.status_code == 200, r.text
            # Banner not visible yet (intent is fresh, threshold default 5 min)
            r2 = await c.get("/api/me/cart-saver", headers=h)
            assert r2.status_code == 200
            assert r2.json()["banner"] is None
    finally:
        await _cleanup(db, [tok], [uid]); client.close()


@pytest.mark.asyncio
async def test_banner_appears_after_threshold():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_user(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            h = {"Authorization": f"Bearer {tok}"}
            await c.post("/api/mess-menu/order-intent", headers=h, json=_payload())
            # Fast-forward by backdating the intent updated_at by 10 minutes
            past = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
            await db.mess_menu_order_intents.update_one(
                {"user_id": uid}, {"$set": {"updated_at": past}},
            )
            r = await c.get("/api/me/cart-saver", headers=h)
            assert r.status_code == 200
            banner = r.json()["banner"]
            assert banner is not None
            assert banner["meal_type"] == "lunch"
            assert banner["service"] == "delivery"
            assert banner["qty"] == 2
            assert "Iter68 Paneer Lunch" in banner["body"]
    finally:
        await _cleanup(db, [tok], [uid]); client.close()


@pytest.mark.asyncio
async def test_dismiss_hides_banner_and_404_unknown():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_user(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            h = {"Authorization": f"Bearer {tok}"}
            await c.post("/api/mess-menu/order-intent", headers=h, json=_payload())
            past = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
            await db.mess_menu_order_intents.update_one(
                {"user_id": uid}, {"$set": {"updated_at": past}},
            )
            r = await c.get("/api/me/cart-saver", headers=h)
            iid = r.json()["banner"]["intent_id"]
            d = await c.post("/api/me/cart-saver/dismiss", headers=h, json={"intent_id": iid})
            assert d.status_code == 200
            # Banner now hidden
            r2 = await c.get("/api/me/cart-saver", headers=h)
            assert r2.json()["banner"] is None
            # Unknown id → 404
            d2 = await c.post("/api/me/cart-saver/dismiss", headers=h, json={"intent_id": "int_does_not_exist"})
            assert d2.status_code == 404
    finally:
        await _cleanup(db, [tok], [uid]); client.close()


@pytest.mark.asyncio
async def test_expired_intent_returns_null():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_user(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            h = {"Authorization": f"Bearer {tok}"}
            await c.post("/api/mess-menu/order-intent", headers=h, json=_payload())
            very_old = (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
            await db.mess_menu_order_intents.update_one(
                {"user_id": uid}, {"$set": {"updated_at": very_old}},
            )
            r = await c.get("/api/me/cart-saver", headers=h)
            assert r.json()["banner"] is None
            # Status should have been flipped to expired
            row = await db.mess_menu_order_intents.find_one({"user_id": uid}, {"_id": 0})
            assert row["status"] == "expired"
    finally:
        await _cleanup(db, [tok], [uid]); client.close()


@pytest.mark.asyncio
async def test_admin_config_get_put_and_subscriber_forbidden():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    a_tok, a_uid = await _mk_user(db, role="admin")
    s_tok, s_uid = await _mk_user(db, role="subscriber")
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            ha = {"Authorization": f"Bearer {a_tok}"}
            hs = {"Authorization": f"Bearer {s_tok}"}
            r = await c.get("/api/admin/cart-saver/config", headers=ha)
            assert r.status_code == 200
            cfg = r.json()
            cfg["threshold_minutes"] = 7
            cfg["title_template"] = "Test iter68 title {meal}"
            put = await c.put("/api/admin/cart-saver/config", headers=ha, json=cfg)
            assert put.status_code == 200
            assert put.json()["threshold_minutes"] == 7
            # Subscriber blocked
            assert (await c.get("/api/admin/cart-saver/config", headers=hs)).status_code == 403
            assert (await c.put("/api/admin/cart-saver/config", headers=hs, json=cfg)).status_code == 403
    finally:
        # restore defaults
        await db.app_config.delete_one({"key": "cart_saver_v1"})
        await _cleanup(db, [a_tok, s_tok], [a_uid, s_uid]); client.close()


@pytest.mark.asyncio
async def test_mess_order_verify_clears_intent():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_user(db)
    date = _today_ist()
    try:
        # Seed a menu so the order endpoint accepts it
        await db.mess_menu.update_one(
            {"date": date},
            {"$set": {"date": date, "lunch": "Iter68 Lunch", "dinner": "Iter68 Dinner", "note": "iter68_test"}},
            upsert=True,
        )
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            h = {"Authorization": f"Bearer {tok}"}
            await c.post("/api/mess-menu/order-intent", headers=h, json=_payload(date=date))
            # Place + verify the order (mock since Razorpay LIVE keys fail)
            r = await c.post("/api/mess-menu/order", headers=h, json={
                "service": "delivery", "qty": 2, "date": date, "meal_type": "lunch", "note": "",
            })
            assert r.status_code == 200, r.text
            order_id = r.json()["order"]["order_id"]
            assert r.json()["checkout"]["mock"] is True
            v = await c.post("/api/mess-menu/order/verify", headers=h, json={
                "order_id": order_id, "razorpay_payment_id": "pay_mock", "razorpay_signature": "sig",
            })
            assert v.status_code == 200, v.text
            # Intent should now be marked paid → banner null even when backdated
            past = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
            await db.mess_menu_order_intents.update_one(
                {"user_id": uid}, {"$set": {"updated_at": past}},
            )
            row = await db.mess_menu_order_intents.find_one({"user_id": uid}, {"_id": 0})
            assert row["status"] == "paid"
            cs = await c.get("/api/me/cart-saver", headers=h)
            assert cs.json()["banner"] is None
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter68_test"})
        await _cleanup(db, [tok], [uid]); client.close()
