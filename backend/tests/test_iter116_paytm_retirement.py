"""iter-116 backend verification: Paytm retired from kiosk QR provider.
Tests:
  (1) GET /api/admin/kiosk/qr-provider returns 'razorpay' even after we
      persist legacy 'paytm' in db.app_config.kiosk_qr_v1 (self-heal).
  (2) PUT /api/admin/kiosk/qr-provider with provider='paytm' still returns
      'razorpay' and persists 'razorpay' (paytm coerced/rejected).
  (3) PUT as non-admin returns 403.
  (4) POST /api/admin/kiosk/order with payment_method='online' returns
      qr_provider='razorpay'. Fallback allowed if upstream Razorpay QR
      creation is not enabled on the account.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

client_mongo = MongoClient(MONGO_URL)
db = client_mongo[DB_NAME]

KIOSK_QR_KEY = "kiosk_qr_v1"


def _iso(dt):
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _mint_session(user_id: str) -> str:
    token = f"sess_test_{uuid.uuid4().hex[:16]}"
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": _iso(datetime.now(timezone.utc) + timedelta(hours=2)),
        "created_at": _iso(datetime.now(timezone.utc)),
    })
    return token


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    admin = db.users.find_one({"phone": "9199990000"}) or db.users.find_one({"role": "admin"})
    assert admin, "No admin user seeded"
    if admin.get("role") != "admin":
        db.users.update_one({"user_id": admin["user_id"]}, {"$set": {"role": "admin"}})
    return _mint_session(admin["user_id"])


@pytest.fixture(scope="module")
def non_admin_token():
    # A subscriber-role user
    u = db.users.find_one({"phone": "9333333333"}) or db.users.find_one({"role": "subscriber"})
    if not u:
        u = db.users.find_one({"role": {"$ne": "admin"}})
    assert u, "No non-admin user seeded"
    return _mint_session(u["user_id"])


class TestQrProviderRead:
    def test_default_when_missing(self, admin_token):
        db.app_config.delete_one({"key": KIOSK_QR_KEY})
        r = requests.get(f"{BASE_URL}/api/admin/kiosk/qr-provider", headers=_headers(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("provider") == "razorpay"

    def test_legacy_paytm_is_migrated(self, admin_token):
        # Seed legacy paytm value directly
        db.app_config.update_one(
            {"key": KIOSK_QR_KEY},
            {"$set": {"key": KIOSK_QR_KEY, "provider": "paytm"}},
            upsert=True,
        )
        r = requests.get(f"{BASE_URL}/api/admin/kiosk/qr-provider", headers=_headers(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        # Read path masks legacy value with default -> razorpay
        assert r.json().get("provider") == "razorpay"


class TestQrProviderWrite:
    def test_put_paytm_forced_to_razorpay(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/api/admin/kiosk/qr-provider",
            headers=_headers(admin_token),
            json={"provider": "paytm"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("provider") == "razorpay"
        # Verify persisted doc is razorpay
        doc = db.app_config.find_one({"key": KIOSK_QR_KEY})
        assert doc and doc.get("provider") == "razorpay"

    def test_put_razorpay_ok(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/api/admin/kiosk/qr-provider",
            headers=_headers(admin_token),
            json={"provider": "razorpay"},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json().get("provider") == "razorpay"

    def test_put_non_admin_403(self, non_admin_token):
        r = requests.put(
            f"{BASE_URL}/api/admin/kiosk/qr-provider",
            headers=_headers(non_admin_token),
            json={"provider": "razorpay"},
            timeout=10,
        )
        assert r.status_code == 403, r.text


class TestKioskOrderProvider:
    def test_online_order_uses_razorpay(self, admin_token):
        # Reset provider to razorpay first
        db.app_config.update_one(
            {"key": KIOSK_QR_KEY},
            {"$set": {"key": KIOSK_QR_KEY, "provider": "razorpay"}},
            upsert=True,
        )
        # Get today's date in IST-ish (server accepts either today/tomorrow from menu)
        r_menu = requests.get(f"{BASE_URL}/api/mess-menu/today?include_next=1", timeout=10)
        assert r_menu.status_code == 200, r_menu.text
        menu = r_menu.json()
        target_date = None
        target_meal = None
        for slot in ("current", "next"):
            block = menu.get(slot) or {}
            if block.get("lunch") or block.get("dinner"):
                target_date = menu.get("today") if slot == "current" else menu.get("tomorrow")
                target_meal = "lunch" if block.get("lunch") else "dinner"
                break
        if not target_date:
            pytest.skip("No mess menu published for today/tomorrow — cannot place kiosk order")

        payload = {
            "service": "takeaway",
            "qty": 1,
            "date": target_date,
            "meal_type": target_meal,
            "payment_method": "online",
            "cash_amount": 0,
            "online_amount": 120,
        }
        r = requests.post(
            f"{BASE_URL}/api/admin/kiosk/order",
            headers=_headers(admin_token),
            json=payload,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Provider must always be razorpay after migration
        assert data.get("qr_provider") == "razorpay", f"Expected qr_provider=razorpay, got {data.get('qr_provider')}. Full: {data}"
        # razorpay_qr_id MAY be null (upstream QR API not activated on merchant)
        # If it's null, backend should still fall back to a UPI intent qr_text.
        assert "order" in data
        order_id = data["order"].get("order_id")
        assert order_id
        # Cleanup: remove the order we just created
        db.mess_menu_orders.delete_one({"order_id": order_id})
