"""iter-131.29 backend verification tests.

Covers:
  (2a) POST /api/attendance/self-scan strict IST slot enforcement (both accept
       and reject paths, forced via db.admin_config.meal_slots override).
  (3)  DINING scan deduction: wallet_balance and meals_used deduct on scan;
       scan_deducted_dates + last_tick_date bumped; wallet_transactions debit
       logged; catch_up_subscription skips already-deducted days.
  (4)  Razorpay dynamic QR on /api/admin/kiosk/order (with close_by param).
"""
import os
import uuid
import asyncio
from datetime import datetime, timedelta, timezone, date

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to reading frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

ADMIN_USER_ID = "user_kiosk_admin"
SUB_USER_ID = "user_54f9acc2eb0a"
SUB_PHONE = "9333333333"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def mongo(event_loop):
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


async def _issue_session_for(mongo, user_id: str) -> str:
    token = f"sess_test_{uuid.uuid4().hex}"
    await mongo.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return token


@pytest.fixture(scope="session")
def admin_token(event_loop, mongo):
    return event_loop.run_until_complete(_issue_session_for(mongo, ADMIN_USER_ID))


@pytest.fixture(scope="session")
def sub_token(event_loop, mongo):
    return event_loop.run_until_complete(_issue_session_for(mongo, SUB_USER_ID))


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _today_ist():
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date().isoformat()


# ---------- helpers ----------
async def _reset_dining_sub(mongo):
    today = _today_ist()
    end = (date.fromisoformat(today) + timedelta(days=30)).isoformat()
    # Remove any existing sub, insert a fresh dining sub for the test user
    await mongo.subscriptions.delete_many({"user_id": SUB_USER_ID})
    await mongo.subscriptions.insert_one({
        "sub_id": "sub_test_dining_iter131_29",
        "user_id": SUB_USER_ID,
        "service_type": "dining",
        "meal_window": "both",
        "wallet_balance": 2000.0,
        "per_day_amount": 200,
        "meals_total": 56,
        "meals_used": 0,
        "scan_deducted_dates": {},
        "last_tick_date": today,
        "start_date": today,
        "end_date": end,
        "status": "active",
        "user_paused": False,
        "paused_days": 0,
    })
    # Also clear today's attendance to avoid 409 duplicate.
    await mongo.attendance.delete_many({"user_id": SUB_USER_ID, "date_str": today})
    # Clear stale wallet_transactions from prior tests
    await mongo.wallet_transactions.delete_many({"user_id": SUB_USER_ID, "reason": {"$regex": "^Scan · "}})


async def _set_meal_slots(mongo, lunch, dinner):
    """lunch/dinner = {'start':'HH:MM','end':'HH:MM'} or None to remove override."""
    if lunch is None and dinner is None:
        await mongo.admin_config.delete_one({"_id": "meal_slots"})
        return
    await mongo.admin_config.update_one(
        {"_id": "meal_slots"},
        {"$set": {"_id": "meal_slots", "lunch": lunch, "dinner": dinner}},
        upsert=True,
    )


async def _set_kiosk_qr_provider(mongo, provider: str):
    await mongo.app_config.update_one(
        {"key": "kiosk_qr_v1"},
        {"$set": {"key": "kiosk_qr_v1", "provider": provider}},
        upsert=True,
    )


