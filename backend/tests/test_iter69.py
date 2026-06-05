"""Iter-69 — Admin wall-kiosk walk-in order endpoint."""
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


async def _mk_user(db, role="admin"):
    uid = f"user_iter69_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": f"Iter69 {role}",
        "email": f"iter69_{uuid.uuid4().hex[:4]}@efoodcare.com", "role": role,
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
        {"$set": {"date": date, "lunch": "Iter69 Lunch Dal", "dinner": "", "note": "iter69_test"}},
        upsert=True,
    )


@pytest.mark.asyncio
async def test_admin_kiosk_order_happy_path():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_user(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post(
                "/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "delivery", "qty": 2, "date": date, "meal_type": "lunch", "phone": "9999000111"},
            )
            assert r.status_code == 200, r.text
            order = r.json()["order"]
            assert order["status"] == "pending_collection"
            assert order["kind"] == "walk_in_kiosk"
            assert order["placed_by_admin_id"] == uid
            assert order["total"] == order["unit_price"] * 2
            assert order["order_id"].startswith("kio_")
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter69_test"})
        await db.mess_menu_orders.delete_many({"placed_by_admin_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        client.close()


@pytest.mark.asyncio
async def test_admin_kiosk_order_subscriber_forbidden():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_user(db, "subscriber"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post(
                "/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "takeaway", "qty": 1, "date": date, "meal_type": "lunch"},
            )
            assert r.status_code == 403, r.text
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter69_test"})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        client.close()


@pytest.mark.asyncio
async def test_admin_kiosk_order_missing_menu_400():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_user(db, "admin")
    far_future = (datetime.now(IST).date() + timedelta(days=90)).isoformat()
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post(
                "/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "dining", "qty": 1, "date": far_future, "meal_type": "lunch"},
            )
            assert r.status_code == 400, r.text
    finally:
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        client.close()


@pytest.mark.asyncio
async def test_admin_kiosk_order_invalid_service_400():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_user(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post(
                "/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "drive_thru", "qty": 1, "date": date, "meal_type": "lunch"},
            )
            assert r.status_code == 400, r.text
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter69_test"})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        client.close()
