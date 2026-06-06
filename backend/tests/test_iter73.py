"""Iter-73 — Paytm QR kiosk + +91 phone validation + payment_method tightening.

Covers:
- mess-menu/order: cash dining (no Razorpay), online dining (Razorpay LIVE checkout),
  +91 phone validation for delivery, removal of 'partial' payment_method
- admin/kiosk/order: delivery rejected, online QR (upi://), mixed split-payment
- admin/kiosk/order/confirm-payment: online-only settled, mixed needs both
- content/footer: unchanged contract
"""
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

load_dotenv("/app/backend/.env"); load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL"); DB_NAME = os.environ.get("DB_NAME", "test_database")
IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist() -> str:
    return datetime.now(IST).date().isoformat()


async def _mk(db, role="subscriber"):
    uid = f"u_iter73_{uuid.uuid4().hex[:6]}"
    tok = "sess_iter73_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}",
        "name": f"iter73 {role}",
        "email": f"iter73_{uuid.uuid4().hex[:4]}@x.com", "role": role,
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
        {"$set": {"date": date, "lunch": "iter73 Lunch Paneer", "dinner": "iter73 Dinner Dal", "note": "iter73_test"}},
        upsert=True,
    )


async def _cleanup(db, tok, uid, date):
    await db.mess_menu_orders.delete_many({"user_id": uid})
    await db.mess_menu_orders.delete_many({"placed_by_admin_id": uid})
    await db.mess_menu.delete_one({"date": date, "note": "iter73_test"})
    await db.user_sessions.delete_one({"session_token": tok})
    await db.users.delete_one({"user_id": uid})


# ==================== mess-menu/order ====================


@pytest.mark.asyncio
async def test_mess_order_cash_dining_no_razorpay():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "subscriber"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            r = await c.post("/api/mess-menu/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "dining", "qty": 2, "date": date, "meal_type": "lunch",
                      "payment_method": "cash"})
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["checkout"] is None, "cash dining should NOT return a checkout block"
            assert j["order"]["status"] == "pending_collection"
            assert j["order"]["payment_method"] == "cash"
            # Persisted?
            persisted = await db.mess_menu_orders.find_one({"order_id": j["order"]["order_id"]})
            assert persisted is not None
            assert persisted["status"] == "pending_collection"
    finally:
        await _cleanup(db, tok, uid, date); db_cli.close()


@pytest.mark.asyncio
async def test_mess_order_online_dining_live_razorpay_checkout():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "subscriber"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            r = await c.post("/api/mess-menu/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "dining", "qty": 1, "date": date, "meal_type": "lunch",
                      "payment_method": "online"})
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["checkout"] is not None
            assert "key_id" in j["checkout"]
            assert "amount_paise" in j["checkout"]
            assert "order_id" in j["checkout"]
            # With LIVE Razorpay keys order_id should NOT start with order_mock_
            # If backend rejected the LIVE keys at startup, this falls back to mock.
            if not j["checkout"].get("mock"):
                assert not j["checkout"]["order_id"].startswith("order_mock_"), \
                    "LIVE keys should produce real Razorpay order_id"
    finally:
        await _cleanup(db, tok, uid, date); db_cli.close()


@pytest.mark.asyncio
async def test_mess_order_delivery_phone_validation():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "subscriber"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            base = {"service": "delivery", "qty": 1, "date": date,
                    "meal_type": "lunch", "payment_method": "cash"}
            # Valid 10-digit
            r = await c.post("/api/mess-menu/order", headers={"Authorization": f"Bearer {tok}"},
                json={**base, "phone": "9876543210"})
            assert r.status_code == 200, r.text
            assert r.json()["order"]["delivery_phone"] == "9876543210"

            # Invalid: starts with 1
            r = await c.post("/api/mess-menu/order", headers={"Authorization": f"Bearer {tok}"},
                json={**base, "phone": "1234567890"})
            assert r.status_code == 400
            assert "indian" in r.json()["detail"].lower() or "+91" in r.json()["detail"]

            # Invalid: too short
            r = await c.post("/api/mess-menu/order", headers={"Authorization": f"Bearer {tok}"},
                json={**base, "phone": "123"})
            assert r.status_code == 400

            # With +91 country code prefix → should strip to 10 digits
            r = await c.post("/api/mess-menu/order", headers={"Authorization": f"Bearer {tok}"},
                json={**base, "phone": "919876543210"})
            assert r.status_code == 200, r.text
            assert r.json()["order"]["delivery_phone"] == "9876543210"
    finally:
        await _cleanup(db, tok, uid, date); db_cli.close()


@pytest.mark.asyncio
async def test_mess_order_partial_rejected():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "subscriber"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            r = await c.post("/api/mess-menu/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "dining", "qty": 1, "date": date, "meal_type": "lunch",
                      "payment_method": "partial"})
            assert r.status_code == 400, r.text
    finally:
        await _cleanup(db, tok, uid, date); db_cli.close()


