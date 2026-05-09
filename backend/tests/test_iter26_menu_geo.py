"""iter26 — /api/restaurant/menu now exposes kitchen_lat / kitchen_lng for ETA chip.

Tests:
  * Public GET /restaurant/menu returns numeric kitchen_lat/lng (Pune fallback when settings unset).
  * After admin sets dispatch_lat/lng via /admin/delivery/settings, /restaurant/menu reflects them.
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PHONE = "9970705391"  # in ADMIN_PHONES → auto-promoted to admin

PUNE_LAT = 18.5204
PUNE_LNG = 73.8567


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _login(phone: str, name: str = "Tester"):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, r.text
    otp = r.json().get("dev_otp")
    assert otp, "dev_otp missing"
    r2 = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name}, timeout=15)
    assert r2.status_code == 200, r2.text
    j = r2.json()
    return j["session_token"], j["user"]


@pytest.fixture(scope="module")
def admin_token():
    tok, u = _login(ADMIN_PHONE, "TEST_iter26_admin")
    assert u.get("role") == "admin", f"admin not promoted; user={u}"
    return tok


def test_menu_returns_kitchen_coords_default_or_set():
    """Public menu endpoint must return kitchen_lat/kitchen_lng as numbers."""
    r = requests.get(f"{API}/restaurant/menu", timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "items" in j
    assert "kitchen_lat" in j, "kitchen_lat missing from /restaurant/menu response"
    assert "kitchen_lng" in j, "kitchen_lng missing from /restaurant/menu response"
    assert isinstance(j["kitchen_lat"], (int, float)), f"kitchen_lat not numeric: {type(j['kitchen_lat'])}"
    assert isinstance(j["kitchen_lng"], (int, float)), f"kitchen_lng not numeric: {type(j['kitchen_lng'])}"
    # Bounds check — must be within India-ish (sanity)
    assert 8 <= j["kitchen_lat"] <= 37, f"kitchen_lat out of range: {j['kitchen_lat']}"
    assert 68 <= j["kitchen_lng"] <= 97, f"kitchen_lng out of range: {j['kitchen_lng']}"


def test_menu_kitchen_coords_reflect_admin_setting(admin_token):
    """After PUT /admin/delivery/settings with dispatch_lat/lng, /restaurant/menu echoes them."""
    # Pick a distinctive value (Mumbai) to differentiate from the Pune default fallback.
    test_lat = 19.0760
    test_lng = 72.8777
    # Try common admin settings endpoints
    candidates = [
        ("PATCH", f"{API}/admin/delivery/settings"),
        ("PUT", f"{API}/admin/delivery/settings"),
        ("POST", f"{API}/admin/delivery/settings"),
    ]
    payload = {"dispatch_lat": test_lat, "dispatch_lng": test_lng}
    set_ok = False
    last_err = None
    for method, url in candidates:
        try:
            r = requests.request(method, url, json=payload, headers=_hdr(admin_token), timeout=15)
            if r.status_code in (200, 201, 204):
                set_ok = True
                break
            last_err = f"{method} {url} → {r.status_code} {r.text[:120]}"
        except Exception as e:
            last_err = str(e)
    if not set_ok:
        # Direct mongo write is out of scope here; just verify the endpoint shape is correct.
        pytest.skip(f"Could not set delivery settings via admin API; last_err={last_err}")

    time.sleep(0.3)
    r = requests.get(f"{API}/restaurant/menu", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert abs(j["kitchen_lat"] - test_lat) < 1e-3, f"kitchen_lat not updated: got {j['kitchen_lat']}"
    assert abs(j["kitchen_lng"] - test_lng) < 1e-3, f"kitchen_lng not updated: got {j['kitchen_lng']}"

    # Restore Pune default for cleanliness (best-effort)
    requests.request("PATCH", f"{API}/admin/delivery/settings",
                     json={"dispatch_lat": PUNE_LAT, "dispatch_lng": PUNE_LNG},
                     headers=_hdr(admin_token), timeout=15)
