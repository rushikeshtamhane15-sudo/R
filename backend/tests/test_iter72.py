"""Iter-72 — kiosk Bluetooth toggle + phone-required delivery + payment_method."""
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

load_dotenv("/app/backend/.env"); load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL"); DB_NAME = os.environ.get("DB_NAME", "test_database")
IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist() -> str:
    return datetime.now(IST).date().isoformat()


async def _mk(db, role="admin"):
    uid = f"u_iter72_{uuid.uuid4().hex[:6]}"; tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": f"iter72 {role}",
        "email": f"iter72_{uuid.uuid4().hex[:4]}@x.com", "role": role,
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _seed_menu(db, date):
    await db.mess_menu.update_one(
        {"date": date},
        {"$set": {"date": date, "lunch": "iter72 Lunch", "dinner": "", "note": "iter72_test"}},
        upsert=True,
    )


@pytest.mark.asyncio
async def test_kiosk_delivery_phone_required():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post("/api/admin/kiosk/order", headers={"Authorization": f"Bearer {tok}"},
                json={"service": "delivery", "qty": 1, "date": date, "meal_type": "lunch", "phone": ""})
            assert r.status_code == 400, r.text
            assert "phone" in r.json()["detail"].lower()
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter72_test"})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        db_cli.close()


@pytest.mark.asyncio
async def test_kiosk_takeaway_phone_optional():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post("/api/admin/kiosk/order", headers={"Authorization": f"Bearer {tok}"},
                json={"service": "takeaway", "qty": 1, "date": date, "meal_type": "lunch", "payment_method": "upi"})
            assert r.status_code == 200, r.text
            assert r.json()["order"]["payment_method"] == "upi"
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter72_test"})
        await db.mess_menu_orders.delete_many({"placed_by_admin_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        db_cli.close()


@pytest.mark.asyncio
async def test_kiosk_invalid_payment_method():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post("/api/admin/kiosk/order", headers={"Authorization": f"Bearer {tok}"},
                json={"service": "takeaway", "qty": 1, "date": date, "meal_type": "lunch", "payment_method": "bitcoin"})
            assert r.status_code == 400
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter72_test"})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        db_cli.close()


@pytest.mark.asyncio
async def test_kiosk_bt_config_crud_and_subscriber_forbidden():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    a_tok, a_uid = await _mk(db, "admin"); s_tok, s_uid = await _mk(db, "subscriber")
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.get("/api/admin/kiosk/bt-config", headers={"Authorization": f"Bearer {a_tok}"})
            assert r.status_code == 200
            assert r.json()["enabled"] is False  # default
            r2 = await c.put("/api/admin/kiosk/bt-config", headers={"Authorization": f"Bearer {a_tok}"}, json={"enabled": True})
            assert r2.status_code == 200
            assert r2.json()["enabled"] is True
            r3 = await c.get("/api/admin/kiosk/bt-config", headers={"Authorization": f"Bearer {a_tok}"})
            assert r3.json()["enabled"] is True
            # Subscriber cannot PUT (admin-only); GET also blocked (admin/staff only)
            assert (await c.put("/api/admin/kiosk/bt-config", headers={"Authorization": f"Bearer {s_tok}"}, json={"enabled": False})).status_code == 403
            assert (await c.get("/api/admin/kiosk/bt-config", headers={"Authorization": f"Bearer {s_tok}"})).status_code == 403
    finally:
        await db.app_config.delete_one({"key": "kiosk_bt_v1"})
        await db.user_sessions.delete_many({"session_token": {"$in": [a_tok, s_tok]}})
        await db.users.delete_many({"user_id": {"$in": [a_uid, s_uid]}})
        db_cli.close()


@pytest.mark.asyncio
async def test_footer_cms_includes_new_brand_fields():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin")
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.get("/api/content/footer")
            assert r.status_code == 200, r.text
            body = r.json()
            # New iter-72 #1 fields are in the default
            for k in ("brand_name", "tagline", "promise", "corporate_address", "support_phone", "website", "email", "copyright"):
                assert k in body, f"Missing footer field: {k}"
            # Admin can update via /content/{key} PUT
            updated = {**body, "brand_name": "eFoodCare", "promise": "iter72 test promise"}
            r2 = await c.post("/api/admin/content/footer", headers={"Authorization": f"Bearer {tok}"}, json={"data": updated})
            assert r2.status_code == 200, r2.text
            r3 = await c.get("/api/content/footer")
            assert r3.json()["brand_name"] == "eFoodCare"
            assert r3.json()["promise"] == "iter72 test promise"
    finally:
        # restore defaults so other tests aren't affected
        await db.site_content.delete_one({"key": "footer"})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        db_cli.close()
