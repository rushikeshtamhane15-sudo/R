"""iter-85 franchise_owner role unlocks — Batch testing.

Covers:
 - tiffin-stock: GET/POST topup/GET history reachable for franchise_owner
 - tiffin-stock: POST adjust + PUT threshold (review request says reachable; code review check)
 - mess_menu_cal: upsert/bulk/delete/get month/get config/put config for franchise_owner
 - mess_menu_push: get/put cfg + preview + send-now for franchise_owner
 - restaurant_hours: per-branch scope + GET status fallback behavior
 - wallet-adjust: franchise_owner MUST get 403
"""
from __future__ import annotations

import os
import time
import uuid
import secrets
import pytest
import requests
from pymongo import MongoClient

def _load_env(path):
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


_load_env("/app/frontend/.env")
_load_env("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

_mc = MongoClient(MONGO_URL)
_db = _mc[DB_NAME]

# Use a deterministic test phone we will clean up. 10-digit, starting with 9.
TEST_PHONE = "9" + str(int(time.time()) % 10**9).zfill(9)
PER_BRANCH_KEY = "restaurant_hours:efoodcare-amravati"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _seed_session(user_id: str) -> str:
    token = "fe_iter85_" + secrets.token_hex(8)
    # Insert into user_sessions like prior iterations (cookie auth)
    _db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": "2026-01-01T00:00:00Z",
        "expires_at": "2030-01-01T00:00:00Z",
    })
    return token


@pytest.fixture(scope="module")
def franchise_session():
    """Create a franchise_owner via send-otp / verify-otp, promote role,
    assign mess ownership, then create a session cookie for it."""
    s = requests.Session()
    # 1) send OTP
    r = s.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": TEST_PHONE}, timeout=15)
    assert r.status_code in (200, 201), f"send-otp failed: {r.status_code} {r.text}"
    otp = (r.json() or {}).get("dev_otp")
    assert otp, f"no dev_otp returned: {r.text}"
    # 2) verify OTP
    r = s.post(f"{BASE_URL}/api/auth/verify-otp", json={
        "phone": TEST_PHONE, "otp": otp, "name": "TEST Franchise"
    }, timeout=15)
    assert r.status_code == 200, f"verify-otp failed: {r.status_code} {r.text}"
    # 3) find the user in Mongo, promote role + own mess
    u = _db.users.find_one({"phone": {"$regex": TEST_PHONE + "$"}})
    if not u:
        u = _db.users.find_one({"phone": "+91" + TEST_PHONE})
    assert u, f"could not find user for phone {TEST_PHONE}"
    user_id = u["user_id"]
    _db.users.update_one({"user_id": user_id}, {"$set": {"role": "franchise_owner"}})
    # Ensure target mess exists, then assign owner_user_id
    if not _db.messes.find_one({"mess_id": "efoodcare-amravati"}):
        _db.messes.insert_one({
            "mess_id": "efoodcare-amravati",
            "name": "TEST Amravati Branch",
            "owner_user_id": user_id,
        })
    else:
        _db.messes.update_one({"mess_id": "efoodcare-amravati"}, {"$set": {"owner_user_id": user_id}})
    # 4) Make a session cookie (cookie-session auth like prior iterations)
    token = _seed_session(user_id)
    s.cookies.set("session_token", token, domain=BASE_URL.split("://", 1)[1].split("/", 1)[0])
    yield {"session": s, "user_id": user_id, "token": token}
    # teardown
    _db.user_sessions.delete_many({"session_token": token})
    _db.users.delete_one({"user_id": user_id})
    _db.app_settings.delete_one({"_id": PER_BRANCH_KEY})


