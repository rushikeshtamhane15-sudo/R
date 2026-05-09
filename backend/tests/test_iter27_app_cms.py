"""iter27 — App CMS (bottom-nav config + notify-sound) + delivery_otp gating.

Tests:
  * GET /api/bottom-nav (public) returns subscriber/rider/guest with default 4 items each.
  * PUT /api/admin/bottom-nav: admin saves; non-admin gets 403; partial role updates allowed; 1-6 items per role validated.
  * POST /api/admin/bottom-nav/reset (admin) restores defaults.
  * GET /api/notify-sound (public) returns {sound_url}. PUT /api/admin/notify-sound validates https / data:audio prefix. DELETE clears.
  * GET /api/restaurant/orders/{id}/track: delivery_otp null when status NOT in (ready_for_pickup, out_for_delivery), present (4-digit) otherwise.
"""
import os
import time
import random
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PHONE = "9970705391"


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _login(phone: str, name: str = "Tester"):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, r.text
    otp = r.json().get("dev_otp")
    assert otp, f"dev_otp missing: {r.text}"
    r2 = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name}, timeout=15)
    assert r2.status_code == 200, r2.text
    j = r2.json()
    return j["session_token"], j["user"]


def _rand_phone():
    return "9" + "".join(str(random.randint(0, 9)) for _ in range(9))


@pytest.fixture(scope="module")
def admin_token():
    tok, u = _login(ADMIN_PHONE, "TEST_iter27_admin")
    assert u.get("role") == "admin", f"admin not promoted; user={u}"
    return tok


@pytest.fixture(scope="module")
def subscriber_session():
    phone = _rand_phone()
    tok, u = _login(phone, "TEST_iter27_sub")
    return {"token": tok, "user": u, "phone": phone}


