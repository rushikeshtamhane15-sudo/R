"""iter-171 · Subscription tabs + Active dining/tiffin stat split tests.

Covers:
  1. GET /api/admin/subscriptions/tabs?tab={active,expiring,expired}
     - auth 401, subscriber 403
     - shape of rows
     - super-admin (no impersonation) sees platform-wide
     - impersonated mess-owner scope filters to that mess
     - expiring window == status=active AND end_date <= now+3d
     - expired == status IN (expired, cancelled), sorted end_date DESC
  2. GET /api/admin/stats includes active_dining + active_tiffin ints,
     and (active_dining + active_tiffin) == active_subscriptions.
"""
import os
import uuid
import time
import requests
import pytest
from datetime import datetime, timedelta, timezone

def _read_env_url():
    if os.environ.get("REACT_APP_BACKEND_URL"):
        return os.environ["REACT_APP_BACKEND_URL"]
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _read_env_url().rstrip("/")
API = f"{BASE_URL}/api"

SUPER_ADMIN_PHONE = "9970705391"


# ----------------------------- helpers ---------------------------------
def _login(phone: str, name: str | None = None) -> str:
    # Cache admin tokens to /tmp so re-runs don't hit OTP rate-limit (10 min per phone).
    import json as _json
    cache_path = "/tmp/iter158_tokens.json"
    cache = {}
    if os.path.exists(cache_path):
        try:
            cache = _json.loads(open(cache_path).read())
        except Exception:
            cache = {}
    tok = cache.get(phone)
    if tok:
        p = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        if p.status_code == 200:
            return tok
    for _ in range(2):
        r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
        if r.status_code == 429:
            time.sleep(65); continue
        assert r.status_code == 200, r.text
        otp = r.json().get("dev_otp")
        assert otp, r.json()
        body = {"phone": phone, "otp": otp}
        if name:
            body["name"] = name
            body["mess_id"] = "efoodcare-amravati"
        r = requests.post(f"{API}/auth/verify-otp", json=body, timeout=15)
        assert r.status_code == 200, r.text
        tok = r.json()["session_token"]
        cache[phone] = tok
        try: open(cache_path, "w").write(_json.dumps(cache))
        except Exception: pass
        return tok
    raise RuntimeError("rate-limited")


@pytest.fixture(scope="module")
def admin_token():
    return _login(SUPER_ADMIN_PHONE)


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def subscriber_token():
    # Fresh subscriber phone, dev OTP, name; role stays subscriber by default
    phone = "9" + str(int(time.time() * 1000))[-9:]
    return _login(phone, name="TEST_iter171_sub")


@pytest.fixture(scope="module")
def subscriber_headers(subscriber_token):
    return {"Authorization": f"Bearer {subscriber_token}", "Content-Type": "application/json"}


# ----------------------------- 1) auth gates -----------------------------
class TestSubscriptionTabsAuth:
    def test_401_without_auth(self):
        r = requests.get(f"{API}/admin/subscriptions/tabs?tab=active", timeout=15)
        assert r.status_code in (401, 403), r.text  # FastAPI security may return either

    def test_403_for_subscriber(self, subscriber_headers):
        r = requests.get(
            f"{API}/admin/subscriptions/tabs?tab=active",
            headers=subscriber_headers, timeout=15,
        )
        assert r.status_code == 403, r.text


