"""Iter14: Webhook event logging + extracted auth/payments routers smoke test.

The auth + payments routes were extracted from server.py into routes/auth.py
and routes/payments.py. These tests confirm the moved routes still respond
correctly under their original paths and that the new webhook event log
captures + categorizes payloads correctly.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest  # noqa: F401
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

API = f"{BASE_URL}/api"
mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]


def _phone() -> str:
    return f"9{uuid.uuid4().int % 1_000_000_000:09d}"


def _seed_admin():
    uid = f"TEST_admin_{uuid.uuid4().hex[:10]}"
    tok = f"TEST_st_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": uid, "email": f"TEST_{uuid.uuid4().hex[:6]}@efoodcare.com",
        "phone": _phone(), "name": "Test Admin", "role": "admin",
        "qr_token": f"qr_TEST_{uuid.uuid4().hex[:10]}",
        "photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "wallet_balance": 0.0,
    })
    db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": "2099-01-01T00:00:00+00:00",
    })
    return uid, tok


def _cleanup_admin(uid, tok):
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_one({"session_token": tok})


# ---------- Refactored route-availability smoke ----------

def test_auth_send_otp_route_still_at_original_path():
    """After moving to routes/auth.py, /api/auth/send-otp must still respond."""
    db.rate_limit_hits.delete_many({})
    r = requests.post(f"{API}/auth/send-otp", json={"phone": _phone()}, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert "dev_otp" in body  # dev mode echoes the OTP
    db.rate_limit_hits.delete_many({})


def test_auth_me_unauth_returns_401():
    r = requests.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 401


def test_payments_custom_preview_route_still_works():
    """After moving to routes/payments.py, /api/plans/custom/preview must still respond."""
    r = requests.get(f"{API}/plans/custom/preview", params={"days": 5, "service_type": "dining"}, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["days"] == 5
    assert body["amount"] == 5 * 2 * 70.0  # 5 days · 2 meals · 70 INR = ₹700
    assert body["meals"] == 10


def test_payments_order_unauth_returns_401():
    r = requests.post(f"{API}/payments/order", json={"plan_id": "premium_60"}, timeout=10)
    assert r.status_code == 401


# ---------- Webhook event logging ----------

def test_webhook_logs_event_when_no_secret():
    """A webhook hit with no RAZORPAY_WEBHOOK_SECRET configured must still be recorded with signature_ok=None."""
    before = db.webhook_events.count_documents({})
    r = requests.post(f"{API}/webhook/razorpay", json={"event": "payment.captured", "payload": {}}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["received"] is False
    assert body["reason"] == "secret_missing"
    after = db.webhook_events.count_documents({})
    assert after == before + 1
    last = db.webhook_events.find_one(sort=[("ts", -1)], projection={"_id": 0})
    assert last["signature_ok"] is None
    assert last["body_size"] > 0
    assert "event_id" in last and last["event_id"].startswith("wh_")


def test_webhook_admin_events_listing_shape(_=None):
    """GET /admin/payments/webhook-events admin-only, returns events + counts."""
    uid, tok = _seed_admin()
    try:
        # Generate one event so list is non-empty
        requests.post(f"{API}/webhook/razorpay", json={"event": "test.event"}, timeout=10)
        r = requests.get(f"{API}/admin/payments/webhook-events?limit=5", cookies={"session_token": tok}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "events" in body and isinstance(body["events"], list)
        assert "counts" in body
        c = body["counts"]
        for k in ("total", "signature_ok", "signature_failed", "no_secret"):
            assert k in c and isinstance(c[k], int)
        # Events shape (any one)
        if body["events"]:
            ev = body["events"][0]
            for k in ("event_id", "ts", "event", "signature_ok", "body_size", "processed"):
                assert k in ev
    finally:
        _cleanup_admin(uid, tok)


def test_webhook_admin_events_unauth_returns_401():
    r = requests.get(f"{API}/admin/payments/webhook-events", timeout=10)
    assert r.status_code == 401
