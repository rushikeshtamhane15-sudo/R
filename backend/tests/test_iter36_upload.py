"""Iteration 36 — Admin menu image upload + StaticFiles mount regression tests."""
import io
import os
import struct
import zlib

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
ADMIN_PHONE = "9970705391"  # from /app/backend/.env ADMIN_PHONES
USER_PHONE = "9876543210"   # ordinary user


def _make_tiny_png() -> bytes:
    """Return bytes of a valid 1x1 red PNG (~70 bytes) without depending on PIL."""
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"  # filter byte + RGB pixel
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def _login_via_otp(phone: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=15)
    if r.status_code == 429:
        pytest.skip(f"OTP rate-limited for {phone}")
    assert r.status_code == 200, r.text
    body = r.json()
    otp = body.get("dev_otp")
    assert otp, f"dev_otp missing — body={body}"
    r2 = s.post(f"{BASE_URL}/api/auth/verify-otp", json={"phone": phone, "otp": otp, "name": "Tester"}, timeout=15)
    assert r2.status_code == 200, r2.text
    tok = r2.json().get("session_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def admin_session() -> requests.Session:
    return _login_via_otp(ADMIN_PHONE)


@pytest.fixture(scope="module")
def user_session() -> requests.Session:
    return _login_via_otp(USER_PHONE)


# ---------------- admin upload happy path ----------------
class TestAdminMenuImageUpload:
    def test_admin_login_role(self, admin_session):
        me = admin_session.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert me.status_code == 200, me.text
        assert me.json().get("role") == "admin", me.json()

    def test_upload_returns_url_and_is_get_able(self, admin_session):
        png = _make_tiny_png()
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = admin_session.post(
            f"{BASE_URL}/api/admin/restaurant/menu/upload-image", files=files, timeout=20
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "url" in body and body["url"].startswith("/api/uploads/menu_images/"), body
        assert body["url"].lower().endswith(".png")
        assert body["bytes"] == len(png)

        # GET-back through the StaticFiles mount
        full = f"{BASE_URL}{body['url']}"
        get = requests.get(full, timeout=15)
        assert get.status_code == 200, f"GET {full} → {get.status_code}"
        assert get.headers.get("content-type", "").startswith("image/"), get.headers
        assert get.content == png, "Bytes mismatch on round-trip"

    def test_reject_non_image_mime(self, admin_session):
        files = {"file": ("evil.txt", io.BytesIO(b"hello"), "text/plain")}
        r = admin_session.post(
            f"{BASE_URL}/api/admin/restaurant/menu/upload-image", files=files, timeout=15
        )
        assert r.status_code == 400, r.text

    def test_reject_oversized(self, admin_session):
        big = b"\x00" * (4 * 1024 * 1024 + 1024)  # > 4MB
        files = {"file": ("big.png", io.BytesIO(big), "image/png")}
        r = admin_session.post(
            f"{BASE_URL}/api/admin/restaurant/menu/upload-image", files=files, timeout=30
        )
        assert r.status_code == 413, r.text


# ---------------- 403 for non-admin ----------------
class TestNonAdminForbidden:
    def test_user_role_is_subscriber(self, user_session):
        me = user_session.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert me.status_code == 200
        assert me.json().get("role") != "admin"

    def test_non_admin_upload_403(self, user_session):
        png = _make_tiny_png()
        files = {"file": ("u.png", io.BytesIO(png), "image/png")}
        r = user_session.post(
            f"{BASE_URL}/api/admin/restaurant/menu/upload-image", files=files, timeout=15
        )
        assert r.status_code == 403, r.text

    def test_anonymous_upload_401(self):
        png = _make_tiny_png()
        files = {"file": ("a.png", io.BytesIO(png), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/admin/restaurant/menu/upload-image", files=files, timeout=15
        )
        assert r.status_code in (401, 403), r.text


# ---------------- regressions ----------------
class TestRegressions:
    def test_menu_list(self):
        r = requests.get(f"{BASE_URL}/api/restaurant/menu", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "items" in body and isinstance(body["items"], list) and len(body["items"]) > 0

    def test_theme(self):
        r = requests.get(f"{BASE_URL}/api/restaurant/theme", timeout=15)
        assert r.status_code == 200, r.text
        # theme should at least be a dict (may be empty)
        assert isinstance(r.json(), dict)

    def test_admin_save_menu_roundtrip(self, admin_session):
        # Fetch current menu, save it back unchanged — admin write path still works.
        r = requests.get(f"{BASE_URL}/api/restaurant/menu", timeout=15)
        assert r.status_code == 200
        items = r.json().get("items", [])
        assert items, "Need seeded items"
        payload = {"items": items}
        save = admin_session.put(
            f"{BASE_URL}/api/admin/restaurant/menu", json=payload, timeout=20
        )
        assert save.status_code == 200, save.text
        assert "items" in save.json()
