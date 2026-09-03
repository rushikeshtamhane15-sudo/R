"""Seed an ephemeral admin session (+ one victim sub) for iter-140.g UI test.

Usage:
  python /app/test_reports/seed_iter142_ui.py seed    -> prints session token
  python /app/test_reports/seed_iter142_ui.py clean   -> removes seeded docs
"""
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import dotenv_values
from pymongo import MongoClient

ENV = dotenv_values(str(Path("/app/backend/.env")))
c = MongoClient(ENV["MONGO_URL"])
db = c[ENV["DB_NAME"]]
TAG = "TEST_i142ui"
IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()


def seed():
    uid = f"{TAG}_admin_{uuid.uuid4().hex[:6]}"
    tok = f"{TAG}_sess_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": uid, "email": f"{uid}@example.test", "name": "TEST UI admin",
        "phone": "9111111111", "address": "TEST addr", "role": "admin",
        "wallet_balance": 0.0, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # victim sub so the preview has something to report
    vuid = f"{TAG}_victim_{uuid.uuid4().hex[:6]}"
    sid = f"{TAG}_sub_{uuid.uuid4().hex[:8]}"
    start = TODAY - timedelta(days=6)
    db.users.insert_one({
        "user_id": vuid, "email": f"{vuid}@example.test", "name": "TEST UI victim",
        "phone": "9222222222", "address": "TEST addr", "role": "subscriber",
        "wallet_balance": 888.0, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.subscriptions.insert_one({
        "sub_id": sid, "user_id": vuid, "plan_id": "p", "plan_name": "TEST 30d",
        "service_type": "dining", "meals_total": 60, "meals_used": 33,
        "per_day_amount": 93.33, "wallet_balance": 400.0, "plan_amount": 2800.0,
        "amount_paid": 2800.0, "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=30)).isoformat(),
        "last_tick_date": (TODAY - timedelta(days=2)).isoformat(),
        "status": "active", "paused_days": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.wallet_transactions.insert_one({
        "txn_id": f"{TAG}_{uuid.uuid4().hex[:8]}", "user_id": vuid, "sub_id": sid,
        "type": "debit", "amount": 93.33, "balance_after": 400.0,
        "reason": f"{TAG} junk row", "created_at": datetime.now(timezone.utc).isoformat(),
    })
    print(tok)


def clean():
    db.users.delete_many({"user_id": {"$regex": f"^{TAG}"}})
    db.user_sessions.delete_many({"session_token": {"$regex": f"^{TAG}"}})
    db.subscriptions.delete_many({"sub_id": {"$regex": f"^{TAG}"}})
    db.wallet_transactions.delete_many({"user_id": {"$regex": f"^{TAG}"}})
    print("cleaned")


if __name__ == "__main__":
    (seed if sys.argv[1] == "seed" else clean)()
