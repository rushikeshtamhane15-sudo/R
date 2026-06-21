"""iter-105 regression — snap admin delta to per-day buckets + reconcile drift."""
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


def _ensure_address(uid):
    """iter-106: admin endpoints now require a complete profile (name/phone/address).
    Tests create users via OTP which leaves address blank — fill it here."""
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


def _assign(admin_token, sub_token, amount=2790, duration=30, meals=60):
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)  # iter-106 guard
    requests.post(f"{API}/admin/users/{sub_uid}/assign-subscription",
                  json={"name": "p", "duration_days": duration, "meals": meals, "amount": amount,
                        "service_type": "dining", "reason": "base"},
                  headers=_h(admin_token), timeout=10).raise_for_status()
    return sub_uid


def test_admin_delta_snaps_to_per_day_bucket(admin_token):
    """Admin enters −₹300 at ₹93/day → wallet actually moves by −₹279 (3 days)."""
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter105 Snap")
    sub_uid = _assign(admin_token, sub_token)  # ₹2790, ₹93/day

    r = requests.post(
        f"{API}/admin/users/{sub_uid}/wallet-adjust",
        json={"delta": -300, "reason": "iter-105 snap test"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    audit = r.json()
    assert audit["auto_derived"]["days"] == -3
    assert audit["auto_derived"]["snapped_delta"] == -279.0
    assert audit["auto_derived"]["residue"] == -21.0
    assert audit["delta"] == -279.0  # snapped value persisted

    sub_after = requests.get(f"{API}/my/subscription", headers=_h(sub_token), timeout=10).json()["subscription"]
    # wallet ₹2790 - ₹279 = ₹2511; meals_used = 6 (meals_left = 54)
    assert sub_after["wallet_balance"] == 2511.0
    assert sub_after["meals_used"] == 6
    # invariant: wallet ≈ meals_left * per_meal
    meals_left = sub_after["meals_total"] - sub_after["meals_used"]
    per_meal = sub_after["per_day_amount"] / 2
    assert abs(sub_after["wallet_balance"] - meals_left * per_meal) < 0.01

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_reconcile_meals_truth_fixes_wallet(admin_token):
    """Seed a desync (wallet drifted low) then trust meals → wallet snaps back."""
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter105 Recon meals")
    sub_uid = _assign(admin_token, sub_token)  # ₹2790, ₹93/day, ₹46.5/meal

    # Manually desync: drop wallet to 1500, leave meals_used at 0 (meals_left=60)
    async def desync(db):
        await db.subscriptions.update_one(
            {"user_id": sub_uid, "status": "active"},
            {"$set": {"wallet_balance": 1500.0, "meals_used": 22}},  # meals_left=38
        )
        await db.users.update_one({"user_id": sub_uid}, {"$set": {"wallet_balance": 1500.0}})
    _db_run(desync)

    # Sanity check pre-reconcile: 38 × 46.5 = ₹1767 expected; actual = ₹1500. Drift = ₹267.
    r = requests.post(
        f"{API}/admin/users/{sub_uid}/reconcile-subscription",
        json={"source_of_truth": "meals", "reason": "iter-105 fix drift"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    audit = r.json()["audit"]
    assert audit["before"]["wallet_balance"] == 1500.0
    assert audit["after"]["wallet_balance"] == 1767.0
    assert audit["before"]["meals_left"] == 38
    assert audit["after"]["meals_left"] == 38  # unchanged — meals is truth
    assert r.json()["user_wallet"] == 1500.0 + 267.0

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_reconcile_wallet_truth_fixes_meals(admin_token):
    """Trust wallet → meals_left snaps to wallet / per_meal."""
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter105 Recon wallet")
    sub_uid = _assign(admin_token, sub_token)

    async def desync(db):
        # wallet ₹1500 → expected meals_left = round(1500/46.5) = 32
        await db.subscriptions.update_one(
            {"user_id": sub_uid, "status": "active"},
            {"$set": {"wallet_balance": 1500.0, "meals_used": 22}},  # meals_left=38 ← will move to 32
        )
        await db.users.update_one({"user_id": sub_uid}, {"$set": {"wallet_balance": 1500.0}})
    _db_run(desync)

    r = requests.post(
        f"{API}/admin/users/{sub_uid}/reconcile-subscription",
        json={"source_of_truth": "wallet", "reason": "trust wallet"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    a = r.json()["audit"]
    assert a["before"]["meals_left"] == 38
    # 1500 / 46.5 = 32.258 → round → 32
    assert a["after"]["meals_left"] == 32
    assert a["after"]["wallet_balance"] == 1500.0  # unchanged — wallet is truth
    assert a["delta"] == 0.0

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)


def test_reconcile_validates(admin_token):
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub_token = _login_otp(sub_phone, "Iter105 Recon val")
    sub_uid = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10).json()["user_id"]
    _ensure_address(sub_uid)

    # No active sub → 404
    r = requests.post(f"{API}/admin/users/{sub_uid}/reconcile-subscription",
                      json={"source_of_truth": "meals", "reason": "x"},
                      headers=_h(admin_token), timeout=10)
    assert r.status_code == 404

    # Empty reason → 400
    _assign(admin_token, sub_token)
    r = requests.post(f"{API}/admin/users/{sub_uid}/reconcile-subscription",
                      json={"source_of_truth": "meals", "reason": ""},
                      headers=_h(admin_token), timeout=10)
    assert r.status_code == 400

    requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)
