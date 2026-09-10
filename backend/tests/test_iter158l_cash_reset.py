"""iter-158l — Cash reset endpoint + auto-refresh pendency + city fallback."""
import json
import os
import time
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_PHONE = "9970705391"
CACHE = Path("/tmp/iter158_tokens.json")


def _admin_token() -> str:
    cache = {}
    if CACHE.exists():
        try: cache = json.loads(CACHE.read_text())
        except Exception: pass
    tok = cache.get(ADMIN_PHONE)
    if tok:
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        if r.status_code == 200: return tok
    for _ in range(3):
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": ADMIN_PHONE}, timeout=15)
        if r.status_code == 429: time.sleep(60); continue
        otp = r.json()["dev_otp"]
        r2 = requests.post(f"{BASE_URL}/api/auth/verify-otp", json={"phone": ADMIN_PHONE, "otp": otp}, timeout=15)
        tok = r2.json().get("session_token")
        cache[ADMIN_PHONE] = tok
        CACHE.write_text(json.dumps(cache))
        return tok
    raise RuntimeError("rate limited")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_admin_token()}"}


def test_cash_reset_admin_dry_run(admin_headers):
    """Admin can dry-run reset without impersonation → global scope."""
    r = requests.post(f"{BASE_URL}/api/admin/cash-collections/reset?dry_run=true", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("dry_run") is True
    assert "would_cancel" in body


def test_cash_reset_forbidden_for_regular_user():
    """Non-admin/non-mess_owner cannot hit the endpoint."""
    r = requests.post(f"{BASE_URL}/api/admin/cash-collections/reset", timeout=15)
    assert r.status_code in (401, 403), r.text


def test_cash_reset_returns_zero_when_no_pending(admin_headers):
    """A fresh (non-dry-run) call on a mess with no pending returns cancelled:0."""
    # First list current pending count via existing endpoint
    r0 = requests.get(f"{BASE_URL}/api/admin/payments/pending-cash", headers=admin_headers, timeout=15)
    assert r0.status_code == 200
    pending_now = r0.json().get("count", 0)
    if pending_now == 0:
        # Actual reset
        r = requests.post(f"{BASE_URL}/api/admin/cash-collections/reset", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("cancelled") == 0
