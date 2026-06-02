"""Iter-53 extra coverage: pending-cash OTP redaction, threshold, assign-staff,
resend-otp, pending-partials, stock floor at 0, subscriber role rejection."""
from __future__ import annotations

import os
import uuid
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


async def _make_session(role="admin"):
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    phone = f"99{uuid.uuid4().hex[:8]}"
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": uid, "phone": phone, "name": f"Test {phone[-4:]}",
        "role": role, "address": "Pune", "photo_url": "data:image/png;base64,iV",
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "wallet_balance": 0.0,
        "lat": 18.5204, "lng": 73.8567,
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


@pytest.mark.asyncio
async def test_pending_cash_redacts_otp_and_enriches_customer():
    sub_tok, _ = await _make_session("subscriber")
    admin_tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        plans = (await cli.get("/api/plans")).json()["plans"]
        plan_id = plans[0]["plan_id"]
        # Sub creates cash order
        r = await cli.post("/api/payments/cash-order", json={"plan_id": plan_id},
                           headers={"Authorization": f"Bearer {sub_tok}"})
        assert r.status_code == 200
        # Admin list
        r = await cli.get("/api/admin/payments/pending-cash",
                          headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 1
        for row in body["rows"]:
            assert "cash_otp" not in row, "OTP must not be exposed to admin/staff list"
            assert "customer_name" in row
            assert "customer_phone" in row


@pytest.mark.asyncio
async def test_subscriber_cannot_access_admin_stock_or_cash():
    sub_tok, _ = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        h = {"Authorization": f"Bearer {sub_tok}"}
        for path in [
            "/api/admin/tiffin-stock",
            "/api/admin/tiffin-stock/history",
            "/api/admin/payments/pending-cash",
            "/api/admin/payments/pending-partials",
            "/api/admin/payments/staff-roster",
        ]:
            r = await cli.get(path, headers=h)
            assert r.status_code == 403, f"{path} should be 403 for subscriber, got {r.status_code}"


@pytest.mark.asyncio
async def test_threshold_persists_and_low_stock_flag():
    tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        h = {"Authorization": f"Bearer {tok}"}
        r = await cli.put("/api/admin/tiffin-stock/threshold", json={"threshold": 9999},
                          headers=h)
        assert r.status_code == 200
        assert r.json()["low_threshold"] == 9999
        r = await cli.get("/api/admin/tiffin-stock", headers=h)
        assert r.status_code == 200
        body = r.json()
        assert body["low_threshold"] == 9999
        # Above-threshold quantity → low_stock True since 9999 >= quantity
        assert body["low_stock"] is True
        assert "active_tiffin_subs" in body
        assert "expected_daily_use" in body
        # Reset to default-ish so other tests aren't impacted
        await cli.put("/api/admin/tiffin-stock/threshold", json={"threshold": 20}, headers=h)


@pytest.mark.asyncio
async def test_assign_staff_and_resend_otp():
    sub_tok, _ = await _make_session("subscriber")
    admin_tok, _ = await _make_session("admin")
    staff_tok, staff_uid = await _make_session("staff")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        plans = (await cli.get("/api/plans")).json()["plans"]
        plan_id = plans[0]["plan_id"]
        r = await cli.post("/api/payments/cash-order", json={"plan_id": plan_id},
                           headers={"Authorization": f"Bearer {sub_tok}"})
        assert r.status_code == 200
        order_id = r.json()["order_id"]
        original_otp = r.json()["dev_otp"]
        # Assign staff
        r = await cli.post("/api/admin/payments/cash-collect/assign",
                           json={"order_id": order_id, "staff_user_id": staff_uid},
                           headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200, r.text
        # Resend OTP (admin allowed)
        r = await cli.post("/api/admin/payments/cash-collect/resend-otp",
                           json={"order_id": order_id},
                           headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200, r.text
        new_otp = r.json()["dev_otp"]
        assert new_otp and new_otp != original_otp
        # Old OTP no longer valid
        r = await cli.post("/api/staff/cash-collect/verify-otp",
                           json={"order_id": order_id, "otp": original_otp},
                           headers={"Authorization": f"Bearer {staff_tok}"})
        assert r.status_code == 400
        # New OTP, verified by STAFF role works (user choice 1c)
        r = await cli.post("/api/staff/cash-collect/verify-otp",
                           json={"order_id": order_id, "otp": new_otp},
                           headers={"Authorization": f"Bearer {staff_tok}"})
        assert r.status_code == 200, r.text
        assert r.json()["deposit_slip_no"].startswith("SLIP-")


@pytest.mark.asyncio
async def test_pending_partials_admin_listing():
    sub_tok, _ = await _make_session("subscriber")
    admin_tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        plans = (await cli.get("/api/plans")).json()["plans"]
        plan = plans[0]
        down = round(plan["amount"] * 0.5, 2)
        r = await cli.post("/api/payments/partial-order",
                           json={"plan_id": plan["plan_id"], "down_payment": down},
                           headers={"Authorization": f"Bearer {sub_tok}"})
        oid = r.json()["order_id"]
        await cli.post("/api/payments/verify",
                       json={"order_id": oid, "razorpay_payment_id": "m", "razorpay_signature": "s"},
                       headers={"Authorization": f"Bearer {sub_tok}"})
        # Admin list of partials
        r = await cli.get("/api/admin/payments/pending-partials",
                          headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 1
        assert body["total_pending"] > 0
        for row in body["rows"]:
            assert row["pending_amount"] > 0
            assert "customer_name" in row


@pytest.mark.asyncio
async def test_stock_floor_at_zero_via_adjust():
    tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        h = {"Authorization": f"Bearer {tok}"}
        # Push hugely negative adjust to force floor
        r = await cli.post("/api/admin/tiffin-stock/adjust",
                           json={"delta": -999999, "reason": "test floor"}, headers=h)
        assert r.status_code == 200
        assert r.json()["quantity"] == 0
        # Re-topup so subsequent suites have stock
        r = await cli.post("/api/admin/tiffin-stock/topup",
                           json={"qty": 50, "note": "iter53-restore"}, headers=h)
        assert r.json()["quantity"] >= 50
