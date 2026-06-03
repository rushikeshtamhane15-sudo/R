"""Iter-57 backend tests — in-grace status with pending_amount > 0 + final-warning push.

Uses the live backend's `POST /api/admin/cron/run-tick` endpoint instead of
importing `server` (avoids motor's event-loop-bound client issues across tests).
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


async def _admin_session(db) -> str:
    uid = f"user_admin_iter57_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Iter57 Admin",
        "email": f"iter57_{uuid.uuid4().hex[:6]}@efoodcare.com", "role": "admin",
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _seed_sub(db, *, wallet: float, pending: float, days_remaining: int = 7):
    uid = f"user_{uuid.uuid4().hex[:12]}"
    sid = f"sub_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    yesterday = (now - timedelta(days=1)).date().isoformat()
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Grace User",
        "role": "subscriber", "qr_token": f"qr_{uuid.uuid4().hex}",
        "wallet_balance": wallet, "created_at": now.isoformat(),
    })
    await db.subscriptions.insert_one({
        "sub_id": sid, "user_id": uid, "plan_id": "premium", "plan_name": "Premium",
        "status": "active", "wallet_balance": wallet,
        "pending_amount": pending, "per_day_amount": 0.0,
        "meals_used": 0, "meals_total": 60,
        "paused_days": 0, "user_paused": False, "service_type": "tiffin",
        "start_date": now.isoformat(),
        "end_date": (now + timedelta(days=days_remaining)).isoformat(),
        "last_tick_date": yesterday,
        "last_active_date": now.date().isoformat(),
        "created_at": now.isoformat(),
    })
    return sid, uid


@pytest.mark.asyncio
async def test_iter57_full_grace_flow():
    """Single end-to-end test covering all 5 in-grace behaviours sequentially.

    Avoids splitting across multiple @pytest.mark.asyncio tests which break
    motor's module-level client across fresh event loops.
    """
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    admin_tok, admin_uid = await _admin_session(db)

    # --- Case 1: grace starts + warning fires when pending > 0
    sid1, uid1 = await _seed_sub(db, wallet=0.0, pending=850.0)
    # --- Case 2: pending = 0 → grace starts, no warning
    sid2, uid2 = await _seed_sub(db, wallet=0.0, pending=0.0)
    # --- Case 3: wallet recovers BEFORE first tick (we'll seed with positive wallet)
    sid3, uid3 = await _seed_sub(db, wallet=100.0, pending=0.0)
    # --- Case 4: grace elapsed → must expire
    sid4, uid4 = await _seed_sub(db, wallet=0.0, pending=0.0)
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    await db.subscriptions.update_one(
        {"sub_id": sid4},
        {"$set": {"zero_wallet_grace_until": past, "in_grace": True}},
    )

    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.post("/api/admin/cron/run-tick", cookies={"session_token": admin_tok})
            assert r.status_code == 200, r.text

        # Case 1 assertions
        s1 = await db.subscriptions.find_one({"sub_id": sid1}, {"_id": 0})
        assert s1["status"] == "active"
        assert s1.get("in_grace") is True
        assert s1.get("zero_wallet_grace_until")
        assert s1.get("in_grace_warning_sent") is True, "warning must fire when pending>0"
        wa = await db.whatsapp_outbox.find_one(
            {"kind": "in_grace_warning", "vars.pending_amount": 850},
            {"_id": 0}, sort=[("created_at", -1)],
        )
        assert wa is not None, "WhatsApp outbox must contain in_grace_warning with ₹850"

        # Case 2 — no warning, in_grace flag still set
        s2 = await db.subscriptions.find_one({"sub_id": sid2}, {"_id": 0})
        assert s2.get("in_grace") is True
        assert s2.get("in_grace_warning_sent") is None

        # Case 3 — wallet still positive, no grace
        s3 = await db.subscriptions.find_one({"sub_id": sid3}, {"_id": 0})
        assert not s3.get("zero_wallet_grace_until")

        # Case 4 — grace elapsed → expired
        s4 = await db.subscriptions.find_one({"sub_id": sid4}, {"_id": 0})
        assert s4["status"] == "expired"
        assert s4.get("expired_reason") == "wallet_zero"
        assert s4.get("in_grace") is False

        # --- Idempotency: re-tick must NOT duplicate warnings for sid1
        before = await db.whatsapp_outbox.count_documents({"kind": "in_grace_warning"})
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r2 = await cli.post("/api/admin/cron/run-tick", cookies={"session_token": admin_tok})
            assert r2.status_code == 200
        after = await db.whatsapp_outbox.count_documents({"kind": "in_grace_warning"})
        assert after == before, f"warning duplicated on re-tick (before={before}, after={after})"

        # --- Recovery: top up sid1 wallet → next tick clears in_grace
        await db.subscriptions.update_one({"sub_id": sid1}, {"$set": {"wallet_balance": 500.0}})
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            await cli.post("/api/admin/cron/run-tick", cookies={"session_token": admin_tok})
        s1b = await db.subscriptions.find_one({"sub_id": sid1}, {"_id": 0})
        assert s1b.get("in_grace") is False
        assert "zero_wallet_grace_until" not in s1b
    finally:
        for sid in (sid1, sid2, sid3, sid4):
            await db.subscriptions.delete_one({"sub_id": sid})
        for uid in (uid1, uid2, uid3, uid4, admin_uid):
            await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_one({"session_token": admin_tok})
        c.close()


def test_iter57_static_grace_warning_helper_exists():
    """Regression: ensure server.py wires the in-grace warning helper + the
    whatsapp/sms send-in-grace-warning helpers exist."""
    server_src = open("/app/backend/server.py").read()
    assert "_send_in_grace_warning" in server_src
    assert '"in_grace": True' in server_src
    assert "in_grace_warning_sent" in server_src

    wa_src = open("/app/backend/whatsapp.py").read()
    assert "send_in_grace_warning" in wa_src

    sms_src = open("/app/backend/sms.py").read()
    assert "send_in_grace_warning" in sms_src
