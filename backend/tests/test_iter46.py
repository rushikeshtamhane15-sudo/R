"""Iter-46 backend tests.

Covers:
- testimonials extraction (public GET + admin auth + admin PUT)
- restaurant theme accepts hero_layout + hero_elements
"""
import os
import time
import pytest
import requests
from pathlib import Path


def _load_backend_url():
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


@pytest.fixture(scope="module")
def admin_token():
    for attempt in range(3):
        r = requests.post(f"{API}/auth/send-otp", json={"phone": ADMIN_PHONE}, timeout=15)
        if r.status_code == 200:
            break
        if r.status_code == 429 and attempt < 2:
            time.sleep(6)
            continue
        pytest.skip(f"send-otp failed: {r.status_code} {r.text[:200]}")
    otp = r.json().get("dev_otp")
    if not otp:
        pytest.skip("dev_otp not in response")
    v = requests.post(f"{API}/auth/verify-otp", json={"phone": ADMIN_PHONE, "otp": otp, "name": "Iter46 Admin"}, timeout=15)
    assert v.status_code == 200
    data = v.json()
    tok = data.get("token") or data.get("session_token")
    assert tok
    assert (data.get("user") or {}).get("role") == "admin"
    return tok


class TestTestimonialsExtraction:
    def test_public_get_returns_200(self):
        r = requests.get(f"{API}/testimonials", timeout=15)
        assert r.status_code == 200, f"got {r.status_code} {r.text[:200]}"
        body = r.json()
        assert "items" in body and isinstance(body["items"], list)

    def test_admin_get_unauthenticated_returns_401(self):
        r = requests.get(f"{API}/admin/testimonials", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_admin_put_with_otp_returns_200(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        # Snapshot existing
        snap = requests.get(f"{API}/admin/testimonials", headers=headers, timeout=15)
        assert snap.status_code == 200
        original_items = snap.json().get("items") or []

        payload = {"items": [{
            "id": "t_iter46_test",
            "name": "Iter46 Tester",
            "role": "QA",
            "quote": "Iter-46 testimonial extraction works.",
            "image_url": "",
            "rating": 5,
            "order": 0,
            "visible": True,
        }]}
        r = requests.put(f"{API}/admin/testimonials", json=payload, headers=headers, timeout=15)
        assert r.status_code == 200, f"PUT testimonials: {r.status_code} {r.text[:300]}"
        body = r.json()
        items = body.get("items") or []
        assert any(t.get("id") == "t_iter46_test" for t in items), f"new testimonial not in response: {items}"

        # GET public should show it (visible=True)
        g = requests.get(f"{API}/testimonials", timeout=15)
        assert g.status_code == 200
        public_items = g.json().get("items") or []
        assert any(t.get("id") == "t_iter46_test" for t in public_items)

        # Restore original list
        if original_items:
            restore_payload = {"items": [{
                "id": it.get("id"),
                "name": it.get("name"),
                "role": it.get("role"),
                "quote": it.get("quote"),
                "image_url": it.get("image_url"),
                "rating": it.get("rating"),
                "order": it.get("order"),
                "visible": it.get("visible"),
            } for it in original_items]}
            requests.put(f"{API}/admin/testimonials", json=restore_payload, headers=headers, timeout=15)


class TestHeroLayoutTheme:
    def test_admin_put_hero_layout_and_elements(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        snap = requests.get(f"{API}/restaurant/theme", timeout=15)
        original = snap.json() if snap.status_code == 200 else {}

        try:
            # NOTE: HeroPanel.jsx renders these element keys: pure_veg_overline, title,
            # hindi_quote, tagline, ninety_min. The problem-statement schema doc has
            # ("pure_veg"/"overline") which is a doc mismatch — backend accepts any keys,
            # but only the above render. Test uses the actually-rendered keys.
            payload = {
                "hero_layout": "centered",
                "hero_elements": [
                    {"key": "title", "visible": True, "align": "center", "x_offset_pct": 0, "y_offset_px": 0},
                    {"key": "tagline", "visible": True, "align": "center", "x_offset_pct": 0, "y_offset_px": 5},
                    {"key": "pure_veg_overline", "visible": True, "align": "left", "x_offset_pct": -10, "y_offset_px": 0},
                ],
            }
            r = requests.put(f"{API}/admin/restaurant/theme", json=payload, headers=headers, timeout=15)
            assert r.status_code == 200, f"PUT theme hero: {r.status_code} {r.text[:300]}"
            body = r.json()
            assert body.get("hero_layout") == "centered"
            assert isinstance(body.get("hero_elements"), list)
            assert len(body["hero_elements"]) == 3
            assert body["hero_elements"][0]["key"] == "title"

            # GET public confirms persistence
            g = requests.get(f"{API}/restaurant/theme", timeout=15)
            assert g.status_code == 200
            gbody = g.json()
            assert gbody.get("hero_layout") == "centered", f"hero_layout not persisted: {gbody}"
            assert len(gbody.get("hero_elements") or []) == 3
        finally:
            # Restore prior hero_layout/hero_elements. Always send explicit values
            # to avoid leaving test data on the live theme. If originals were
            # missing, set hero_layout='default' and hero_elements=[] so HeroPanel
            # falls back to its hard-coded DEFAULT_ELEMENTS list.
            restore = {
                "hero_layout": original.get("hero_layout") if original.get("hero_layout") is not None else "default",
                "hero_elements": original.get("hero_elements") if original.get("hero_elements") is not None else [],
            }
            requests.put(f"{API}/admin/restaurant/theme", json=restore, headers=headers, timeout=15)

    def test_admin_put_hero_layout_unauth_rejected(self):
        r = requests.put(f"{API}/admin/restaurant/theme", json={"hero_layout": "centered"}, timeout=15)
        assert r.status_code in (401, 403)
