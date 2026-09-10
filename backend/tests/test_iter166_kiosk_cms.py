"""iter-166 — Wall-Kiosk CMS per-mess scoping.

Invariants tested:
  * GET /api/kiosk/cms returns platform DEFAULTS when nothing customised.
  * GET /api/kiosk/cms?mess_id=UNKNOWN falls back to defaults (never 404).
  * GET /api/admin/kiosk/cms requires auth (401/403).
  * Super-admin PUT (no impersonation) writes to global doc — anon GET reflects.
  * Super-admin PUT with impersonation writes to per-mess doc — global anon GET
    unchanged (isolation invariant).
  * POST /reset scoped to caller's scope.
  * Empty string writes fall back to default; partial updates preserve prior fields.
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
CACHE = Path("/tmp/iter158_tokens.json")

DEFAULT_BRAND_NAME = "efoodcare"
DEFAULT_TAGLINE = "ghar se accha khana"
CMS_KEYS = (
    "brand_name",
    "brand_tagline",
    "pure_veg_label",
    "greeting_lunch_hi",
    "greeting_lunch_en",
    "greeting_dinner_hi",
    "greeting_dinner_en",
)


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


def _reset_global(admin_headers):
    """Restore global kiosk_cms doc to defaults."""
    requests.post(f"{BASE_URL}/api/admin/kiosk/cms/reset", headers=admin_headers, timeout=15)


def _reset_mess(admin_headers, mess_id):
    _impersonate(admin_headers, mess_id)
    try:
        requests.post(f"{BASE_URL}/api/admin/kiosk/cms/reset", headers=admin_headers, timeout=15)
    finally:
        _clear_imp(admin_headers)


# ---------------------------------------------------------------------------
# 1. Anonymous GET returns defaults + all expected keys
# ---------------------------------------------------------------------------
def test_anon_cms_returns_all_keys():
    r = requests.get(f"{BASE_URL}/api/kiosk/cms", timeout=15)
    assert r.status_code == 200
    body = r.json()
    for k in CMS_KEYS:
        assert k in body, f"missing key: {k}"
        assert isinstance(body[k], str) and body[k], f"empty value for: {k}"
    # {name} placeholder present in all 4 greetings
    for k in ("greeting_lunch_hi", "greeting_lunch_en", "greeting_dinner_hi", "greeting_dinner_en"):
        assert "{name}" in body[k], f"{{name}} placeholder missing in {k}: {body[k]}"


def test_anon_cms_unknown_mess_falls_back():
    r = requests.get(f"{BASE_URL}/api/kiosk/cms?mess_id=zzz-unknown-tenant", timeout=15)
    assert r.status_code == 200
    body = r.json()
    for k in CMS_KEYS:
        assert body.get(k), f"missing {k}"


# ---------------------------------------------------------------------------
# 2. Admin GET requires auth
# ---------------------------------------------------------------------------
def test_admin_get_requires_auth():
    r = requests.get(f"{BASE_URL}/api/admin/kiosk/cms", timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_admin_get_super_admin_ok(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/kiosk/cms", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # super-admin without impersonation → mess_id is None (global scope)
    assert body.get("mess_id") in (None, ""), f"expected None mess_id for super-admin, got {body.get('mess_id')}"
    for k in CMS_KEYS:
        assert k in body


# ---------------------------------------------------------------------------
# 3. Super-admin PUT (no impersonation) writes global — anon GET reflects.
# ---------------------------------------------------------------------------
def test_super_admin_global_put_reflects_in_anon(admin_headers):
    marker = f"efoodcare-global-iter166-{uuid.uuid4().hex[:6]}"
    try:
        r = requests.put(
            f"{BASE_URL}/api/admin/kiosk/cms",
            headers=admin_headers,
            json={"brand_name": marker},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("brand_name") == marker
        assert body.get("mess_id") in (None, "")

        # Anonymous GET reflects global change
        r_anon = requests.get(f"{BASE_URL}/api/kiosk/cms", timeout=15)
        assert r_anon.json().get("brand_name") == marker
    finally:
        # Restore global default
        requests.post(f"{BASE_URL}/api/admin/kiosk/cms/reset", headers=admin_headers, timeout=15)
        r_final = requests.get(f"{BASE_URL}/api/kiosk/cms", timeout=15)
        assert r_final.json().get("brand_name") == DEFAULT_BRAND_NAME


# ---------------------------------------------------------------------------
# 4. Impersonated PUT writes per-mess doc — global anon unchanged. (KEY invariant)
# ---------------------------------------------------------------------------
def test_mess_owner_put_isolated_from_global(admin_headers, test_mess_id):
    # capture global before
    r_before = requests.get(f"{BASE_URL}/api/kiosk/cms", timeout=15)
    global_before = r_before.json()

    _impersonate(admin_headers, test_mess_id)
    try:
        marker_brand = f"Amravati Mess {uuid.uuid4().hex[:5]}"
        marker_greet_hi = "नमस्ते {name}, आपका लंच तैयार है।"
        r_put = requests.put(
            f"{BASE_URL}/api/admin/kiosk/cms",
            headers=admin_headers,
            json={
                "brand_name": marker_brand,
                "brand_tagline": "khana khazana",
                "greeting_lunch_hi": marker_greet_hi,
            },
            timeout=15,
        )
        assert r_put.status_code == 200, r_put.text
        body = r_put.json()
        assert body.get("mess_id") == test_mess_id
        assert body.get("brand_name") == marker_brand

        # mess-scoped anon GET returns the override
        r_scoped = requests.get(f"{BASE_URL}/api/kiosk/cms?mess_id={test_mess_id}", timeout=15)
        assert r_scoped.status_code == 200
        sb = r_scoped.json()
        assert sb["brand_name"] == marker_brand
        assert sb["brand_tagline"] == "khana khazana"
        assert sb["greeting_lunch_hi"] == marker_greet_hi
        # non-overridden fields inherit from global (defaults)
        assert sb["greeting_dinner_en"] == global_before["greeting_dinner_en"]

        # anon global GET (no mess_id) UNCHANGED — the crucial isolation check
        r_anon = requests.get(f"{BASE_URL}/api/kiosk/cms", timeout=15)
        assert r_anon.status_code == 200
        assert r_anon.json() == global_before, (
            f"mess-owner write LEAKED to global. before={global_before} after={r_anon.json()}"
        )
    finally:
        _reset_mess(admin_headers, test_mess_id)


# ---------------------------------------------------------------------------
# 5. Reset scoped to caller (mess-scoped reset does not clear global)
# ---------------------------------------------------------------------------
def test_reset_scoped_to_caller(admin_headers, test_mess_id):
    # Set a global marker
    global_marker = f"global-iter166-{uuid.uuid4().hex[:5]}"
    try:
        requests.put(
            f"{BASE_URL}/api/admin/kiosk/cms",
            headers=admin_headers,
            json={"brand_tagline": global_marker},
            timeout=15,
        )
        # Set a mess marker
        _impersonate(admin_headers, test_mess_id)
        try:
            mess_marker = f"mess-iter166-{uuid.uuid4().hex[:5]}"
            requests.put(
                f"{BASE_URL}/api/admin/kiosk/cms",
                headers=admin_headers,
                json={"brand_tagline": mess_marker},
                timeout=15,
            )
            # Now reset (still impersonated) → clears mess doc only
            r_reset = requests.post(
                f"{BASE_URL}/api/admin/kiosk/cms/reset",
                headers=admin_headers,
                timeout=15,
            )
            assert r_reset.status_code == 200
            # mess-scoped GET now falls back to global marker
            r_scoped = requests.get(
                f"{BASE_URL}/api/kiosk/cms?mess_id={test_mess_id}", timeout=15
            )
            assert r_scoped.json()["brand_tagline"] == global_marker
        finally:
            _clear_imp(admin_headers)

        # Global still intact
        r_anon = requests.get(f"{BASE_URL}/api/kiosk/cms", timeout=15)
        assert r_anon.json()["brand_tagline"] == global_marker
    finally:
        # Cleanup: restore global default
        requests.post(f"{BASE_URL}/api/admin/kiosk/cms/reset", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 6. Empty string = inherit; partial updates preserve
# ---------------------------------------------------------------------------
def test_empty_string_inherits_default(admin_headers, test_mess_id):
    _impersonate(admin_headers, test_mess_id)
    try:
        # First set a custom brand_name
        requests.put(
            f"{BASE_URL}/api/admin/kiosk/cms",
            headers=admin_headers,
            json={"brand_name": "TempMessBrand"},
            timeout=15,
        )
        # Now overwrite with empty string → should fall back to default
        r = requests.put(
            f"{BASE_URL}/api/admin/kiosk/cms",
            headers=admin_headers,
            json={"brand_name": ""},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["brand_name"] == DEFAULT_BRAND_NAME
    finally:
        _reset_mess(admin_headers, test_mess_id)


def test_partial_update_preserves_other_fields(admin_headers, test_mess_id):
    _impersonate(admin_headers, test_mess_id)
    try:
        requests.put(
            f"{BASE_URL}/api/admin/kiosk/cms",
            headers=admin_headers,
            json={"brand_name": "MessA", "brand_tagline": "TagA"},
            timeout=15,
        )
        # Second PUT only changes brand_tagline
        r = requests.put(
            f"{BASE_URL}/api/admin/kiosk/cms",
            headers=admin_headers,
            json={"brand_tagline": "TagB"},
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["brand_name"] == "MessA", "brand_name was clobbered"
        assert body["brand_tagline"] == "TagB"
    finally:
        _reset_mess(admin_headers, test_mess_id)


def test_put_empty_payload_rejected(admin_headers):
    r = requests.put(
        f"{BASE_URL}/api/admin/kiosk/cms",
        headers=admin_headers,
        json={},
        timeout=15,
    )
    assert r.status_code == 400
