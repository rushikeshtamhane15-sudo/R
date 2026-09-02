"""iter-140 method-level check: dining scan deduction vs user-level wallet.

Calls server._mark_attendance directly (bypasses meal-slot time window) to
verify the per-meal deduction and check whether users.wallet_balance is kept
in sync with subscriptions.wallet_balance.
"""
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from dotenv import dotenv_values
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")
backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")
IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()


@pytest.mark.asyncio
async def test_scan_deducts_per_meal_and_records_scan_map():
    import server

    client = MongoClient(MONGO_URL)
    mdb = client[DB_NAME]
    uid = f"TEST_iter140m_{uuid.uuid4().hex[:8]}"
    sid = f"TEST_subm_{uuid.uuid4().hex[:8]}"
    mdb.users.insert_one({"user_id": uid, "name": "TEST scan", "role": "subscriber",
                          "email": f"TEST_{uid}@example.test", "wallet_balance": 1000.0,
                          "created_at": datetime.now(timezone.utc).isoformat()})
    mdb.subscriptions.insert_one({
        "sub_id": sid, "user_id": uid, "plan_id": "TEST", "plan_name": "TEST",
        "service_type": "dining", "meals_total": 60, "meals_used": 0,
        "per_day_amount": 100.0, "wallet_balance": 1000.0, "status": "active",
        "paused_days": 0, "last_tick_date": (TODAY - timedelta(days=1)).isoformat(),
        "start_date": (TODAY - timedelta(days=5)).isoformat(),
        "end_date": (TODAY + timedelta(days=20)).isoformat(),
        "scan_deducted_dates": {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # temporarily widen the IST meal slots so the scan is not time-rejected
    prev_slots = mdb.admin_config.find_one({"_id": "meal_slots"})
    mdb.admin_config.update_one(
        {"_id": "meal_slots"},
        {"$set": {"lunch": {"start": "00:00", "end": "23:59"},
                  "dinner": {"start": "00:00", "end": "23:59"}}},
        upsert=True,
    )
    try:
        target = mdb.users.find_one({"user_id": uid}, {"_id": 0})
        rec = await server._mark_attendance(target, "lunch", "TEST_staff", "counter_scan")
        assert rec["meal_type"] == "lunch"

        sub = mdb.subscriptions.find_one({"sub_id": sid}, {"_id": 0})
        assert sub["wallet_balance"] == 950.0, sub
        assert sub["meals_used"] == 1
        assert sub["scan_deducted_dates"][TODAY.isoformat()] == ["lunch"]
        assert sub["last_tick_date"] == (TODAY - timedelta(days=1)).isoformat(), \
            "scan must not advance last_tick_date"

        # Now run the tick — must NOT charge anything more for today.
        active = await server.get_active_subscription(uid)
        assert active["wallet_balance"] == 950.0, active
        assert active["meals_used"] == 1

        u = mdb.users.find_one({"user_id": uid}, {"_id": 0})
        # DRIFT CHECK: users.wallet_balance is what /api/my/wallet returns.
        assert u["wallet_balance"] == 950.0, (
            f"user-level wallet not synced after scan deduction: users={u['wallet_balance']} sub={sub['wallet_balance']}")
    finally:
        if prev_slots:
            mdb.admin_config.replace_one({"_id": "meal_slots"}, prev_slots)
        else:
            mdb.admin_config.delete_one({"_id": "meal_slots"})
        mdb.users.delete_many({"user_id": uid})
        mdb.subscriptions.delete_many({"sub_id": sid})
        mdb.attendance.delete_many({"user_id": uid})
        mdb.wallet_transactions.delete_many({"user_id": uid})
        client.close()
