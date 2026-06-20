"""iter-102 regression — duplicate user detection + merge.

Unified-lookup behaviour of `create_or_get_user` is exercised indirectly:
seeding two duplicate rows and merging them is the end-to-end proof that
the cleanup tool actually consolidates the data. The new lookup logic
itself only matters for FRESH logins — covered by manual verification
because it requires both Google-auth and OTP flows.
"""
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
    """Run an async DB op inside its own event loop with a fresh Motor client."""
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


def test_detect_and_merge_existing_duplicates(admin_token):
    email = f"legacy-{uuid.uuid4().hex[:8]}@example.com"
    phone_a = f"9{uuid.uuid4().int % 10**9:09d}"
    phone_b = f"9{uuid.uuid4().int % 10**9:09d}"
    uid_a = f"user_{uuid.uuid4().hex[:12]}"
    uid_b = f"user_{uuid.uuid4().hex[:12]}"

    async def seed(db):
        await db.users.insert_one({
            "user_id": uid_a, "email": email, "phone": phone_a, "name": "Legacy A",
            "role": "subscriber", "wallet_balance": 1500.0,
            "created_at": "2025-01-01T00:00:00+00:00",
            "qr_token": f"qr_{uuid.uuid4().hex}",
        })
        await db.users.insert_one({
            "user_id": uid_b, "email": email, "phone": phone_b, "name": "Legacy B",
            "role": "subscriber", "wallet_balance": 800.0,
            "created_at": "2025-02-01T00:00:00+00:00",
            "qr_token": f"qr_{uuid.uuid4().hex}",
            "address": "B address",
        })
        await db.wallet_transactions.insert_one({
            "txn_id": f"wtxn_{uuid.uuid4().hex[:12]}", "user_id": uid_b,
            "type": "credit", "amount": 800, "balance_after": 800,
            "reason": "legacy seed", "created_at": "2025-02-01T00:00:01+00:00",
        })
    _db_run(seed)

    # Detect
    r = requests.get(f"{API}/admin/users/duplicates", headers=_h(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    clusters = r.json()["clusters"]
    found = [c for c in clusters if c["shared_value"] == email]
    assert len(found) == 1, f"expected one cluster for {email}, got {[c['shared_value'] for c in clusters]}"
    ids_in_cluster = {u["user_id"] for u in found[0]["users"]}
    assert {uid_a, uid_b} <= ids_in_cluster

    # Merge B into A
    r = requests.post(
        f"{API}/admin/users/{uid_a}/merge",
        json={"duplicate_user_id": uid_b, "reason": "iter-102 pytest cleanup"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    audit = r.json()["audit"]
    assert audit["new_wallet"] == 2300.0

    async def verify(db):
        rows = await db.users.find({"email": email}, {"_id": 0}).to_list(10)
        assert len(rows) == 1, f"expected 1 surviving row, got {len(rows)}"
        assert rows[0]["user_id"] == uid_a
        assert rows[0]["wallet_balance"] == 2300.0
        assert rows[0]["address"] == "B address"
        txns_a = await db.wallet_transactions.find({"user_id": uid_a}, {"_id": 0}).to_list(50)
        assert any(t["reason"] == "legacy seed" for t in txns_a)
        txns_b = await db.wallet_transactions.find({"user_id": uid_b}, {"_id": 0}).to_list(50)
        assert txns_b == []
        # Cleanup
        await db.users.delete_one({"user_id": uid_a})
        await db.wallet_transactions.delete_many({"user_id": uid_a})
        await db.wallet_overrides.delete_many({"primary_user_id": uid_a})
    _db_run(verify)


def test_phone_collision_also_detected(admin_token):
    """Two rows sharing only a phone (no email) should also surface."""
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    uid_a = f"user_{uuid.uuid4().hex[:12]}"
    uid_b = f"user_{uuid.uuid4().hex[:12]}"

    async def seed(db):
        await db.users.insert_one({
            "user_id": uid_a, "email": None, "phone": phone, "name": "PhoneA",
            "role": "subscriber", "wallet_balance": 100.0,
            "created_at": "2025-01-01T00:00:00+00:00",
            "qr_token": f"qr_{uuid.uuid4().hex}",
        })
        await db.users.insert_one({
            "user_id": uid_b, "email": None, "phone": phone, "name": "PhoneB",
            "role": "subscriber", "wallet_balance": 50.0,
            "created_at": "2025-02-01T00:00:00+00:00",
            "qr_token": f"qr_{uuid.uuid4().hex}",
        })
    _db_run(seed)

    r = requests.get(f"{API}/admin/users/duplicates", headers=_h(admin_token), timeout=10)
    clusters = r.json()["clusters"]
    matched = [c for c in clusters if c["shared_value"] == phone]
    assert len(matched) == 1
    assert matched[0]["shared_by"] == "phone"

    # Merge A into B
    r = requests.post(
        f"{API}/admin/users/{uid_b}/merge",
        json={"duplicate_user_id": uid_a, "reason": "phone-collision cleanup"},
        headers=_h(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json()["audit"]["new_wallet"] == 150.0

    async def cleanup(db):
        await db.users.delete_one({"user_id": uid_b})
    _db_run(cleanup)


def test_merge_validates_inputs(admin_token):
    uid_a = f"user_{uuid.uuid4().hex[:12]}"

    async def seed(db):
        await db.users.insert_one({
            "user_id": uid_a, "email": None, "phone": "9999999991", "name": "Solo",
            "role": "subscriber", "wallet_balance": 0,
            "created_at": "2025-01-01T00:00:00+00:00",
            "qr_token": "qr_x",
        })
    _db_run(seed)

    # Self-merge → 400
    r = requests.post(f"{API}/admin/users/{uid_a}/merge",
                      json={"duplicate_user_id": uid_a, "reason": "self"},
                      headers=_h(admin_token), timeout=10)
    assert r.status_code == 400

    # Missing reason → 400
    r = requests.post(f"{API}/admin/users/{uid_a}/merge",
                      json={"duplicate_user_id": "user_unknown", "reason": ""},
                      headers=_h(admin_token), timeout=10)
    assert r.status_code == 400

    # Unknown user → 404
    r = requests.post(f"{API}/admin/users/{uid_a}/merge",
                      json={"duplicate_user_id": "user_does_not_exist_xx", "reason": "test"},
                      headers=_h(admin_token), timeout=10)
    assert r.status_code == 404

    async def cleanup(db):
        await db.users.delete_one({"user_id": uid_a})
    _db_run(cleanup)