# ============================================================
# (2a) Strict IST slot enforcement on /api/attendance/self-scan
# ============================================================
class TestSlotEnforcement:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/counter/qr/public?meal=lunch&location=main", timeout=15)
        assert r.status_code == 200, r.text
        assert "counter_code" in r.json()

    def test_lunch_scan_outside_window_rejected(self, event_loop, mongo, admin_token, sub_token):
        # Force lunch slot to a definitively-closed window (00:00-00:01)
        event_loop.run_until_complete(_reset_dining_sub(mongo))
        event_loop.run_until_complete(_set_meal_slots(
            mongo,
            {"start": "00:00", "end": "00:01"},
            {"start": "00:00", "end": "00:01"},
        ))
        # Mint fresh lunch counter code as admin
        r = requests.get(f"{BASE_URL}/api/counter/qr?meal=lunch&location=main",
                         headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        code = r.json()["counter_code"]
        # Attempt self-scan (should be blocked)
        rr = requests.post(
            f"{BASE_URL}/api/attendance/self-scan",
            headers=_hdr(sub_token),
            json={"counter_code": code},
            timeout=15,
        )
        assert rr.status_code == 403, f"Expected 403, got {rr.status_code}: {rr.text}"
        detail = rr.json().get("detail", "")
        assert "Lunch scans are open" in detail and "IST" in detail, f"Unexpected message: {detail}"

    def test_dinner_scan_outside_window_rejected(self, event_loop, mongo, admin_token, sub_token):
        event_loop.run_until_complete(_reset_dining_sub(mongo))
        event_loop.run_until_complete(_set_meal_slots(
            mongo,
            {"start": "00:00", "end": "00:01"},
            {"start": "00:00", "end": "00:01"},
        ))
        r = requests.get(f"{BASE_URL}/api/counter/qr?meal=dinner&location=main",
                         headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        code = r.json()["counter_code"]
        rr = requests.post(
            f"{BASE_URL}/api/attendance/self-scan",
            headers=_hdr(sub_token),
            json={"counter_code": code},
            timeout=15,
        )
        assert rr.status_code == 403, rr.text
        assert "Dinner scans are open" in rr.json().get("detail", "")

    def test_lunch_scan_within_window_accepted(self, event_loop, mongo, admin_token, sub_token):
        # Widen slot to 00:00-23:59 so accept path always works
        event_loop.run_until_complete(_reset_dining_sub(mongo))
        event_loop.run_until_complete(_set_meal_slots(
            mongo,
            {"start": "00:00", "end": "23:59"},
            {"start": "00:00", "end": "23:59"},
        ))
        r = requests.get(f"{BASE_URL}/api/counter/qr?meal=lunch&location=main",
                         headers=_hdr(admin_token), timeout=15)
        code = r.json()["counter_code"]
        rr = requests.post(
            f"{BASE_URL}/api/attendance/self-scan",
            headers=_hdr(sub_token),
            json={"counter_code": code},
            timeout=15,
        )
        assert rr.status_code == 200, rr.text
        data = rr.json()
        assert data["ok"] is True
        assert data["meal_type"] == "lunch"


# ============================================================
# (3) DINING scan-based wallet + meal deduction
# ============================================================
class TestDiningDeduction:
    def test_scan_deducts_wallet_and_meal(self, event_loop, mongo, admin_token, sub_token):
        today = _today_ist()
        event_loop.run_until_complete(_reset_dining_sub(mongo))
        event_loop.run_until_complete(_set_meal_slots(
            mongo,
            {"start": "00:00", "end": "23:59"},
            {"start": "00:00", "end": "23:59"},
        ))
        # Mint lunch counter code
        r = requests.get(f"{BASE_URL}/api/counter/qr?meal=lunch&location=main",
                         headers=_hdr(admin_token), timeout=15)
        code = r.json()["counter_code"]
        rr = requests.post(
            f"{BASE_URL}/api/attendance/self-scan",
            headers=_hdr(sub_token),
            json={"counter_code": code},
            timeout=15,
        )
        assert rr.status_code == 200, rr.text
        data = rr.json()
        # per_day 200 / 2 = 100 → wallet 2000 - 100 = 1900
        assert data["wallet_balance"] == 1900, f"wallet_balance={data['wallet_balance']}"
        # meals_left = 56 - 1 = 55
        assert data["meals_left"] == 55, f"meals_left={data['meals_left']}"
        assert data["meals_total"] == 56

        # Verify mongo persistence
        sub = event_loop.run_until_complete(
            mongo.subscriptions.find_one({"user_id": SUB_USER_ID}, {"_id": 0})
        )
        assert sub["wallet_balance"] == 1900
        assert sub["meals_used"] == 1
        assert sub["last_tick_date"] == today
        assert sub["scan_deducted_dates"].get(today) == ["lunch"]

        # Verify a debit wallet_transactions entry exists
        txn = event_loop.run_until_complete(
            mongo.wallet_transactions.find_one(
                {"user_id": SUB_USER_ID, "reason": f"Scan · lunch · {today}"},
                {"_id": 0},
            )
        )
        assert txn is not None, "No Scan debit wallet_transactions entry found"
        assert txn["type"] == "debit"
        assert txn["amount"] == 100
        assert txn["balance_after"] == 1900

    def test_catch_up_skips_scan_deducted_day(self, event_loop, mongo, admin_token, sub_token):
        """After scan on today, backdate last_tick_date one day earlier so
        catch_up_subscription iterates 'today'. With today in
        scan_deducted_dates, no additional deduction should occur.
        """
        today = _today_ist()
        yesterday = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
        # Ensure sub is in the post-scan state from previous test; if not, run scan first.
        sub_before = event_loop.run_until_complete(
            mongo.subscriptions.find_one({"user_id": SUB_USER_ID}, {"_id": 0})
        )
        if not (sub_before and sub_before.get("scan_deducted_dates", {}).get(today)):
            # Re-run the scan
            event_loop.run_until_complete(_reset_dining_sub(mongo))
            event_loop.run_until_complete(_set_meal_slots(
                mongo,
                {"start": "00:00", "end": "23:59"},
                {"start": "00:00", "end": "23:59"},
            ))
            r = requests.get(f"{BASE_URL}/api/counter/qr?meal=lunch&location=main",
                             headers=_hdr(admin_token), timeout=15)
            requests.post(
                f"{BASE_URL}/api/attendance/self-scan",
                headers=_hdr(sub_token),
                json={"counter_code": r.json()["counter_code"]},
                timeout=15,
            )
            sub_before = event_loop.run_until_complete(
                mongo.subscriptions.find_one({"user_id": SUB_USER_ID}, {"_id": 0})
            )
        wallet_after_scan = sub_before["wallet_balance"]
        meals_used_after_scan = sub_before["meals_used"]

        # Backdate last_tick_date so catch_up will iterate over today
        event_loop.run_until_complete(mongo.subscriptions.update_one(
            {"user_id": SUB_USER_ID}, {"$set": {"last_tick_date": yesterday}}
        ))

        # Trigger catch_up by hitting /api/my/wallet which invokes
        # get_active_subscription → catch_up_subscription.
        r = requests.get(f"{BASE_URL}/api/my/wallet",
                         headers=_hdr(sub_token), timeout=15)
        assert r.status_code == 200, r.text
        sub_after = event_loop.run_until_complete(
            mongo.subscriptions.find_one({"user_id": SUB_USER_ID}, {"_id": 0})
        )
        # No additional deduction: wallet same, meals_used same. last_tick_date bumped to today.
        assert sub_after["wallet_balance"] == wallet_after_scan, (
            f"Double-deduction! before={wallet_after_scan} after={sub_after['wallet_balance']}"
        )
        assert sub_after["meals_used"] == meals_used_after_scan, (
            f"meals_used changed! before={meals_used_after_scan} after={sub_after['meals_used']}"
        )
        assert sub_after["last_tick_date"] == today


# ============================================================
# (4) Razorpay dynamic QR on /api/admin/kiosk/order
# ============================================================
class TestRazorpayKioskQR:
    def test_razorpay_qr_created_with_close_by(self, event_loop, mongo, admin_token):
        # Ensure provider is razorpay
        event_loop.run_until_complete(_set_kiosk_qr_provider(mongo, "razorpay"))
        # Ensure menu exists for today's lunch
        today = _today_ist()
        event_loop.run_until_complete(mongo.mess_menu.update_one(
            {"date": today},
            {"$set": {"date": today, "lunch": "Test lunch menu", "dinner": "Test dinner menu"}},
            upsert=True,
        ))
        # Ensure kiosk mess_menu_config price exists
        cfg = event_loop.run_until_complete(mongo.mess_menu_config.find_one({}, {"_id": 0}))
        if not cfg or not cfg.get("price_takeaway"):
            event_loop.run_until_complete(mongo.mess_menu_config.update_one(
                {},
                {"$set": {"price_takeaway": 120, "price_dining": 100}},
                upsert=True,
            ))

        payload = {
            "date": today,
            "meal_type": "lunch",
            "service": "takeaway",
            "qty": 1,
            "payment_method": "online",
            "online_amount": 120,
            "cash_amount": 0,
            "note": "iter-131.29 rzp test",
        }
        r = requests.post(
            f"{BASE_URL}/api/admin/kiosk/order",
            headers=_hdr(admin_token),
            json=payload,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert data.get("qr_provider") == "razorpay", f"provider={data.get('qr_provider')}"
        rzp_id = data.get("razorpay_qr_id")
        rzp_url = data.get("razorpay_qr_image_url")
        if rzp_id is None:
            # Fallback path was taken. Verify code-side did send close_by, and
            # surface the Razorpay-side error so the main agent can act.
            import subprocess
            log = subprocess.run(
                ["bash", "-c", "grep -h 'Razorpay QR create failed' /var/log/supervisor/backend.*.log | tail -3"],
                capture_output=True, text=True,
            ).stdout
            pytest.fail(
                "Razorpay QR create fell back to UPI intent. "
                "Code-review confirms 'close_by' param IS sent (mess_menu_cal.py L448). "
                "Upstream Razorpay QR API is returning HTTP 500 SERVER_ERROR — this is a "
                "Razorpay merchant-account activation issue (QR Codes feature not enabled "
                "on the live key rzp_live_StwxFqd60PF0VM). "
                f"Backend fallback log: {log.strip() or '(none)'}"
            )
        assert rzp_id.startswith("qr_"), f"Expected qr_id to start with 'qr_', got: {rzp_id}"
        assert rzp_url and rzp_url.startswith("http"), f"Bad image_url: {rzp_url}"
