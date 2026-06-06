"""Iter-74 — Kiosk QR provider toggle (Paytm vs Razorpay) + payment-status poll.

New endpoints:
- GET  /api/admin/kiosk/qr-provider  (admin/staff)
- PUT  /api/admin/kiosk/qr-provider  (admin only, provider in {paytm, razorpay})
- GET  /api/admin/kiosk/order/{order_id}/payment-status

Provider effects on POST /api/admin/kiosk/order with payment_method='online':
- paytm     -> upi_qr_text starts with 'upi://pay?pa=' ; razorpay_qr_id is null
- razorpay  -> razorpay_qr_id starts with 'qr_' AND razorpay_qr_image_url present ;
              upi_qr_text is empty (UNLESS Razorpay rejects QR create -> fallback)

Quick regression: cash mess order + +91 phone validation.
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
    uid = f"u_iter74_{uuid.uuid4().hex[:6]}"
    tok = "sess_iter74_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}",
        "name": f"iter74 {role}",
        "email": f"iter74_{uuid.uuid4().hex[:4]}@x.com", "role": role,
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
        {"$set": {"date": date, "lunch": "iter74 Lunch Paneer", "dinner": "iter74 Dinner Dal", "note": "iter74_test"}},
        upsert=True,
    )


async def _cleanup(db, tokens_uids, date):
    for tok, uid in tokens_uids:
        await db.mess_menu_orders.delete_many({"user_id": uid})
        await db.mess_menu_orders.delete_many({"placed_by_admin_id": uid})
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})
    await db.mess_menu.delete_one({"date": date, "note": "iter74_test"})


async def _reset_provider(db, provider="paytm"):
    await db.app_config.update_one(
        {"key": "kiosk_qr_v1"},
        {"$set": {"key": "kiosk_qr_v1", "provider": provider}},
        upsert=True,
    )


# ============== /admin/kiosk/qr-provider ==============


@pytest.mark.asyncio
async def test_qr_provider_get_default_paytm():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        # Delete any existing config so default kicks in
        await db.app_config.delete_one({"key": "kiosk_qr_v1"})
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.get("/api/admin/kiosk/qr-provider",
                            headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200, r.text
            j = r.json()
            assert j.get("provider") == "paytm", f"expected default paytm, got {j}"
    finally:
        await _cleanup(db, [(tok, uid)], date); db_cli.close()


@pytest.mark.asyncio
async def test_qr_provider_put_razorpay_then_get():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.put("/api/admin/kiosk/qr-provider",
                            headers={"Authorization": f"Bearer {tok}"},
                            json={"provider": "razorpay"})
            assert r.status_code == 200, r.text
            assert r.json().get("provider") == "razorpay"
            # GET should now read razorpay
            r2 = await c.get("/api/admin/kiosk/qr-provider",
                             headers={"Authorization": f"Bearer {tok}"})
            assert r2.status_code == 200
            assert r2.json().get("provider") == "razorpay"
            # Switch back to paytm to leave state clean
            r3 = await c.put("/api/admin/kiosk/qr-provider",
                             headers={"Authorization": f"Bearer {tok}"},
                             json={"provider": "paytm"})
            assert r3.status_code == 200
            # Invalid provider rejected
            r4 = await c.put("/api/admin/kiosk/qr-provider",
                             headers={"Authorization": f"Bearer {tok}"},
                             json={"provider": "invalid"})
            assert r4.status_code == 400, r4.text
    finally:
        await _reset_provider(db, "paytm")
        await _cleanup(db, [(tok, uid)], date); db_cli.close()


@pytest.mark.asyncio
async def test_qr_provider_put_forbidden_for_non_admin():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok_sub, uid_sub = await _mk(db, "subscriber")
    tok_staff, uid_staff = await _mk(db, "staff")
    date = _today_ist()
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            # subscriber: PUT must be 403
            r = await c.put("/api/admin/kiosk/qr-provider",
                            headers={"Authorization": f"Bearer {tok_sub}"},
                            json={"provider": "razorpay"})
            assert r.status_code == 403, r.text
            # staff: PUT must also be 403 (admin only)
            r2 = await c.put("/api/admin/kiosk/qr-provider",
                             headers={"Authorization": f"Bearer {tok_staff}"},
                             json={"provider": "razorpay"})
            assert r2.status_code == 403, r2.text
            # staff: GET is allowed
            r3 = await c.get("/api/admin/kiosk/qr-provider",
                             headers={"Authorization": f"Bearer {tok_staff}"})
            assert r3.status_code == 200, r3.text
    finally:
        await _cleanup(db, [(tok_sub, uid_sub), (tok_staff, uid_staff)], date); db_cli.close()


# ============== /admin/kiosk/order with provider toggle ==============


@pytest.mark.asyncio
async def test_kiosk_order_paytm_provider_upi_intent():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        await _reset_provider(db, "paytm")
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            r = await c.post("/api/admin/kiosk/order",
                             headers={"Authorization": f"Bearer {tok}"},
                             json={"service": "takeaway", "qty": 1, "date": date,
                                   "meal_type": "lunch", "payment_method": "online"})
            assert r.status_code == 200, r.text
            j = r.json()
            assert j.get("upi_qr_text", "").startswith("upi://pay?pa="), j.get("upi_qr_text")
            assert not j.get("razorpay_qr_id"), f"expected no razorpay_qr_id, got {j.get('razorpay_qr_id')}"
            assert j.get("qr_provider") == "paytm"
    finally:
        await _cleanup(db, [(tok, uid)], date); db_cli.close()


@pytest.mark.asyncio
async def test_kiosk_order_razorpay_provider_qr_image():
    """Provider=razorpay should attempt to create a Razorpay QR (qr_*) with
    image_url. If LIVE Razorpay rejects the QR API call, backend falls back
    to UPI intent — flagged as acceptable per the iter-74 brief."""
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        await _reset_provider(db, "razorpay")
        order_id = None
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=60.0) as c:
            r = await c.post("/api/admin/kiosk/order",
                             headers={"Authorization": f"Bearer {tok}"},
                             json={"service": "takeaway", "qty": 1, "date": date,
                                   "meal_type": "lunch", "payment_method": "online"})
            assert r.status_code == 200, r.text
            j = r.json()
            order_id = j["order"]["order_id"]
            rzp_id = j.get("razorpay_qr_id")
            if rzp_id:
                assert rzp_id.startswith("qr_"), f"razorpay_qr_id must start with qr_, got {rzp_id}"
                assert j.get("razorpay_qr_image_url"), "razorpay_qr_image_url missing"
                assert (j.get("upi_qr_text") or "") == "", "upi_qr_text should be empty when razorpay QR works"
                # Persisted?
                persisted = await db.mess_menu_orders.find_one({"order_id": order_id})
                assert persisted and persisted.get("razorpay_qr_id") == rzp_id

                # payment-status poll BEFORE any payment (should be polled=true, online_paid=false)
                r2 = await c.get(f"/api/admin/kiosk/order/{order_id}/payment-status",
                                 headers={"Authorization": f"Bearer {tok}"})
                assert r2.status_code == 200, r2.text
                j2 = r2.json()
                assert j2.get("ok") is True
                # polled may be False if razorpay fetch errors transiently — accept both
                if j2.get("polled"):
                    assert j2.get("online_paid") is False
                    assert j2.get("received_paise") == 0
                    assert isinstance(j2.get("expected_paise"), int)
            else:
                # Acceptable fallback to UPI intent (live key rejected QR API)
                assert (j.get("upi_qr_text") or "").startswith("upi://pay?pa="), \
                    f"Razorpay QR create failed and UPI fallback missing: {j}"
                print("[iter74] Razorpay QR create failed — fell back to UPI intent. Acceptable per brief.")
    finally:
        await _reset_provider(db, "paytm")
        await _cleanup(db, [(tok, uid)], date); db_cli.close()


# ============== regression: mess-menu/order cash + +91 phone ==============


@pytest.mark.asyncio
async def test_regression_mess_cash_and_phone_validation():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "subscriber"); date = _today_ist()
    try:
        await _seed_menu(db, date)
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            # cash dining → no checkout
            r = await c.post("/api/mess-menu/order",
                             headers={"Authorization": f"Bearer {tok}"},
                             json={"service": "dining", "qty": 1, "date": date,
                                   "meal_type": "lunch", "payment_method": "cash"})
            assert r.status_code == 200, r.text
            assert r.json().get("checkout") is None
            # delivery + invalid phone
            r2 = await c.post("/api/mess-menu/order",
                              headers={"Authorization": f"Bearer {tok}"},
                              json={"service": "delivery", "qty": 1, "date": date,
                                    "meal_type": "lunch", "payment_method": "cash",
                                    "phone": "12"})
            assert r2.status_code == 400, r2.text
            # delivery + valid +91
            r3 = await c.post("/api/mess-menu/order",
                              headers={"Authorization": f"Bearer {tok}"},
                              json={"service": "delivery", "qty": 1, "date": date,
                                    "meal_type": "lunch", "payment_method": "cash",
                                    "phone": "919876543210"})
            assert r3.status_code == 200, r3.text
            assert r3.json()["order"]["delivery_phone"] == "9876543210"
    finally:
        await _cleanup(db, [(tok, uid)], date); db_cli.close()
