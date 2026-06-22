"""iter-119 — Pass-scan mobile app sync handshake.

Verifies that every endpoint the mobile app needs is reachable via the
`Authorization: Bearer <session_token>` header (mobile apps cannot use
the HttpOnly cookie the web app gets). One full happy-path walk:

  send-otp → verify-otp → auth/me → /my/subscription
                                  → /my/wallet
                                  → /my/qr
                                  → /menu/today
                                  → /my/attendance
                                  → /my/deliveries/pending
                                  → /my/deliveries/track

All eleven calls MUST succeed with the same Bearer token.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"


def _unique_phone() -> str:
    # 9 + 9-digit suffix from current unix ns to avoid OTP rate-limit clashes
    return "9" + str(time.time_ns())[-9:]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    yield s
    s.close()


@pytest.fixture(scope="module")
def bearer_token(session):
    phone = _unique_phone()
    r1 = session.post(f"{BASE_URL}/auth/send-otp", json={"phone": phone}, timeout=10)
    assert r1.status_code == 200, r1.text
    dev_otp = r1.json().get("dev_otp")
    assert dev_otp, "Backend must echo dev_otp in dev mode"

    r2 = session.post(
        f"{BASE_URL}/auth/verify-otp",
        json={"phone": phone, "otp": dev_otp, "name": f"MobileTest-{uuid.uuid4().hex[:6]}"},
        timeout=10,
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert "session_token" in body, "verify-otp must return session_token in JSON for mobile apps"
    assert body["session_token"].startswith("sess_"), body["session_token"]
    yield body["session_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_bearer_auth_me(bearer_token):
    """Bearer token authenticates against /auth/me (the gateway sanity check)."""
    r = requests.get(f"{BASE_URL}/auth/me", headers=_h(bearer_token), timeout=10)
    assert r.status_code == 200, r.text
    assert r.json().get("user_id"), r.json()


def test_my_subscription(bearer_token):
    r = requests.get(f"{BASE_URL}/my/subscription", headers=_h(bearer_token), timeout=10)
    assert r.status_code == 200, r.text
    # Either an active sub or `{"subscription": null}` — both fine.
    assert "subscription" in r.json()


def test_my_wallet(bearer_token):
    r = requests.get(f"{BASE_URL}/my/wallet", headers=_h(bearer_token), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "wallet_balance" in body, body


def test_my_qr(bearer_token):
    r = requests.get(f"{BASE_URL}/my/qr", headers=_h(bearer_token), timeout=10)
    assert r.status_code == 200, r.text
    # Older deployments return qr_token; newer ones add qr_data_url. At least one MUST be present.
    body = r.json()
    assert body.get("qr_token") or body.get("qr_data_url"), body


def test_menu_today(bearer_token):
    r = requests.get(f"{BASE_URL}/menu/today", headers=_h(bearer_token), timeout=10)
    assert r.status_code == 200, r.text


def test_my_attendance(bearer_token):
    r = requests.get(f"{BASE_URL}/my/attendance", headers=_h(bearer_token), timeout=10)
    assert r.status_code == 200, r.text
    assert "attendance" in r.json()


def test_my_deliveries_pending(bearer_token):
    """The endpoint that was previously thought to be missing — actually exists in delivery/customer.py."""
    r = requests.get(f"{BASE_URL}/my/deliveries/pending", headers=_h(bearer_token), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "pending" in body and "date" in body


def test_my_deliveries_track(bearer_token):
    r = requests.get(f"{BASE_URL}/my/deliveries/track", headers=_h(bearer_token), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    # Either tracking is false (no active boy) or full shape returned
    assert "tracking" in body


def test_bearer_missing_returns_401():
    """Sanity: no token → 401, never silent fallback."""
    r = requests.get(f"{BASE_URL}/auth/me", timeout=10)
    assert r.status_code == 401, r.text


def test_bearer_invalid_returns_401():
    r = requests.get(
        f"{BASE_URL}/auth/me",
        headers={"Authorization": "Bearer sess_thisisnotarealtoken"},
        timeout=10,
    )
    assert r.status_code == 401, r.text


def test_cors_open(bearer_token):
    """Mobile apps don't preflight, but a friendly browser-based PWA might.
    Confirm the server allows arbitrary origins (`allow_origins=*` default)."""
    r = requests.options(
        f"{BASE_URL}/auth/me",
        headers={
            "Origin": "https://mobile.example.com",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
        timeout=10,
    )
    # OPTIONS may be 200 or 405 depending on stack; what matters is the header
    assert r.headers.get("access-control-allow-origin") in ("*", "https://mobile.example.com"), r.headers
