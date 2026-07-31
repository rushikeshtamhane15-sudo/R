"""iter-134 backend tests:
- GET /api/meal-slots (public)
- GET /api/admin/kiosk/staff-cash-pendency (admin/franchise_owner only)
- POST /api/admin/kiosk/staff-cash-mark-deposited (admin/franchise_owner only)
- Staff role allowed on POST /api/admin/kiosk/order (walk-in kiosk cash)
- Response schema key razorpay_qr_short_url present
"""
import os
import uuid
import time
import requests
import pytest
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

ADMIN_PHONE = "9970705391"   # in ADMIN_PHONES whitelist
STAFF_PHONE = "9811122233"   # ephemeral staff created in setup
SUBSCRIBER_PHONE = "9123456780"  # ephemeral clean subscriber (default role)


def _otp_login(phone: str, name: str | None = None) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, f"send-otp failed: {r.status_code} {r.text}"
    otp = r.json().get("dev_otp")
    assert otp, f"dev_otp not returned: {r.json()}"
    payload = {"phone": phone, "otp": otp}
    if name:
        payload["name"] = name
    r = requests.post(f"{BASE_URL}/api/auth/verify-otp", json=payload, timeout=15)
    assert r.status_code == 200, f"verify-otp failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module")
def admin_token():
    return _otp_login(ADMIN_PHONE, name="Admin Tester")


@pytest.fixture(scope="module")
def subscriber_token():
    return _otp_login(SUBSCRIBER_PHONE, name="Sub Tester")


@pytest.fixture(scope="module")
def staff(mongo):
    """Create a staff user via OTP login then promote via mongo."""
    token = _otp_login(STAFF_PHONE, name="Staff Tester")
    # Look up user_id
    u = mongo.users.find_one({"phone": STAFF_PHONE})
    assert u, "staff user was not created"
    mongo.users.update_one({"user_id": u["user_id"]}, {"$set": {"role": "staff"}})
    return {"token": token, "user_id": u["user_id"]}


@pytest.fixture(scope="module")
def cleanup_seed(mongo):
    seeded_ids: list[str] = []
    yield seeded_ids
    if seeded_ids:
        mongo.mess_menu_orders.delete_many({"order_id": {"$in": seeded_ids}})


