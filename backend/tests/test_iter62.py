"""Iter-62 backend tests — Mess menu calendar (#8)."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "test_database")


async def _admin_session(db):
    uid = f"user_admin_iter62_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Iter62 Admin",
        "email": f"iter62_{uuid.uuid4().hex[:6]}@efoodcare.com", "role": "admin",
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


@pytest.mark.asyncio
async def test_mess_menu_admin_upsert_and_month_feed():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _admin_session(db)
    # Clean any stale fixture
    await db.mess_menu.delete_many({"date": {"$regex": "^2026-02-"}})
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post(
                "/api/admin/mess-menu/upsert",
                json={"date": "2026-02-15", "lunch": "Dal · Aloo · Phulka · Rice", "dinner": "Paneer · Jeera rice · Roti", "note": "Festival"},
                cookies={"session_token": tok},
            )
            assert r.status_code == 200
            body = r.json()
            assert body["lunch"].startswith("Dal")
            # Month feed picks it up
            m = await cli.get("/api/admin/mess-menu?month=2026-02", cookies={"session_token": tok})
            assert m.status_code == 200
            items = m.json()["items"]
            assert any(it["date"] == "2026-02-15" for it in items)
    finally:
        await db.mess_menu.delete_many({"date": {"$regex": "^2026-02-"}})
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_mess_menu_bulk_upsert():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _admin_session(db)
    await db.mess_menu.delete_many({"date": {"$regex": "^2026-03-"}})
    try:
        items = [{"date": f"2026-03-{d:02d}", "lunch": f"L{d}", "dinner": f"D{d}", "note": ""} for d in range(1, 8)]
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post(
                "/api/admin/mess-menu/bulk",
                json={"items": items},
                cookies={"session_token": tok},
            )
            assert r.status_code == 200
            assert r.json()["upserted"] == 7
            m = await cli.get("/api/admin/mess-menu?month=2026-03", cookies={"session_token": tok})
            assert len(m.json()["items"]) >= 7
    finally:
        await db.mess_menu.delete_many({"date": {"$regex": "^2026-03-"}})
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_mess_menu_subscriber_forbidden_admin_upsert():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    uid = f"user_sub_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({"user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Sub",
                                "role": "subscriber", "qr_token": f"qr_{uuid.uuid4().hex}",
                                "wallet_balance": 0.0, "created_at": datetime.now(timezone.utc).isoformat()})
    await db.user_sessions.insert_one({"session_token": tok, "user_id": uid,
                                        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
                                        "created_at": datetime.now(timezone.utc).isoformat()})
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post("/api/admin/mess-menu/upsert", json={"date": "2026-02-20", "lunch": "x"},
                                cookies={"session_token": tok})
            assert r.status_code == 403
    finally:
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_mess_menu_today_public_shape():
    """Public endpoint requires no auth and always returns the {current,next,early_bird} shape."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/mess-menu/today")
        assert r.status_code == 200
        body = r.json()
        assert "today" in body and "early_bird" in body
        # current may be None when nothing is saved — that's OK
        assert "current" in body
