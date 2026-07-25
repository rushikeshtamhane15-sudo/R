"""Seed a short-lived subscriber session for focused /self-scan UI testing."""

from datetime import datetime, timedelta, timezone
import os

from pymongo import MongoClient


MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
TOKEN = "sess_iter110_self_scan_9333333333"
USER_ID = "user_54f9acc2eb0a"


def iso(dt):
    return dt.isoformat()


client = MongoClient(MONGO_URL)
db = client[DB_NAME]
user = db.users.find_one({"user_id": USER_ID}, {"_id": 0, "user_id": 1, "phone": 1, "role": 1})
if not user:
    raise SystemExit(f"Required subscriber user not found: {USER_ID}")

now = datetime.now(timezone.utc)
db.user_sessions.update_one(
    {"session_token": TOKEN},
    {
        "$set": {
            "session_token": TOKEN,
            "user_id": USER_ID,
            "expires_at": iso(now + timedelta(hours=2)),
            "created_at": iso(now),
            "test_artifact": "iter110_self_scan_bug_verification",
        }
    },
    upsert=True,
)
print({"token": TOKEN, "user": user})