# ---------------------------------------------------------------------------
# tiffin_stock
# ---------------------------------------------------------------------------
class TestTiffinStockFranchise:
    def test_get_stock_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/tiffin-stock", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "quantity" in data
        assert "low_threshold" in data
        assert "active_tiffin_subs" in data
        assert "expected_daily_use" in data

    def test_topup_franchise(self, franchise_session):
        s = franchise_session["session"]
        before = s.get(f"{BASE_URL}/api/admin/tiffin-stock").json()["quantity"]
        r = s.post(f"{BASE_URL}/api/admin/tiffin-stock/topup",
                   json={"qty": 5, "note": "TEST franchise topup"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["quantity"] == before + 5
        # adjust back to keep state clean
        _db.tiffin_stock.update_one({"_id": "active"}, {"$inc": {"quantity": -5}})

    def test_history_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/tiffin-stock/history?limit=5", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data
        assert isinstance(data["rows"], list)

    def test_adjust_franchise_should_be_allowed(self, franchise_session):
        """Review request says adjust should be reachable for franchise_owner.
        Current code at line 135 still has `if user.role != 'admin'`."""
        s = franchise_session["session"]
        r = s.post(f"{BASE_URL}/api/admin/tiffin-stock/adjust",
                   json={"delta": 0, "reason": "TEST"}, timeout=10)
        # According to review request this should NOT be 403.
        assert r.status_code != 403, (
            f"BUG: adjust returns 403 for franchise_owner but review request requires access. "
            f"tiffin_stock.py line 135 still has 'if user.role != admin'. Body: {r.text}"
        )

    def test_threshold_franchise_should_be_allowed(self, franchise_session):
        s = franchise_session["session"]
        r = s.put(f"{BASE_URL}/api/admin/tiffin-stock/threshold",
                  json={"threshold": 25}, timeout=10)
        assert r.status_code != 403, (
            f"BUG: threshold returns 403 for franchise_owner but review request requires access. "
            f"tiffin_stock.py line 169 still has 'if user.role != admin'. Body: {r.text}"
        )


# ---------------------------------------------------------------------------
# mess_menu_cal
# ---------------------------------------------------------------------------
class TestMessMenuCalFranchise:
    test_date = "2030-06-15"

    def test_upsert_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.post(f"{BASE_URL}/api/admin/mess-menu/upsert",
                   json={"date": self.test_date, "lunch": "TEST lunch", "dinner": "TEST dinner"},
                   timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["lunch"] == "TEST lunch"

    def test_bulk_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.post(f"{BASE_URL}/api/admin/mess-menu/bulk",
                   json={"items": [
                       {"date": "2030-06-16", "lunch": "TEST L1", "dinner": "TEST D1"},
                       {"date": "2030-06-17", "lunch": "TEST L2", "dinner": "TEST D2"},
                   ]}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["upserted"] == 2

    def test_get_month_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/mess-menu?month=2030-06", timeout=10)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert any(it["date"] == self.test_date for it in items)

    def test_delete_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.delete(f"{BASE_URL}/api/admin/mess-menu/{self.test_date}", timeout=10)
        assert r.status_code == 200, r.text
        # cleanup the others
        for d in ("2030-06-16", "2030-06-17"):
            s.delete(f"{BASE_URL}/api/admin/mess-menu/{d}")

    def test_config_get_put_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/mess-menu/config", timeout=10)
        assert r.status_code == 200, r.text
        cfg = r.json()
        assert "price_delivery" in cfg
        # PUT round-trip with same values
        r = s.put(f"{BASE_URL}/api/admin/mess-menu/config", json=cfg, timeout=10)
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# mess_menu_push
# ---------------------------------------------------------------------------
class TestMessMenuPushFranchise:
    def test_get_push_config(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/mess-menu/push/config", timeout=10)
        assert r.status_code == 200, r.text
        assert "hour_ist" in r.json()

    def test_put_push_config(self, franchise_session):
        s = franchise_session["session"]
        r = s.put(f"{BASE_URL}/api/admin/mess-menu/push/config",
                  json={"enabled": True, "hour_ist": 11,
                        "title_template": "Today's {meal}",
                        "body_template": "{menu} · ₹{delivery_price}",
                        "cta_label": "Order now", "cta_route": "/dashboard"},
                  timeout=10)
        assert r.status_code == 200, r.text

    def test_preview_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.post(f"{BASE_URL}/api/admin/mess-menu/push/preview", timeout=10)
        # 400 if no menu published; what matters is NOT 403
        assert r.status_code != 403, f"BUG: preview returns 403: {r.text}"


# ---------------------------------------------------------------------------
# restaurant_hours per-branch
# ---------------------------------------------------------------------------
class TestRestaurantHoursFranchise:
    def test_get_hours_returns_branch_scope(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/restaurant/hours", timeout=10)
        assert r.status_code == 200, r.text
        cfg = r.json()
        assert cfg.get("scope") == "branch", f"expected scope=branch, got {cfg}"
        assert cfg.get("mess_id") == "efoodcare-amravati", f"got mess_id={cfg.get('mess_id')}"

    def test_post_hours_writes_to_branch_key(self, franchise_session):
        s = franchise_session["session"]
        # Clean any pre-existing per-branch doc
        _db.app_settings.delete_one({"_id": PER_BRANCH_KEY})
        r = s.post(f"{BASE_URL}/api/admin/restaurant/hours",
                   json={"mode": "auto", "open_time": "09:30", "close_time": "21:30",
                         "capacity_per_hour": 50, "closed_message": "TEST closed"},
                   timeout=10)
        assert r.status_code == 200, r.text
        # Verify Mongo doc landed on the per-branch key
        doc = _db.app_settings.find_one({"_id": PER_BRANCH_KEY})
        assert doc is not None, "per-branch app_settings doc not created"
        assert doc["open_time"] == "09:30"
        assert doc["mess_id"] == "efoodcare-amravati"
        # Verify global key wasn't overwritten by this call
        gdoc = _db.app_settings.find_one({"_id": "restaurant_hours"})
        if gdoc is not None:
            assert gdoc.get("open_time") != "09:30" or gdoc.get("mess_id") == "efoodcare-amravati", \
                "franchise POST leaked into global restaurant_hours doc"

    def test_public_status_branch_param(self, franchise_session):
        # without mess_id → global fallback
        r1 = requests.get(f"{BASE_URL}/api/restaurant/status", timeout=10)
        assert r1.status_code == 200, r1.text
        # with mess_id → branch config (open_time 09:30 from previous test)
        r2 = requests.get(f"{BASE_URL}/api/restaurant/status?mess_id=efoodcare-amravati", timeout=10)
        assert r2.status_code == 200, r2.text
        assert r2.json()["open_time"] == "09:30", f"expected per-branch override, got {r2.json()}"

    def test_public_status_unknown_mess_falls_back_to_global(self, franchise_session):
        r = requests.get(f"{BASE_URL}/api/restaurant/status?mess_id=nonexistent-mess", timeout=10)
        assert r.status_code == 200, r.text
        # Should NOT error out — falls back to either branch doc or global config defaults.
        assert "open_time" in r.json()


# ---------------------------------------------------------------------------
# Negative: wallet-adjust MUST be 403 for franchise
# ---------------------------------------------------------------------------
class TestWalletAdjustNegative:
    def test_wallet_adjust_franchise_403(self, franchise_session):
        s = franchise_session["session"]
        # Need a target user id — use the franchise user themselves
        target_uid = franchise_session["user_id"]
        r = s.post(f"{BASE_URL}/api/admin/users/{target_uid}/wallet-adjust",
                   json={"delta": 100, "reason": "TEST"}, timeout=10)
        assert r.status_code == 403, f"BUG: wallet-adjust must be 403 for franchise_owner, got {r.status_code} {r.text}"