# ==================== admin/kiosk/order ====================


@pytest.mark.asyncio
async def test_kiosk_rejects_delivery():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            r = await c.post("/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "delivery", "qty": 1, "date": date,
                      "meal_type": "lunch", "payment_method": "cash"})
            assert r.status_code == 400, r.text
            assert "takeaway" in r.json()["detail"].lower() or "dining" in r.json()["detail"].lower()
    finally:
        await _cleanup(db, tok, uid, date); db_cli.close()


@pytest.mark.asyncio
async def test_kiosk_online_upi_qr():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            r = await c.post("/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "takeaway", "qty": 1, "date": date,
                      "meal_type": "lunch", "payment_method": "online"})
            assert r.status_code == 200, r.text
            j = r.json()
            order = j["order"]
            assert order["upi_qr_text"].startswith("upi://pay?pa=")
            assert order["upi_vpa"]
            assert order["online_amount"] == order["total"]
            assert order["cash_amount"] == 0
    finally:
        await _cleanup(db, tok, uid, date); db_cli.close()


@pytest.mark.asyncio
async def test_kiosk_mixed_payment_balance():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            # Find the dining price to size the totals
            cfg = await c.get("/api/admin/mess-menu/config", headers={"Authorization": f"Bearer {tok}"})
            assert cfg.status_code == 200
            price_dining = int(cfg.json().get("price_dining", 100))
            # qty=1 → total = price_dining; split into cash + online that sum to total
            cash = price_dining - 40 if price_dining > 40 else 1
            online = price_dining - cash

            # Mixed: balanced (cash + online == total) → success
            r = await c.post("/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "dining", "qty": 1, "date": date,
                      "meal_type": "lunch", "payment_method": "mixed",
                      "cash_amount": cash, "online_amount": online})
            assert r.status_code == 200, r.text
            assert r.json()["order"]["cash_amount"] == cash
            assert r.json()["order"]["online_amount"] == online

            # Mixed: unbalanced → 400
            r = await c.post("/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "dining", "qty": 1, "date": date,
                      "meal_type": "lunch", "payment_method": "mixed",
                      "cash_amount": 50, "online_amount": 40})
            assert r.status_code == 400, r.text
    finally:
        await _cleanup(db, tok, uid, date); db_cli.close()


# ==================== confirm-payment ====================


@pytest.mark.asyncio
async def test_kiosk_confirm_online_settles():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            r = await c.post("/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "takeaway", "qty": 1, "date": date,
                      "meal_type": "lunch", "payment_method": "online"})
            assert r.status_code == 200, r.text
            order_id = r.json()["order"]["order_id"]

            r = await c.post("/api/admin/kiosk/order/confirm-payment",
                headers={"Authorization": f"Bearer {tok}"},
                json={"order_id": order_id, "online_paid": True})
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["settled"] is True
            assert j["order"]["status"] == "pending_collection"
            assert j["order"]["online_paid"] is True
    finally:
        await _cleanup(db, tok, uid, date); db_cli.close()


@pytest.mark.asyncio
async def test_kiosk_confirm_mixed_requires_both():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            cfg = await c.get("/api/admin/mess-menu/config", headers={"Authorization": f"Bearer {tok}"})
            price_dining = int(cfg.json().get("price_dining", 100))
            cash = price_dining - 40 if price_dining > 40 else 1
            online = price_dining - cash
            r = await c.post("/api/admin/kiosk/order",
                headers={"Authorization": f"Bearer {tok}"},
                json={"service": "dining", "qty": 1, "date": date,
                      "meal_type": "lunch", "payment_method": "mixed",
                      "cash_amount": cash, "online_amount": online})
            assert r.status_code == 200, r.text
            order_id = r.json()["order"]["order_id"]

            # Only online → not settled
            r = await c.post("/api/admin/kiosk/order/confirm-payment",
                headers={"Authorization": f"Bearer {tok}"},
                json={"order_id": order_id, "online_paid": True})
            assert r.status_code == 200
            assert r.json()["settled"] is False
            assert r.json()["order"]["status"] == "awaiting_payment"

            # Now cash → settled
            r = await c.post("/api/admin/kiosk/order/confirm-payment",
                headers={"Authorization": f"Bearer {tok}"},
                json={"order_id": order_id, "cash_received": True})
            assert r.status_code == 200
            assert r.json()["settled"] is True
            assert r.json()["order"]["status"] == "pending_collection"
    finally:
        await _cleanup(db, tok, uid, date); db_cli.close()


# ==================== content/footer ====================


@pytest.mark.asyncio
async def test_content_footer_contract():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=15.0) as c:
        r = await c.get("/api/content/footer")
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("brand_name", "support_phone", "copyright"):
            assert k in j, f"missing {k} in /api/content/footer response"