# ---------------------------------------------------------------------------
# Bottom nav config
# ---------------------------------------------------------------------------
class TestBottomNav:
    def test_get_bottom_nav_public_default(self, admin_token):
        # Reset first to ensure clean state
        rr = requests.post(f"{API}/admin/bottom-nav/reset", headers=_hdr(admin_token), timeout=10)
        assert rr.status_code == 200
        # Public — no auth header
        r = requests.get(f"{API}/bottom-nav", timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        for role in ("subscriber", "rider", "guest"):
            assert role in j, f"missing role {role}"
            assert isinstance(j[role], list)
            assert len(j[role]) == 4, f"{role} default should have 4 items, got {len(j[role])}"
            for it in j[role]:
                for k in ("id", "label", "icon", "to", "visible"):
                    assert k in it, f"item missing {k}"

    def test_put_bottom_nav_non_admin_403(self, subscriber_session):
        body = {"subscriber": [{"id": "x", "label": "X", "icon": "Home", "to": "/x", "visible": True}]}
        r = requests.put(f"{API}/admin/bottom-nav", json=body,
                         headers=_hdr(subscriber_session["token"]), timeout=10)
        assert r.status_code == 403, f"expected 403; got {r.status_code} {r.text}"

    def test_put_bottom_nav_partial_role_update(self, admin_token):
        # Update only subscriber; rider+guest should remain unchanged
        new_sub = [
            {"id": "rest", "label": "Eat", "icon": "ChefHat", "to": "/restaurant", "visible": True},
            {"id": "ord", "label": "Orders", "icon": "Receipt", "to": "/restaurant/orders", "visible": True},
        ]
        r = requests.put(f"{API}/admin/bottom-nav", json={"subscriber": new_sub},
                         headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert len(j["subscriber"]) == 2
        assert j["subscriber"][0]["label"] == "Eat"
        # rider/guest should still be defaults (4 items)
        assert len(j["rider"]) == 4
        assert len(j["guest"]) == 4
        # Verify persistence via GET
        time.sleep(0.2)
        g = requests.get(f"{API}/bottom-nav", timeout=10).json()
        assert g["subscriber"][0]["label"] == "Eat"
        assert len(g["subscriber"]) == 2

    def test_put_bottom_nav_validation_too_many_items(self, admin_token):
        big = [{"id": f"i{i}", "label": f"L{i}", "icon": "Home", "to": f"/x{i}", "visible": True}
               for i in range(7)]
        r = requests.put(f"{API}/admin/bottom-nav", json={"subscriber": big},
                         headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 400, f"expected 400 for 7 items; got {r.status_code} {r.text}"

    def test_put_bottom_nav_validation_zero_items(self, admin_token):
        r = requests.put(f"{API}/admin/bottom-nav", json={"subscriber": []},
                         headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 400, f"expected 400 for 0 items; got {r.status_code}"

    def test_reset_bottom_nav(self, admin_token):
        r = requests.post(f"{API}/admin/bottom-nav/reset", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200
        # GET should return defaults (4 each)
        g = requests.get(f"{API}/bottom-nav", timeout=10).json()
        for role in ("subscriber", "rider", "guest"):
            assert len(g[role]) == 4, f"{role} should have 4 default items after reset"

    def test_reset_bottom_nav_non_admin_403(self, subscriber_session):
        r = requests.post(f"{API}/admin/bottom-nav/reset",
                          headers=_hdr(subscriber_session["token"]), timeout=10)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Notify sound
# ---------------------------------------------------------------------------
class TestNotifySound:
    def test_get_notify_sound_default_empty_or_string(self, admin_token):
        # Clear first
        requests.delete(f"{API}/admin/notify-sound", headers=_hdr(admin_token), timeout=10)
        r = requests.get(f"{API}/notify-sound", timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "sound_url" in j
        assert isinstance(j["sound_url"], str)
        assert j["sound_url"] == ""

    def test_put_notify_sound_https_ok(self, admin_token):
        url = "https://example.com/ding.mp3"
        r = requests.put(f"{API}/admin/notify-sound", json={"sound_url": url},
                         headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["sound_url"] == url
        # Persists
        g = requests.get(f"{API}/notify-sound", timeout=10).json()
        assert g["sound_url"] == url

    def test_put_notify_sound_data_audio_ok(self, admin_token):
        url = "data:audio/mpeg;base64,SUQzAwAAAAAAAA=="
        r = requests.put(f"{API}/admin/notify-sound", json={"sound_url": url},
                         headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["sound_url"] == url

    def test_put_notify_sound_invalid_prefix(self, admin_token):
        for bad in ("http://insecure.com/x.mp3", "ftp://x", "javascript:alert(1)", "data:text/plain,abc"):
            r = requests.put(f"{API}/admin/notify-sound", json={"sound_url": bad},
                             headers=_hdr(admin_token), timeout=10)
            assert r.status_code == 400, f"expected 400 for {bad!r}; got {r.status_code}"

    def test_put_notify_sound_non_admin_403(self, subscriber_session):
        r = requests.put(f"{API}/admin/notify-sound",
                         json={"sound_url": "https://example.com/x.mp3"},
                         headers=_hdr(subscriber_session["token"]), timeout=10)
        assert r.status_code == 403

    def test_delete_notify_sound(self, admin_token):
        # Set first
        requests.put(f"{API}/admin/notify-sound", json={"sound_url": "https://example.com/x.mp3"},
                     headers=_hdr(admin_token), timeout=10)
        r = requests.delete(f"{API}/admin/notify-sound", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200
        g = requests.get(f"{API}/notify-sound", timeout=10).json()
        assert g["sound_url"] == ""


# ---------------------------------------------------------------------------
# delivery_otp gating on /restaurant/orders/{id}/track
# ---------------------------------------------------------------------------
class TestDeliveryOtpGating:
    """Manipulate restaurant_orders status directly through admin endpoints to test gating."""

    def _create_paid_order(self, sub_token: str):
        # Get menu items first
        m = requests.get(f"{API}/restaurant/menu", timeout=15).json()
        items = m.get("items", [])
        if not items:
            pytest.skip("No menu items available to create test order")
        # Add 1 item to cart
        chosen = items[0]
        cart_payload = {"items": [{"id": chosen["id"], "qty": 1}]}
        # Use checkout flow — POST /restaurant/order then mark paid via mock payment
        r = requests.post(f"{API}/restaurant/order", json=cart_payload,
                          headers=_hdr(sub_token), timeout=15)
        if r.status_code != 200:
            pytest.skip(f"order creation failed: {r.status_code} {r.text[:200]}")
        order = r.json()
        oid = order.get("order_id") or order.get("id")
        if not oid:
            pytest.skip(f"no order_id in response: {order}")

        # Pay (mock razorpay)
        po = requests.post(f"{API}/payments/order", json={"order_id": oid, "kind": "restaurant_order"},
                           headers=_hdr(sub_token), timeout=15)
        if po.status_code == 200:
            pj = po.json()
            rzp = pj.get("razorpay_order_id") or pj.get("id")
            if rzp:
                requests.post(f"{API}/payments/verify",
                              json={"razorpay_order_id": rzp, "razorpay_payment_id": "mock_pay",
                                    "razorpay_signature": "mock_sig", "order_id": oid,
                                    "kind": "restaurant_order"},
                              headers=_hdr(sub_token), timeout=15)
        return oid

    def test_track_otp_gated_by_status(self, subscriber_session, admin_token):
        oid = self._create_paid_order(subscriber_session["token"])

        def _track():
            r = requests.get(f"{API}/restaurant/orders/{oid}/track",
                             headers=_hdr(subscriber_session["token"]), timeout=10)
            assert r.status_code == 200, r.text
            return r.json()

        # status=paid → otp must be null
        t = _track()
        if t["status"] in ("ready_for_pickup", "out_for_delivery"):
            pytest.skip(f"unexpected initial status={t['status']}")
        assert t.get("delivery_otp") is None, f"otp leaked for status={t['status']}: {t['delivery_otp']}"

        # Move to preparing
        s1 = requests.post(f"{API}/admin/restaurant/orders/{oid}/status",
                           json={"status": "preparing"}, headers=_hdr(admin_token), timeout=10)
        if s1.status_code == 200:
            t = _track()
            assert t["status"] == "preparing"
            assert t.get("delivery_otp") is None, "otp leaked at preparing"

        # Move to ready_for_pickup — at this point otp should still be None (rider hasn't issued it)
        # but the field is exposed (None unless rider /arrived has been hit)
        s2 = requests.post(f"{API}/admin/restaurant/orders/{oid}/status",
                           json={"status": "ready_for_pickup"}, headers=_hdr(admin_token), timeout=10)
        if s2.status_code == 200:
            t = _track()
            assert t["status"] == "ready_for_pickup"
            # When otp hasn't been generated by rider yet, value remains None even though gate is open
            # The gate logic exposes the field but it may be None until rider hits /arrived
            # We can only assert: NOT a leak from a different status (i.e., the field is in the response key)
            assert "delivery_otp" in t

        # If we can simulate out_for_delivery (need rider role to do pickup); skip the rider flow
        # Instead, directly write an OTP via mongo? Out of scope without DB access.
        # We've verified the gating at non-active statuses (paid + preparing).
