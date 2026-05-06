"""Iter11: Purchase Order PDF + staff access to raw-materials & today-deliveries."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
assert BASE_URL

mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _seed_session(role="admin"):
    uid = f"TEST_u_{uuid.uuid4().hex[:10]}"
    tok = f"TEST_s_{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": uid,
        "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com",
        "phone": f"99{uuid.uuid4().int % 10**8:08d}",
        "name": f"Test {role}",
        "role": role,
        "qr_token": f"qr_TEST_{uuid.uuid4().hex[:10]}",
        "photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        "created_at": now.isoformat(),
        "wallet_balance": 0.0,
    })
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "created_at": now.isoformat(),
    })
    return uid, tok


@pytest.fixture
def admin():
    uid, tok = _seed_session("admin")
    yield {"user_id": uid, "token": tok}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_one({"session_token": tok})


@pytest.fixture
def staff():
    uid, tok = _seed_session("staff")
    yield {"user_id": uid, "token": tok}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_one({"session_token": tok})


@pytest.fixture
def subscriber():
    uid, tok = _seed_session("subscriber")
    yield {"user_id": uid, "token": tok}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_one({"session_token": tok})


# --------- Staff access to raw materials ---------
class TestStaffAccess:
    def test_staff_can_get_raw_materials(self, staff):
        r = requests.get(f"{BASE_URL}/api/admin/raw-materials", headers=_h(staff["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and "breakdown" in d and "totals" in d

    def test_staff_cannot_edit_rates(self, staff):
        r = requests.put(f"{BASE_URL}/api/admin/raw-materials", headers=_h(staff["token"]), json={"items": []})
        assert r.status_code == 403

    def test_staff_cannot_reset_rates(self, staff):
        r = requests.post(f"{BASE_URL}/api/admin/raw-materials/reset", headers=_h(staff["token"]))
        assert r.status_code == 403

    def test_subscriber_cannot_get_raw_materials(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/admin/raw-materials", headers=_h(subscriber["token"]))
        assert r.status_code == 403


# --------- Purchase order generation ---------
class TestPurchaseOrders:
    def test_admin_can_generate(self, admin):
        r = requests.post(
            f"{BASE_URL}/api/admin/purchase-orders/generate",
            headers=_h(admin["token"]),
            json={"supplier_name": "Test Supplier"},
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        body = r.content
        assert body.startswith(b"%PDF"), "Response is not a PDF"
        po_number = r.headers.get("x-po-number")
        assert po_number and po_number.startswith("PO-")
        # Stored in DB
        doc = db.purchase_orders.find_one({"po_number": po_number})
        assert doc is not None
        assert doc["supplier_name"] == "Test Supplier"
        assert doc["generated_by_user_id"] == admin["user_id"]
        # Cleanup
        db.purchase_orders.delete_one({"po_number": po_number})

    def test_staff_can_generate(self, staff):
        r = requests.post(f"{BASE_URL}/api/admin/purchase-orders/generate", headers=_h(staff["token"]), json={})
        assert r.status_code == 200
        po_number = r.headers["x-po-number"]
        db.purchase_orders.delete_one({"po_number": po_number})

    def test_subscriber_cannot_generate(self, subscriber):
        r = requests.post(f"{BASE_URL}/api/admin/purchase-orders/generate", headers=_h(subscriber["token"]), json={})
        assert r.status_code == 403

    def test_list_and_redownload(self, admin):
        # Generate one
        r = requests.post(f"{BASE_URL}/api/admin/purchase-orders/generate", headers=_h(admin["token"]), json={})
        po_number = r.headers["x-po-number"]
        try:
            # List
            lr = requests.get(f"{BASE_URL}/api/admin/purchase-orders", headers=_h(admin["token"]))
            assert lr.status_code == 200
            ld = lr.json()
            assert any(p["po_number"] == po_number for p in ld["purchase_orders"])
            # Redownload
            dl = requests.get(f"{BASE_URL}/api/admin/purchase-orders/{po_number}/download", headers=_h(admin["token"]))
            assert dl.status_code == 200
            assert dl.content.startswith(b"%PDF")
            # 404 on bogus po
            bad = requests.get(f"{BASE_URL}/api/admin/purchase-orders/PO-NOPE/download", headers=_h(admin["token"]))
            assert bad.status_code == 404
        finally:
            db.purchase_orders.delete_one({"po_number": po_number})


# --------- Staff today-deliveries ---------
class TestStaffDeliveries:
    def test_staff_can_view(self, staff):
        r = requests.get(f"{BASE_URL}/api/staff/today-deliveries", headers=_h(staff["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "rows" in d and "counts" in d
        assert "lunch" in d["counts"] and "dinner" in d["counts"]
        for k in ("full", "half"):
            assert k in d["counts"]["lunch"]
            assert k in d["counts"]["dinner"]

    def test_admin_can_view(self, admin):
        r = requests.get(f"{BASE_URL}/api/staff/today-deliveries", headers=_h(admin["token"]))
        assert r.status_code == 200

    def test_subscriber_cannot_view(self, subscriber):
        r = requests.get(f"{BASE_URL}/api/staff/today-deliveries", headers=_h(subscriber["token"]))
        assert r.status_code == 403
