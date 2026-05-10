"""iter29 — 13-item batch backend tests.

Covers:
  * GET /api/header-menu (public) + PUT /api/admin/header-menu + reset; non-admin 403.
  * POST /api/admin/restaurant/takeaway-pendency/manual — admin/staff create.
  * GET/PUT /api/admin/pnl/expenses — admin only PUT, admin/staff GET.
  * GET /api/admin/pnl/daily?days=N — rows + summary + config.
  * PUT /api/admin/restaurant/theme accepts 4 NEW color fields.
  * is_returnable_tiffin still persists on PUT /api/admin/restaurant/menu.

Regression: iter12-28 already covered by their own files; we only sanity-check
the theme model + menu PUT here.
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
    tok, u = _login(ADMIN_PHONE, "TEST_iter29_admin")
    assert u.get("role") == "admin", f"admin not promoted; user={u}"
    return tok


@pytest.fixture(scope="module")
def sub_session():
    phone = _rand_phone()
    tok, u = _login(phone, "TEST_iter29_sub")
    return {"token": tok, "user": u, "phone": phone}


# ---------------------------------------------------------------------------
# Header menu CMS
# ---------------------------------------------------------------------------
class TestHeaderMenu:
    def test_get_header_menu_public_default(self):
        r = requests.get(f"{API}/header-menu", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "items" in body
        assert isinstance(body["items"], list)
        assert len(body["items"]) >= 4
        for it in body["items"]:
            assert {"id", "label", "to", "visible"} <= set(it.keys())

    def test_put_header_menu_non_admin_403(self, sub_session):
        r = requests.put(f"{API}/admin/header-menu", json={"items": [
            {"id": "x", "label": "X", "to": "/x", "visible": True}
        ]}, headers=_hdr(sub_session["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_put_header_menu_admin_then_reset(self, admin_token):
        new_items = [
            {"id": "test_iter29_a", "label": "TEST Iter29 A", "to": "/contact", "visible": True},
            {"id": "test_iter29_b", "label": "TEST Iter29 B", "to": "/privacy", "visible": False},
        ]
        r = requests.put(f"{API}/admin/header-menu", json={"items": new_items}, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        assert len(r.json()["items"]) == 2

        # GET reflects
        g = requests.get(f"{API}/header-menu", timeout=15)
        labels = [it["label"] for it in g.json()["items"]]
        assert "TEST Iter29 A" in labels

        # Reset
        rs = requests.post(f"{API}/admin/header-menu/reset", headers=_hdr(admin_token), timeout=15)
        assert rs.status_code == 200, rs.text
        assert len(rs.json()["items"]) == 4

        # Confirm public GET back to defaults
        g2 = requests.get(f"{API}/header-menu", timeout=15)
        assert len(g2.json()["items"]) == 4


# ---------------------------------------------------------------------------
# Manual takeaway-pendency entry
# ---------------------------------------------------------------------------
class TestManualTakeaway:
    def test_manual_takeaway_admin_creates_row(self, admin_token):
        payload = {
            "name": "TEST_iter29 Walkin",
            "phone": "9999900000",
            "address": "Test Lane 1",
            "tiffin_count": 2,
            "notes": "iter29 test",
        }
        r = requests.post(f"{API}/admin/restaurant/takeaway-pendency/manual",
                          json=payload, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("pendency_id", "").startswith("rtp_manual_")
        pid = body["pendency_id"]

        # GET list should include it
        g = requests.get(f"{API}/admin/restaurant/takeaway-pendency",
                         headers=_hdr(admin_token), timeout=15)
        assert g.status_code == 200, g.text
        rows = g.json().get("rows", [])
        ids = [r2.get("pendency_id") for r2 in rows]
        assert pid in ids

    def test_manual_takeaway_subscriber_403(self, sub_session):
        r = requests.post(f"{API}/admin/restaurant/takeaway-pendency/manual",
                          json={"name": "x", "phone": "9999988888", "tiffin_count": 1},
                          headers=_hdr(sub_session["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_manual_takeaway_validation(self, admin_token):
        # tiffin_count > 20
        r = requests.post(f"{API}/admin/restaurant/takeaway-pendency/manual",
                          json={"name": "x", "phone": "9999977777", "tiffin_count": 99},
                          headers=_hdr(admin_token), timeout=15)
        assert r.status_code in (400, 422), r.text
        # missing name
        r2 = requests.post(f"{API}/admin/restaurant/takeaway-pendency/manual",
                           json={"name": "", "phone": "9999977777", "tiffin_count": 1},
                           headers=_hdr(admin_token), timeout=15)
        assert r2.status_code in (400, 422), r2.text


# ---------------------------------------------------------------------------
# P&L expense config + daily
# ---------------------------------------------------------------------------
class TestPnLExpenses:
    def test_get_expenses_admin_default_zero_or_existing(self, admin_token):
        r = requests.get(f"{API}/admin/pnl/expenses", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("salary", "rent", "electricity", "loan_emi", "other"):
            assert k in body
            assert isinstance(body[k], (int, float))

    def test_get_expenses_subscriber_403(self, sub_session):
        r = requests.get(f"{API}/admin/pnl/expenses",
                         headers=_hdr(sub_session["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_put_expenses_admin_persists(self, admin_token):
        payload = {"salary": 30000, "rent": 12000, "electricity": 4000, "loan_emi": 8000, "other": 1000}
        r = requests.put(f"{API}/admin/pnl/expenses", json=payload, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        g = requests.get(f"{API}/admin/pnl/expenses", headers=_hdr(admin_token), timeout=15)
        body = g.json()
        for k, v in payload.items():
            assert body[k] == v, f"{k}: {body[k]} != {v}"

    def test_put_expenses_subscriber_403(self, sub_session):
        r = requests.put(f"{API}/admin/pnl/expenses",
                         json={"salary": 1, "rent": 1, "electricity": 1, "loan_emi": 1, "other": 1},
                         headers=_hdr(sub_session["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_put_expenses_negative_rejected(self, admin_token):
        r = requests.put(f"{API}/admin/pnl/expenses",
                         json={"salary": -1, "rent": 0, "electricity": 0, "loan_emi": 0, "other": 0},
                         headers=_hdr(admin_token), timeout=15)
        assert r.status_code in (400, 422), r.text


class TestPnLDaily:
    def test_daily_default_30_rows(self, admin_token):
        r = requests.get(f"{API}/admin/pnl/daily", headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "rows" in body and "summary" in body and "config" in body
        assert "computed_at" in body
        assert len(body["rows"]) == 30
        # Row schema
        for row in body["rows"][:2]:
            for k in ("date", "sub_revenue", "rest_revenue", "total_revenue",
                      "raw_material_cost", "fixed_cost", "total_expense", "net"):
                assert k in row, f"missing {k}"
        # Summary schema
        s = body["summary"]
        assert s["days"] == 30
        for k in ("total_revenue", "total_expense", "net", "is_profit"):
            assert k in s
        # Config schema
        cfg = body["config"]
        for k in ("monthly_fixed", "daily_fixed", "daily_raw_material"):
            assert k in cfg

    @pytest.mark.parametrize("days", [1, 7, 60, 90])
    def test_daily_pagination_bounds(self, admin_token, days):
        r = requests.get(f"{API}/admin/pnl/daily?days={days}",
                         headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        assert len(r.json()["rows"]) == days

    def test_daily_clamps_above_90(self, admin_token):
        r = requests.get(f"{API}/admin/pnl/daily?days=500",
                         headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        assert len(r.json()["rows"]) == 90

    def test_daily_clamps_zero(self, admin_token):
        r = requests.get(f"{API}/admin/pnl/daily?days=0",
                         headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        assert len(r.json()["rows"]) == 1

    def test_daily_subscriber_403(self, sub_session):
        r = requests.get(f"{API}/admin/pnl/daily",
                         headers=_hdr(sub_session["token"]), timeout=20)
        assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Restaurant theme — 4 new color fields
# ---------------------------------------------------------------------------
class TestThemeNewColors:
    NEW_FIELDS = {
        "ninety_min_bg_color": "#059669",
        "ninety_min_text_color": "#ffffff",
        "item_promise_bg_color": "#fef3c7",
        "item_promise_text_color": "#92400e",
    }

    def test_put_theme_accepts_new_color_fields(self, admin_token):
        r = requests.put(f"{API}/admin/restaurant/theme",
                         json=self.NEW_FIELDS, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k, v in self.NEW_FIELDS.items():
            assert body.get(k) == v, f"{k} not persisted in PUT response"

    def test_get_theme_returns_persisted_new_colors(self, admin_token):
        # ensure put first
        requests.put(f"{API}/admin/restaurant/theme",
                     json=self.NEW_FIELDS, headers=_hdr(admin_token), timeout=15)
        r = requests.get(f"{API}/restaurant/theme", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k, v in self.NEW_FIELDS.items():
            assert body.get(k) == v, f"{k} not in GET response"

    def test_cleanup_theme_clear_new_colors(self, admin_token):
        # leave defaults — null out our test colors
        clear = {k: None for k in self.NEW_FIELDS}
        r = requests.put(f"{API}/admin/restaurant/theme",
                         json=clear, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# is_returnable_tiffin still persists via PUT /admin/restaurant/menu
# ---------------------------------------------------------------------------
class TestMenuReturnableTiffinPersist:
    def test_put_menu_with_returnable_persists(self, admin_token):
        # Pull current menu
        g = requests.get(f"{API}/restaurant/menu", timeout=15)
        assert g.status_code == 200, g.text
        items = g.json().get("items", [])
        if not items:
            pytest.skip("no menu items configured")
        # Toggle is_returnable_tiffin on first item
        target_id = items[0].get("id")
        original = bool(items[0].get("is_returnable_tiffin", False))
        new_val = not original
        # Build payload preserving rest of fields
        new_items = []
        for it in items:
            entry = {k: it.get(k) for k in ("id", "name", "price", "category",
                                            "image", "available", "popular",
                                            "is_returnable_tiffin")}
            if entry["id"] == target_id:
                entry["is_returnable_tiffin"] = new_val
            new_items.append(entry)
        r = requests.put(f"{API}/admin/restaurant/menu",
                         json={"items": new_items}, headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text

        # Re-GET and verify
        g2 = requests.get(f"{API}/restaurant/menu", timeout=15)
        items2 = g2.json().get("items", [])
        match = [it for it in items2 if it.get("id") == target_id]
        assert match, f"item {target_id} disappeared after PUT"
        assert bool(match[0].get("is_returnable_tiffin")) == new_val

        # Restore
        for it in new_items:
            if it["id"] == target_id:
                it["is_returnable_tiffin"] = original
        requests.put(f"{API}/admin/restaurant/menu",
                     json={"items": new_items}, headers=_hdr(admin_token), timeout=20)
