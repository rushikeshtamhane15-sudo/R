"""iter-110 regression — email-registered (no-name) users can delete their account."""
import os
import uuid
import asyncio
import pytest
import requests
from datetime import datetime, timezone

API = os.environ.get("API_URL", "http://localhost:8001/api")


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


def _seed_email_user_no_name() -> tuple[str, str]:
    """Mirror what Google-OAuth verify produces: a users row with name=None,
    phone=None, only email set, and a valid session token."""
    uid = f"user_g{uuid.uuid4().hex[:10]}"
    token = f"sess_{uuid.uuid4().hex}"
    email = f"g-{uuid.uuid4().hex[:8]}@example.com"

    async def seed(db):
        await db.users.insert_one({
            "user_id": uid,
            "email": email,
            "phone": None,
            "name": None,  # Google-OAuth users start with no name
            "role": "subscriber",
            "qr_token": f"qr_{uuid.uuid4().hex}",
            "wallet_balance": 0.0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.user_sessions.insert_one({
            "session_token": token,
            "user_id": uid,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": datetime(2030, 1, 1, tzinfo=timezone.utc).isoformat(),
        })
    _db_run(seed)
    return uid, token


def test_auth_me_does_not_500_for_email_user_without_name():
    """Before iter-110 this returned HTTP 500 because doc_to_user did
    `doc["name"]` and Pydantic rejected name=None on the User model."""
    uid, token = _seed_email_user_no_name()
    try:
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=10)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        # Fallback name = email-local-part
        assert body["name"], "name fallback should be set"
        assert body["user_id"] == uid
    finally:
        # cleanup if test didn't already delete
        async def cleanup(db):
            await db.users.delete_one({"user_id": uid})
            await db.user_sessions.delete_many({"user_id": uid})
        _db_run(cleanup)


def test_delete_my_account_works_for_email_registered_user():
    """The original user complaint: 'User with email registered account is
    unable to delete their account'. Verify the foreground delete returns
    200 with users:1 in the counts."""
    uid, token = _seed_email_user_no_name()
    r = requests.delete(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
    body = r.json()
    assert body["ok"] is True
    assert body["deleted"] is True
    assert body["counts"]["users"] == 1

    # Subsequent /auth/me should 401
    r2 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    assert r2.status_code == 401


def test_user_row_with_missing_created_at_does_not_500():
    """Legacy / seeded rows may be missing created_at — auth path must tolerate it."""
    uid = f"user_legacy{uuid.uuid4().hex[:10]}"
    token = f"sess_{uuid.uuid4().hex}"

    async def seed(db):
        await db.users.insert_one({
            "user_id": uid,
            "email": None,
            "phone": "9876512300",
            "name": "Legacy",
            "role": "subscriber",
            "qr_token": "qr_legacy",
            "wallet_balance": 0.0,
            # NB: NO created_at
        })
        await db.user_sessions.insert_one({
            "session_token": token,
            "user_id": uid,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": datetime(2030, 1, 1, tzinfo=timezone.utc).isoformat(),
        })
    _db_run(seed)
    try:
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=10)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
    finally:
        async def cleanup(db):
            await db.users.delete_one({"user_id": uid})
            await db.user_sessions.delete_many({"user_id": uid})
        _db_run(cleanup)
