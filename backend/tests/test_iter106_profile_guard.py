"""iter-106 regression — admin blocked from wallet/sub adjust on incomplete profile."""
import os
import uuid
import asyncio
import pytest
import requests

API = os.environ.get("API_URL", "http://localhost:8001/api")
ADMIN_PHONE = "9970705391"


def _login_otp(phone, name="Test"):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10)
    r.raise_for_status()
    otp = r.json()["dev_otp"]
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name}, timeout=10)
    r.raise_for_status()
    return r.json()["session_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login_otp(ADMIN_PHONE, "Admin")


def _db_run(fn):
    async def runner():
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        try:
            return await fn(db)
        finally:
            cli.close()
    return asyncio.run(runner())


def test_profile_status_endpoint(admin_token):
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter106 No Address")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]

    r = requests.get(f"{API}/admin/users/{sub_uid}/profile-status", headers=_h(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["complete"] is False
    assert "address" in data["missing"]
    assert set(data["required"]) == {"name", "phone", "address"}

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_wallet_adjust_blocked_on_incomplete_profile(admin_token):
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter106 Adjust Blocked")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]

    r = requests.post(
        f"{API}/admin/users/{sub_uid}/wallet-adjust",
        json={"delta": 500, "reason": "x"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 400, r.text
    assert "address" in r.json()["detail"]

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_assign_subscription_blocked_on_incomplete_profile(admin_token):
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter106 Assign Blocked")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]

    body = {"name": "p", "duration_days": 30, "meals": 60, "amount": 2790,
            "service_type": "dining", "reason": "trying to onboard"}
    r = requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                      json=body, headers=_h(admin_token), timeout=10)
    assert r.status_code == 400, r.text
    assert "address" in r.json()["detail"]

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_complete_profile_allows_adjust(admin_token):
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter106 Complete")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]

    # Fill in the missing address
    async def fill(db):
        await db.users.update_one({"user_id": sub_uid}, {"$set": {"address": "Main St, Amravati"}})
    _db_run(fill)

    # Now profile-status should report complete
    r = requests.get(f"{API}/admin/users/{sub_uid}/profile-status", headers=_h(admin_token), timeout=10).json()
    assert r["complete"] is True

    # And assignment should now succeed
    body = {"name": "p", "duration_days": 30, "meals": 60, "amount": 2790,
            "service_type": "dining", "reason": "post-completion"}
    r = requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                      json=body, headers=_h(admin_token), timeout=10)
    assert r.status_code == 200, r.text

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)
