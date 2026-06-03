"""Iter-56 backend tests.

Covers:
  - /api/dashboard-styles  GET (public) + PUT (admin)
  - /api/admin/bank-account GET/PUT
  - /api/admin/payments/upload-deposit-proof (multipart → data-URL)
  - /api/admin/notifications/bank-deposit  (banner when pending > 10000)
  - /api/admin/notifications/mark-read
  - /api/auth/google/verify rejects empty / invalid credentials
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


async def _make_session(role: str = "subscriber"):
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    phone = f"7{uuid.uuid4().hex[:9]}"
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": uid, "phone": phone, "name": "Iter56 Test",
        "role": role, "address": "Test addr Pune 411001",
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    tok = "sess_" + uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    c.close()
    return tok, uid


# 1x1 PNG bytes — uploadable image fixture
_PNG_1x1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
    b"\x89\x00\x00\x00\rIDATx\x9cc\xfa\xcf\x00\x00\x00\x02\x00\x01\xe5\x27\xde\xfc\x00\x00\x00\x00IEND\xaeB`\x82"
)


# ---------------------------------------------------------------------------
# Dashboard styles CMS
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_dashboard_styles_public_read():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/dashboard-styles")
        assert r.status_code == 200
        data = r.json()
        # default keys always present (even when collection empty)
        for k in ("dues_bg", "dues_text", "otp_bg", "otp_text"):
            assert k in data


@pytest.mark.asyncio
async def test_dashboard_styles_admin_put():
    tok, _ = await _make_session("admin")
    payload = {
        "dues_bg": "#fff7ed",
        "dues_text": "#9a3412",
        "otp_bg": "#ecfdf5",
        "otp_text": "#065f46",
    }
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.put(
            "/api/admin/dashboard-styles",
            json=payload,
            cookies={"session_token": tok},
        )
        assert r.status_code == 200, r.text
        assert r.json()["dues_bg"] == "#fff7ed"
        # Confirm public GET reflects update
        g = await cli.get("/api/dashboard-styles")
        assert g.status_code == 200
        assert g.json()["dues_bg"] == "#fff7ed"


@pytest.mark.asyncio
async def test_dashboard_styles_subscriber_cannot_put():
    tok, _ = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.put(
            "/api/admin/dashboard-styles",
            json={"dues_bg": "#000", "dues_text": "#fff", "otp_bg": "", "otp_text": ""},
            cookies={"session_token": tok},
        )
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Bank account CMS
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bank_account_admin_put_get():
    tok, _ = await _make_session("admin")
    payload = {
        "holder_name": "eFoodCare Operations LLP",
        "account_no": "123456789012",
        "ifsc": "HDFC0001234",
        "bank_name": "HDFC Bank",
    }
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.put("/api/admin/bank-account", json=payload, cookies={"session_token": tok})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["account_last4"] == "9012"
        # Confirm GET
        g = await cli.get("/api/admin/bank-account", cookies={"session_token": tok})
        assert g.status_code == 200
        assert g.json()["account_last4"] == "9012"


@pytest.mark.asyncio
async def test_bank_account_subscriber_forbidden():
    tok, _ = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/admin/bank-account", cookies={"session_token": tok})
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Deposit-proof upload
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_upload_deposit_proof_returns_data_url():
    tok, _ = await _make_session("admin")
    files = {"file": ("proof.png", _PNG_1x1, "image/png")}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
        r = await cli.post(
            "/api/admin/payments/upload-deposit-proof",
            files=files,
            cookies={"session_token": tok},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["url"].startswith("data:image/")
        assert ";base64," in body["url"]
        assert body["bytes"] > 0


@pytest.mark.asyncio
async def test_upload_deposit_proof_subscriber_forbidden():
    tok, _ = await _make_session("subscriber")
    files = {"file": ("proof.png", _PNG_1x1, "image/png")}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
        r = await cli.post(
            "/api/admin/payments/upload-deposit-proof",
            files=files,
            cookies={"session_token": tok},
        )
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Pending-bank-deposit notification banner
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_pending_deposit_notification_under_threshold():
    """Below ₹10,000 → notification banner should not fire (show=false)."""
    tok, _ = await _make_session("admin")
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    # Wipe prior state
    await db.admin_notifications.delete_many({"kind": "pending_bank_deposit"})
    # Seed a small cash order < threshold
    oid = f"order_{uuid.uuid4().hex[:10]}"
    await db.payment_orders.insert_one({
        "order_id": oid, "status": "paid", "payment_mode": "cash",
        "amount": 500.0, "deposited_to_bank": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.get("/api/admin/notifications/bank-deposit", cookies={"session_token": tok})
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["threshold"] == 10_000
            assert body["pending"] >= 500
            # Even if there are leftover unread notifications from prior runs we tolerate them,
            # but show should be False when current pending is well under threshold and we wiped.
            if body["pending"] <= 10_000:
                assert body["show"] is False
    finally:
        await db.payment_orders.delete_one({"order_id": oid})
        c.close()


@pytest.mark.asyncio
async def test_pending_deposit_notification_over_threshold_then_mark_read():
    tok, _ = await _make_session("admin")
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    # Clean
    await db.admin_notifications.delete_many({"kind": "pending_bank_deposit"})
    # Seed enough cash orders to cross 10k
    oids = []
    for i in range(3):
        oid = f"order_{uuid.uuid4().hex[:10]}"
        oids.append(oid)
        await db.payment_orders.insert_one({
            "order_id": oid, "status": "paid", "payment_mode": "cash",
            "amount": 4000.0, "deposited_to_bank": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
            r = await cli.get("/api/admin/notifications/bank-deposit", cookies={"session_token": tok})
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["pending"] >= 12_000
            assert body["show"] is True
            assert body["message"] and "₹" in body["message"]
            # mark-read clears the banner
            m = await cli.post("/api/admin/notifications/mark-read", cookies={"session_token": tok})
            assert m.status_code == 200
            r2 = await cli.get("/api/admin/notifications/bank-deposit", cookies={"session_token": tok})
            # After mark-read the same call may resurface it because pending is still high.
            # The contract: read=true is overwritten by the upsert only on insert. So after
            # mark-read AND no new insert, show should be False.
            # However, the route does an upsert {$setOnInsert: read=False}; on re-read it
            # finds the existing doc with read=true (since we just marked it) and returns show=False.
            assert r2.json()["show"] is False
    finally:
        await db.payment_orders.delete_many({"order_id": {"$in": oids}})
        await db.admin_notifications.delete_many({"kind": "pending_bank_deposit"})
        c.close()


@pytest.mark.asyncio
async def test_pending_deposit_notification_subscriber_forbidden():
    tok, _ = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/admin/notifications/bank-deposit", cookies={"session_token": tok})
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Google verify rejects invalid credentials (no auto-fill name regression test)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_google_verify_rejects_invalid_credential():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.post("/api/auth/google/verify", json={"credential": "not-a-real-jwt"})
        # 401 on bad token, OR 503 if GOOGLE_CLIENT_ID is missing (we treat both as expected non-200)
        assert r.status_code in (401, 503), r.text


def test_google_route_does_not_pull_name_from_idinfo():
    """Static-code regression: ensure the route still sets name=None instead of
    reading idinfo['name']. Guards against an accidental revert.
    """
    src = open("/app/backend/routes/auth_google.py").read()
    assert "name = None" in src or 'name=None' in src
    # idinfo['name'] / idinfo.get('name') usage would re-enable auto-fill — must not appear.
    assert 'idinfo.get("name")' not in src
    assert "idinfo['name']" not in src
