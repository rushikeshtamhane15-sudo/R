"""iter-168 — Backend tests for:
  1) POST /api/admin/restaurant/takeaway-pendency/collect accepts a manual
     pendency (user_id=None, mess_id=<mess_owner's mess>) — regression for
     "Pendency not in your branch" 403.
  2) mess_owner GET/PATCH /api/admin/messes/<mess_id>/bottom-nav-slots for
     their OWN mess; 403 on other mess.
  3) mess_owner GET /api/admin/bottom-nav/slot-catalog now 200.
  4) Isolation: mess_owner PATCH bottom-nav-slots does NOT affect
     platform-wide /api/bottom-nav; anonymous /api/franchise/me/bottom-nav-slots
     returns full catalog fallback.
  5) Content/branding/kiosk-cms anon-vs-mess regressions (light smoke).
"""
from __future__ import annotations

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
MESS_OWNER_PHONE = "8421375391"          # user_073485b79a1b
# Login mess (user.mess_id tag) — used in verify-otp payload.
MESS_OWNER_LOGIN_MESS = "efoodcare-amravati"
# Actual mess this user OWNS (messes.owner_user_id = user_073485b79a1b).
# Bottom-nav-slots endpoints resolve via owner_user_id, not user.mess_id.
MESS_OWNER_MESS_ID = "MESS-C0A9"
OTHER_MESS_ID = "MESS-0267"              # different owner (user_934f47b039cc)
CACHE = Path("/tmp/iter158_tokens.json")


def _login(phone: str, mess_id: str | None = None) -> str:
    """Return a session token for a phone. Caches by phone."""
    cache = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text())
        except Exception:
            pass
    tok = cache.get(phone)
    if tok:
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        if r.status_code == 200:
            return tok
    for _ in range(3):
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=15)
        if r.status_code == 429:
            time.sleep(65)
            continue
        otp = r.json()["dev_otp"]
        body = {"phone": phone, "otp": otp}
        if mess_id:
            body["mess_id"] = mess_id
        r2 = requests.post(f"{BASE_URL}/api/auth/verify-otp", json=body, timeout=15)
        assert r2.status_code == 200, r2.text
        tok = r2.json().get("session_token")
        cache[phone] = tok
        CACHE.write_text(json.dumps(cache))
        return tok
    raise RuntimeError("rate-limited")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_PHONE)}"}


@pytest.fixture(scope="module")
def mess_owner_headers():
    return {"Authorization": f"Bearer {_login(MESS_OWNER_PHONE, MESS_OWNER_LOGIN_MESS)}"}


@pytest.fixture(scope="module")
def mess_owner_user(mess_owner_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=mess_owner_headers, timeout=10)
    assert r.status_code == 200, r.text
    u = r.json()
    assert u.get("role") == "mess_owner", f"expected mess_owner, got {u.get('role')}"
    return u


# ---------------------------------------------------------------------------
# 1. Manual takeaway pendency — mess_owner can collect their own mess row
# ---------------------------------------------------------------------------
def test_mess_owner_can_collect_manual_pendency(mess_owner_headers, mess_owner_user):
    # Create a manual pendency as the mess_owner (row.mess_id auto-set to their mess).
    marker = uuid.uuid4().hex[:6]
    r_add = requests.post(
        f"{BASE_URL}/api/admin/restaurant/takeaway-pendency/manual",
        headers=mess_owner_headers,
        json={
            "name": f"iter168-{marker}",
            "phone": "9000000001",
            "address": "-",
            "tiffin_count": 1,
            "notes": "iter168 test",
        },
        timeout=15,
    )
    assert r_add.status_code == 200, r_add.text
    pid = r_add.json()["pendency_id"]

    # Collect it — this was previously 403 "Pendency not in your branch".
    r_col = requests.post(
        f"{BASE_URL}/api/admin/restaurant/takeaway-pendency/collect",
        headers=mess_owner_headers,
        json={"pendency_id": pid, "notes": "iter168-collected"},
        timeout=15,
    )
    assert r_col.status_code == 200, f"expected 200, got {r_col.status_code}: {r_col.text}"
    assert r_col.json().get("ok") is True


