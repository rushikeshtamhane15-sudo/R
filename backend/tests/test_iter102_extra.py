"""iter-102 extra coverage — unified-lookup behaviour, admin-only guards,
rider-into-admin refusal, account_merged notice push, and iter-101
regression smoke (assign-subscription, wallet-adjust, notices ack,
DELETE /auth/me).
"""
import os
import sys
import uuid
import asyncio
import pytest
import requests

sys.path.insert(0, "/app/backend")

API = os.environ.get("API_URL", "https://dining-pass-scan.preview.emergentagent.com/api")
ADMIN_PHONE = "9970705391"


def _send_otp(phone):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10)
    r.raise_for_status()
    return r.json()["dev_otp"]


def _verify(phone, otp, name="Test"):
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name}, timeout=10)
    r.raise_for_status()
    return r.json()


def _login_otp(phone, name="Test"):
    return _verify(phone, _send_otp(phone), name)


def _h(token):
    return {"Authorization": f"Bearer {token}"}


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


@pytest.fixture(scope="module")
def admin_token():
    return _login_otp(ADMIN_PHONE, "Admin")["session_token"]


# ---------------------------------------------------------------------------
# Unified-lookup behaviour
# ---------------------------------------------------------------------------
def test_otp_twice_same_phone_returns_same_user_id():
    """Calling /auth/verify-otp twice for the same phone must resolve to
    the same `users` row (not fork into duplicates)."""
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    a = _login_otp(phone, "Once")
    b = _login_otp(phone, "Twice")
    assert a["user"]["user_id"] == b["user"]["user_id"]

    # Cleanup
    requests.delete(f"{API}/auth/me", headers=_h(b["session_token"]), timeout=10)


def test_create_or_get_user_backfills_email_when_only_phone_existed():
    """Seed a phone-only row, then directly invoke create_or_get_user with
    a fresh email + same phone → must return the SAME user_id and the
    row must now have the email backfilled."""
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    uid = f"user_{uuid.uuid4().hex[:12]}"
    new_email = f"backfill-{uuid.uuid4().hex[:8]}@example.com"

    async def seed_and_call(db):
        await db.users.insert_one({
            "user_id": uid, "email": None, "phone": phone, "name": "PhoneOnly",
            "role": "subscriber", "wallet_balance": 0,
            "created_at": "2025-01-01T00:00:00+00:00",
            "qr_token": f"qr_{uuid.uuid4().hex}",
        })
        # Invoke server.create_or_get_user directly
        from server import create_or_get_user
        result = await create_or_get_user(email=new_email, phone=phone, name="PhoneOnly")
        # Re-fetch from DB to verify persistence
        row = await db.users.find_one({"user_id": uid}, {"_id": 0})
        # Cleanup
        await db.users.delete_one({"user_id": uid})
        return result, row

    result, row = _db_run(seed_and_call)
    assert result["user_id"] == uid, f"expected same user_id; got {result['user_id']} vs seeded {uid}"
    assert row is not None
    assert row.get("email") == new_email, f"email not backfilled on existing row: {row.get('email')}"
    assert row.get("phone") == phone


# ---------------------------------------------------------------------------
# Admin-only guards
# ---------------------------------------------------------------------------
def test_duplicates_endpoint_requires_admin():
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub = _login_otp(sub_phone, "Sub")
    r = requests.get(f"{API}/admin/users/duplicates", headers=_h(sub["session_token"]), timeout=10)
    assert r.status_code == 403, f"expected 403 for non-admin, got {r.status_code} {r.text}"
    requests.delete(f"{API}/auth/me", headers=_h(sub["session_token"]), timeout=10)


def test_merge_endpoint_requires_admin():
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub = _login_otp(sub_phone, "Sub")
    r = requests.post(
        f"{API}/admin/users/{sub['user']['user_id']}/merge",
        json={"duplicate_user_id": "user_x", "reason": "test"},
        headers=_h(sub["session_token"]),
        timeout=10,
    )
    assert r.status_code == 403
    requests.delete(f"{API}/auth/me", headers=_h(sub["session_token"]), timeout=10)


