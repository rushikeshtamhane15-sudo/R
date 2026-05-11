"""Iter-39 backend tests — restaurant order variant (regular/large/family) feature.

Covers:
- POST /api/restaurant/order with variant=large → portion_multiplier=2, line_total = base*2*qty
- Unknown variant → 400
- Backwards-compat: no variant in payload → defaults to regular
- GET /api/restaurant/orders → each item carries variant + variant_label + portion_multiplier
- Regression: menu, theme, categories endpoints respond
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
TEST_PHONE = "9876543210"


# ---------- shared fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_token(session):
    """OTP DEV login. Returns Bearer token."""
    r = session.post(f"{API}/auth/send-otp", json={"phone": TEST_PHONE})
    assert r.status_code == 200, f"send-otp failed: {r.status_code} {r.text}"
    otp = r.json().get("dev_otp")
    assert otp, f"dev_otp missing in response: {r.json()}"
    r2 = session.post(f"{API}/auth/verify-otp", json={"phone": TEST_PHONE, "otp": otp, "name": "Variant Tester"})
    assert r2.status_code == 200, f"verify-otp failed: {r2.status_code} {r2.text}"
    tok = r2.json().get("session_token") or r2.json().get("token") or r2.json().get("access_token")
    assert tok, f"token missing: {r2.json()}"
    return tok


@pytest.fixture(scope="module")
def auth_session(session, auth_token):
    session.headers.update({"Authorization": f"Bearer {auth_token}"})
    return session


@pytest.fixture(scope="module")
def menu(session):
    r = session.get(f"{API}/restaurant/menu")
    assert r.status_code == 200, r.text
    items = r.json().get("items") or []
    assert len(items) > 0, "No menu items returned"
    return items


# ---------- variant feature ----------
class TestVariantPricing:
    def test_large_variant_doubles_price(self, auth_session, menu):
        bc = next((m for m in menu if m["id"] == "main_butter_chicken"), None)
        assert bc, "Butter Chicken not in menu"
        base = float(bc.get("discounted_price") or bc["price"])

        r = auth_session.post(f"{API}/restaurant/order", json={
            "items": [{"id": "main_butter_chicken", "qty": 1, "variant": "large"}],
            "name": "TEST Variant Large",
            "phone": TEST_PHONE,
            "address": "TEST_ADDR",
        })
        assert r.status_code == 200, f"order failed: {r.status_code} {r.text}"
        data = r.json()
        items = data["items"]
        assert len(items) == 1
        it = items[0]
        assert it["variant"] == "large"
        assert it["variant_label"] == "Large"
        assert it["portion_multiplier"] == 2
        assert it["unit_price"] == round(base * 2, 2), f"unit_price={it['unit_price']} expected {base*2}"
        assert it["line_total"] == round(base * 2 * 1, 2)
        # Persisted: GET orders returns the same shape
        oid = data["order_id"]
        TestVariantPricing._large_oid = oid

    def test_family_variant_4x(self, auth_session, menu):
        m = next((m for m in menu if m["id"] == "main_dal_makhani"), None)
        assert m
        base = float(m.get("discounted_price") or m["price"])
        r = auth_session.post(f"{API}/restaurant/order", json={
            "items": [{"id": "main_dal_makhani", "qty": 2, "variant": "family"}],
        })
        assert r.status_code == 200, r.text
        it = r.json()["items"][0]
        assert it["portion_multiplier"] == 4
        assert it["variant_label"] == "Family"
        assert it["unit_price"] == round(base * 4, 2)
        assert it["line_total"] == round(base * 4 * 2, 2)

    def test_unknown_variant_returns_400(self, auth_session):
        r = auth_session.post(f"{API}/restaurant/order", json={
            "items": [{"id": "main_butter_chicken", "qty": 1, "variant": "supersize"}],
        })
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        body = r.json()
        msg = (body.get("detail") or "").lower()
        assert "variant" in msg or "portion" in msg, f"detail does not mention variant: {body}"

    def test_no_variant_defaults_to_regular(self, auth_session, menu):
        """Backwards compat: omit variant → defaults regular (multiplier=1)."""
        m = next((m for m in menu if m["id"] == "starter_paneer_tikka"), None)
        assert m
        base = float(m.get("discounted_price") or m["price"])
        r = auth_session.post(f"{API}/restaurant/order", json={
            "items": [{"id": "starter_paneer_tikka", "qty": 3}],
        })
        assert r.status_code == 200, r.text
        it = r.json()["items"][0]
        assert it["variant"] == "regular"
        assert it["variant_label"] == "Regular"
        assert it["portion_multiplier"] == 1
        assert it["unit_price"] == round(base, 2)
        assert it["line_total"] == round(base * 3, 2)

    def test_get_orders_carries_variant_fields(self, auth_session):
        r = auth_session.get(f"{API}/restaurant/orders?limit=10")
        assert r.status_code == 200, r.text
        orders = r.json()["orders"]
        # Find any order created in this run carrying our 'large' variant
        large_orders = [o for o in orders if any(i.get("variant") == "large" for i in (o.get("items") or []))]
        assert large_orders, f"No order with large variant found among {len(orders)} orders"
        it = next(i for i in large_orders[0]["items"] if i["variant"] == "large")
        assert it["variant_label"] == "Large"
        assert it["portion_multiplier"] == 2

    def test_mixed_cart_two_variants_same_item(self, auth_session, menu):
        """Same dish appearing twice in cart with different variants — must
        produce 2 separate priced lines."""
        m = next((m for m in menu if m["id"] == "main_veg_biryani"), None)
        assert m
        base = float(m.get("discounted_price") or m["price"])
        r = auth_session.post(f"{API}/restaurant/order", json={
            "items": [
                {"id": "main_veg_biryani", "qty": 1, "variant": "large"},
                {"id": "main_veg_biryani", "qty": 1, "variant": "regular"},
            ],
        })
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) == 2
        variants = {it["variant"] for it in items}
        assert variants == {"large", "regular"}
        expected_subtotal = round(base * 2 + base * 1, 2)
        assert r.json()["subtotal"] == expected_subtotal


# ---------- Regression: existing flows still work ----------
class TestRegression:
    def test_menu_endpoint(self, session):
        r = session.get(f"{API}/restaurant/menu")
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("items"), list) and len(body["items"]) > 0
        assert "delivery_fee_flat" in body and "delivery_free_over" in body

    def test_theme_endpoint(self, session):
        r = session.get(f"{API}/restaurant/theme")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_categories_endpoint(self, session):
        r = session.get(f"{API}/restaurant/categories")
        assert r.status_code == 200
        cats = r.json().get("categories")
        assert isinstance(cats, list) and len(cats) > 0

    def test_guest_cart_sync(self, session):
        token = "TEST_guest_iter39_" + os.urandom(4).hex()
        cart = {"main_butter_chicken::large": {"id": "main_butter_chicken", "variant": "large", "qty": 1}}
        r = session.put(f"{API}/guest-cart", json={"token": token, "cart": cart})
        assert r.status_code == 200, r.text
        r2 = session.get(f"{API}/guest-cart/{token}")
        assert r2.status_code == 200
        assert r2.json().get("cart") == cart
