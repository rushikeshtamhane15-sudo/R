"""Iter-47 refactor smoke tests.

Validates that the 4 newly-extracted routers (plans, wallet, subscription,
restaurant_orders) still respond identically to iter-46 endpoints.
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

ADMIN_PHONE = "9970705391"
SUB_PHONE = "9876543210"


# ------------- helpers -------------
def _otp_login(phone: str, name: str | None = None) -> str | None:
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    if r.status_code == 429:
        return None  # rate-limited; caller falls back to env-supplied token
    assert r.status_code == 200, f"send-otp failed: {r.status_code} {r.text}"
    otp = r.json().get("dev_otp")
    assert otp, f"no dev_otp in response: {r.text}"
    payload = {"phone": phone, "otp": otp}
    if name:
        payload["name"] = name
    rv = requests.post(f"{API}/auth/verify-otp", json=payload, timeout=15)
    assert rv.status_code == 200, f"verify-otp failed: {rv.status_code} {rv.text}"
    j = rv.json()
    return j.get("session_token") or j.get("token") or j.get("access_token")


@pytest.fixture(scope="module")
def admin_token():
    tok = _otp_login(ADMIN_PHONE, name="AdminIter47") or os.environ.get("ADMIN_SESSION_TOKEN")
    if not tok:
        pytest.skip("admin token unavailable (OTP rate-limited and ADMIN_SESSION_TOKEN env not set)")
    return tok


@pytest.fixture(scope="module")
def sub_token():
    tok = _otp_login(SUB_PHONE, name="SubIter47") or os.environ.get("SUB_SESSION_TOKEN")
    if not tok:
        pytest.skip("subscriber token unavailable (OTP rate-limited and SUB_SESSION_TOKEN env not set)")
    return tok


# ------------- public/unauth smoke -------------
class TestPublicSmoke:
    def test_get_plans_public(self):
        r = requests.get(f"{API}/plans", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "plans" in data
        assert isinstance(data["plans"], list)

    def test_admin_plans_unauth(self):
        r = requests.get(f"{API}/admin/plans", timeout=15)
        assert r.status_code in (401, 403)

    def test_my_wallet_unauth(self):
        r = requests.get(f"{API}/my/wallet", timeout=15)
        assert r.status_code in (401, 403)

    def test_my_subscription_unauth(self):
        r = requests.get(f"{API}/my/subscription", timeout=15)
        assert r.status_code in (401, 403)

    def test_restaurant_menu_public(self):
        r = requests.get(f"{API}/restaurant/menu", timeout=15)
        assert r.status_code == 200

    def test_restaurant_order_unauth(self):
        r = requests.post(f"{API}/restaurant/order", json={"items": []}, timeout=15)
        assert r.status_code in (401, 403)

    def test_restaurant_orders_list_unauth(self):
        r = requests.get(f"{API}/restaurant/orders", timeout=15)
        assert r.status_code in (401, 403)


# ------------- admin plans CRUD -------------
class TestAdminPlansCRUD:
    def test_create_list_delete_plan(self, admin_token):
        h = {"Authorization": f"Bearer {admin_token}"}
        plan_id = f"TEST_iter47_{uuid.uuid4().hex[:6]}"
        plan_payload = {
            "plan_id": plan_id,
            "name": "TEST iter47 plan",
            "description": "regression smoke",
            "amount": 1,
            "meals": 1,
            "duration_days": 1,
            "active": True,
            "sort_order": 999,
        }
        r = requests.post(f"{API}/admin/plans", json=plan_payload, headers=h, timeout=15)
        assert r.status_code in (200, 201), f"create plan failed: {r.status_code} {r.text}"

        # list
        rl = requests.get(f"{API}/admin/plans", headers=h, timeout=15)
        assert rl.status_code == 200
        plans = rl.json().get("plans", [])
        ids = [p.get("plan_id") for p in plans]
        assert plan_id in ids, f"created plan {plan_id} not in admin list (ids={ids})"

        # delete
        rd = requests.delete(f"{API}/admin/plans/{plan_id}", headers=h, timeout=15)
        assert rd.status_code in (200, 204)

        # verify removed
        rl2 = requests.get(f"{API}/admin/plans", headers=h, timeout=15)
        ids2 = [p.get("plan_id") for p in rl2.json().get("plans", [])]
        assert plan_id not in ids2


# ------------- subscriber wallet + subscription -------------
class TestSubscriberWalletSubscription:
    def test_my_wallet_shape(self, sub_token):
        h = {"Authorization": f"Bearer {sub_token}"}
        r = requests.get(f"{API}/my/wallet", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("wallet_balance", "subscription", "per_day_amount", "paused_days", "inactivity_threshold_days"):
            assert k in d, f"missing key {k} in /my/wallet response: {d}"

    def test_my_wallet_transactions(self, sub_token):
        h = {"Authorization": f"Bearer {sub_token}"}
        r = requests.get(f"{API}/my/wallet/transactions", headers=h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "transactions" in d
        assert isinstance(d["transactions"], list)

    def test_my_subscription_shape(self, sub_token):
        h = {"Authorization": f"Bearer {sub_token}"}
        r = requests.get(f"{API}/my/subscription", headers=h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "active" in d
        assert "subscription" in d

    def test_pause_resume_without_active_sub(self, sub_token):
        h = {"Authorization": f"Bearer {sub_token}"}
        # Fetch current state — only run 404 assertion if there's no active sub
        rs = requests.get(f"{API}/my/subscription", headers=h, timeout=15)
        if rs.status_code == 200 and rs.json().get("active"):
            pytest.skip("Subscriber has an active subscription; pause/resume 404 path not applicable")
        rp = requests.post(f"{API}/my/subscription/pause", headers=h, timeout=15)
        assert rp.status_code == 404, f"expected 404 without active sub: {rp.status_code} {rp.text}"
        rr = requests.post(f"{API}/my/subscription/resume", headers=h, timeout=15)
        assert rr.status_code == 404


# ------------- restaurant orders end-to-end -------------
class TestRestaurantOrderFlow:
    def test_order_create_list_verify_route_exists(self, sub_token):
        h = {"Authorization": f"Bearer {sub_token}"}

        # Find a menu item
        m = requests.get(f"{API}/restaurant/menu", timeout=15)
        assert m.status_code == 200
        menu_data = m.json()
        # menu may be {"menu":[...]} or list — handle both
        items = menu_data.get("items") if isinstance(menu_data, dict) else menu_data
        if not items:
            items = menu_data.get("menu") if isinstance(menu_data, dict) else None
        if not items:
            # try nested categories
            cats = menu_data.get("categories") if isinstance(menu_data, dict) else None
            if cats:
                for c in cats:
                    if c.get("items"):
                        items = c["items"]
                        break
        assert items, f"no menu items found in /restaurant/menu: {menu_data}"
        first = items[0]
        item_id = first.get("id") or first.get("_id") or first.get("item_id")
        assert item_id, f"no id field on menu item: {first}"

        payload = {
            "items": [{"id": item_id, "qty": 1}],
            "apply_wallet": False,
            # Iter-54: include Pune coords so geo-block passes
            "customer_lat": 18.5204,
            "customer_lng": 73.8567,
        }
        r = requests.post(f"{API}/restaurant/order", json=payload, headers=h, timeout=20)
        # Accept 200/201 success; also allow 400 if menu items lack price (won't fail entire iter)
        assert r.status_code in (200, 201), f"order create failed: {r.status_code} {r.text}"
        ord_resp = r.json()
        order_id = ord_resp.get("order_id") or ord_resp.get("id")
        assert order_id, f"no order_id in response: {ord_resp}"

        # GET orders should include this order
        ro = requests.get(f"{API}/restaurant/orders", headers=h, timeout=15)
        assert ro.status_code == 200
        orders_data = ro.json()
        order_list = orders_data.get("orders") if isinstance(orders_data, dict) else orders_data
        ids = [o.get("order_id") or o.get("id") for o in order_list]
        assert order_id in ids, f"created order {order_id} not in user's order list"

        # Verify route still exists — call with fake signature, expect 400/422 (NOT 404)
        rv = requests.post(
            f"{API}/restaurant/verify",
            json={
                "razorpay_order_id": "order_mock_fake",
                "razorpay_payment_id": "pay_mock_fake",
                "razorpay_signature": "deadbeef",
                "order_id": order_id,
            },
            headers=h,
            timeout=15,
        )
        assert rv.status_code != 404, f"/restaurant/verify route missing (404): {rv.text}"
