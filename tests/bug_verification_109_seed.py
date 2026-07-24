import json
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from dotenv import dotenv_values
from pymongo import MongoClient


ROOT = Path("/app")
backend_env = dotenv_values(ROOT / "backend" / ".env")
frontend_env = dotenv_values(ROOT / "frontend" / ".env")
MONGO_URL = backend_env.get("MONGO_URL", "mongodb://localhost:27017").strip('"')
DB_NAME = backend_env.get("DB_NAME", "test_database").strip('"')
BASE = (frontend_env.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").strip().rstrip("/")
API = BASE + "/api"
RUN = "iter109"

client = MongoClient(MONGO_URL)
db = client[DB_NAME]
now = datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat()


def issue_session(user_id, suffix):
    token = f"test_{RUN}_{suffix}_{uuid.uuid4().hex[:12]}"
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": iso(now + timedelta(days=7)),
        "created_at": iso(now),
        "test_run": RUN,
    })
    return token


def upsert_user(user_id, phone, name, address, photo_url, wallet=0):
    db.users.update_one({"user_id": user_id}, {"$set": {
        "user_id": user_id,
        "phone": phone,
        "name": name,
        "address": address,
        "photo_url": photo_url,
        "picture": None,
        "role": "subscriber",
        "qr_token": f"qr_{RUN}_{user_id.split('_')[-1]}",
        "wallet_balance": float(wallet),
        "created_at": iso(now),
        "test_run": RUN,
    }}, upsert=True)


# Fresh, deterministic users for focused re-test.
incomplete_user_id = f"user_{RUN}_incomplete"
complete_user_id = f"user_{RUN}_complete"
tiffin_user_id = f"user_{RUN}_tiffin"

upsert_user(incomplete_user_id, "9555519109", "Iter109 Incomplete", "", "", 0)
upsert_user(complete_user_id, "9555519111", "Iter109 Complete", "Complete address Amravati 444607", "https://example.com/profile.jpg", 777)
upsert_user(tiffin_user_id, "9555519110", "Iter109 Tiffin", "Tiffin address Amravati 444607", "https://example.com/tiffin.jpg", 2600)

# Keep only this run's tiffin/complete subscriptions deterministic.
for sub_id in [f"sub_{RUN}_tiffin", f"sub_{RUN}_complete_dining"]:
    db.subscriptions.delete_many({"sub_id": sub_id})

db.subscriptions.insert_one({
    "sub_id": f"sub_{RUN}_tiffin",
    "user_id": tiffin_user_id,
    "plan_id": "classic_60",
    "plan_name": "Classic Full Tiffin",
    "amount_paid": 2600.0,
    "plan_amount": 2600.0,
    "pending_amount": 0,
    "currency": "INR",
    "meals_total": 56,
    "meals_used": 0,
    "wallet_balance": 2600.0,
    "per_day_amount": 92.86,
    "start_date": iso(now),
    "end_date": iso(now + timedelta(days=28)),
    "last_tick_date": (now + timedelta(hours=5, minutes=30)).date().isoformat(),
    "paused_days": 0,
    "status": "active",
    "service_type": "tiffin",
    "plan_type": "delivery",
    "category": "tiffin",
    "tiffin_size": "full",
    "tiffins_per_day": 2,
    "user_paused": False,
    "created_at": iso(now),
    "test_run": RUN,
})

db.subscriptions.insert_one({
    "sub_id": f"sub_{RUN}_complete_dining",
    "user_id": complete_user_id,
    "plan_id": "premium_60",
    "plan_name": "Premium Dining",
    "amount_paid": 2800.0,
    "plan_amount": 2800.0,
    "pending_amount": 0,
    "currency": "INR",
    "meals_total": 56,
    "meals_used": 0,
    "wallet_balance": 777.0,
    "per_day_amount": 100.0,
    "start_date": iso(now),
    "end_date": iso(now + timedelta(days=10)),
    "last_tick_date": (now + timedelta(hours=5, minutes=30)).date().isoformat(),
    "paused_days": 0,
    "status": "active",
    "service_type": "dining",
    "plan_type": "kiosk",
    "category": "dining",
    "user_paused": False,
    "created_at": iso(now),
    "test_run": RUN,
})

tokens = {
    "incomplete": issue_session(incomplete_user_id, "incomplete"),
    "complete": issue_session(complete_user_id, "complete"),
    "tiffin": issue_session(tiffin_user_id, "tiffin"),
}

serviceability = None
plans = None
try:
    serviceability = requests.get(API + "/restaurant/serviceable-area", timeout=20).json()
except Exception as e:
    serviceability = {"error": str(e)}
try:
    plans = requests.get(API + "/plans", timeout=20).json()
except Exception as e:
    plans = {"error": str(e)}

result = {
    "run": RUN,
    "base": BASE,
    "users": {
        "incomplete": incomplete_user_id,
        "complete": complete_user_id,
        "tiffin": tiffin_user_id,
    },
    "tokens": tokens,
    "serviceability": serviceability,
    "first_plan_id": ((plans or {}).get("plans") or [{}])[0].get("plan_id") if isinstance(plans, dict) else None,
}

out = ROOT / "test_reports" / "bug_verification_109_seed.json"
out.write_text(json.dumps(result, indent=2, default=str))
print(json.dumps(result, indent=2, default=str))