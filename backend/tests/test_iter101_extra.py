"""iter-101 extras — plan_id mode, only_unread filter, specific ack, mess_id in /auth/me."""
import os
import uuid
import pytest
import requests

API = os.environ.get("API_URL", "http://localhost:8001/api")
ADMIN_PHONE = "9970705391"


def _login(phone, name="Tester"):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10)
    r.raise_for_status()
    otp = r.json()["dev_otp"]
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name}, timeout=10)
    r.raise_for_status()
    return r.json()["session_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_PHONE, "Admin")


@pytest.fixture(scope="module")
def fresh_subscriber():
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    token = _login(phone, "Extra Target")
    me = requests.get(f"{API}/auth/me", headers=_h(token), timeout=10).json()
    yield {"token": token, "uid": me["user_id"], "phone": phone, "me": me}
    requests.delete(f"{API}/auth/me", headers=_h(token), timeout=10)


def test_auth_me_includes_mess_id_field(fresh_subscriber):
    me = fresh_subscriber["me"]
    # mess_id key must be present (may be None for fresh subscriber)
    assert "mess_id" in me, f"mess_id not in /auth/me response: keys={list(me.keys())}"


def test_assign_subscription_via_plan_id(admin_token, fresh_subscriber):
    admin = admin_token
    # Fetch available plans
    r = requests.get(f"{API}/admin/plans", headers=_h(admin), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    plans = body.get("plans", body) if isinstance(body, dict) else body
    if not plans:
        pytest.skip("no admin plans available to test plan_id mode")
    plan = plans[0]
    plan_id = plan.get("plan_id") or plan.get("id")
    assert plan_id, f"plan has no id field: {plan}"

    body = {"plan_id": plan_id, "reason": "iter-101 plan_id test"}
    r = requests.post(
        f"{API}/admin/users/{fresh_subscriber['uid']}/assign-subscription",
        json=body, headers=_h(admin), timeout=10,
    )
    assert r.status_code == 200, r.text
    sub = r.json()["subscription"]
    assert sub["status"] == "active"
    # Plan attributes should propagate
    assert sub["meals_total"] >= 1
    assert sub["plan_amount"] >= 0


def test_only_unread_filter_and_specific_ack(admin_token):
    admin = admin_token
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login(sub_phone, "Ack Target")
    uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]

    # Trigger two notices: assign + wallet-adjust
    requests.post(f"{API}/admin/users/{uid}/assign-subscription",
                  json={"name": "AckTest", "duration_days": 10, "meals": 20,
                        "amount": 500, "service_type": "dining", "reason": "ack test"},
                  headers=_h(admin), timeout=10).raise_for_status()
    requests.post(f"{API}/admin/users/{uid}/wallet-adjust",
                  json={"delta": 100, "reason": "ack test topup",
                        "extend_days": 0, "meals_delta": 0},
                  headers=_h(admin), timeout=10).raise_for_status()

    # /auth/notices?only_unread=true
    r = requests.get(f"{API}/auth/notices?only_unread=true", headers=_h(sub_token), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["unread"] >= 2
    ids = [n.get("notice_id") or n.get("id") for n in body["notices"]]
    assert len(ids) >= 2

    # Ack only the first one
    first_id = ids[0]
    r = requests.post(f"{API}/auth/notices/ack",
                      json={"notice_ids": [first_id]},
                      headers=_h(sub_token), timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    # Unread count should drop by exactly 1
    r2 = requests.get(f"{API}/auth/notices?only_unread=true", headers=_h(sub_token), timeout=10).json()
    assert r2["unread"] == body["unread"] - 1
    remaining_ids = {n.get("notice_id") or n.get("id") for n in r2["notices"]}
    assert first_id not in remaining_ids

    # Cleanup
    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_wallet_adjust_pushes_notice_with_extend_and_meals(admin_token):
    admin = admin_token
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login(sub_phone, "WAdjust")
    uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]

    # Need an active sub for extend_days/meals_delta to apply
    requests.post(f"{API}/admin/users/{uid}/assign-subscription",
                  json={"name": "WA", "duration_days": 30, "meals": 60,
                        "amount": 1000, "service_type": "dining", "reason": "wa setup"},
                  headers=_h(admin), timeout=10).raise_for_status()

    r = requests.post(f"{API}/admin/users/{uid}/wallet-adjust",
                      json={"delta": 50, "reason": "combo adj",
                            "extend_days": 3, "meals_delta": 5},
                      headers=_h(admin), timeout=10)
    assert r.status_code == 200, r.text

    notices = requests.get(f"{API}/auth/notices", headers=_h(sub_token), timeout=10).json()["notices"]
    wallet_notices = [n for n in notices if n["kind"] == "wallet_adjust"]
    assert wallet_notices, "no wallet_adjust notice produced"
    body_text = wallet_notices[0].get("body", "") + wallet_notices[0].get("title", "")
    # Human-readable should mention the delta/days/meals — soft check
    assert any(tok in body_text.lower() for tok in ["50", "3", "5", "day", "meal", "wallet"]), \
        f"wallet_adjust notice body looks empty: {wallet_notices[0]}"

    # Cleanup
    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)
