"""Iter-63 backend tests — Weekly poster generator (#1) + mess-menu include_next."""
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
    uid = f"user_admin_iter63_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Iter63 Admin",
        "email": f"iter63_{uuid.uuid4().hex[:6]}@efoodcare.com", "role": "admin",
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
async def test_poster_returns_png_for_admin():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _admin_session(db)
    # Seed 3 days so the poster has at least some content
    base = datetime(2026, 4, 1).date()
    for i in range(3):
        d = (base + timedelta(days=i)).isoformat()
        await db.mess_menu.update_one(
            {"date": d},
            {"$set": {"date": d, "lunch": f"Lunch{i}", "dinner": f"Dinner{i}", "note": ""}},
            upsert=True,
        )
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=60) as cli:
            r = await cli.get(
                f"/api/admin/mess-menu/poster?start={base.isoformat()}&format=a4&fmt=png",
                cookies={"session_token": tok},
            )
            assert r.status_code == 200, r.text
            assert r.headers["content-type"] == "image/png"
            # PNG magic bytes
            assert r.content.startswith(b"\x89PNG\r\n\x1a\n"), "response is not a valid PNG"
            assert len(r.content) > 5000, "poster looks too small to be valid"
            # JPG variant
            r2 = await cli.get(
                f"/api/admin/mess-menu/poster?start={base.isoformat()}&format=square&fmt=jpg",
                cookies={"session_token": tok},
            )
            assert r2.status_code == 200
            assert r2.headers["content-type"] == "image/jpeg"
            assert r2.content[:3] == b"\xff\xd8\xff", "response is not a valid JPEG"
    finally:
        await db.mess_menu.delete_many({"date": {"$gte": base.isoformat(), "$lt": (base + timedelta(days=10)).isoformat()}})
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_poster_subscriber_forbidden():
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
            r = await cli.get(
                "/api/admin/mess-menu/poster?start=2026-04-01&format=a4&fmt=png",
                cookies={"session_token": tok},
            )
            assert r.status_code == 403
    finally:
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_poster_rejects_bad_date():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _admin_session(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.get(
                "/api/admin/mess-menu/poster?start=not-a-date&format=a4&fmt=png",
                cookies={"session_token": tok},
            )
            assert r.status_code == 400
    finally:
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_mess_menu_include_next_returns_tomorrow_anytime():
    """iter-63 #7: with ?include_next=1 the public endpoint should always
    return tomorrow's record (when one exists) regardless of the IST hour."""
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    # Seed tomorrow record
    _IST_offset = timedelta(hours=5, minutes=30)
    now = datetime.now(timezone.utc) + _IST_offset
    tomorrow_iso = (now.date() + timedelta(days=1)).isoformat()
    await db.mess_menu.update_one(
        {"date": tomorrow_iso},
        {"$set": {"date": tomorrow_iso, "lunch": "Iter63-L", "dinner": "Iter63-D", "note": ""}},
        upsert=True,
    )
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.get("/api/mess-menu/today?include_next=1")
            assert r.status_code == 200
            body = r.json()
            assert body["next"] is not None
            assert body["next"]["lunch"] == "Iter63-L"
            assert body["tomorrow"] == tomorrow_iso
    finally:
        await db.mess_menu.delete_one({"date": tomorrow_iso})
        c.close()
