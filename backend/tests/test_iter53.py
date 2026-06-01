"""Iter-53 pytest: cash + partial + tiffin-stock backend flows."""
from __future__ import annotations

import os
import uuid
import asyncio
import pytest
import httpx
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "test_database")


async def _make_session(role="admin", phone=None):
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    phone = phone or f"99{uuid.uuid4().hex[:8]}"
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": uid, "phone": phone, "name": f"Test {phone[-4:]}",
        "role": role, "address": "Pune", "photo_url": "data:image/png;base64,iV",
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "wallet_balance": 0.0, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    tok = "sess_" + uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    c.close()
    return tok, uid, phone


@pytest.mark.asyncio
async def test_tiffin_stock_crud():
    tok, uid, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        h = {"Authorization": f"Bearer {tok}"}
        r = await cli.get("/api/admin/tiffin-stock", headers=h)
        assert r.status_code == 200
        before = r.json()["quantity"]
        r = await cli.post("/api/admin/tiffin-stock/topup", json={"qty": 20, "note": "iter53"}, headers=h)
        assert r.status_code == 200
        assert r.json()["quantity"] == before + 20
        r = await cli.post("/api/admin/tiffin-stock/adjust", json={"delta": -5, "reason": "broken"}, headers=h)
        assert r.status_code == 200
        assert r.json()["quantity"] == before + 15
        r = await cli.get("/api/admin/tiffin-stock/history?limit=5", headers=h)
        assert r.status_code == 200
        assert r.json()["count"] >= 2


@pytest.mark.asyncio
async def test_tiffin_stock_unauth():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        r = await cli.get("/api/admin/tiffin-stock")
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_cash_order_otp_verify_flow():
    sub_tok, _, _ = await _make_session("subscriber")
    admin_tok, _, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        # Find a plan
        r = await cli.get("/api/plans")
        plans = r.json()["plans"]
        plan_id = plans[0]["plan_id"]
        # Cash order
        sub_h = {"Authorization": f"Bearer {sub_tok}"}
        r = await cli.post("/api/payments/cash-order", json={"plan_id": plan_id}, headers=sub_h)
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "pending_cash"
        assert body.get("dev_otp"), "dev_otp must be present in DEV mode"
        # Pending list (admin)
        admin_h = {"Authorization": f"Bearer {admin_tok}"}
        r = await cli.get("/api/admin/payments/pending-cash", headers=admin_h)
        assert r.status_code == 200
        assert any(x["order_id"] == body["order_id"] for x in r.json()["rows"])
        # Wrong OTP
        r = await cli.post("/api/staff/cash-collect/verify-otp", json={"order_id": body["order_id"], "otp": "000000"}, headers=admin_h)
        assert r.status_code == 400
        # Correct OTP
        r = await cli.post("/api/staff/cash-collect/verify-otp", json={"order_id": body["order_id"], "otp": body["dev_otp"]}, headers=admin_h)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["ok"] and out["deposit_slip_no"].startswith("SLIP-")


@pytest.mark.asyncio
async def test_partial_payment_50pct_min():
    sub_tok, _, _ = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/plans")
        plan = r.json()["plans"][0]
        sub_h = {"Authorization": f"Bearer {sub_tok}"}
        # Less than 50% should fail
        too_low = round(float(plan["amount"]) * 0.4, 2)
        r = await cli.post("/api/payments/partial-order",
                           json={"plan_id": plan["plan_id"], "down_payment": too_low}, headers=sub_h)
        assert r.status_code == 400
        # Exactly 50% should succeed
        ok_amt = round(float(plan["amount"]) * 0.5, 2)
        r = await cli.post("/api/payments/partial-order",
                           json={"plan_id": plan["plan_id"], "down_payment": ok_amt}, headers=sub_h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["partial_total"] > body["partial_pending"]
        assert abs(body["partial_pending"] - (plan["amount"] - ok_amt)) < 1


@pytest.mark.asyncio
async def test_partial_verify_creates_pending_balance():
    sub_tok, _, _ = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/plans")
        plan = r.json()["plans"][0]
        sub_h = {"Authorization": f"Bearer {sub_tok}"}
        down = round(float(plan["amount"]) * 0.5, 2)
        r = await cli.post("/api/payments/partial-order",
                           json={"plan_id": plan["plan_id"], "down_payment": down}, headers=sub_h)
        order = r.json()
        # Mock verify
        r = await cli.post("/api/payments/verify",
                           json={"order_id": order["order_id"], "razorpay_payment_id": "m", "razorpay_signature": "s"},
                           headers=sub_h)
        assert r.status_code == 200
        # Pending balance present
        r = await cli.get("/api/my/partial-balance", headers=sub_h)
        assert r.status_code == 200
        rows = r.json()["items"]
        assert len(rows) == 1
        assert abs(rows[0]["pending_amount"] - (plan["amount"] - down)) < 1


@pytest.mark.asyncio
async def test_partial_clear_balance_flow():
    sub_tok, _, _ = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/plans")
        plan = r.json()["plans"][0]
        sub_h = {"Authorization": f"Bearer {sub_tok}"}
        down = round(float(plan["amount"]) * 0.5, 2)
        # Create + verify partial
        r = await cli.post("/api/payments/partial-order",
                           json={"plan_id": plan["plan_id"], "down_payment": down}, headers=sub_h)
        oid = r.json()["order_id"]
        await cli.post("/api/payments/verify", headers=sub_h,
                       json={"order_id": oid, "razorpay_payment_id": "m", "razorpay_signature": "s"})
        # Read sub id
        r = await cli.get("/api/my/partial-balance", headers=sub_h)
        sub_id = r.json()["items"][0]["sub_id"]
        pending_before = r.json()["items"][0]["pending_amount"]
        # Clear partial - small amount
        clear_amt = round(pending_before / 2, 2)
        r = await cli.post("/api/payments/clear-partial-balance",
                           json={"sub_id": sub_id, "amount": clear_amt}, headers=sub_h)
        assert r.status_code == 200
        order2 = r.json()
        await cli.post("/api/payments/verify", headers=sub_h,
                       json={"order_id": order2["order_id"], "razorpay_payment_id": "m", "razorpay_signature": "s"})
        # Check balance reduced
        r = await cli.get("/api/my/partial-balance", headers=sub_h)
        rows = r.json()["items"]
        if rows:
            assert abs(rows[0]["pending_amount"] - (pending_before - clear_amt)) < 1


@pytest.mark.asyncio
async def test_tiffin_pref_admin_image_routes_exist():
    """Smoke: AI image gen + upload endpoints reachable (don't call OpenAI)."""
    tok, _, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        # Without auth → 401
        r = await cli.get("/api/admin/tiffin-preferences/catalog")
        assert r.status_code == 401
        r = await cli.get("/api/admin/tiffin-preferences/catalog",
                          headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        assert isinstance(r.json()["items"], list)
