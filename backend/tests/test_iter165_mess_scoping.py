"""iter-165 — Verify multi-tenant scoping for restaurant theme/menu/categories
+ branding: mess-owner writes must NOT leak into the global (Super Admin) doc.

Uses super-admin impersonation as the mess_owner surrogate (as per iter-163
test pattern) since a real mess_owner login would require SMS OTP with a
seed user.
"""
from __future__ import annotations

import io
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
            pass
    tok = cache.get(ADMIN_PHONE)
    if tok:
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        if r.status_code == 200:
            return tok
    for _ in range(3):
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": ADMIN_PHONE}, timeout=15)
        if r.status_code == 429:
            time.sleep(65)
            continue
        otp = r.json()["dev_otp"]
        r2 = requests.post(
            f"{BASE_URL}/api/auth/verify-otp",
            json={"phone": ADMIN_PHONE, "otp": otp},
            timeout=15,
        )
        tok = r2.json().get("session_token")
        cache[ADMIN_PHONE] = tok
        CACHE.write_text(json.dumps(cache))
        return tok
    raise RuntimeError("rate-limited")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_admin_token()}"}


@pytest.fixture(scope="module")
def test_mess_id(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/messes", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    ids = [m["mess_id"] for m in r.json().get("messes", [])]
    return "efoodcare-amravati" if "efoodcare-amravati" in ids else ids[0]


def _impersonate(headers, mess_id):
    r = requests.post(f"{BASE_URL}/api/admin/impersonate/{mess_id}", headers=headers, timeout=15)
    assert r.status_code == 200, r.text


def _clear_imp(headers):
    requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=headers, timeout=15)