# ----------------------------- 2) response shape -------------------------
class TestSubscriptionTabsShape:
    @pytest.mark.parametrize("tab", ["active", "expiring", "expired"])
    def test_shape(self, admin_headers, tab):
        r = requests.get(f"{API}/admin/subscriptions/tabs?tab={tab}",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["tab"] == tab
        assert isinstance(data["count"], int)
        assert isinstance(data["rows"], list)
        assert "mess_id" in data
        # If any rows present, verify row shape
        if data["rows"]:
            row = data["rows"][0]
            for k in ("sub_id", "user_id", "name", "phone", "plan_id", "plan_name",
                      "service_type", "meals_left", "days_left", "renewal_date",
                      "status", "status_label"):
                assert k in row, f"missing {k} in row keys {list(row.keys())}"
            assert row["service_type"] in ("dining", "tiffin")

    def test_super_admin_global_scope(self, admin_headers):
        r = requests.get(f"{API}/admin/subscriptions/tabs?tab=active",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # Super-admin without impersonation → mess_id null → platform scope
        assert d["mess_id"] in (None, ""), d["mess_id"]


# --------------------- 3) active vs expiring split -----------------------
class TestActiveVsExpiring:
    def test_active_excludes_within_3d(self, admin_headers):
        ra = requests.get(f"{API}/admin/subscriptions/tabs?tab=active",
                          headers=admin_headers, timeout=30).json()
        rx = requests.get(f"{API}/admin/subscriptions/tabs?tab=expiring",
                          headers=admin_headers, timeout=30).json()
        # Row status_labels on active tab should never be "Expired"
        for row in ra["rows"]:
            assert row["status"] == "active"
            assert row["status_label"] != "Expired"
            assert row["days_left"] > 3 or row["days_left"] == 0  # allow clamp
        # Rows on expiring tab are active-status with label "Expiring" (per code)
        for row in rx["rows"]:
            assert row["status"] == "active"
            # status_label from route: "Expiring" when tab == expiring
            assert row["status_label"] == "Expiring"

    def test_expired_status_and_sort(self, admin_headers):
        re_ = requests.get(f"{API}/admin/subscriptions/tabs?tab=expired",
                           headers=admin_headers, timeout=30).json()
        for row in re_["rows"]:
            assert row["status"] in ("expired", "cancelled")
        # Sorted end_date DESC
        dates = [r["renewal_date"] for r in re_["rows"] if r["renewal_date"]]
        assert dates == sorted(dates, reverse=True), "expired rows not sorted DESC by end_date"


# ----------------------- 4) admin/stats split ---------------------------
class TestAdminStatsSplit:
    def test_active_dining_and_tiffin_keys(self, admin_headers):
        r = requests.get(f"{API}/admin/stats", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "active_dining" in d, d.keys()
        assert "active_tiffin" in d, d.keys()
        assert isinstance(d["active_dining"], int)
        assert isinstance(d["active_tiffin"], int)
        assert d["active_dining"] + d["active_tiffin"] == d["active_subscriptions"], (
            f"active_dining({d['active_dining']}) + active_tiffin({d['active_tiffin']}) "
            f"!= active_subscriptions({d['active_subscriptions']})"
        )
        # Super-admin no impersonation → scope=global
        assert d.get("scope") == "global"


# --------------------- 5) mess-owner impersonation scope -----------------
class TestImpersonatedScope:
    def test_impersonated_mess_scope(self, admin_headers):
        # Pick any mess to impersonate
        messes = requests.get(f"{API}/admin/messes", headers=admin_headers, timeout=15)
        if messes.status_code != 200:
            pytest.skip(f"cannot list messes: {messes.status_code}")
        rows = messes.json().get("messes") or messes.json().get("rows") or []
        if not rows:
            pytest.skip("no mess available to impersonate")
        target = rows[0]
        mid = target.get("mess_id") or target.get("id")
        if not mid:
            pytest.skip(f"no mess_id key in {target}")

        try:
            imp = requests.post(f"{API}/admin/impersonate/{mid}",
                                headers=admin_headers, timeout=15)
            assert imp.status_code == 200, imp.text

            tabs = requests.get(f"{API}/admin/subscriptions/tabs?tab=active",
                                headers=admin_headers, timeout=30)
            assert tabs.status_code == 200, tabs.text
            data = tabs.json()
            assert data["mess_id"] == mid, f"expected mess_id={mid}, got {data['mess_id']}"

            stats = requests.get(f"{API}/admin/stats",
                                 headers=admin_headers, timeout=30).json()
            assert stats.get("scope") == "branch"
            assert stats["active_dining"] + stats["active_tiffin"] == stats["active_subscriptions"]
        finally:
            requests.delete(f"{API}/admin/impersonate",
                            headers=admin_headers, timeout=15)
