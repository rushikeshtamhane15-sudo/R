"""Iter-42 backend tests — scan enrichment + admin attendance enrichment +
Pydantic Literal variant + variant_prices override + WebP image upload.

Covers:
- POST /api/attendance/scan returns subscriber_name + subscriber_phone + plan info
- GET /api/admin/attendance/today rows enriched with name/phone/photo
- POST /api/restaurant/order with invalid variant → HTTP 422 (Pydantic Literal)
- MenuItem.variant_prices override applied in _compute_totals
  * multiplier form (1.8x large)
  * absolute form ({"absolute": 650} family)
  * empty dict → default 1x/2x/4x multipliers preserved
- POST /api/admin/restaurant/menu/upload-image → .webp + smaller bytes
- POST /api/admin/landing-promotion/upload-image → .webp
- Regression: /api/restaurant/menu, /theme, /categories, /landing-promotion still work
"""
import io
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_PHONE = "9970705391"     # from ADMIN_PHONES env
USER_PHONE = "9876543210"      # regular subscriber (whose QR is scanned)


# ---------------- shared fixtures ----------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _otp_login(s, phone, name):
    r = s.post(f"{API}/auth/send-otp", json={"phone": phone})
    assert r.status_code == 200, f"send-otp({phone}) failed: {r.status_code} {r.text}"
    otp = r.json().get("dev_otp")
    assert otp, f"no dev_otp for {phone}: {r.json()}"
    r2 = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name})
    assert r2.status_code == 200, f"verify-otp({phone}) failed: {r2.status_code} {r2.text}"
    body = r2.json()
    tok = body.get("session_token") or body.get("token") or body.get("access_token")
    assert tok, f"token missing in verify-otp: {body}"
    return tok, body.get("user", {})


@pytest.fixture(scope="module")
def admin_token():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    tok, user = _otp_login(s, ADMIN_PHONE, "Admin Tester")
    assert user.get("role") == "admin", f"expected admin role, got {user.get('role')}"
    return tok


