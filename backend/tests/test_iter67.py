"""Iter-67 tests — meal override on /push/send-now + /push/preview."""
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


async def _mk_admin(db):
    uid = f"user_admin_iter67_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Iter67 Admin",
        "email": f"iter67admin_{uuid.uuid4().hex[:4]}@efoodcare.com", "role": "admin",
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _seed_menu(db, date: str):
    await db.mess_menu.update_one(
        {"date": date},
        {"$set": {"date": date, "lunch": "Iter67 Lunch Paneer", "dinner": "Iter67 Dinner Roti", "note": "iter67_test"}},
        upsert=True,
    )


async def _cleanup(db, tok, uid, date):
    await db.mess_menu.delete_one({"date": date, "note": "iter67_test"})
    await db.mess_menu_broadcasts.delete_one({"date": date})
    await db.user_sessions.delete_one({"session_token": tok})
    await db.users.delete_one({"user_id": uid})


@pytest.mark.asyncio
async def test_send_now_lunch_override():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_admin(db); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post("/api/admin/mess-menu/push/send-now?meal=lunch", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["broadcast"]["meal"] == "lunch"
            assert "Iter67 Lunch Paneer" in data["broadcast"]["menu_text"]
    finally:
        await _cleanup(db, tok, uid, date); client.close()


@pytest.mark.asyncio
async def test_send_now_dinner_override():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_admin(db); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post("/api/admin/mess-menu/push/send-now?meal=dinner", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200, r.text
            assert r.json()["broadcast"]["meal"] == "dinner"
            assert "Iter67 Dinner Roti" in r.json()["broadcast"]["menu_text"]
    finally:
        await _cleanup(db, tok, uid, date); client.close()


@pytest.mark.asyncio
async def test_send_now_invalid_meal_400():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_admin(db); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post("/api/admin/mess-menu/push/send-now?meal=brunch", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 400, r.text
    finally:
        await _cleanup(db, tok, uid, date); client.close()


@pytest.mark.asyncio
async def test_preview_dinner_override():
    client = AsyncIOMotorClient(MONGO_URL); db = client[DB_NAME]
    tok, uid = await _mk_admin(db); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post("/api/admin/mess-menu/push/preview?meal=dinner", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200, r.text
            assert r.json()["preview"]["meal"] == "dinner"
            assert r.json()["preview"]["menu_text"].startswith("Iter67 Dinner")
    finally:
        await _cleanup(db, tok, uid, date); client.close()
