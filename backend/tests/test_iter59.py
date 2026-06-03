"""Iter-59 backend tests:

  - #4 bulk-delete users
  - #8 control-tower endpoint shape
  - #9 kitchen close-out submit + reconciliation + fraud_alert
"""
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


async def _admin_session(db) -> tuple[str, str]:
    uid = f"user_admin_iter59_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Iter59 Admin",
        "email": f"iter59_{uuid.uuid4().hex[:6]}@efoodcare.com", "role": "admin",
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


# ---------------------------------------------------------------------------
# #4 bulk-delete
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bulk_delete_users_happy_path():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    admin_tok, admin_uid = await _admin_session(db)
    # Seed 3 disposable subscribers
    uids = []
    for _ in range(3):
        u = f"user_{uuid.uuid4().hex[:10]}"
        uids.append(u)
        await db.users.insert_one({
            "user_id": u, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Bulk Target",
            "role": "subscriber", "qr_token": f"qr_{uuid.uuid4().hex}",
            "wallet_balance": 0.0, "created_at": datetime.now(timezone.utc).isoformat(),
        })
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.post(
                "/api/admin/users/bulk-delete",
                json={"user_ids": uids},
                cookies={"session_token": admin_tok},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["deleted_count"] == 3
            assert sorted(body["deleted"]) == sorted(uids)
            # All gone from db
            remaining = await db.users.count_documents({"user_id": {"$in": uids}})
            assert remaining == 0
    finally:
        await db.users.delete_many({"user_id": {"$in": uids + [admin_uid]}})
        await db.user_sessions.delete_one({"session_token": admin_tok})
        c.close()


@pytest.mark.asyncio
async def test_bulk_delete_skips_admins_and_self():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, me = await _admin_session(db)
    other_admin = f"user_{uuid.uuid4().hex[:10]}"
    target = f"user_{uuid.uuid4().hex[:10]}"
    await db.users.insert_one({"user_id": other_admin, "phone": f"7{uuid.uuid4().hex[:9]}",
                                "name": "Other Admin", "role": "admin",
                                "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
                                "created_at": datetime.now(timezone.utc).isoformat()})
    await db.users.insert_one({"user_id": target, "phone": f"7{uuid.uuid4().hex[:9]}",
                                "name": "OK Target", "role": "subscriber",
                                "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
                                "created_at": datetime.now(timezone.utc).isoformat()})
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.post(
                "/api/admin/users/bulk-delete",
                json={"user_ids": [me, other_admin, target, "ghost"]},
                cookies={"session_token": tok},
            )
            assert r.status_code == 200
            b = r.json()
            assert b["deleted_count"] == 1
            assert b["deleted"] == [target]
            reasons = {s["user_id"]: s["reason"] for s in b["skipped"]}
            assert reasons.get(me) == "self"
            assert reasons.get(other_admin) == "is admin"
            assert reasons.get("ghost") == "not found"
    finally:
        await db.users.delete_many({"user_id": {"$in": [me, other_admin, target]}})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


# ---------------------------------------------------------------------------
# #8 control-tower
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_control_tower_shape_admin_only():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, me = await _admin_session(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.get("/api/admin/control-tower", cookies={"session_token": tok})
            assert r.status_code == 200
            b = r.json()
            for k in ("today", "live", "notifications", "as_of"):
                assert k in b
            for k in ("tiffins_shipped", "scans", "cash", "online"):
                assert k in b["today"]
            for k in ("tiffin_deliveries_active", "tiffin_riders_online",
                       "restaurant_orders_active", "restaurant_riders_online",
                       "staff_online", "admins_online", "counter_staff_online"):
                assert k in b["live"]
            for k in ("pending_bank_amt", "pending_bank_count", "kitchen_alerts"):
                assert k in b["notifications"]
    finally:
        await db.users.delete_one({"user_id": me})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_control_tower_subscriber_forbidden():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    uid = f"user_sub_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({"user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}",
                                "name": "Sub", "role": "subscriber",
                                "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
                                "created_at": datetime.now(timezone.utc).isoformat()})
    await db.user_sessions.insert_one({"session_token": tok, "user_id": uid,
                                        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
                                        "created_at": datetime.now(timezone.utc).isoformat()})
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.get("/api/admin/control-tower", cookies={"session_token": tok})
            assert r.status_code == 403
    finally:
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


# ---------------------------------------------------------------------------
# #9 kitchen close-out + fraud alert
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_kitchen_closeout_submit_clean_no_alert():
    """Dispatched = 0, scans = 0 → clean reconciliation, no alert."""
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, me = await _admin_session(db)
    date = "2026-02-09"
    # Wipe any prior closeout + alert for this date
    await db.kitchen_closeouts.delete_one({"date": date})
    await db.admin_notifications.delete_many({"kind": "kitchen_fraud_alert", "date": date})
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post(
                "/api/kitchen/close-out",
                json={"date": date, "tiffins_dispatched": 0, "plates_served": 0, "notes": ""},
                cookies={"session_token": tok},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["alert_raised"] is False
            assert body["suspicious"] is False
            assert body["scans"] == 0
    finally:
        await db.kitchen_closeouts.delete_one({"date": date})
        await db.users.delete_one({"user_id": me})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_kitchen_closeout_raises_fraud_alert_on_gap():
    """Dispatched 100, scans 80 → 20-unit gap (20%) → alert raised."""
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, me = await _admin_session(db)
    date = "2026-02-08"
    await db.kitchen_closeouts.delete_one({"date": date})
    await db.admin_notifications.delete_many({"kind": "kitchen_fraud_alert", "date": date})
    await db.scans.delete_many({"_test_iter59": True})
    # Seed 80 scans for the date
    start = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    for i in range(80):
        await db.scans.insert_one({
            "_test_iter59": True,
            "scan_id": f"scan_iter59_{uuid.uuid4().hex[:8]}",
            "created_at": (start + timedelta(hours=10, minutes=i)).isoformat(),
        })
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post(
                "/api/kitchen/close-out",
                json={"date": date, "tiffins_dispatched": 100, "plates_served": 0},
                cookies={"session_token": tok},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["scans"] == 80
            assert body["delta"] == 20
            assert body["suspicious"] is True
            assert body["alert_raised"] is True
            # Notification should exist + unread
            doc = await db.admin_notifications.find_one(
                {"kind": "kitchen_fraud_alert", "date": date}, {"_id": 0},
            )
            assert doc is not None
            assert doc["read"] is False
            assert "₹" not in doc["message"]  # not a currency message
            assert "100" in doc["message"]
    finally:
        await db.scans.delete_many({"_test_iter59": True})
        await db.kitchen_closeouts.delete_one({"date": date})
        await db.admin_notifications.delete_many({"kind": "kitchen_fraud_alert", "date": date})
        await db.users.delete_one({"user_id": me})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_kitchen_closeout_subscriber_forbidden():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    uid = f"user_sub_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({"user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}",
                                "name": "Sub", "role": "subscriber",
                                "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
                                "created_at": datetime.now(timezone.utc).isoformat()})
    await db.user_sessions.insert_one({"session_token": tok, "user_id": uid,
                                        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
                                        "created_at": datetime.now(timezone.utc).isoformat()})
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post(
                "/api/kitchen/close-out",
                json={"date": "2026-02-10", "tiffins_dispatched": 5},
                cookies={"session_token": tok},
            )
            assert r.status_code == 403
    finally:
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()