@pytest.fixture(scope="module")
def admin_sess(admin_token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {admin_token}"})
    return s


@pytest.fixture(scope="module")
def user_token_and_profile():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    tok, user = _otp_login(s, USER_PHONE, "Iter42 Sub")
    return tok, user


@pytest.fixture(scope="module")
def user_sess(user_token_and_profile):
    tok, _ = user_token_and_profile
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def subscriber_qr(user_sess, user_token_and_profile):
    """Read the QR token from /api/my/qr for the regular user."""
    r = user_sess.get(f"{API}/my/qr")
    assert r.status_code == 200, r.text
    body = r.json()
    qr = body.get("qr_token")
    assert qr, f"no qr_token in /my/qr response: {body}"
    _, user_profile = user_token_and_profile
    return qr, user_profile


@pytest.fixture(scope="module")
def active_subscription(user_sess):
    """Ensure the test user has an active dining subscription so scan succeeds.

    Sequence: complete profile → create mock payment order → verify (auto-accepts
    mock orders) → returns the sub_id.
    """
    # 1) Profile (name/phone/address/photo_url required by payment endpoint)
    r = user_sess.post(f"{API}/auth/profile", json={
        "name": "Iter42 Sub",
        "phone": USER_PHONE,
        "address": "TEST_ADDR_iter42",
        "photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    })
    # photo_url field name is "photo_url" — already used above
    if r.status_code != 200:
        pytest.skip(f"profile update failed: {r.status_code} {r.text}")

    # 2) Check if user already has active sub (avoid duplicate)
    rs = user_sess.get(f"{API}/my/subscription")
    if rs.status_code == 200 and rs.json().get("subscription"):
        sub = rs.json()["subscription"]
        if sub.get("status") == "active":
            return sub["sub_id"]

    # 3) Create payment order (uses kiosk_30 default plan)
    r2 = user_sess.post(f"{API}/payments/order", json={"plan_id": "kiosk_30"})
    if r2.status_code != 200:
        # Try premium_60
        r2 = user_sess.post(f"{API}/payments/order", json={"plan_id": "premium_60"})
    assert r2.status_code == 200, f"create order failed: {r2.status_code} {r2.text}"
    order_id = r2.json().get("order_id")
    assert order_id, f"no order_id: {r2.json()}"

    # 4) Verify (mock auto-accepts)
    r3 = user_sess.post(f"{API}/payments/verify", json={
        "order_id": order_id,
        "razorpay_payment_id": "TEST_pay_iter42",
        "razorpay_signature": "TEST_sig_iter42",
    })
    assert r3.status_code == 200, f"verify failed: {r3.status_code} {r3.text}"
    return r3.json().get("sub_id")


# ---------------- 1. Pydantic Literal — invalid variant ----------------
class TestPydanticLiteralVariant:
    def test_invalid_variant_returns_422(self, user_sess):
        r = user_sess.post(f"{API}/restaurant/order", json={
            "items": [{"id": "main_dal_makhani", "qty": 1, "variant": "supersize"}],
        })
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"
        body = r.json()
        # FastAPI validation error shape
        detail = body.get("detail")
        assert isinstance(detail, list) and detail, f"unexpected error shape: {body}"
        msg = str(detail).lower()
        assert "regular" in msg and "large" in msg and "family" in msg, \
            f"422 message should enumerate allowed variants: {detail}"

    def test_valid_variants_still_pass(self, user_sess):
        for v in ("regular", "large", "family"):
            r = user_sess.post(f"{API}/restaurant/order", json={
                "items": [{"id": "main_dal_makhani", "qty": 1, "variant": v}],
            })
            assert r.status_code == 200, f"variant={v}: {r.status_code} {r.text}"


# ---------------- 2. variant_prices override ----------------
class TestVariantPricesOverride:
    """Set/restore variant_prices on a real menu item and confirm pricing math.

    We pick 'main_dal_makhani' (veg, present in default seed) for these tests.
    """
    ITEM_ID = "main_dal_makhani"

    @staticmethod
    def _snapshot_and_patch(admin_sess, patch: dict) -> dict:
        """Fetch admin menu, patch the target item's variant_prices, PUT back.

        Filters out non-veg items first since the veg-gate (iter-40) rejects
        them in admin save, causing 400. Returns the original variant_prices.
        """
        from routes.restaurant import is_non_veg  # local import
        r = admin_sess.get(f"{API}/admin/restaurant/menu")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        # Drop non-veg rows so admin save passes the veg gate
        items = [
            it for it in items
            if not is_non_veg(it.get("name", ""), it.get("description", ""), it.get("category", ""))
        ]
        orig = None
        for it in items:
            if it["id"] == TestVariantPricesOverride.ITEM_ID:
                orig = dict(it.get("variant_prices") or {})
                it["variant_prices"] = patch
                break
        assert orig is not None, "Dal Makhani not found in admin menu"
        r2 = admin_sess.put(f"{API}/admin/restaurant/menu", json={"items": items})
        assert r2.status_code == 200, f"PUT admin menu failed: {r2.status_code} {r2.text}"
        return orig

    @classmethod
    def _restore(cls, admin_sess, orig: dict):
        from routes.restaurant import is_non_veg
        r = admin_sess.get(f"{API}/admin/restaurant/menu")
        items = [
            it for it in r.json()["items"]
            if not is_non_veg(it.get("name", ""), it.get("description", ""), it.get("category", ""))
        ]
        for it in items:
            if it["id"] == cls.ITEM_ID:
                it["variant_prices"] = orig
                break
        admin_sess.put(f"{API}/admin/restaurant/menu", json={"items": items})

    def test_a_multiplier_override_large_1_8x(self, admin_sess, user_sess):
        orig = self._snapshot_and_patch(admin_sess, {"large": 1.8})
        try:
            # Need base price post-PUT
            m = next((x for x in admin_sess.get(f"{API}/admin/restaurant/menu").json()["items"] if x["id"] == self.ITEM_ID))
            base = float(m.get("discounted_price") or m["price"])
            r = user_sess.post(f"{API}/restaurant/order", json={
                "items": [{"id": self.ITEM_ID, "qty": 1, "variant": "large"}],
            })
            assert r.status_code == 200, r.text
            it = r.json()["items"][0]
            assert it["unit_price"] == round(base * 1.8, 2), \
                f"large override 1.8× → unit_price={it['unit_price']} expected {base*1.8}"
            # NOT 2× anymore
            assert it["unit_price"] != round(base * 2, 2)
        finally:
            self._restore(admin_sess, orig)

    def test_b_absolute_override_family_650(self, admin_sess, user_sess):
        orig = self._snapshot_and_patch(admin_sess, {"family": {"absolute": 650}})
        try:
            r = user_sess.post(f"{API}/restaurant/order", json={
                "items": [{"id": self.ITEM_ID, "qty": 1, "variant": "family"}],
            })
            assert r.status_code == 200, r.text
            it = r.json()["items"][0]
            assert it["unit_price"] == 650.0, \
                f"family absolute 650 → unit_price={it['unit_price']} expected 650"
            assert it["line_total"] == 650.0
        finally:
            self._restore(admin_sess, orig)

    def test_c_empty_override_keeps_default_multipliers(self, admin_sess, user_sess):
        orig = self._snapshot_and_patch(admin_sess, {})
        try:
            m = next((x for x in admin_sess.get(f"{API}/admin/restaurant/menu").json()["items"] if x["id"] == self.ITEM_ID))
            base = float(m.get("discounted_price") or m["price"])
            # Large = 2×
            r = user_sess.post(f"{API}/restaurant/order", json={
                "items": [{"id": self.ITEM_ID, "qty": 1, "variant": "large"}],
            })
            assert r.status_code == 200, r.text
            it = r.json()["items"][0]
            assert it["unit_price"] == round(base * 2, 2)
            assert it["portion_multiplier"] == 2
            # Family = 4×
            r2 = user_sess.post(f"{API}/restaurant/order", json={
                "items": [{"id": self.ITEM_ID, "qty": 1, "variant": "family"}],
            })
            it2 = r2.json()["items"][0]
            assert it2["unit_price"] == round(base * 4, 2)
            assert it2["portion_multiplier"] == 4
        finally:
            self._restore(admin_sess, orig)

    def test_d_admin_save_accepts_variant_prices_field(self, admin_sess):
        """PUT /admin/restaurant/menu with variant_prices set should 200."""
        from routes.restaurant import is_non_veg
        r = admin_sess.get(f"{API}/admin/restaurant/menu")
        items = [
            it for it in r.json()["items"]
            if not is_non_veg(it.get("name", ""), it.get("description", ""), it.get("category", ""))
        ]
        orig = {}
        for it in items:
            if it["id"] == self.ITEM_ID:
                orig = dict(it.get("variant_prices") or {})
                it["variant_prices"] = {"large": 1.5, "family": {"absolute": 599}}
        r2 = admin_sess.put(f"{API}/admin/restaurant/menu", json={"items": items})
        assert r2.status_code == 200, r2.text
        # GET back and confirm persistence
        r3 = admin_sess.get(f"{API}/admin/restaurant/menu")
        saved = next(x for x in r3.json()["items"] if x["id"] == self.ITEM_ID)
        assert saved.get("variant_prices", {}).get("large") == 1.5
        assert saved.get("variant_prices", {}).get("family", {}).get("absolute") == 599
        # restore
        self._restore(admin_sess, orig)


# ---------------- 3. QR scan enrichment ----------------
class TestScanEnrichment:
    def test_admin_scan_returns_subscriber_identity(self, admin_sess, subscriber_qr, user_token_and_profile, active_subscription):
        qr, me = subscriber_qr
        _, user_profile = user_token_and_profile
        assert active_subscription, "active subscription seed failed"
        r = admin_sess.post(f"{API}/attendance/scan", json={"qr_token": qr, "meal_type": "lunch"})
        assert r.status_code == 200, f"scan failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert "record" in body
        # Identity enrichment
        assert body.get("subscriber_name") == me.get("name") or body.get("subscriber_name") is not None
        assert body.get("subscriber_phone") == USER_PHONE
        assert body.get("subscriber_user_id") == me.get("user_id")
        # Profile photo key present (may be None)
        assert "profile_photo_url" in body
        # Plan keys present (may be None if no active sub)
        for k in ("plan_name", "meals_left", "meals_total", "wallet_balance"):
            assert k in body, f"missing key {k} in scan response"

    def test_scan_rejects_invalid_qr(self, admin_sess):
        r = admin_sess.post(f"{API}/attendance/scan", json={"qr_token": "TEST_BOGUS_QR", "meal_type": "lunch"})
        assert r.status_code == 404, f"expected 404 for bogus qr, got {r.status_code}"

    def test_scan_requires_staff_or_admin(self, user_sess, subscriber_qr):
        qr, _ = subscriber_qr
        r = user_sess.post(f"{API}/attendance/scan", json={"qr_token": qr, "meal_type": "lunch"})
        assert r.status_code == 403, f"non-staff/admin should get 403, got {r.status_code}"


# ---------------- 4. Admin today attendance enrichment ----------------
class TestAdminTodayAttendance:
    def test_today_attendance_rows_enriched(self, admin_sess):
        r = admin_sess.get(f"{API}/admin/attendance/today")
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body.get("attendance")
        assert isinstance(rows, list), f"expected list, got {type(rows)}"
        # The scan test above creates at least one row for today
        assert len(rows) >= 1, "no attendance rows for today — scan test must run first"
        # Every row should have the 3 enriched keys (even if None for stale users)
        for row in rows:
            assert "subscriber_name" in row
            assert "subscriber_phone" in row
            assert "profile_photo_url" in row
        # At least one row should have non-null name + phone (the one we just scanned)
        with_identity = [r for r in rows if r.get("subscriber_phone")]
        assert with_identity, "no rows carrying subscriber_phone — enrichment broken"

    def test_today_attendance_admin_only(self, user_sess):
        r = user_sess.get(f"{API}/admin/attendance/today")
        assert r.status_code == 403


# ---------------- 5. WebP upload optimization ----------------
def _make_jpg(size=(800, 800)) -> bytes:
    """Build an 800×800 JPEG via PIL for upload tests."""
    from PIL import Image
    im = Image.new("RGB", size, (200, 50, 50))
    # add some variance so JPEG compression doesn't drop it to a few bytes
    for x in range(0, size[0], 40):
        for y in range(0, size[1], 40):
            im.putpixel((x, y), (50, 200, 100))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


class TestWebPUpload:
    def test_menu_image_upload_converts_to_webp(self, admin_token):
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {admin_token}"})
        raw = _make_jpg()
        files = {"file": ("TEST_iter42.jpg", raw, "image/jpeg")}
        r = s.post(f"{API}/admin/restaurant/menu/upload-image", files=files)
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["url"].endswith(".webp"), f"expected .webp url, got {body['url']}"
        # WebP should be smaller than original 800×800 JPEG-quality-92
        assert body["bytes"] < len(raw), \
            f"webp size {body['bytes']} not smaller than original {len(raw)}"
        # GET via static mount should succeed
        r2 = requests.get(f"{BASE_URL}{body['url']}")
        assert r2.status_code == 200
        assert len(r2.content) > 0

    def test_promo_image_upload_converts_to_webp(self, admin_token):
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {admin_token}"})
        raw = _make_jpg(size=(800, 600))
        files = {"file": ("TEST_iter42_promo.jpg", raw, "image/jpeg")}
        r = s.post(f"{API}/admin/landing-promotion/upload-image", files=files)
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["url"].endswith(".webp"), f"expected .webp, got {body['url']}"
        r2 = requests.get(f"{BASE_URL}{body['url']}")
        assert r2.status_code == 200


# ---------------- 6. Regression ----------------
class TestRegression:
    def test_menu(self, session):
        r = session.get(f"{API}/restaurant/menu")
        assert r.status_code == 200
        items = r.json().get("items")
        assert isinstance(items, list) and len(items) > 0

    def test_theme(self, session):
        r = session.get(f"{API}/restaurant/theme")
        assert r.status_code == 200

    def test_categories(self, session):
        r = session.get(f"{API}/restaurant/categories")
        assert r.status_code == 200
        assert isinstance(r.json().get("categories"), list)

    def test_landing_promotion(self, session):
        r = session.get(f"{API}/landing-promotion")
        assert r.status_code == 200
