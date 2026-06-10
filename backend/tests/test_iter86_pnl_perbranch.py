"""iter-86: per-branch tiffin stock + per-branch hours + kiosk GET unlock + branch P&L."""
from __future__ import annotations

import os
import time
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

TEST_PHONE_FR = "9" + str(int(time.time()) % 10**9).zfill(9)
MESS_ID = "efoodcare-amravati"
PER_BRANCH_HOURS_KEY = f"restaurant_hours:{MESS_ID}"
PER_BRANCH_STOCK_KEY = f"active:{MESS_ID}"
PER_BRANCH_COSTS_KEY = f"branch_costs:{MESS_ID}"


def _seed_session(user_id: str, prefix="fe_iter86_") -> str:
    token = prefix + secrets.token_hex(8)
    _db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": "2026-01-01T00:00:00Z",
        "expires_at": "2030-01-01T00:00:00Z",
    })
    return token


def _host():
    return BASE_URL.split("://", 1)[1].split("/", 1)[0]


@pytest.fixture(scope="module")
def franchise_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": TEST_PHONE_FR}, timeout=15)
    assert r.status_code in (200, 201), r.text
    otp = (r.json() or {}).get("dev_otp")
    assert otp
    r = s.post(f"{BASE_URL}/api/auth/verify-otp",
               json={"phone": TEST_PHONE_FR, "otp": otp, "name": "TEST F86"}, timeout=15)
    assert r.status_code == 200, r.text
    u = _db.users.find_one({"phone": {"$regex": TEST_PHONE_FR + "$"}})
    assert u
    user_id = u["user_id"]
    _db.users.update_one({"user_id": user_id}, {"$set": {"role": "franchise_owner"}})
    if not _db.messes.find_one({"mess_id": MESS_ID}):
        _db.messes.insert_one({"mess_id": MESS_ID, "name": "TEST Amravati", "owner_user_id": user_id})
    else:
        _db.messes.update_one({"mess_id": MESS_ID}, {"$set": {"owner_user_id": user_id}})
    token = _seed_session(user_id, "fe_iter86_fr_")
    s.cookies.set("session_token", token, domain=_host())
    # Cleanup any pre-existing per-branch test docs so we measure deltas correctly
    _db.tiffin_stock.delete_one({"_id": PER_BRANCH_STOCK_KEY})
    _db.app_settings.delete_one({"_id": PER_BRANCH_HOURS_KEY})
    _db.app_settings.delete_one({"_id": PER_BRANCH_COSTS_KEY})
    yield {"session": s, "user_id": user_id, "token": token}
    # teardown
    _db.user_sessions.delete_many({"session_token": token})
    _db.users.delete_one({"user_id": user_id})
    _db.tiffin_stock.delete_one({"_id": PER_BRANCH_STOCK_KEY})
    _db.app_settings.delete_many({"_id": {"$regex": f"^(restaurant_hours|branch_costs):{MESS_ID}"}})


@pytest.fixture(scope="module")
def admin_session():
    """Seed an admin via Mongo + cookie-session."""
    email = "admin@efoodcare.com"
    u = _db.users.find_one({"email": email})
    if not u:
        uid = f"user_admin_iter86_{secrets.token_hex(4)}"
        _db.users.insert_one({"user_id": uid, "email": email, "name": "ADMIN", "role": "admin"})
        u = _db.users.find_one({"user_id": uid})
    else:
        _db.users.update_one({"user_id": u["user_id"]}, {"$set": {"role": "admin"}})
    user_id = u["user_id"]
    token = _seed_session(user_id, "fe_iter86_admin_")
    s = requests.Session()
    s.cookies.set("session_token", token, domain=_host())
    yield {"session": s, "user_id": user_id, "token": token}
    _db.user_sessions.delete_many({"session_token": token})


