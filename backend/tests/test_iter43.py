"""Iter-43 backend tests.

Covers:
- POST /api/auth/google/verify rejects invalid credential with 401 (route registered, not 500/404).
- GET /api/restaurant/theme returns 200.
- PUT /api/admin/restaurant/theme accepts new fields `pure_veg_color` and
  `pure_veg_bg_color` (no 422) and persists them.
"""
import os
import time
import pytest
import requests
from pathlib import Path


def _load_backend_url():
    # 1) env var (CI/local), 2) frontend/.env
    val = os.environ.get("REACT_APP_BACKEND_URL")
    if val:
        return val.rstrip("/")
    fenv = Path(__file__).resolve().parent.parent.parent / "frontend" / ".env"
    if fenv.exists():
        for line in fenv.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

ADMIN_PHONE = "9970705391"


def _send_otp(phone):
    return requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)


def _verify_otp(phone, otp, name=None):
    body = {"phone": phone, "otp": otp}
    if name:
        body["name"] = name
    return requests.post(f"{API}/auth/verify-otp", json=body, timeout=15)


@pytest.fixture(scope="module")
def admin_token():
    """Login as admin via dev OTP. Tolerate 429 rate-limit by waiting briefly."""
    for attempt in range(2):
        r = _send_otp(ADMIN_PHONE)
        if r.status_code == 200:
            break
        if r.status_code == 429 and attempt == 0:
            time.sleep(5)
            continue
        pytest.skip(f"send-otp failed: {r.status_code} {r.text[:200]}")
    body = r.json()
    otp = body.get("dev_otp")
    if not otp:
        pytest.skip("dev_otp not present in send-otp response")
    v = _verify_otp(ADMIN_PHONE, otp, name="Iter43 Admin")
    assert v.status_code == 200, f"verify-otp: {v.status_code} {v.text[:200]}"
    data = v.json()
    tok = data.get("token") or data.get("session_token")
    assert tok, f"no token in verify-otp response: {data}"
    role = (data.get("user") or {}).get("role")
    assert role == "admin", f"phone {ADMIN_PHONE} not admin — got role={role}"
    return tok


# -------- Google verify ----------------------------------------------------
class TestGoogleVerify:
    def test_invalid_credential_returns_401(self):
        r = requests.post(
            f"{API}/auth/google/verify",
            json={"credential": "not-a-real-jwt"},
            timeout=15,
        )
        # 401 = bad token; 503 = server has no GOOGLE_CLIENT_ID configured (still valid: route registered, not 500/404)
        assert r.status_code in (401, 503), f"expected 401/503, got {r.status_code} · {r.text[:200]}"
        # MUST NOT be 500 (would mean unhandled exception) or 404 (route not registered)
        assert r.status_code != 500
        assert r.status_code != 404

    def test_missing_credential_returns_422(self):
        r = requests.post(f"{API}/auth/google/verify", json={}, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code}"


# -------- Restaurant theme -------------------------------------------------
class TestRestaurantTheme:
    def test_get_theme_returns_200(self):
        r = requests.get(f"{API}/restaurant/theme", timeout=15)
        assert r.status_code == 200, f"GET theme: {r.status_code} {r.text[:200]}"
        # must be a dict (may be empty if never set)
        assert isinstance(r.json(), dict)

    def test_admin_put_pure_veg_color_fields(self, admin_token):
        # Snapshot existing theme for restoration
        snap_r = requests.get(f"{API}/restaurant/theme", timeout=15)
        original = snap_r.json() if snap_r.status_code == 200 else {}

        try:
            payload = {
                "pure_veg_color": "#057a3a",
                "pure_veg_bg_color": "#ffffff",
            }
            headers = {"Authorization": f"Bearer {admin_token}"}
            r = requests.put(
                f"{API}/admin/restaurant/theme",
                json=payload,
                headers=headers,
                timeout=15,
            )
            assert r.status_code == 200, f"PUT theme: {r.status_code} {r.text[:300]}"
            body = r.json()
            assert body.get("pure_veg_color") == "#057a3a"
            assert body.get("pure_veg_bg_color") == "#ffffff"

            # GET to verify persistence
            g = requests.get(f"{API}/restaurant/theme", timeout=15)
            assert g.status_code == 200
            gbody = g.json()
            assert gbody.get("pure_veg_color") == "#057a3a", f"pure_veg_color not persisted: {gbody}"
            assert gbody.get("pure_veg_bg_color") == "#ffffff", f"pure_veg_bg_color not persisted: {gbody}"
        finally:
            # Restore prior values (or null-out test fields if absent)
            restore = {
                "pure_veg_color": original.get("pure_veg_color") or None,
                "pure_veg_bg_color": original.get("pure_veg_bg_color") or None,
            }
            # exclude_none on the route drops None — so only restore real prior values
            restore = {k: v for k, v in restore.items() if v}
            if restore:
                requests.put(
                    f"{API}/admin/restaurant/theme",
                    json=restore,
                    headers={"Authorization": f"Bearer {admin_token}"},
                    timeout=15,
                )

    def test_admin_put_rejects_unauthenticated(self):
        r = requests.put(
            f"{API}/admin/restaurant/theme",
            json={"pure_veg_color": "#000000"},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"
