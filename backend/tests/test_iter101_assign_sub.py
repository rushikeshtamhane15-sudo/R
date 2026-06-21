"""iter-101 regression — admin assign-subscription + user notices + hardened delete."""
import os
import uuid
import pytest
import requests

API = os.environ.get("API_URL", "http://localhost:8001/api")
ADMIN_PHONE = "9970705391"  # ADMIN_PHONES in .env


def _login(phone: str, name: str = "Test") -> str:
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10)
    r.raise_for_status()
    otp = r.json()["dev_otp"]
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name}, timeout=10)
    r.raise_for_status()
    return r.json()["session_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _ensure_address(uid):
    """iter-106: admin endpoints require a complete profile (name/phone/address)."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    async def run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await cli[os.environ["DB_NAME"]].users.update_one(
                {"user_id": uid}, {"$set": {"address": "Test St, Amravati"}}
            )
        finally:
            cli.close()
    asyncio.run(run())


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_PHONE, "Admin")


def test_assign_subscription_custom_and_notice_flow(admin_token):
    admin = admin_token
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login(sub_phone, "Iter101 Target")
    me = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()
    sub_uid = me["user_id"]
    _ensure_address(sub_uid)

    # 1) Notices empty initially
    r = requests.get(f"{API}/auth/notices", headers=_h(sub_token), timeout=10).json()
    assert r["unread"] == 0
    assert r["notices"] == []

    # 2) Admin assigns a custom subscription
    body = {
        "name": "Iter101 Walk-in",
        "duration_days": 15,
        "meals": 30,
        "amount": 1500,
        "service_type": "dining",
        "reason": "iter-101 pytest",
    }
    r = requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                      json=body, headers=_h(admin), timeout=10)
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["ok"] is True
    new_sub = payload["subscription"]
    assert new_sub["meals_total"] == 30
    assert new_sub["plan_amount"] == 1500.0
    assert new_sub["status"] == "active"
    assert payload["user_wallet"] >= 1500.0

    # 3) User sees the subscription via /my/subscription
    r = requests.get(f"{API}/my/subscription", headers=_h(sub_token), timeout=10).json()
    assert r["active"] is True
    assert r["subscription"]["meals_total"] == 30

    # 4) User has unread notice
    r = requests.get(f"{API}/auth/notices", headers=_h(sub_token), timeout=10).json()
    assert r["unread"] >= 1
    kinds = {n["kind"] for n in r["notices"]}
    assert "subscription_assigned" in kinds

    # 5) Admin tops up wallet → second notice
    r = requests.post(
        f"{API}/admin/users/{sub_uid}/wallet-adjust",
        json={"delta": 200, "reason": "iter-101 topup", "extend_days": 0, "meals_delta": 0},
        headers=_h(admin), timeout=10,
    )
    assert r.status_code == 200, r.text

    r = requests.get(f"{API}/auth/notices", headers=_h(sub_token), timeout=10).json()
    kinds = {n["kind"] for n in r["notices"]}
    assert "wallet_adjust" in kinds

    # 6) Acknowledge all → unread = 0
    r = requests.post(f"{API}/auth/notices/ack", json={"all": True}, headers=_h(sub_token), timeout=10).json()
    assert r["ok"] is True
    r = requests.get(f"{API}/auth/notices", headers=_h(sub_token), timeout=10).json()
    assert r["unread"] == 0

    # 7) Account deletion works even with subs / overrides / notices in flight
    r = requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)
    assert r.status_code == 200, r.text
    counts = r.json()["counts"]
    assert counts["users"] == 1
    assert counts["subscriptions"] >= 1
    assert counts["admin_user_notices"] >= 2


def test_assign_subscription_replace_requires_explicit_flag(admin_token):
    admin = admin_token
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login(sub_phone, "Iter101 Replace")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)

    # First assignment
    body = {"name": "First", "duration_days": 10, "meals": 20, "amount": 1000,
            "service_type": "dining", "reason": "first"}
    r = requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                      json=body, headers=_h(admin), timeout=10)
    assert r.status_code == 200, r.text

    # Second with replace_active=false should 409
    r = requests.post(
        f"{API}/admin/users/{sub_uid}/assign-subscription",
        json={**body, "name": "Second", "replace_active": False},
        headers=_h(admin), timeout=10,
    )
    assert r.status_code == 409

    # Cleanup
    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_assign_subscription_validates_inputs(admin_token):
    admin = admin_token
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login(sub_phone, "Iter101 Validate")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)

    # Missing reason → 400
    r = requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                      json={"name": "x", "duration_days": 10, "meals": 20, "amount": 100, "reason": ""},
                      headers=_h(admin), timeout=10)
    assert r.status_code == 400

    # No plan_id and missing custom fields → 400
    r = requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                      json={"reason": "missing"}, headers=_h(admin), timeout=10)
    assert r.status_code == 400

    # Out-of-range days → 400
    r = requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                      json={"name": "x", "duration_days": 9999, "meals": 20, "amount": 100, "reason": "x"},
                      headers=_h(admin), timeout=10)
    assert r.status_code == 400

    # Cleanup
    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)
