"""Seed an admin session + a today-tick victim for iter-140.b UI testing."""
import json
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

be = dotenv_values("/app/backend/.env")
cli = MongoClient(be.get("MONGO_URL"))
db = cli[be.get("DB_NAME")]
IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()
now = datetime.now(timezone.utc).isoformat()

uid = f"TEST_i140bui_admin_{uuid.uuid4().hex[:6]}"
tok = f"sess_TEST_{uuid.uuid4().hex}"
db.users.insert_one({"user_id": uid, "email": f"TEST_{uid}@example.test", "name": "TEST i140b Admin",
                     "role": "admin", "wallet_balance": 0.0, "created_at": now})
db.user_sessions.insert_one({"user_id": uid, "session_token": tok,
                             "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
                             "created_at": now})

vuid = f"TEST_i140bui_victim_{uuid.uuid4().hex[:6]}"
sid = f"TEST_sub_{uuid.uuid4().hex[:8]}"
db.users.insert_one({"user_id": vuid, "email": f"TEST_{vuid}@example.test", "name": "TEST i140b Victim",
                     "role": "subscriber", "wallet_balance": 800.0,
                     "qr_token": f"TEST_qr_{uuid.uuid4().hex[:8]}", "created_at": now})
db.subscriptions.insert_one({"sub_id": sid, "user_id": vuid, "plan_id": "TEST_plan", "plan_name": "TEST Plan",
                             "service_type": "dining", "meals_total": 60, "meals_used": 4,
                             "per_day_amount": 100.0, "wallet_balance": 800.0,
                             "start_date": (TODAY - timedelta(days=10)).isoformat(),
                             "end_date": (TODAY + timedelta(days=20)).isoformat(),
                             "status": "active", "paused_days": 0,
                             "last_tick_date": TODAY.isoformat(), "scan_deducted_dates": {},
                             "created_at": now})
db.wallet_transactions.insert_one({"txn_id": f"TEST_{uuid.uuid4().hex[:8]}", "user_id": vuid, "sub_id": sid,
                                   "type": "debit", "amount": 100.0, "balance_after": 800.0,
                                   "reason": f"Daily deduction · {TODAY.isoformat()} · 2 meals · active",
                                   "created_at": now})

print(json.dumps({"admin_user": uid, "token": tok, "victim": vuid, "sub_id": sid}))