def test_mess_owner_403_on_other_mess_manual_pendency(admin_headers, mess_owner_headers):
    """A manual pendency created under OTHER_MESS_ID must NOT be collectable
    by our mess_owner (whose mess is efoodcare-amravati)."""
    # Super-admin impersonates OTHER_MESS_ID and creates a manual pendency there.
    r_imp = requests.post(
        f"{BASE_URL}/api/admin/impersonate/{OTHER_MESS_ID}",
        headers=admin_headers,
        timeout=15,
    )
    assert r_imp.status_code == 200, r_imp.text
    try:
        r_add = requests.post(
            f"{BASE_URL}/api/admin/restaurant/takeaway-pendency/manual",
            headers=admin_headers,
            json={
                "name": "iter168-other-mess",
                "phone": "9000000002",
                "tiffin_count": 1,
            },
            timeout=15,
        )
        assert r_add.status_code == 200, r_add.text
        pid = r_add.json()["pendency_id"]
    finally:
        requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=admin_headers, timeout=15)

    # mess_owner tries to collect it → must be 403.
    r_col = requests.post(
        f"{BASE_URL}/api/admin/restaurant/takeaway-pendency/collect",
        headers=mess_owner_headers,
        json={"pendency_id": pid},
        timeout=15,
    )
    assert r_col.status_code == 403, (
        f"expected 403, got {r_col.status_code}: {r_col.text}"
    )


# ---------------------------------------------------------------------------
# 2. Bottom-nav slot catalog & per-mess slot whitelist
# ---------------------------------------------------------------------------
def test_slot_catalog_accessible_to_mess_owner(mess_owner_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/bottom-nav/slot-catalog",
        headers=mess_owner_headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body.get("slots"), list) and len(body["slots"]) > 0
    for s in body["slots"]:
        assert "key" in s and "label" in s


def test_slot_catalog_requires_auth():
    r = requests.get(f"{BASE_URL}/api/admin/bottom-nav/slot-catalog", timeout=15)
    assert r.status_code in (401, 403)


