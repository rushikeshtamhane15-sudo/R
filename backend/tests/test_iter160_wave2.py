"""iter-160 Wave-2: role-widening for takeaway pendency, tiffin delivery,
cash collection, and partial payments.

All endpoints below previously returned 403 for mess_owner and now must return 2xx.
Uses super-admin impersonation of a fresh mess (equivalent to acting as mess_owner).
"""
import json
import os
import time
import uuid
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
        try:
            cache = json.loads(CACHE.read_text())
        except Exception:
            cache = {}
    tok = cache.get(ADMIN_PHONE)
    if tok:
        rc = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        if rc.status_code == 200:
            return tok
    for _ in range(3):
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": ADMIN_PHONE}, timeout=15)
        if r.status_code == 429:
            time.sleep(60)
            continue
        assert r.status_code == 200, r.text
        otp = r.json()["dev_otp"]
        r2 = requests.post(
            f"{BASE_URL}/api/auth/verify-otp",
            json={"phone": ADMIN_PHONE, "otp": otp, "name": "Super"},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        tok = r2.json().get("session_token") or r2.json().get("token")
        cache[ADMIN_PHONE] = tok
        CACHE.write_text(json.dumps(cache))
        return tok
    raise RuntimeError("admin login failed")


def _mess_owner_login_token(mess_id: str, owner_phone: str) -> str:
    for _ in range(3):
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": owner_phone}, timeout=15)
        if r.status_code == 429:
            time.sleep(60)
            continue
        assert r.status_code == 200, r.text
        otp = r.json()["dev_otp"]
        break
    r2 = requests.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": owner_phone, "otp": otp, "name": "Owner", "mess_id": mess_id},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    j = r2.json()
    assert j["user"]["role"] == "mess_owner", f"expected mess_owner, got {j['user']['role']}"
    return j.get("session_token") or j.get("token")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_admin_token()}"}


@pytest.fixture(scope="module")
def owner_ctx(admin_headers):
    owner_phone = f"95{int(time.time()) % 100000000:08d}"
    body = {
        "name": f"Wave2Mess {uuid.uuid4().hex[:6]}",
        "slug": f"wave2-{uuid.uuid4().hex[:8]}",
        "owner_phone": owner_phone,
        "city": "Testville",
        "state": "MH",
        "pincode": "440001",
        "address": "Wave2 testing",
        "is_franchise": True,
    }
    r = requests.post(f"{BASE_URL}/api/admin/messes", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    mess_id = r.json()["mess_id"]
    tok = _mess_owner_login_token(mess_id, owner_phone)
    return mess_id, {"Authorization": f"Bearer {tok}"}


# ---------------- #2 TAKEAWAY PENDENCY ----------------

def test_takeaway_pendency_get(owner_ctx):
    _, h = owner_ctx
    r = requests.get(f"{BASE_URL}/api/admin/restaurant/takeaway-pendency", headers=h, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"


def test_takeaway_pendency_manual(owner_ctx):
    _, h = owner_ctx
    r = requests.post(
        f"{BASE_URL}/api/admin/restaurant/takeaway-pendency/manual",
        headers=h,
        json={"name": "Test", "phone": "9999999999", "tiffin_count": 1},
        timeout=15,
    )
    assert r.status_code != 403, f"role blocked: {r.status_code} {r.text}"
    assert r.status_code in (200, 400, 422), f"{r.status_code} {r.text}"


def test_takeaway_pendency_collect(owner_ctx):
    _, h = owner_ctx
    r = requests.post(
        f"{BASE_URL}/api/admin/restaurant/takeaway-pendency/collect",
        headers=h,
        json={"pendency_id": "nonexistent-id"},
        timeout=15,
    )
    # Not 403 = role check widened; 404/400 acceptable
    assert r.status_code != 403, f"role blocked: {r.status_code} {r.text}"
    assert r.status_code in (200, 400, 404, 422), f"{r.status_code} {r.text}"


# ---------------- #9 TIFFIN DELIVERY ----------------

def test_delivery_today(owner_ctx):
    _, h = owner_ctx
    r = requests.get(f"{BASE_URL}/api/admin/delivery/today", headers=h, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"


# ---------------- CASH COLLECTIONS ----------------

def test_pending_cash(owner_ctx):
    _, h = owner_ctx
    r = requests.get(f"{BASE_URL}/api/admin/payments/pending-cash", headers=h, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"


def test_kiosk_staff_cash_pendency(owner_ctx):
    _, h = owner_ctx
    r = requests.get(f"{BASE_URL}/api/admin/kiosk/staff-cash-pendency", headers=h, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"


# ---------------- PARTIAL PAYMENTS ----------------

def test_cash_collect_assign(owner_ctx):
    _, h = owner_ctx
    r = requests.post(
        f"{BASE_URL}/api/admin/payments/cash-collect/assign",
        headers=h,
        json={"user_id": "nonexistent", "amount": 100},
        timeout=15,
    )
    assert r.status_code != 403, f"role blocked: {r.status_code} {r.text}"
    assert r.status_code in (200, 400, 404, 422), f"{r.status_code} {r.text}"


def test_cash_collect_resend_otp(owner_ctx):
    _, h = owner_ctx
    r = requests.post(
        f"{BASE_URL}/api/admin/payments/cash-collect/resend-otp",
        headers=h,
        json={"collection_id": "nonexistent"},
        timeout=15,
    )
    assert r.status_code != 403, f"role blocked: {r.status_code} {r.text}"
    assert r.status_code in (200, 400, 404, 422), f"{r.status_code} {r.text}"
