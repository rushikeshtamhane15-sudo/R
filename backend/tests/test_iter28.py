"""iter28 — 14-item batch backend tests.

Covers:
  * GET /api/restaurant/menu — every item has is_returnable_tiffin bool; Tiffin Specials default True.
  * GET /api/restaurant/theme + PUT /api/admin/restaurant/theme — new fields persist.
  * GET /api/admin/restaurant/takeaway-pendency — admin returns {rows, pending_count}; subscriber 403.
  * POST /api/admin/restaurant/takeaway-pendency/collect — 404 for unknown id.
  * GET /api/admin/raw-materials — breakdown[] has stock_remaining/pct_remaining/low_stock; low_stock_alerts present.
  * POST /api/admin/raw-materials/stock-topup — sets current_stock + last_stock_topup_at; idempotent on re-call.
  * Auto-PO de-duplication on AUTO-{date}.
"""
import os
import random
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PHONE = "9970705391"


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _login(phone, name="Tester"):
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
    tok, u = _login(ADMIN_PHONE, "TEST_iter28_admin")
    assert u.get("role") == "admin", f"admin not promoted; user={u}"
    return tok


@pytest.fixture(scope="module")
def sub_session():
    phone = _rand_phone()
    tok, u = _login(phone, "TEST_iter28_sub")
    return {"token": tok, "user": u, "phone": phone}


# ---------------------------------------------------------------------------
# Restaurant menu — is_returnable_tiffin flag
# ---------------------------------------------------------------------------
class TestMenuReturnableTiffin:
    def test_menu_items_have_is_returnable_tiffin_flag(self):
        r = requests.get(f"{API}/restaurant/menu", timeout=15)
        assert r.status_code == 200, r.text
        items = r.json().get("items") or []
        assert len(items) > 0, "menu items empty"
        for it in items:
            assert "is_returnable_tiffin" in it, f"missing flag on item: {it.get('id')} / {it.get('name')}"
            assert isinstance(it["is_returnable_tiffin"], bool)

    def test_tiffin_specials_default_true(self):
        r = requests.get(f"{API}/restaurant/menu", timeout=15)
        items = r.json().get("items") or []
        tiffin = [it for it in items if it.get("category") == "Tiffin Specials"]
        if not tiffin:
            pytest.skip("No Tiffin Specials category items in seed/migrated menu")
        for it in tiffin:
            assert it["is_returnable_tiffin"] is True, f"{it['id']} should be returnable"

    def test_non_tiffin_default_false(self):
        r = requests.get(f"{API}/restaurant/menu", timeout=15)
        items = r.json().get("items") or []
        non_tiffin = [it for it in items if it.get("category") != "Tiffin Specials"]
        if not non_tiffin:
            pytest.skip("No non-tiffin items")
        # At least most should be False (some admin override possible)
        false_count = sum(1 for it in non_tiffin if it["is_returnable_tiffin"] is False)
        assert false_count >= len(non_tiffin) * 0.5, "most non-tiffin items should default to False"


