"""iter-107 regression — async account-delete + expiring-subs endpoint."""
import os
import uuid
import asyncio
import pytest
import requests
from datetime import timedelta, datetime, timezone

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


def _ensure_address(uid):
    async def run():
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
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


def test_delete_account_returns_fast_with_async_cascade():
    """User row + sessions should be gone immediately, status=200, mode=async_cascade."""
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    token = _login_otp(phone, "Iter107 Delete")

    import time
    t0 = time.time()
    r = requests.delete(f"{API}/auth/me", headers=_h(token), timeout=10)
    elapsed = time.time() - t0

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["mode"] in ("async_cascade", "sync_fallback")
    assert body["deleted"] is True
    # Foreground step should be very fast even with no data
    assert elapsed < 2.0, f"delete took {elapsed:.2f}s — slower than the 2s SLA"

    # Subsequent /auth/me should 401 (session is gone)
    r = requests.get(f"{API}/auth/me", headers=_h(token), timeout=10)
    assert r.status_code == 401

    # Eventually the cascade collections are clean — give it a moment
    async def verify(db):
        await asyncio.sleep(0.5)
        u = await db.users.find_one({"phone": phone})
        assert u is None, "user row should be gone"
    _db_run(verify)


def test_expiring_subscriptions_lists_users_with_phone(admin_token):
    """Seed an active sub that expires in 2 days → it shows up in the alert list."""
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter107 Expiring")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)
    # Assign a sub then backdate its end_date
    requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                  json={"name": "Expiring Plan", "duration_days": 30, "meals": 60, "amount": 2790,
                        "service_type": "dining", "reason": "iter-107"},
                  headers=_h(admin_token), timeout=10).raise_for_status()

    async def backdate(db):
        end = datetime.now(timezone.utc) + timedelta(days=2)
        await db.subscriptions.update_one(
            {"user_id": sub_uid, "status": "active"},
            {"$set": {"end_date": end.isoformat()}},
        )
    _db_run(backdate)

    r = requests.get(f"{API}/admin/expiring-subscriptions?within_days=3",
                     headers=_h(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    matched = [s for s in data["subscriptions"] if s["user_id"] == sub_uid]
    assert len(matched) == 1
    m = matched[0]
    assert m["name"] == "Iter107 Expiring"
    assert m["phone"] == sub_phone
    assert m["plan_name"] == "Expiring Plan"
    # iter-108: plan_id now in the payload so the UI can build a 1-click renew link
    assert m["plan_id"], "plan_id must be present for the renew deep-link"
    assert 0 <= m["days_left"] <= 3
    assert m["meals_left"] == 60

    # Cleanup
    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_expiring_subscriptions_excludes_far_future(admin_token):
    """A sub expiring in 30 days should NOT appear in the 3-day window."""
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter107 Far")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)
    requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                  json={"name": "Far", "duration_days": 30, "meals": 60, "amount": 2790,
                        "service_type": "dining", "reason": "iter-107 far"},
                  headers=_h(admin_token), timeout=10).raise_for_status()

    r = requests.get(f"{API}/admin/expiring-subscriptions?within_days=3",
                     headers=_h(admin_token), timeout=10).json()
    assert sub_uid not in {s["user_id"] for s in r["subscriptions"]}

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_expiring_subscriptions_admin_only(admin_token):
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter107 NotAdmin")

    r = requests.get(f"{API}/admin/expiring-subscriptions?within_days=3",
                     headers=_h(sub_token), timeout=10)
    assert r.status_code == 403

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)
