"""Iter-70 — Kiosk receipt QR + single-use counter check-in."""
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
    uid = f"user_iter70_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": f"Iter70 {role}",
        "email": f"iter70_{uuid.uuid4().hex[:4]}@efoodcare.com", "role": role,
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
        {"$set": {"date": date, "lunch": "Iter70 Lunch", "dinner": "", "note": "iter70_test"}},
        upsert=True,
    )


async def _place_kiosk_order(client, headers, date):
    return await client.post(
        "/api/admin/kiosk/order",
        headers=headers,
        json={"service": "delivery", "qty": 1, "date": date, "meal_type": "lunch"},
    )


@pytest.mark.asyncio
async def test_kiosk_order_returns_qr_and_token():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk_user(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await _place_kiosk_order(c, {"Authorization": f"Bearer {tok}"}, date)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["qr_text"].startswith("kio:")
            assert data["qr_data_url"].startswith("data:image/png;base64,")
            # kiosk_token persisted on the order row
            row = await db.mess_menu_orders.find_one({"order_id": data["order"]["order_id"]}, {"_id": 0})
            assert row["kiosk_token"]
            assert row["kiosk_consumed_at"] is None
            assert data["qr_text"] == f"kio:{row['kiosk_token']}"
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter70_test"})
        await db.mess_menu_orders.delete_many({"placed_by_admin_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        db_cli.close()


@pytest.mark.asyncio
async def test_scan_kiosk_token_marks_served():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk_user(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            place = await _place_kiosk_order(c, {"Authorization": f"Bearer {tok}"}, date)
            qr_text = place.json()["qr_text"]
            r = await c.post(
                "/api/attendance/scan",
                headers={"Authorization": f"Bearer {tok}"},
                json={"qr_token": qr_text, "meal_type": "lunch"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["kiosk"] is True
            assert body["record"]["order_id"].startswith("kio_")
            # status flipped + consumed_at populated
            row = await db.mess_menu_orders.find_one({"order_id": body["record"]["order_id"]}, {"_id": 0})
            assert row["status"] == "served"
            assert row["kiosk_consumed_at"]
            assert row["kiosk_consumed_by"] == uid
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter70_test"})
        await db.mess_menu_orders.delete_many({"placed_by_admin_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        db_cli.close()


@pytest.mark.asyncio
async def test_kiosk_token_is_single_use():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk_user(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            place = await _place_kiosk_order(c, {"Authorization": f"Bearer {tok}"}, date)
            qr_text = place.json()["qr_text"]
            ok = await c.post("/api/attendance/scan", headers={"Authorization": f"Bearer {tok}"}, json={"qr_token": qr_text, "meal_type": "lunch"})
            assert ok.status_code == 200
            dup = await c.post("/api/attendance/scan", headers={"Authorization": f"Bearer {tok}"}, json={"qr_token": qr_text, "meal_type": "lunch"})
            assert dup.status_code == 400
            assert "already" in dup.json()["detail"].lower()
    finally:
        await db.mess_menu.delete_one({"date": date, "note": "iter70_test"})
        await db.mess_menu_orders.delete_many({"placed_by_admin_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        db_cli.close()


@pytest.mark.asyncio
async def test_invalid_kiosk_token_404():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk_user(db, "admin")
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post(
                "/api/attendance/scan",
                headers={"Authorization": f"Bearer {tok}"},
                json={"qr_token": "kio:does_not_exist_zzz", "meal_type": "lunch"},
            )
            assert r.status_code == 404
    finally:
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
        db_cli.close()


@pytest.mark.asyncio
async def test_subscriber_qr_still_works_after_kiosk_changes():
    """Iter-70 must not break the existing subscriber flow."""
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    a_tok, a_uid = await _mk_user(db, "admin")
    s_tok, s_uid = await _mk_user(db, "subscriber")
    sub = await db.users.find_one({"user_id": s_uid}, {"_id": 0, "qr_token": 1})
    qr = sub["qr_token"]
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post(
                "/api/attendance/scan",
                headers={"Authorization": f"Bearer {a_tok}"},
                json={"qr_token": qr, "meal_type": "lunch"},
            )
            # 200 (no sub) is fine — what matters is the kiosk path didn't
            # short-circuit it. We accept 200 or 400 (already-checked-in).
            assert r.status_code in (200, 400)
            if r.status_code == 200:
                assert r.json().get("kiosk") is not True
    finally:
        await db.attendance.delete_many({"subscriber_user_id": s_uid})
        await db.user_sessions.delete_many({"session_token": {"$in": [a_tok, s_tok]}})
        await db.users.delete_many({"user_id": {"$in": [a_uid, s_uid]}})
        db_cli.close()
