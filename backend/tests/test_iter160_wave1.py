"""iter-160 Wave-1 fixes:
- Widened mess_owner rights on previously admin-only endpoints
- x-mess-id header scoping for public content GET
"""
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
    """OTP login as a fresh phone that owns `mess_id` (auto-promotes to mess_owner via iter-158h)."""
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
    assert j["user"]["role"] == "mess_owner", f"expected auto-promote, got {j['user']['role']}"
    return j.get("session_token") or j.get("token")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_admin_token()}"}


@pytest.fixture(scope="module")
def owner_ctx(admin_headers):
    """Create a fresh mess with a fresh owner_phone, log in the owner to
    auto-promote to mess_owner, return (mess_id, headers)."""
    import uuid
    owner_phone = f"94{int(time.time()) % 100000000:08d}"
    body = {
        "name": f"WaveTestMess {uuid.uuid4().hex[:6]}",
        "slug": f"wave-{uuid.uuid4().hex[:8]}",
        "owner_phone": owner_phone,
        "city": "Testville",
        "state": "MH",
        "pincode": "440001",
        "address": "Wave testing",
        "is_franchise": True,
    }
    r = requests.post(f"{BASE_URL}/api/admin/messes", headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    mess_id = r.json()["mess_id"]
    tok = _mess_owner_login_token(mess_id, owner_phone)
    return mess_id, {"Authorization": f"Bearer {tok}"}


# --- Widened endpoints — must return 2xx for mess_owner ---

def test_admin_theme_post_allows_mess_owner(owner_ctx):
    _, h = owner_ctx
    r = requests.post(f"{BASE_URL}/api/admin/theme", headers=h, json={"tokens": {}}, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"


def test_admin_theme_reset_allows_mess_owner(owner_ctx):
    _, h = owner_ctx
    r = requests.post(f"{BASE_URL}/api/admin/theme/reset", headers=h, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"


def test_admin_menu_post_allows_mess_owner(owner_ctx):
    _, h = owner_ctx
    r = requests.post(
        f"{BASE_URL}/api/admin/menu",
        headers=h,
        json={"menu_date": "2026-01-20", "lunch_items": ["dal", "rice"], "dinner_items": ["roti", "sabzi"]},
        timeout=15,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"


def test_admin_dashboard_config_patch_allows_mess_owner(owner_ctx):
    _, h = owner_ctx
    r = requests.patch(
        f"{BASE_URL}/api/admin/dashboard/config",
        headers=h,
        json={"texts": {}},
        timeout=15,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"


def test_restaurant_theme_put_allows_mess_owner(owner_ctx):
    _, h = owner_ctx
    # Get current then put back
    r0 = requests.get(f"{BASE_URL}/api/restaurant/theme", timeout=15)
    body = r0.json() if r0.status_code == 200 else {}
    body.pop("_id", None)
    r = requests.put(f"{BASE_URL}/api/admin/restaurant/theme", headers=h, json=body or {"hero_title": "Test"}, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"


def test_restaurant_menu_get_put_allows_mess_owner(owner_ctx):
    _, h = owner_ctx
    r = requests.get(f"{BASE_URL}/api/admin/restaurant/menu", headers=h, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    r2 = requests.put(
        f"{BASE_URL}/api/admin/restaurant/menu",
        headers=h,
        json={"items": []},
        timeout=15,
    )
    assert r2.status_code in (200, 400), f"{r2.status_code} {r2.text}"  # 400 acceptable if schema demands more


def test_meal_slots_put_allows_mess_owner(owner_ctx):
    _, h = owner_ctx
    # Try GET first if available
    rg = requests.get(f"{BASE_URL}/api/admin/meal-slots", headers=h, timeout=15)
    # PUT some payload
    payload = {
        "lunch": {"open": "11:30", "close": "14:30"},
        "dinner": {"open": "19:00", "close": "22:00"},
    }
    r = requests.put(f"{BASE_URL}/api/admin/meal-slots", headers=h, json=payload, timeout=15)
    # Key check: role not blocked (200 or 400/422 schema issue OK — 403 = fail)
    assert r.status_code != 403, f"role blocked: {r.status_code} {r.text}"
    assert r.status_code in (200, 400, 422), f"unexpected {r.status_code} {r.text}"


def test_pnl_expenses_allows_mess_owner(owner_ctx):
    _, h = owner_ctx
    rg = requests.get(f"{BASE_URL}/api/admin/pnl/expenses", headers=h, timeout=15)
    assert rg.status_code == 200, f"{rg.status_code} {rg.text}"
    rp = requests.put(
        f"{BASE_URL}/api/admin/pnl/expenses",
        headers=h,
        json={"expenses": {}},
        timeout=15,
    )
    assert rp.status_code in (200, 400), f"expected not 403; got {rp.status_code} {rp.text}"
    assert rp.status_code != 403


# --- x-mess-id content scoping (item #11) ---

def test_content_footer_scoped_per_mess(owner_ctx):
    mess_id, h = owner_ctx
    unique_brand = f"MyMess-{int(time.time())}"

    r = requests.post(
        f"{BASE_URL}/api/admin/content/footer",
        headers=h,
        json={"data": {"brand_name": unique_brand}},
        timeout=15,
    )
    assert r.status_code == 200, r.text

    # GET without header -> should NOT return our custom brand
    r_no = requests.get(f"{BASE_URL}/api/content/footer", timeout=15)
    assert r_no.status_code == 200, r_no.text
    assert r_no.json().get("brand_name") != unique_brand, r_no.json()

    # GET with header -> returns mess-scoped
    r_with = requests.get(
        f"{BASE_URL}/api/content/footer",
        headers={"x-mess-id": mess_id},
        timeout=15,
    )
    assert r_with.status_code == 200, r_with.text
    assert r_with.json().get("brand_name") == unique_brand, r_with.json()
