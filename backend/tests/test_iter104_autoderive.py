"""iter-104 regression — wallet-delta auto-derives days/meals + new 4-day pause threshold."""
import os
import uuid
import asyncio
import pytest
import requests
from datetime import date, timedelta

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


def test_wallet_debit_auto_deducts_days_and_meals(admin_token):
    """Admin debits ₹279 at ₹93/day → derived −3 days, −6 meals (used += 6)."""
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter104 Deduct")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)

    # Admin assigns a 30-day / 60-meal / ₹2790 plan (per_day = 93)
    body = {"name": "Iter104 plan", "duration_days": 30, "meals": 60, "amount": 2790,
            "service_type": "dining", "reason": "iter-104 base"}
    r = requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                      json=body, headers=_h(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    sub_before = r.json()["subscription"]
    assert sub_before["per_day_amount"] == 93.0
    end_before = sub_before["end_date"]

    # Admin debits ₹279 (= 3 days). No explicit extend_days / meals_delta.
    r = requests.post(
        f"{API}/admin/users/{sub_uid}/wallet-adjust",
        json={"delta": -279, "reason": "iter-104 auto-deduct check"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    audit = r.json()
    assert audit["auto_derived"]["days"] == -3
    assert audit["auto_derived"]["meals"] == -6
    assert audit["extend_days"] == -3
    assert audit["meals_delta"] == -6

    # Verify the sub doc reflects the auto-derived changes
    r = requests.get(f"{API}/my/subscription", headers=_h(sub_token), timeout=10).json()
    sub_after = r["subscription"]
    assert sub_after["meals_used"] == 6
    assert sub_after["wallet_balance"] == sub_before["wallet_balance"] - 279
    # end_date pulled back 3 days
    from datetime import datetime
    pulled = (datetime.fromisoformat(end_before.replace("Z", "+00:00")) - timedelta(days=3))
    assert sub_after["end_date"].startswith(pulled.date().isoformat())

    # Cleanup
    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_wallet_credit_auto_restores_days_and_meals(admin_token):
    """Admin credits ₹186 at ₹93/day → derived +2 days, +4 meals (restore)."""
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter104 Credit")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)

    body = {"name": "Iter104 plan", "duration_days": 30, "meals": 60, "amount": 2790,
            "service_type": "dining", "reason": "base"}
    requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                  json=body, headers=_h(admin_token), timeout=10).raise_for_status()
    # Manually consume some meals so restore can land somewhere
    async def bump(db):
        await db.subscriptions.update_one(
            {"user_id": sub_uid, "status": "active"},
            {"$set": {"meals_used": 10}},
        )
    _db_run(bump)

    r = requests.post(
        f"{API}/admin/users/{sub_uid}/wallet-adjust",
        json={"delta": 186, "reason": "iter-104 auto-credit check"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    audit = r.json()
    assert audit["auto_derived"]["days"] == 2
    assert audit["auto_derived"]["meals"] == 4

    sub_after = requests.get(f"{API}/my/subscription", headers=_h(sub_token), timeout=10).json()["subscription"]
    assert sub_after["meals_used"] == 6  # 10 - 4

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_explicit_extend_or_meals_skips_auto_derive(admin_token):
    """If admin sets extend_days OR meals_delta explicitly, auto-derive stays at 0."""
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter104 Explicit")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)
    requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                  json={"name": "p", "duration_days": 30, "meals": 60, "amount": 2790,
                        "service_type": "dining", "reason": "base"},
                  headers=_h(admin_token), timeout=10).raise_for_status()

    # Admin gives ₹279 BUT specifies meals_delta=2 — should NOT auto-derive
    r = requests.post(
        f"{API}/admin/users/{sub_uid}/wallet-adjust",
        json={"delta": 279, "meals_delta": 2, "reason": "explicit"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    audit = r.json()
    assert audit["auto_derived"]["days"] == 0
    assert audit["auto_derived"]["meals"] == 0
    assert audit["meals_delta"] == 2

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_pause_threshold_starts_at_day_4(admin_token):
    """Brand-new sub, no scans, simulate 4 days of tick → first 3 days deduct, day 4 pauses."""
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter104 Pause")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)
    requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                  json={"name": "p", "duration_days": 30, "meals": 60, "amount": 2790,
                        "service_type": "dining", "reason": "base"},
                  headers=_h(admin_token), timeout=10).raise_for_status()

    # Push last_tick_date back by 4 days so the next /my/subscription call processes 4 ticks
    async def backdate(db):
        sub = await db.subscriptions.find_one({"user_id": sub_uid, "status": "active"}, {"_id": 0})
        start = date.fromisoformat(sub["start_date"][:10])
        # Make start = today - 4 days, last_tick = today - 4 days, so the
        # tick has to advance 4 calendar days.
        new_start = (date.today() - timedelta(days=4)).isoformat() + "T00:00:00+00:00"
        await db.subscriptions.update_one(
            {"user_id": sub_uid, "status": "active"},
            {"$set": {"start_date": new_start, "last_tick_date": (date.today() - timedelta(days=4)).isoformat()}},
        )
    _db_run(backdate)

    # Triggering /my/subscription runs the tick.
    sub_after = requests.get(f"{API}/my/subscription", headers=_h(sub_token), timeout=10).json()["subscription"]

    # First 3 days deducted (₹93 × 3 = ₹279), 6 meals consumed.
    # Day 4 paused (no debit), paused_days = 1.
    assert sub_after["meals_used"] == 6, sub_after
    assert sub_after["wallet_balance"] == 2790 - 279, sub_after
    assert sub_after["paused_days"] == 1, sub_after

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)
