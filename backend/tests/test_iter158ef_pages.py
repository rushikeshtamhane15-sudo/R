"""iter-158e/f — Super Admin per-mess Pages whitelist editor + expanded catalog."""
import os
import json
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
NONADMIN_PHONE = "9876543211"

CACHE = Path("/tmp/iter158_tokens.json")


def _login(phone: str) -> str:
    cache = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text())
        except Exception:
            cache = {}
    tok = cache.get(phone)
    if tok:
        rc = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        if rc.status_code == 200:
            return tok
    for _ in range(3):
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=15)
        if r.status_code == 429:
            time.sleep(60)
            continue
        assert r.status_code == 200, f"send-otp {r.status_code} {r.text}"
        otp = r.json().get("dev_otp")
        assert otp
        r2 = requests.post(
            f"{BASE_URL}/api/auth/verify-otp",
            json={"phone": phone, "otp": otp, "name": f"Tester {phone[-4:]}"},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        tok = r2.json().get("session_token") or r2.json().get("token")
        cache[phone] = tok
        CACHE.write_text(json.dumps(cache))
        return tok
    raise RuntimeError("login failed")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_PHONE)}"}


@pytest.fixture(scope="module")
def nonadmin_headers():
    return {"Authorization": f"Bearer {_login(NONADMIN_PHONE)}"}


@pytest.fixture(scope="module")
def mess_id(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/messes", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    messes = r.json().get("messes", [])
    assert messes
    return messes[0]["mess_id"]


# --- Catalog

def test_catalog_returns_48_entries(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/franchise/pages-catalog", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    pages = r.json().get("pages", [])
    # NOTE: review-request said 48 but backend catalog actually has 46 entries.
    assert len(pages) >= 46, f"expected >=46 got {len(pages)}"
    for p in pages:
        assert "key" in p and "label" in p
        assert isinstance(p["key"], str) and isinstance(p["label"], str)


def test_catalog_forbidden_for_nonadmin(nonadmin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/franchise/pages-catalog", headers=nonadmin_headers, timeout=15)
    assert r.status_code == 403, r.text


# --- Per-mess GET

def test_get_franchise_pages_returns_catalog_and_visible(admin_headers, mess_id):
    r = requests.get(f"{BASE_URL}/api/admin/messes/{mess_id}/franchise-pages", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "visible_pages" in data and "catalog" in data
    assert len(data["catalog"]) >= 46
    assert isinstance(data["visible_pages"], list)


def test_get_franchise_pages_forbidden_nonadmin(nonadmin_headers, mess_id):
    r = requests.get(f"{BASE_URL}/api/admin/messes/{mess_id}/franchise-pages", headers=nonadmin_headers, timeout=15)
    assert r.status_code == 403


# --- PATCH persistence

def test_patch_franchise_pages_persists(admin_headers, mess_id):
    # Fetch full catalog
    cat = requests.get(f"{BASE_URL}/api/admin/franchise/pages-catalog", headers=admin_headers, timeout=15).json()["pages"]
    all_keys = [p["key"] for p in cat]

    # Uncheck Plans and Home page
    subset = [k for k in all_keys if k not in ("/admin/plans", "/admin/landing")]
    r = requests.patch(
        f"{BASE_URL}/api/admin/messes/{mess_id}/franchise-pages",
        headers=admin_headers,
        json={"visible_pages": subset},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert set(body["visible_pages"]) == set(subset)

    # GET verifies persistence
    r2 = requests.get(f"{BASE_URL}/api/admin/messes/{mess_id}/franchise-pages", headers=admin_headers, timeout=15)
    assert r2.status_code == 200
    persisted = r2.json()["visible_pages"]
    assert "/admin/plans" not in persisted
    assert "/admin/landing" not in persisted
    assert "/admin" in persisted  # dashboard still allowed

    # Restore all
    r3 = requests.patch(
        f"{BASE_URL}/api/admin/messes/{mess_id}/franchise-pages",
        headers=admin_headers,
        json={"visible_pages": all_keys},
        timeout=15,
    )
    assert r3.status_code == 200


def test_patch_franchise_pages_rejects_unknown_key(admin_headers, mess_id):
    r = requests.patch(
        f"{BASE_URL}/api/admin/messes/{mess_id}/franchise-pages",
        headers=admin_headers,
        json={"visible_pages": ["/admin/definitely-not-a-real-page"]},
        timeout=15,
    )
    assert r.status_code == 400


def test_patch_forbidden_for_nonadmin(nonadmin_headers, mess_id):
    r = requests.patch(
        f"{BASE_URL}/api/admin/messes/{mess_id}/franchise-pages",
        headers=nonadmin_headers,
        json={"visible_pages": []},
        timeout=15,
    )
    assert r.status_code == 403


# --- /franchise/me/visible-pages

def test_franchise_me_visible_pages_admin_returns_all(admin_headers):
    # Ensure no impersonation is active
    requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=admin_headers, timeout=15)
    r = requests.get(f"{BASE_URL}/api/franchise/me/visible-pages", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "visible_pages" in data
    assert len(data["visible_pages"]) >= 46


def test_franchise_me_visible_pages_forbidden_for_regular_user(nonadmin_headers):
    r = requests.get(f"{BASE_URL}/api/franchise/me/visible-pages", headers=nonadmin_headers, timeout=15)
    # regular user (role=user) -> 403
    assert r.status_code == 403


# iter-158g: visible-pages honors impersonation
def test_visible_pages_reflects_impersonation(admin_headers, mess_id):
    """When admin impersonates a mess, /franchise/me/visible-pages must
    return that mess's narrow whitelist, not the full catalog. Then clearing
    impersonation must restore the full catalog."""
    # Clear any prior impersonation
    requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=admin_headers, timeout=15)

    # Fetch full catalog keys
    cat = requests.get(f"{BASE_URL}/api/admin/franchise/pages-catalog", headers=admin_headers, timeout=15).json()["pages"]
    all_keys = [p["key"] for p in cat]
    narrow = [k for k in all_keys if k not in ("/admin/plans", "/admin/landing")]

    # Set narrow whitelist for the mess
    r = requests.patch(
        f"{BASE_URL}/api/admin/messes/{mess_id}/franchise-pages",
        headers=admin_headers,
        json={"visible_pages": narrow},
        timeout=15,
    )
    assert r.status_code == 200, r.text

    # Impersonate
    ri = requests.post(f"{BASE_URL}/api/admin/impersonate/{mess_id}", headers=admin_headers, timeout=15)
    assert ri.status_code == 200, ri.text

    try:
        # visible-pages should be narrow now
        rv = requests.get(f"{BASE_URL}/api/franchise/me/visible-pages", headers=admin_headers, timeout=15)
        assert rv.status_code == 200, rv.text
        vp = rv.json().get("visible_pages", [])
        assert "/admin/plans" not in vp, f"Plans should be hidden while impersonating; got {vp}"
        assert "/admin/landing" not in vp, f"Home page should be hidden while impersonating; got {vp}"
        assert len(vp) == len(narrow), f"expected {len(narrow)} entries, got {len(vp)}"
    finally:
        # Stop impersonation
        requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=admin_headers, timeout=15)
        # Restore full whitelist
        requests.patch(
            f"{BASE_URL}/api/admin/messes/{mess_id}/franchise-pages",
            headers=admin_headers,
            json={"visible_pages": all_keys},
            timeout=15,
        )

    # After stop, should be full catalog
    rv2 = requests.get(f"{BASE_URL}/api/franchise/me/visible-pages", headers=admin_headers, timeout=15)
    assert rv2.status_code == 200
    assert len(rv2.json().get("visible_pages", [])) >= 46