# ---------- 1. GET /api/meal-slots ----------
def test_meal_slots_public():
    r = requests.get(f"{BASE_URL}/api/meal-slots", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    # It should return time windows
    assert isinstance(data, dict)
    # Basic keys we expect
    assert any(k in data for k in ("lunch", "lunch_start", "lunch_end", "slots"))


# ---------- 2. Staff role can call kiosk/order with cash ----------
def test_staff_can_place_kiosk_cash_order(staff, mongo, cleanup_seed):
    # We'll seed a menu row for today if missing to avoid the 400
    from datetime import date
    today = date.today().isoformat()
    if not mongo.mess_menu.find_one({"date": today}):
        mongo.mess_menu.insert_one({
            "date": today, "lunch": "TEST-Dal Rice", "dinner": "TEST-Roti Sabzi",
            "_seeded_by_test": True,
        })

    # Detect currently active meal
    slots = requests.get(f"{BASE_URL}/api/meal-slots").json()
    # Fallback: try both — one of them should be accepted by backend regardless (no time check on POST)
    payload = {
        "service": "takeaway",
        "qty": 1,
        "date": today,
        "meal_type": "lunch",
        "payment_method": "cash",
        "cash_amount": 0,
        "online_amount": 0,
        "note": "TEST_iter134 staff cash",
    }
    r = requests.post(
        f"{BASE_URL}/api/admin/kiosk/order",
        json=payload,
        headers={"Authorization": f"Bearer {staff['token']}"},
        timeout=20,
    )
    if r.status_code == 400 and "lunch" in r.text.lower():
        payload["meal_type"] = "dinner"
        r = requests.post(f"{BASE_URL}/api/admin/kiosk/order", json=payload,
                          headers={"Authorization": f"Bearer {staff['token']}"}, timeout=20)
    assert r.status_code == 200, f"staff kiosk order failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("ok") is True
    order = body["order"]
    assert order["kind"] == "walk_in_kiosk"
    assert order["placed_by_admin_id"] == staff["user_id"]
    assert order["cash_amount"] >= 0
    # Schema key present (value may be None in cash-only order)
    assert "razorpay_qr_short_url" in body
    assert "razorpay_qr_short_url" in order
    cleanup_seed.append(order["order_id"])


# ---------- 3. Staff-cash-pendency: admin sees the staff pending ----------
def test_staff_cash_pendency_admin_sees(admin_token, staff, mongo, cleanup_seed):
    # Ensure at least one pending kiosk cash order exists for this staff.
    seed_id = f"kio_TEST_{uuid.uuid4().hex[:10]}"
    mongo.mess_menu_orders.insert_one({
        "order_id": seed_id,
        "kind": "walk_in_kiosk",
        "cash_amount": 120,
        "online_amount": 0,
        "placed_by_admin_id": staff["user_id"],
        "created_at": "2026-01-01T10:00:00+00:00",
        "status": "pending_collection",
    })
    cleanup_seed.append(seed_id)

    r = requests.get(
        f"{BASE_URL}/api/admin/kiosk/staff-cash-pendency",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "rows" in data and "count" in data and "total_pending" in data
    assert isinstance(data["rows"], list)
    match = [row for row in data["rows"] if row["staff_user_id"] == staff["user_id"]]
    assert match, f"our staff not in pendency: rows={data['rows']}"
    row = match[0]
    assert row["pending_amount"] >= 120
    assert row["order_count"] >= 1
    for k in ("staff_name", "staff_role", "staff_phone", "oldest_at", "latest_at"):
        assert k in row
    assert row["staff_role"] == "staff"


# ---------- 4. Non-admin gets 403 on pendency ----------
def test_pendency_forbidden_for_subscriber(subscriber_token):
    r = requests.get(
        f"{BASE_URL}/api/admin/kiosk/staff-cash-pendency",
        headers={"Authorization": f"Bearer {subscriber_token}"},
        timeout=15,
    )
    assert r.status_code == 403, f"subscriber must be forbidden: {r.status_code} {r.text}"


def test_pendency_forbidden_for_plain_staff(staff):
    """Review-request explicitly notes regular staff must not see this admin section."""
    r = requests.get(
        f"{BASE_URL}/api/admin/kiosk/staff-cash-pendency",
        headers={"Authorization": f"Bearer {staff['token']}"},
        timeout=15,
    )
    assert r.status_code == 403, f"plain staff must be 403: {r.status_code} {r.text}"


# ---------- 5. Mark-deposited flips flag; subsequent list excludes ----------
def test_mark_deposited_flow(admin_token, staff, mongo):
    # Reseed a fresh pending order
    seed_id = f"kio_TEST_{uuid.uuid4().hex[:10]}"
    mongo.mess_menu_orders.insert_one({
        "order_id": seed_id,
        "kind": "walk_in_kiosk",
        "cash_amount": 250,
        "online_amount": 0,
        "placed_by_admin_id": staff["user_id"],
        "created_at": "2026-01-01T11:00:00+00:00",
        "status": "pending_collection",
    })
    try:
        r = requests.post(
            f"{BASE_URL}/api/admin/kiosk/staff-cash-mark-deposited",
            json={"staff_user_id": staff["user_id"], "bank_ref": "TEST_REF_iter134"},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("updated", 0) >= 1

        # Verify DB state
        doc = mongo.mess_menu_orders.find_one({"order_id": seed_id})
        assert doc["kiosk_cash_deposited"] is True
        assert doc.get("kiosk_cash_bank_ref") == "TEST_REF_iter134"
        assert doc.get("kiosk_cash_deposited_by")
        assert doc.get("kiosk_cash_deposited_at")

        # Subsequent GET should exclude that order (staff's pending should drop to
        # 0 unless earlier test seeded still-pending doc — but test_staff_cash_pendency
        # test seeded one which is now also deposited because same staff_user_id).
        r2 = requests.get(
            f"{BASE_URL}/api/admin/kiosk/staff-cash-pendency",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r2.status_code == 200
        matched = [row for row in r2.json()["rows"] if row["staff_user_id"] == staff["user_id"]]
        assert not matched, f"staff should have no pending after mark-deposited: {matched}"
    finally:
        mongo.mess_menu_orders.delete_one({"order_id": seed_id})


def test_mark_deposited_forbidden_for_subscriber(subscriber_token, staff):
    r = requests.post(
        f"{BASE_URL}/api/admin/kiosk/staff-cash-mark-deposited",
        json={"staff_user_id": staff["user_id"]},
        headers={"Authorization": f"Bearer {subscriber_token}"},
        timeout=15,
    )
    assert r.status_code == 403


# ---------- 6. Cleanup ephemeral staff user (best-effort) ----------
def test_zz_cleanup_staff(mongo):
    mongo.users.delete_one({"phone": STAFF_PHONE})
    mongo.users.delete_one({"phone": SUBSCRIBER_PHONE})
    # Cleanup any seeded menu row
    mongo.mess_menu.delete_many({"_seeded_by_test": True})