# ---------------------------------------------------------------------------
# 1. Anonymous /restaurant/theme returns global theme (no mess_id key leaks)
# ---------------------------------------------------------------------------
def test_anon_theme_no_param():
    r = requests.get(f"{BASE_URL}/api/restaurant/theme", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "mess_id" not in body
    assert "singleton" not in body


def test_anon_theme_unknown_mess_falls_back():
    r = requests.get(f"{BASE_URL}/api/restaurant/theme?mess_id=zzz-nonexistent", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "mess_id" not in body


# ---------------------------------------------------------------------------
# 2. Anonymous /restaurant/menu returns global menu with items
# ---------------------------------------------------------------------------
def test_anon_menu_has_items():
    r = requests.get(f"{BASE_URL}/api/restaurant/menu", timeout=15)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert len(items) >= 12, f"expected 12+ items, got {len(items)}"


def test_anon_menu_unknown_mess_falls_back():
    r = requests.get(f"{BASE_URL}/api/restaurant/menu?mess_id=zzz-nonexistent", timeout=15)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert len(items) >= 12


# ---------------------------------------------------------------------------
# 3. Anonymous /branding returns global with fallbacks
# ---------------------------------------------------------------------------
def test_anon_branding_returns_defaults():
    r = requests.get(f"{BASE_URL}/api/branding", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("brand_logo_url")
    assert body.get("header_logo_url")


def test_anon_branding_unknown_mess_falls_back():
    r = requests.get(f"{BASE_URL}/api/branding?mess_id=zzz-nonexistent", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("brand_logo_url")


# ---------------------------------------------------------------------------
# 4. Mess-owner scoping: THEME isolation
# ---------------------------------------------------------------------------
def test_theme_mess_owner_write_isolated(admin_headers, test_mess_id):
    # Capture original anon (global) title
    r_before = requests.get(f"{BASE_URL}/api/restaurant/theme", timeout=15)
    original_title = r_before.json().get("hero_title")

    _impersonate(admin_headers, test_mess_id)
    try:
        # Admin GET (impersonation) returns mess_id
        r_adm = requests.get(
            f"{BASE_URL}/api/admin/restaurant/theme",
            headers=admin_headers,
            timeout=15,
        )
        assert r_adm.status_code == 200, r_adm.text
        assert r_adm.json().get("mess_id") == test_mess_id

        marker = f"Test Mess Custom Title Iter-165 {uuid.uuid4().hex[:6]}"
        r_put = requests.put(
            f"{BASE_URL}/api/admin/restaurant/theme",
            headers=admin_headers,
            json={"hero_title": marker},
            timeout=15,
        )
        assert r_put.status_code == 200, r_put.text

        # Mess-scoped GET returns marker
        r_scoped = requests.get(
            f"{BASE_URL}/api/restaurant/theme?mess_id={test_mess_id}",
            timeout=15,
        )
        assert r_scoped.json().get("hero_title") == marker

        # Anonymous global GET still returns original
        r_anon = requests.get(f"{BASE_URL}/api/restaurant/theme", timeout=15)
        assert r_anon.json().get("hero_title") == original_title, (
            f"mess-owner write leaked into global: anon={r_anon.json().get('hero_title')} orig={original_title}"
        )
    finally:
        _clear_imp(admin_headers)


# ---------------------------------------------------------------------------
# 5. Mess-owner MENU isolation
# ---------------------------------------------------------------------------
def test_menu_mess_owner_write_isolated(admin_headers, test_mess_id):
    r_before = requests.get(f"{BASE_URL}/api/restaurant/menu", timeout=15)
    global_items_before = r_before.json().get("items", [])
    global_names_before = sorted([i["name"] for i in global_items_before])

    _impersonate(admin_headers, test_mess_id)
    try:
        marker_id = f"custom_iter165_{uuid.uuid4().hex[:6]}"
        marker_name = f"MessCustomItem-{uuid.uuid4().hex[:6]}"
        # Load existing (per-mess or global fallback) and append a marker
        r_load = requests.get(
            f"{BASE_URL}/api/admin/restaurant/menu",
            headers=admin_headers,
            timeout=15,
        )
        items = r_load.json().get("items", [])
        # Filter out any items that would fail the non-veg gate (legacy defaults
        # like "Chicken 65", "Butter Chicken", "Hara Bhara Kebab" trip the regex).
        _bad = ("chicken", "mutton", "kebab", "fish", "egg", "prawn", "meat")
        items = [i for i in items if not any(b in (i.get("name","") + " " + i.get("description","") + " " + i.get("category","")).lower() for b in _bad)]
        # trim to keep payload small - just append marker
        new_items = items + [{
            "id": marker_id,
            "name": marker_name,
            "description": "iter-165 mess-scoped test item",
            "price": 111.0,
            "category": "Mains",
            "active": True,
            "sort_order": 999,
        }]
        r_put = requests.put(
            f"{BASE_URL}/api/admin/restaurant/menu",
            headers=admin_headers,
            json={"items": new_items},
            timeout=30,
        )
        assert r_put.status_code == 200, r_put.text

        # Mess-scoped GET should include marker
        r_scoped = requests.get(
            f"{BASE_URL}/api/restaurant/menu?mess_id={test_mess_id}",
            timeout=15,
        )
        scoped_names = [i["name"] for i in r_scoped.json().get("items", [])]
        assert marker_name in scoped_names

        # Anonymous global GET must NOT include marker
        r_anon = requests.get(f"{BASE_URL}/api/restaurant/menu", timeout=15)
        anon_names = sorted([i["name"] for i in r_anon.json().get("items", [])])
        assert marker_name not in anon_names, "mess-owner menu write leaked to global"
        assert anon_names == global_names_before, "global menu list changed"
    finally:
        _clear_imp(admin_headers)


# ---------------------------------------------------------------------------
# 6. Mess-owner BRANDING isolation (upload a small PNG)
# ---------------------------------------------------------------------------
def _tiny_png_bytes() -> bytes:
    # 1x1 red PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082"
    )


def test_branding_mess_owner_upload_isolated(admin_headers, test_mess_id):
    r_before = requests.get(f"{BASE_URL}/api/branding", timeout=15)
    global_brand_before = r_before.json().get("brand_logo_url")

    _impersonate(admin_headers, test_mess_id)
    try:
        png = _tiny_png_bytes()
        files = {"file": ("logo.png", io.BytesIO(png), "image/png")}
        r_up = requests.post(
            f"{BASE_URL}/api/admin/branding/logo?slot=brand",
            headers=admin_headers,
            files=files,
            timeout=30,
        )
        assert r_up.status_code == 200, r_up.text
        body = r_up.json()
        assert body.get("mess_id") == test_mess_id
        new_url = body.get("brand_logo_url")
        assert new_url and new_url.startswith("data:")

        # mess-scoped GET returns new URL
        r_scoped = requests.get(f"{BASE_URL}/api/branding?mess_id={test_mess_id}", timeout=15)
        assert r_scoped.json().get("brand_logo_url") == new_url

        # anonymous GET unchanged
        r_anon = requests.get(f"{BASE_URL}/api/branding", timeout=15)
        anon_brand = r_anon.json().get("brand_logo_url")
        assert anon_brand == global_brand_before, (
            f"branding leaked to global: anon={anon_brand[:60]} orig={str(global_brand_before)[:60]}"
        )
    finally:
        _clear_imp(admin_headers)


# ---------------------------------------------------------------------------
# 7. Categories mess-scoping
# ---------------------------------------------------------------------------
def test_categories_mess_scoped(admin_headers, test_mess_id):
    r_global = requests.get(f"{BASE_URL}/api/restaurant/categories", timeout=15)
    global_cats = r_global.json().get("categories", [])

    _impersonate(admin_headers, test_mess_id)
    try:
        r_adm = requests.get(
            f"{BASE_URL}/api/admin/restaurant/categories",
            headers=admin_headers,
            timeout=15,
        )
        assert r_adm.status_code == 200
        assert r_adm.json().get("mess_id") == test_mess_id

        new_cats = list(global_cats) + [f"MessCat-{uuid.uuid4().hex[:5]}"]
        r_put = requests.put(
            f"{BASE_URL}/api/admin/restaurant/categories",
            headers=admin_headers,
            json={"categories": new_cats},
            timeout=15,
        )
        assert r_put.status_code == 200, r_put.text

        r_scoped = requests.get(
            f"{BASE_URL}/api/restaurant/categories?mess_id={test_mess_id}",
            timeout=15,
        )
        assert r_scoped.json().get("categories") == new_cats

        r_anon = requests.get(f"{BASE_URL}/api/restaurant/categories", timeout=15)
        assert r_anon.json().get("categories") == global_cats, "categories leaked to global"
    finally:
        _clear_imp(admin_headers)