# ============================================================================
# Backend #1 — per-mess tiffin_stock
# ============================================================================
class TestPerMessTiffinStock:
    def test_franchise_get_scoped_to_branch(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/tiffin-stock", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("mess_id") == MESS_ID, f"expected mess_id={MESS_ID}, got {data}"

    def test_franchise_topup_writes_to_branch_doc(self, franchise_session):
        s = franchise_session["session"]
        before = s.get(f"{BASE_URL}/api/admin/tiffin-stock").json().get("quantity", 0)
        r = s.post(f"{BASE_URL}/api/admin/tiffin-stock/topup",
                   json={"qty": 7, "note": "TEST iter86 franchise"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("mess_id") == MESS_ID
        assert data.get("quantity") == before + 7
        # Verify Mongo: per-branch doc exists
        branch_doc = _db.tiffin_stock.find_one({"_id": PER_BRANCH_STOCK_KEY})
        assert branch_doc is not None, "per-branch tiffin_stock doc missing"
        assert int(branch_doc.get("quantity", 0)) == before + 7

    def test_admin_topup_writes_to_legacy_active(self, admin_session):
        s = admin_session["session"]
        # baseline global
        before = (_db.tiffin_stock.find_one({"_id": "active"}) or {}).get("quantity", 0)
        r = s.post(f"{BASE_URL}/api/admin/tiffin-stock/topup",
                   json={"qty": 11, "note": "TEST iter86 admin global"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        # admin without mess_id = legacy/global → mess_id None or absent
        assert data.get("mess_id") in (None, ""), f"expected None mess_id, got {data}"
        after = (_db.tiffin_stock.find_one({"_id": "active"}) or {}).get("quantity", 0)
        assert after == before + 11
        # cleanup
        _db.tiffin_stock.update_one({"_id": "active"}, {"$inc": {"quantity": -11}})

    def test_admin_can_peek_branch_via_mess_id(self, admin_session):
        s = admin_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/tiffin-stock?mess_id={MESS_ID}", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("mess_id") == MESS_ID
        branch_doc = _db.tiffin_stock.find_one({"_id": PER_BRANCH_STOCK_KEY}) or {}
        assert data.get("quantity") == int(branch_doc.get("quantity", 0))

    def test_movements_include_mess_id_field(self, franchise_session):
        # The franchise topup test above should have created a movement w/ mess_id
        rows = list(_db.tiffin_stock_movements.find({"mess_id": MESS_ID}).limit(5))
        assert rows, "no movement docs with mess_id field — iter-86 #1 should log mess_id"


# ============================================================================
# Backend #2 — admin per-branch hours
# ============================================================================
class TestPerBranchHoursAdmin:
    def test_admin_post_with_mess_id_writes_to_branch_key(self, admin_session):
        s = admin_session["session"]
        _db.app_settings.delete_one({"_id": PER_BRANCH_HOURS_KEY})
        r = s.post(f"{BASE_URL}/api/admin/restaurant/hours?mess_id={MESS_ID}",
                   json={"mode": "auto", "open_time": "08:15", "close_time": "20:45",
                         "capacity_per_hour": 30, "closed_message": "TEST iter86 branch"},
                   timeout=10)
        assert r.status_code == 200, r.text
        doc = _db.app_settings.find_one({"_id": PER_BRANCH_HOURS_KEY})
        assert doc is not None, "admin per-branch POST should write to restaurant_hours:{mess_id}"
        assert doc.get("open_time") == "08:15"
        assert doc.get("mess_id") == MESS_ID

    def test_admin_get_with_mess_id_returns_branch_scope(self, admin_session):
        s = admin_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/restaurant/hours?mess_id={MESS_ID}", timeout=10)
        assert r.status_code == 200, r.text
        cfg = r.json()
        assert cfg.get("scope") == "branch"
        assert cfg.get("mess_id") == MESS_ID
        assert cfg.get("open_time") == "08:15"


# ============================================================================
# Backend #3 — kiosk GET unlock for franchise_owner
# ============================================================================
class TestKioskGetUnlock:
    def test_get_bt_config_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/kiosk/bt-config", timeout=10)
        assert r.status_code != 403, f"expected NOT 403 for franchise on bt-config, got {r.status_code} {r.text}"
        assert r.status_code == 200, r.text

    def test_get_qr_provider_franchise(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/kiosk/qr-provider", timeout=10)
        assert r.status_code != 403, f"expected NOT 403 for franchise on qr-provider, got {r.status_code} {r.text}"
        assert r.status_code == 200, r.text


# ============================================================================
# Backend #5 — Branch P&L
# ============================================================================
class TestBranchPnl:
    REQUIRED_KEYS = {
        "today_revenue", "total_revenue_window", "order_revenue_window",
        "sub_revenue_window", "fixed_daily_cost", "monthly_target",
        "period_cost", "gross_margin", "gross_margin_pct", "pct_target_hit",
        "days", "mess_id", "scope",
    }

    def test_franchise_pnl_branch_scope(self, franchise_session):
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/branch-pnl?days=30", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        missing = self.REQUIRED_KEYS - set(data.keys())
        assert not missing, f"missing keys in P&L response: {missing}"
        assert data["scope"] == "branch"
        assert data["mess_id"] == MESS_ID
        assert data["days"] == 30

    def test_admin_pnl_global_scope(self, admin_session):
        s = admin_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/branch-pnl?days=30", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["scope"] == "global"
        assert data["mess_id"] in (None, "")

    def test_admin_pnl_peek_branch(self, admin_session):
        s = admin_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/branch-pnl?days=7&mess_id={MESS_ID}", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["scope"] == "branch"
        assert data["mess_id"] == MESS_ID
        assert data["days"] == 7

    def test_pnl_config_defaults(self, franchise_session):
        # ensure clean state
        _db.app_settings.delete_one({"_id": PER_BRANCH_COSTS_KEY})
        s = franchise_session["session"]
        r = s.get(f"{BASE_URL}/api/admin/branch-pnl/config", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["mess_id"] == MESS_ID
        assert data["fixed_daily_cost"] == 1500
        assert data["monthly_target"] == 150000

    def test_pnl_config_post_persists(self, franchise_session):
        s = franchise_session["session"]
        r = s.post(f"{BASE_URL}/api/admin/branch-pnl/config",
                   json={"fixed_daily_cost": 2500, "monthly_target": 200000}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["fixed_daily_cost"] == 2500
        assert data["monthly_target"] == 200000
        # Verify via GET
        r2 = s.get(f"{BASE_URL}/api/admin/branch-pnl/config", timeout=10)
        assert r2.json()["fixed_daily_cost"] == 2500
        # Verify in mongo
        doc = _db.app_settings.find_one({"_id": PER_BRANCH_COSTS_KEY})
        assert doc and doc.get("fixed_daily_cost") == 2500

    def test_pct_target_hit_computation(self, franchise_session):
        s = franchise_session["session"]
        # Configure known target then read
        s.post(f"{BASE_URL}/api/admin/branch-pnl/config",
               json={"fixed_daily_cost": 100, "monthly_target": 100000}, timeout=10)
        r = s.get(f"{BASE_URL}/api/admin/branch-pnl?days=30", timeout=10)
        data = r.json()
        expected = round((data["total_revenue_window"] / 100000) * 100, 1)
        assert data["pct_target_hit"] == expected, f"got {data['pct_target_hit']}, expected {expected}"
