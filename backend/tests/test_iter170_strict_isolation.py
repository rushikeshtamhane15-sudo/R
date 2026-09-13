"""iter-170 — Strict tenant isolation for /content/{key}, /kiosk/cms, /branding.

Invariants:
  * Super-admin PUT (no impersonation) writes to global doc — anon reflects.
  * A mess that has NO override never inherits the super-admin's global doc.
    - GET /api/content/<key>?mess_id=<pristine_mess> → DEFAULT
    - GET /api/kiosk/cms?mess_id=<pristine_mess>     → DEFAULT
    - GET /api/branding?mess_id=<pristine_mess>      → brand_logo_url = ""
  * Mess-owner writes are isolated from global anon.
  * Super-admin logo upload without impersonation reflects globally.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from io import BytesIO
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

CONTENT_KEYS = ("footer", "announcement", "contact", "privacy", "refund", "about", "login")


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
    assert r.status_code == 200, r.text
    ids = [m["mess_id"] for m in r.json().get("messes", [])]
    return "efoodcare-amravati" if "efoodcare-amravati" in ids else ids[0]


def _impersonate(headers, mess_id):
    r = requests.post(f"{BASE_URL}/api/admin/impersonate/{mess_id}", headers=headers, timeout=15)
    assert r.status_code == 200, r.text


def _clear_imp(headers):
    requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=headers, timeout=15)


# ---------------------------------------------------------------------------
# 1. CONTENT strict isolation — global marker doesn't leak to mess without override
# ---------------------------------------------------------------------------
def test_content_footer_strict_isolation(admin_headers, test_mess_id):
    """Super-admin PUT global footer marker; mess (no override) still sees pristine default."""
    marker = f"iter170-{uuid.uuid4().hex[:6]}"

    # Ensure the test mess has NO override for footer (reset it first)
    _impersonate(admin_headers, test_mess_id)
    try:
        requests.post(f"{BASE_URL}/api/admin/content/footer/reset", headers=admin_headers, timeout=15)
    finally:
        _clear_imp(admin_headers)

    # Get pristine default snapshot (anon, before any global write, may be default or already customized)
    # We can't guarantee anon is pristine; so we compare mess-scoped view instead.
    r_default_scope = requests.get(f"{BASE_URL}/api/content/footer?mess_id={test_mess_id}", timeout=15)
    assert r_default_scope.status_code == 200
    default_snapshot = r_default_scope.json()

    # Super-admin PUT (no impersonation) — sets a marker into global
    _clear_imp(admin_headers)
    try:
        r_put = requests.post(
            f"{BASE_URL}/api/admin/content/footer",
            headers=admin_headers,
            json={"data": {"contact_line": marker}},
            timeout=15,
        )
        assert r_put.status_code == 200, r_put.text

        # Anonymous GET reflects the global marker
        r_anon = requests.get(f"{BASE_URL}/api/content/footer", timeout=15)
        assert r_anon.status_code == 200
        assert r_anon.json().get("contact_line") == marker, "global anon should reflect super-admin write"

        # Mess-scoped GET (no override) should NOT return marker — the pristine default.
        r_mess = requests.get(f"{BASE_URL}/api/content/footer?mess_id={test_mess_id}", timeout=15)
        assert r_mess.status_code == 200
        mess_body = r_mess.json()
        assert mess_body.get("contact_line") != marker, (
            f"STRICT ISOLATION LEAK: mess without override inherited super-admin marker. Got {mess_body.get('contact_line')!r}"
        )
        # And matches the pristine default snapshot
        assert mess_body.get("contact_line") == default_snapshot.get("contact_line")
    finally:
        # Reset global footer
        requests.post(f"{BASE_URL}/api/admin/content/footer/reset", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 2. CONTENT — mess-owner write is isolated from anon global
# ---------------------------------------------------------------------------
def test_content_mess_owner_write_isolated(admin_headers, test_mess_id):
    marker = f"messmark-{uuid.uuid4().hex[:6]}"

    # Snapshot global anon before
    r_before = requests.get(f"{BASE_URL}/api/content/footer", timeout=15)
    assert r_before.status_code == 200
    before = r_before.json()

    _impersonate(admin_headers, test_mess_id)
    try:
        r_put = requests.post(
            f"{BASE_URL}/api/admin/content/footer",
            headers=admin_headers,
            json={"data": {"contact_line": marker}},
            timeout=15,
        )
        assert r_put.status_code == 200, r_put.text

        # Mess-scoped GET reflects marker
        r_mess = requests.get(f"{BASE_URL}/api/content/footer?mess_id={test_mess_id}", timeout=15)
        assert r_mess.json().get("contact_line") == marker

        # Anonymous global GET is unchanged
        r_anon = requests.get(f"{BASE_URL}/api/content/footer", timeout=15)
        assert r_anon.json().get("contact_line") == before.get("contact_line"), (
            "mess_owner write LEAKED to global anon"
        )
    finally:
        # reset mess override
        requests.post(f"{BASE_URL}/api/admin/content/footer/reset", headers=admin_headers, timeout=15)
        _clear_imp(admin_headers)


# ---------------------------------------------------------------------------
# 3. All CONTENT keys are addressable and return 200 for mess scope
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("key", CONTENT_KEYS)
def test_content_keys_reachable(key, test_mess_id):
    # Anon
    r_a = requests.get(f"{BASE_URL}/api/content/{key}", timeout=15)
    assert r_a.status_code == 200, f"anon /api/content/{key} → {r_a.status_code}: {r_a.text}"
    # Mess-scoped
    r_m = requests.get(f"{BASE_URL}/api/content/{key}?mess_id={test_mess_id}", timeout=15)
    assert r_m.status_code == 200, f"mess /api/content/{key} → {r_m.status_code}: {r_m.text}"


# ---------------------------------------------------------------------------
# 4. BRANDING strict isolation — super-admin logo upload, mess without override sees empty
# ---------------------------------------------------------------------------
def _tiny_png_bytes() -> bytes:
    # 1x1 transparent PNG
    import base64 as b64
    return b64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )


def test_branding_strict_isolation(admin_headers, test_mess_id):
    """Super-admin upload logo (no impersonation) → GET /api/branding reflects.
    GET /api/branding?mess_id=<X> (no per-mess upload) returns empty brand_logo_url (falls back to bundled default at /brand-logo.jpg).
    """
    # Ensure mess has no branding override
    _impersonate(admin_headers, test_mess_id)
    try:
        requests.post(f"{BASE_URL}/api/admin/branding/reset?slot=brand", headers=admin_headers, timeout=15)
    finally:
        _clear_imp(admin_headers)

    # Read mess-scoped BEFORE global write; capture what mess sees when its own doc has no logo.
    r_mess_before = requests.get(f"{BASE_URL}/api/branding?mess_id={test_mess_id}", timeout=15)
    assert r_mess_before.status_code == 200
    mess_before = r_mess_before.json()
    # With strict isolation, mess doc has empty brand_logo_url in _load → public falls back to DEFAULT_BRAND_URL
    assert mess_before.get("brand_logo_url") == "/brand-logo.jpg"
    assert mess_before.get("is_custom") is False

    # Super-admin upload (no impersonation) → global logo set
    _clear_imp(admin_headers)
    files = {"file": ("logo.png", _tiny_png_bytes(), "image/png")}
    r_up = requests.post(
        f"{BASE_URL}/api/admin/branding/logo?slot=brand",
        headers=admin_headers,
        files=files,
        timeout=30,
    )
    assert r_up.status_code == 200, r_up.text
    uploaded_url = r_up.json().get("brand_logo_url")
    assert uploaded_url and uploaded_url.startswith("data:image/"), f"expected data URL, got {uploaded_url!r}"

    try:
        # Anonymous / super-admin GET /api/branding reflects the uploaded URL
        r_anon = requests.get(f"{BASE_URL}/api/branding", timeout=15)
        assert r_anon.status_code == 200
        assert r_anon.json().get("brand_logo_url") == uploaded_url
        assert r_anon.json().get("is_custom") is True

        # Mess-scoped (still no per-mess override) — STRICT ISOLATION: mess must
        # NOT inherit the super-admin logo. Public endpoint fallbacks to
        # /brand-logo.jpg (bundled default).
        r_mess = requests.get(f"{BASE_URL}/api/branding?mess_id={test_mess_id}", timeout=15)
        assert r_mess.status_code == 200
        mb = r_mess.json()
        assert mb.get("brand_logo_url") != uploaded_url, (
            "STRICT ISOLATION LEAK: mess without override inherited super-admin logo"
        )
        assert mb.get("brand_logo_url") == "/brand-logo.jpg"
        assert mb.get("is_custom") is False
    finally:
        # Reset global brand slot
        requests.post(f"{BASE_URL}/api/admin/branding/reset?slot=brand", headers=admin_headers, timeout=15)


# ---------------------------------------------------------------------------
# 5. KIOSK CMS strict isolation — mess without override sees default, NOT global marker
# ---------------------------------------------------------------------------
def test_kiosk_cms_strict_isolation(admin_headers, test_mess_id):
    marker = f"iter170-kiosk-{uuid.uuid4().hex[:5]}"
    # Ensure mess has no override
    _impersonate(admin_headers, test_mess_id)
    try:
        requests.post(f"{BASE_URL}/api/admin/kiosk/cms/reset", headers=admin_headers, timeout=15)
    finally:
        _clear_imp(admin_headers)

    try:
        # Super-admin PUT (no impersonation) — writes global
        r_put = requests.put(
            f"{BASE_URL}/api/admin/kiosk/cms",
            headers=admin_headers,
            json={"brand_name": marker},
            timeout=15,
        )
        assert r_put.status_code == 200, r_put.text

        # Anon GET reflects global marker
        r_anon = requests.get(f"{BASE_URL}/api/kiosk/cms", timeout=15)
        assert r_anon.json().get("brand_name") == marker

        # Mess-scoped GET does NOT inherit — pristine default "efoodcare"
        r_mess = requests.get(f"{BASE_URL}/api/kiosk/cms?mess_id={test_mess_id}", timeout=15)
        assert r_mess.status_code == 200
        assert r_mess.json().get("brand_name") == "efoodcare", (
            f"KIOSK STRICT ISOLATION LEAK: got {r_mess.json().get('brand_name')!r}"
        )
    finally:
        requests.post(f"{BASE_URL}/api/admin/kiosk/cms/reset", headers=admin_headers, timeout=15)