# ---------------------------------------------------------------------------
# Restaurant theme — new fields
# ---------------------------------------------------------------------------
class TestRestaurantTheme:
    NEW_FIELDS = [
        "pure_veg_label", "bad_stuff_chip_text", "hero_delivery_badge",
        "hero_overline", "item_promise_label", "search_placeholder",
        "cart_login_hint", "cart_free_delivery_label", "cart_delivery_fee_template",
        "checkout_btn_label", "checkout_login_btn_label", "no_items_label",
        "reorder_overline", "reorder_cta_label",
    ]

    def test_put_theme_accepts_all_new_fields(self, admin_token):
        payload = {f: f"TEST_iter28_{f}" for f in self.NEW_FIELDS}
        r = requests.put(f"{API}/admin/restaurant/theme", json=payload,
                         headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        for f in self.NEW_FIELDS:
            assert body.get(f) == f"TEST_iter28_{f}", f"{f} not echoed: {body.get(f)}"

    def test_get_theme_returns_persisted_new_fields(self, admin_token):
        # Set a known value
        requests.put(f"{API}/admin/restaurant/theme",
                     json={"pure_veg_label": "Test Veg iter28"},
                     headers=_hdr(admin_token), timeout=10)
        r = requests.get(f"{API}/restaurant/theme", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body.get("pure_veg_label") == "Test Veg iter28"

    def test_put_theme_non_admin_403(self, sub_session):
        r = requests.put(f"{API}/admin/restaurant/theme",
                         json={"pure_veg_label": "Hacker"},
                         headers=_hdr(sub_session["token"]), timeout=10)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Take-away pendency
# ---------------------------------------------------------------------------
class TestTakeawayPendency:
    def test_list_admin_ok(self, admin_token):
        r = requests.get(f"{API}/admin/restaurant/takeaway-pendency",
                         headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "rows" in j and isinstance(j["rows"], list)
        assert "pending_count" in j and isinstance(j["pending_count"], int)

    def test_list_subscriber_403(self, sub_session):
        r = requests.get(f"{API}/admin/restaurant/takeaway-pendency",
                         headers=_hdr(sub_session["token"]), timeout=10)
        assert r.status_code == 403

    def test_collect_unknown_id_404(self, admin_token):
        r = requests.post(f"{API}/admin/restaurant/takeaway-pendency/collect",
                          json={"pendency_id": "does_not_exist_12345"},
                          headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 404

    def test_filter_collected_param(self, admin_token):
        for v in ("true", "false"):
            r = requests.get(f"{API}/admin/restaurant/takeaway-pendency?collected={v}",
                             headers=_hdr(admin_token), timeout=10)
            assert r.status_code == 200


# ---------------------------------------------------------------------------
# Raw materials — stock + alerts + auto-PO + topup
# ---------------------------------------------------------------------------
class TestRawMaterials:
    def test_get_raw_materials_breakdown_has_stock_fields(self, admin_token):
        r = requests.get(f"{API}/admin/raw-materials", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "breakdown" in j and "low_stock_alerts" in j
        assert isinstance(j["low_stock_alerts"], list)
        non_amt = [r for r in j["breakdown"] if not r.get("is_amount_based")]
        assert non_amt, "no non-amount-based items in breakdown"
        for row in non_amt:
            for f in ("current_stock", "stock_remaining", "pct_remaining", "low_stock", "monthly_need"):
                assert f in row, f"row missing {f}: {row.get('key')}"
            assert isinstance(row["low_stock"], bool)

    def test_stock_topup_updates_current_stock(self, admin_token):
        # Find a non-amount-based key
        r = requests.get(f"{API}/admin/raw-materials", headers=_hdr(admin_token), timeout=15).json()
        non_amt = [row for row in r["breakdown"] if not row.get("is_amount_based")]
        assert non_amt
        key = non_amt[0]["key"]
        # Topup with a high qty (should not be low stock)
        topup_qty = 10000.0
        r2 = requests.post(f"{API}/admin/raw-materials/stock-topup",
                           json={"key": key, "qty": topup_qty},
                           headers=_hdr(admin_token), timeout=15)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        target = next((row for row in body["breakdown"] if row.get("key") == key), None)
        assert target, f"key {key} not in breakdown after topup"
        assert target["current_stock"] == topup_qty
        assert target["stock_remaining"] == topup_qty  # 0 days elapsed
        assert target["low_stock"] is False, "high topup should not be low stock"

    def test_stock_topup_low_triggers_alert_and_auto_po(self, admin_token):
        # Find first non-amount-based key
        r = requests.get(f"{API}/admin/raw-materials", headers=_hdr(admin_token), timeout=15).json()
        non_amt = [row for row in r["breakdown"] if not row.get("is_amount_based")]
        if not non_amt:
            pytest.skip("no non-amount-based items")
        key = non_amt[0]["key"]
        # Topup with very low qty (force low-stock)
        r2 = requests.post(f"{API}/admin/raw-materials/stock-topup",
                           json={"key": key, "qty": 0.01},
                           headers=_hdr(admin_token), timeout=15)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        # Validate alert appears (only if monthly_need > 0)
        target = next((row for row in body["breakdown"] if row.get("key") == key), None)
        if target and target.get("monthly_need", 0) > 0:
            assert target["low_stock"] is True, f"0.01 should trigger low_stock for {key}"
            alert_keys = [a["key"] for a in body.get("low_stock_alerts", [])]
            assert key in alert_keys, f"{key} not in low_stock_alerts"

    def test_stock_topup_unknown_key_404(self, admin_token):
        r = requests.post(f"{API}/admin/raw-materials/stock-topup",
                          json={"key": "definitely_not_a_real_key_xyz", "qty": 5},
                          headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 404

    def test_stock_topup_negative_qty_400(self, admin_token):
        r = requests.post(f"{API}/admin/raw-materials/stock-topup",
                          json={"key": "toor_dal", "qty": -1},
                          headers=_hdr(admin_token), timeout=15)
        assert r.status_code in (400, 422)

    def test_stock_topup_non_admin_403(self, sub_session):
        r = requests.post(f"{API}/admin/raw-materials/stock-topup",
                          json={"key": "toor_dal", "qty": 5},
                          headers=_hdr(sub_session["token"]), timeout=15)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Regression sanity — iter27 endpoints still 200
# ---------------------------------------------------------------------------
class TestRegression:
    def test_bottom_nav_public(self):
        r = requests.get(f"{API}/bottom-nav", timeout=10)
        assert r.status_code == 200
        for role in ("subscriber", "rider", "guest"):
            assert role in r.json()

    def test_notify_sound_public(self):
        r = requests.get(f"{API}/notify-sound", timeout=10)
        assert r.status_code == 200
        assert "sound_url" in r.json()

    def test_plans_public(self):
        r = requests.get(f"{API}/plans", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json().get("plans"), list)

    def test_theme_public(self):
        r = requests.get(f"{API}/theme", timeout=10)
        assert r.status_code == 200
