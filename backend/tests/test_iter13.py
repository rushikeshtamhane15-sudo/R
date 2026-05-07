"""Iter13: Per-IP rate limit on /auth/send-otp + Razorpay key validation."""
import os
import uuid
from datetime import datetime, timezone

import pytest
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


# ---------- /auth/send-otp rate limit ----------

def test_send_otp_per_phone_limit():
    """3 OTPs per phone per 10 min — 4th must return 429 with Retry-After header."""
    phone = _phone()
    # Pre-clean ALL rate-limit hits from this test IP to avoid cross-test contamination
    # (per-IP-hour and per-IP-day limits would otherwise mask the per-phone limit).
    db.rate_limit_hits.delete_many({})
    try:
        for i in range(3):
            r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10)
            assert r.status_code == 200, f"attempt {i+1} unexpectedly {r.status_code}: {r.text}"
        # 4th hit
        r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10)
        assert r.status_code == 429, r.text
        assert "Retry-After" in r.headers
        assert int(r.headers["Retry-After"]) > 0
        body = r.json()
        assert "OTP per phone" in body["detail"]
    finally:
        db.rate_limit_hits.delete_many({"key": f"otp:phone:{phone}"})


def test_send_otp_invalid_phone_returns_400_not_429():
    """Bad phone returns 400 BEFORE the rate limit fires."""
    for _ in range(5):
        r = requests.post(f"{API}/auth/send-otp", json={"phone": "x"}, timeout=10)
        assert r.status_code == 400


def test_rate_limit_collection_has_ttl_index():
    """Verify the TTL index was created — Mongo reaps stale hits automatically."""
    # Force at least one hit so the collection exists with indexes
    phone = _phone()
    try:
        requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10)
        idx_info = db.rate_limit_hits.index_information()
        # At least one index should be a TTL index on expires_at
        ttl_found = any(
            "expireAfterSeconds" in spec
            for spec in idx_info.values()
        )
        assert ttl_found, f"No TTL index found in rate_limit_hits indexes: {list(idx_info.keys())}"
    finally:
        db.rate_limit_hits.delete_many({"key": f"otp:phone:{phone}"})


# ---------- Razorpay validator ----------

def test_razorpay_status_unauth_returns_401():
    r = requests.get(f"{API}/admin/payments/razorpay-status", timeout=10)
    assert r.status_code == 401


def test_razorpay_status_admin_returns_diagnostic():
    """Admin GET returns ok+status+detail+key_id_masked, regardless of mode."""
    uid, tok = _seed_admin()
    try:
        r = requests.get(
            f"{API}/admin/payments/razorpay-status",
            cookies={"session_token": tok},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] in {"live", "mock", "auth_failed", "error"}, body
        assert "detail" in body and isinstance(body["detail"], str) and body["detail"]
        assert "key_id_masked" in body
        # Status==live ⇒ ok==True ; otherwise ok==False
        if body["status"] == "live":
            assert body["ok"] is True
        else:
            assert body["ok"] is False
    finally:
        _cleanup_admin(uid, tok)