def test_mess_owner_can_read_own_bottom_nav_slots(mess_owner_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/messes/{MESS_OWNER_MESS_ID}/bottom-nav-slots",
        headers=mess_owner_headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "slots" in body and isinstance(body["slots"], list)
    assert "catalog" in body and isinstance(body["catalog"], list)


def test_mess_owner_403_on_other_mess_bottom_nav_get(mess_owner_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/messes/{OTHER_MESS_ID}/bottom-nav-slots",
        headers=mess_owner_headers,
        timeout=15,
    )
    assert r.status_code == 403, r.text


def test_mess_owner_can_patch_own_bottom_nav_slots(mess_owner_headers, admin_headers):
    # Capture original slots for restoration.
    r_before = requests.get(
        f"{BASE_URL}/api/admin/messes/{MESS_OWNER_MESS_ID}/bottom-nav-slots",
        headers=mess_owner_headers,
        timeout=15,
    )
    original = r_before.json()["slots"]

    # Snapshot global platform bottom-nav BEFORE (isolation invariant).
    r_global_before = requests.get(f"{BASE_URL}/api/bottom-nav", timeout=15)
    global_before_status = r_global_before.status_code
    global_before = r_global_before.json() if r_global_before.status_code == 200 else None

    new_slots = ["home", "scan", "profile"]
    try:
        r_patch = requests.patch(
            f"{BASE_URL}/api/admin/messes/{MESS_OWNER_MESS_ID}/bottom-nav-slots",
            headers=mess_owner_headers,
            json={"slots": new_slots},
            timeout=15,
        )
        assert r_patch.status_code == 200, r_patch.text
        assert r_patch.json().get("slots") == new_slots

        # GET reflects it.
        r_after = requests.get(
            f"{BASE_URL}/api/admin/messes/{MESS_OWNER_MESS_ID}/bottom-nav-slots",
            headers=mess_owner_headers,
            timeout=15,
        )
        assert r_after.json()["slots"] == new_slots

        # Isolation invariant: global bottom-nav untouched.
        r_global_after = requests.get(f"{BASE_URL}/api/bottom-nav", timeout=15)
        if global_before_status == 200:
            assert r_global_after.status_code == 200
            assert r_global_after.json() == global_before, (
                f"mess_owner PATCH leaked to global /api/bottom-nav. "
                f"before={global_before} after={r_global_after.json()}"
            )
    finally:
        # Restore original slots.
        requests.patch(
            f"{BASE_URL}/api/admin/messes/{MESS_OWNER_MESS_ID}/bottom-nav-slots",
            headers=mess_owner_headers,
            json={"slots": original},
            timeout=15,
        )


def test_mess_owner_403_on_other_mess_bottom_nav_patch(mess_owner_headers):
    r = requests.patch(
        f"{BASE_URL}/api/admin/messes/{OTHER_MESS_ID}/bottom-nav-slots",
        headers=mess_owner_headers,
        json={"slots": ["home", "profile"]},
        timeout=15,
    )
    assert r.status_code == 403, r.text


def test_super_admin_full_access_bottom_nav_slots(admin_headers):
    r_get = requests.get(
        f"{BASE_URL}/api/admin/messes/{OTHER_MESS_ID}/bottom-nav-slots",
        headers=admin_headers,
        timeout=15,
    )
    assert r_get.status_code == 200, r_get.text


def test_anonymous_franchise_me_bottom_nav_slots_fallback():
    """Anonymous (no auth) → 401/403 per get_current_user; but if impl allows
    unauth via optional_user, must fall back to full catalog. Assert either
    401/403 OR 200 with the full slot list."""
    r = requests.get(f"{BASE_URL}/api/franchise/me/bottom-nav-slots", timeout=15)
    assert r.status_code in (200, 401, 403), r.text
    if r.status_code == 200:
        assert isinstance(r.json().get("slots"), list)
        assert len(r.json()["slots"]) >= 5  # full catalog fallback


# ---------------------------------------------------------------------------
# 3. Content pages regression — anon returns global defaults; mess_owner PUT
#    is scoped and does NOT leak to anonymous global.
# ---------------------------------------------------------------------------
CONTENT_KEYS = ["footer", "announcement", "contact", "privacy", "refund", "about-us"]


@pytest.mark.parametrize("key", CONTENT_KEYS)
def test_anon_content_returns_something(key):
    r = requests.get(f"{BASE_URL}/api/content/{key}", timeout=15)
    # Accept 200 with body; 404 acceptable only for unseeded keys.
    assert r.status_code in (200, 404), f"{key} → {r.status_code}: {r.text[:200]}"


def test_mess_owner_content_write_isolation(mess_owner_headers):
    """PUT /api/admin/content/announcement as mess_owner scopes to their mess,
    while anonymous /api/content/announcement stays unchanged."""
    key = "announcement"
    r_anon_before = requests.get(f"{BASE_URL}/api/content/{key}", timeout=15)
    if r_anon_before.status_code != 200:
        pytest.skip(f"/api/content/{key} not implemented (status={r_anon_before.status_code})")
    anon_before = r_anon_before.json()

    marker = f"iter168-mess-only-{uuid.uuid4().hex[:6]}"
    r_put = requests.post(
        f"{BASE_URL}/api/admin/content/{key}",
        headers=mess_owner_headers,
        json={"data": {"body": marker, "title": marker}},
        timeout=15,
    )
    if r_put.status_code not in (200, 201):
        pytest.skip(f"POST /api/admin/content/{key} not accepted for mess_owner (status={r_put.status_code}): {r_put.text[:200]}")

    try:
        # Anonymous /api/content/{key} (no session, no mess scope) — must NOT
        # reflect our per-mess override.
        r_anon_after = requests.get(f"{BASE_URL}/api/content/{key}", timeout=15)
        assert r_anon_after.status_code == 200
        after_body_str = json.dumps(r_anon_after.json())
        assert marker not in after_body_str, (
            f"mess_owner content write LEAKED to global anon. marker={marker} "
            f"in body: {after_body_str[:400]}"
        )
        # Full body should still match pre-write (structurally).
        assert r_anon_after.json() == anon_before, (
            "global anon /api/content/announcement changed after mess_owner PUT"
        )
    finally:
        # Reset the mess-owner scope so we don't leave test residue.
        requests.post(
            f"{BASE_URL}/api/admin/content/{key}/reset",
            headers=mess_owner_headers,
            timeout=15,
        )


# ---------------------------------------------------------------------------
# 4. Branding + Kiosk CMS smoke (light regression — full suite is iter166/165).
# ---------------------------------------------------------------------------
def test_anon_branding_default():
    r = requests.get(f"{BASE_URL}/api/branding", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "mess_id" not in body or body.get("mess_id") in (None, "")


def test_scoped_branding_mess_id():
    r = requests.get(f"{BASE_URL}/api/branding?mess_id={MESS_OWNER_MESS_ID}", timeout=15)
    assert r.status_code == 200
    # Should have same shape (logos, etc.). Absence of raise is enough for smoke.


def test_anon_kiosk_cms_defaults():
    r = requests.get(f"{BASE_URL}/api/kiosk/cms", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("brand_name")
    assert body.get("brand_tagline")