# ---------------------------------------------------------------------------
# Refuse to absorb non-subscriber into admin
# ---------------------------------------------------------------------------
def test_merge_refuses_rider_into_admin(admin_token):
    admin_uid = None

    async def find_admin(db):
        row = await db.users.find_one({"phone": ADMIN_PHONE}, {"_id": 0, "user_id": 1})
        return row["user_id"] if row else None

    admin_uid = _db_run(find_admin)
    assert admin_uid

    rider_id = f"user_{uuid.uuid4().hex[:12]}"

    async def seed_rider(db):
        await db.users.insert_one({
            "user_id": rider_id, "email": None,
            "phone": f"9{uuid.uuid4().int % 10**9:09d}", "name": "Rider",
            "role": "rider", "wallet_balance": 0,
            "created_at": "2025-01-01T00:00:00+00:00",
            "qr_token": f"qr_{uuid.uuid4().hex}",
        })

    async def cleanup(db):
        await db.users.delete_one({"user_id": rider_id})

    _db_run(seed_rider)
    try:
        r = requests.post(
            f"{API}/admin/users/{admin_uid}/merge",
            json={"duplicate_user_id": rider_id, "reason": "should be refused"},
            headers=_h(admin_token), timeout=10,
        )
        assert r.status_code == 400, f"expected 400 refuse-rider-into-admin, got {r.status_code} {r.text}"
        assert "rider" in r.text.lower() or "refus" in r.text.lower()
    finally:
        _db_run(cleanup)


# ---------------------------------------------------------------------------
# account_merged notice push
# ---------------------------------------------------------------------------
def test_merge_pushes_account_merged_notice(admin_token):
    """After merge, primary user should see a notice kind='account_merged'."""
    phone_primary = f"9{uuid.uuid4().int % 10**9:09d}"
    phone_dup = f"9{uuid.uuid4().int % 10**9:09d}"
    shared_email = f"merge-notice-{uuid.uuid4().hex[:8]}@example.com"

    # Create primary via real OTP so we have a session token to query notices
    primary = _login_otp(phone_primary, "Primary")
    primary_uid = primary["user"]["user_id"]
    primary_token = primary["session_token"]

    # Patch primary's email so we have a collision target, and seed duplicate
    dup_uid = f"user_{uuid.uuid4().hex[:12]}"

    async def seed(db):
        await db.users.update_one({"user_id": primary_uid}, {"$set": {"email": shared_email}})
        await db.users.insert_one({
            "user_id": dup_uid, "email": shared_email, "phone": phone_dup,
            "name": "Duplicate", "role": "subscriber", "wallet_balance": 250.0,
            "created_at": "2025-02-01T00:00:00+00:00",
            "qr_token": f"qr_{uuid.uuid4().hex}",
        })
    _db_run(seed)

    # Merge
    r = requests.post(
        f"{API}/admin/users/{primary_uid}/merge",
        json={"duplicate_user_id": dup_uid, "reason": "iter-102 notice push test"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    audit = r.json()["audit"]
    assert audit["kind"] == "merge_users"

    # Primary fetches notices
    r = requests.get(f"{API}/auth/notices", headers=_h(primary_token), timeout=10)
    assert r.status_code == 200
    notices = r.json().get("notices", [])
    am = [n for n in notices if n.get("kind") == "account_merged"]
    assert len(am) >= 1, f"expected at least 1 account_merged notice; got kinds={[n.get('kind') for n in notices]}"
    assert "merged" in am[0].get("title", "").lower() or "merge" in am[0].get("title", "").lower()

    # Cleanup
    requests.delete(f"{API}/auth/me", headers=_h(primary_token), timeout=10)


# ---------------------------------------------------------------------------
# Iter-101 regression smoke
# ---------------------------------------------------------------------------
def test_iter101_regression_assign_sub_and_wallet_adjust(admin_token):
    sub_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    sub = _login_otp(sub_phone, "RegSub")
    sub_uid = sub["user"]["user_id"]
    sub_token = sub["session_token"]

    # assign-subscription (custom)
    r = requests.post(
        f"{API}/admin/users/{sub_uid}/assign-subscription",
        json={"mode": "custom", "name": "Reg 7d", "duration_days": 7, "meals": 14,
              "amount": 700, "reason": "iter-102 regression"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text

    # wallet-adjust
    r = requests.post(
        f"{API}/admin/users/{sub_uid}/wallet-adjust",
        json={"delta": 100, "reason": "regression wallet credit"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text

    # notices
    r = requests.get(f"{API}/auth/notices", headers=_h(sub_token), timeout=10)
    assert r.status_code == 200
    kinds = [n.get("kind") for n in r.json().get("notices", [])]
    assert "subscription_assigned" in kinds
    assert "wallet_adjust" in kinds

    # ack all
    r = requests.post(f"{API}/auth/notices/ack", json={"all": True},
                     headers=_h(sub_token), timeout=10)
    assert r.status_code == 200

    # /auth/me has mess_id key
    r = requests.get(f"{API}/auth/me", headers=_h(sub_token), timeout=10)
    assert r.status_code == 200
    assert "mess_id" in r.json()

    # DELETE /auth/me
    r = requests.delete(f"{API}/auth/me", headers=_h(sub_token), timeout=10)
    assert r.status_code == 200
