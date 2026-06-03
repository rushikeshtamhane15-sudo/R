"""Iter-61 backend tests:

  - #7 user can cancel their own pending_cash order
  - Other users cannot cancel someone else's order
  - Cannot cancel a non-pending order
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


async def _make_user(db, role="subscriber"):
    uid = f"user_{uuid.uuid4().hex[:10]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Cancel Tester",
        "role": role, "qr_token": f"qr_{uuid.uuid4().hex}",
        "wallet_balance": 0.0, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _seed_pending_cash(db, user_id):
    order_id = f"order_{uuid.uuid4().hex[:12]}"
    sub_id = f"sub_{uuid.uuid4().hex[:12]}"
    await db.subscriptions.insert_one({
        "sub_id": sub_id, "user_id": user_id, "plan_id": "premium",
        "plan_name": "Premium", "status": "pending_payment",
        "wallet_balance": 0.0, "pending_amount": 0,
        "meals_used": 0, "meals_total": 60,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.payment_orders.insert_one({
        "order_id": order_id, "user_id": user_id, "sub_id": sub_id,
        "status": "pending_cash", "payment_mode": "cash",
        "amount": 1500.0, "plan_name": "Premium",
        "cash_otp": "1234",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return order_id, sub_id


@pytest.mark.asyncio
async def test_cash_cancel_happy_path():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _make_user(db)
    oid, sid = await _seed_pending_cash(db, uid)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post(
                "/api/payments/cash-cancel",
                json={"order_id": oid},
                cookies={"session_token": tok},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["order_id"] == oid
            # Both the payment order AND the pending subscription stub gone
            assert await db.payment_orders.find_one({"order_id": oid}) is None
            assert await db.subscriptions.find_one({"sub_id": sid}) is None
    finally:
        await db.payment_orders.delete_many({"order_id": oid})
        await db.subscriptions.delete_many({"sub_id": sid})
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_cash_cancel_other_user_forbidden():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    owner_tok, owner_uid = await _make_user(db)
    intruder_tok, intruder_uid = await _make_user(db)
    oid, sid = await _seed_pending_cash(db, owner_uid)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post(
                "/api/payments/cash-cancel",
                json={"order_id": oid},
                cookies={"session_token": intruder_tok},
            )
            assert r.status_code == 403, r.text
            # Order remains
            assert await db.payment_orders.find_one({"order_id": oid}) is not None
    finally:
        await db.payment_orders.delete_many({"order_id": oid})
        await db.subscriptions.delete_many({"sub_id": sid})
        for u, t in [(owner_uid, owner_tok), (intruder_uid, intruder_tok)]:
            await db.users.delete_one({"user_id": u})
            await db.user_sessions.delete_one({"session_token": t})
        c.close()


@pytest.mark.asyncio
async def test_cash_cancel_blocks_non_pending_order():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _make_user(db)
    oid, sid = await _seed_pending_cash(db, uid)
    # Mark as already paid
    await db.payment_orders.update_one({"order_id": oid}, {"$set": {"status": "paid"}})
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post(
                "/api/payments/cash-cancel",
                json={"order_id": oid},
                cookies={"session_token": tok},
            )
            assert r.status_code == 400, r.text
            assert "paid" in r.json()["detail"]
    finally:
        await db.payment_orders.delete_many({"order_id": oid})
        await db.subscriptions.delete_many({"sub_id": sid})
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()


@pytest.mark.asyncio
async def test_cash_cancel_404_missing_order():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _make_user(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.post(
                "/api/payments/cash-cancel",
                json={"order_id": "order_ghost"},
                cookies={"session_token": tok},
            )
            assert r.status_code == 404
    finally:
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        c.close()
