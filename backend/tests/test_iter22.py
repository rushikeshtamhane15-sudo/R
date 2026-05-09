"""Iter22 — Backend regression for big-batch features:
- Wallet on checkout (apply_wallet, wallet_used, payable, debit ledger on verify)
- Profile auto-save during /restaurant/order
- Self-service rider apply + admin approve/reject + role promotion
- /admin/role accepts email, phone, or both ($or)
- Multi-order helpers: list /restaurant/orders for the same user
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME") or "test_database"

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


def _iso(dt):
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt.tzinfo is None else dt.isoformat()


def _seed_user(phone, role, name, wallet=0, email=None, lat=None, lng=None):
    uid = f"user_TEST_{uuid.uuid4().hex[:10]}"
    doc = {
        "user_id": uid,
        "phone": phone,
        "role": role,
        "name": name,
        "wallet_balance": float(wallet),
        "qr_token": f"qr_{uuid.uuid4().hex[:10]}",
        "created_at": _iso(datetime.now(timezone.utc)),
    }
    if email:
        doc["email"] = email
    if lat is not None:
        doc["lat"] = lat
    if lng is not None:
        doc["lng"] = lng
    db.users.replace_one({"phone": phone}, doc, upsert=True)
    return db.users.find_one({"phone": phone}, {"_id": 0})


def _issue_session(user_id):
    tok = f"sess_TEST_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({
        "session_token": tok,
        "user_id": user_id,
        "expires_at": _iso(datetime.now(timezone.utc) + timedelta(days=1)),
        "created_at": _iso(datetime.now(timezone.utc)),
    })
    return tok


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# --- Fixtures ---------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_user():
    u = _seed_user(phone="9988776611", role="admin", name="TEST_Admin", email="testadmin@efoodcare.com")
    yield u


@pytest.fixture(scope="module")
def admin_token(admin_user):
    return _issue_session(admin_user["user_id"])


@pytest.fixture
def fresh_subscriber():
    # New user per test for isolation
    phone = f"99{uuid.uuid4().int % 100000000:08d}"
    u = _seed_user(phone=phone, role="subscriber", name="TEST_Sub", wallet=200)
    tok = _issue_session(u["user_id"])
    yield u, tok


# --- Wallet on checkout -----------------------------------------------------
class TestCheckoutWallet:
    def test_apply_wallet_reduces_payable(self, fresh_subscriber):
        u, tok = fresh_subscriber
        payload = {
            "items": [{"id": "starter_paneer_tikka", "qty": 1}],
            "name": "Test Foo",
            "phone": "9988001122",
            "address": "Plot 99 Test Lane",
            "apply_wallet": True,
        }
        r = requests.post(f"{API}/restaurant/order", headers=_hdr(tok), json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        # Wallet has 200 → wallet_used = min(200, total). Don't hardcode total (delivery fee may vary).
        assert d["wallet_used"] == min(200, d["total"]), d
        assert d["payable"] == round(d["total"] - d["wallet_used"], 2), d
        assert "order_id" in d

    def test_apply_wallet_false_default(self, fresh_subscriber):
        u, tok = fresh_subscriber
        payload = {
            "items": [{"id": "starter_paneer_tikka", "qty": 1}],
            "name": "T", "phone": "9988001122", "address": "X",
        }
        r = requests.post(f"{API}/restaurant/order", headers=_hdr(tok), json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["wallet_used"] == 0
        assert d["payable"] == d["total"]

    def test_full_wallet_payment_then_verify_deducts(self, fresh_subscriber):
        """Wallet 200 → order 200 (use 1 hara_bhara discounted=190 + something).
        Easier: top up wallet to cover whole order."""
        u, tok = fresh_subscriber
        # Bump wallet to 500 to cover order fully
        db.users.update_one({"user_id": u["user_id"]}, {"$set": {"wallet_balance": 500.0}})
        payload = {
            "items": [{"id": "starter_paneer_tikka", "qty": 1}],  # total=240
            "name": "T", "phone": "9988001122", "address": "X",
            "apply_wallet": True,
        }
        r = requests.post(f"{API}/restaurant/order", headers=_hdr(tok), json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        order_id = d["order_id"]
        order_total = d["total"]
        assert d["wallet_used"] == order_total
        assert d["payable"] == 0
        assert d["mock"] is True  # full wallet => mock branch

        # Verify endpoint should debit wallet by order_total + log txn
        wallet_before = float(db.users.find_one({"user_id": u["user_id"]})["wallet_balance"])
        rv = requests.post(
            f"{API}/restaurant/verify",
            headers=_hdr(tok),
            json={"order_id": order_id, "razorpay_payment_id": "", "razorpay_signature": ""},
        )
        assert rv.status_code == 200, rv.text
        wallet_after = float(db.users.find_one({"user_id": u["user_id"]})["wallet_balance"])
        assert wallet_before - wallet_after == pytest.approx(order_total)
        # Ledger entry exists (wallet_transactions collection)
        txn = db.wallet_transactions.find_one(
            {"user_id": u["user_id"], "type": "debit", "amount": order_total,
             "reason": {"$regex": f"Restaurant order payment.*{order_id}"}}
        )
        assert txn is not None, "wallet_transactions debit txn missing"


# --- Profile auto-save ------------------------------------------------------
class TestProfileAutoSave:
    def test_order_writes_name_phone_address_to_user_doc(self, fresh_subscriber):
        u, tok = fresh_subscriber
        payload = {
            "items": [{"id": "starter_paneer_tikka", "qty": 1}],
            "name": "Test Foo",
            "phone": "9988001122",
            "address": "Plot 99 Test Lane",
        }
        r = requests.post(f"{API}/restaurant/order", headers=_hdr(tok), json=payload)
        assert r.status_code == 200, r.text
        # /api/auth/me should now reflect the auto-saved profile
        me = requests.get(f"{API}/auth/me", headers=_hdr(tok))
        assert me.status_code == 200, me.text
        u_after = me.json()["user"] if "user" in me.json() else me.json()
        assert u_after.get("name") == "Test Foo"
        assert u_after.get("phone") == "9988001122"
        assert u_after.get("address") == "Plot 99 Test Lane"


# --- Rider self-service apply + admin decide --------------------------------
class TestRiderApplyFlow:
    def test_apply_then_duplicate_then_approve_promotes(self, fresh_subscriber, admin_token):
        u, tok = fresh_subscriber
        body = {
            "full_name": "Test Rider",
            "phone": u["phone"],
            "licence_no": "DL14-2020-A12",
            "bike_number": "KA01AB1234",
            "bank_acc_last4": "9876",
            "city": "Bengaluru",
        }
        r = requests.post(f"{API}/rider/apply", headers=_hdr(tok), json=body)
        assert r.status_code == 200, r.text
        app = r.json()["application"]
        assert app["status"] == "pending"
        assert app["bike_number"] == "KA01AB1234"
        application_id = app["application_id"]

        # Duplicate pending application → 400
        r2 = requests.post(f"{API}/rider/apply", headers=_hdr(tok), json=body)
        assert r2.status_code == 400, r2.text

        # Self GET status
        rm = requests.get(f"{API}/rider/apply/me", headers=_hdr(tok))
        assert rm.status_code == 200
        assert rm.json()["application"]["application_id"] == application_id

        # Admin lists pending
        al = requests.get(f"{API}/admin/rider-applications", headers=_hdr(admin_token))
        assert al.status_code == 200
        ids = [a["application_id"] for a in al.json()["applications"]]
        assert application_id in ids

        # Admin approves → user role becomes 'rider'
        ad = requests.post(
            f"{API}/admin/rider-applications/{application_id}/decide",
            headers=_hdr(admin_token),
            json={"decision": "approve"},
        )
        assert ad.status_code == 200, ad.text
        assert ad.json()["application"]["status"] == "approved"
        promoted = db.users.find_one({"user_id": u["user_id"]})
        assert promoted["role"] == "rider"
        assert promoted.get("rider_bike_number") == "KA01AB1234"

    def test_reject_keeps_role(self, fresh_subscriber, admin_token):
        u, tok = fresh_subscriber
        body = {
            "full_name": "Test Reject",
            "phone": u["phone"],
            "licence_no": "DL55-2021-B22",
            "bike_number": "KA02XY9999",
            "bank_acc_last4": "0001",
            "city": "Mumbai",
        }
        r = requests.post(f"{API}/rider/apply", headers=_hdr(tok), json=body)
        assert r.status_code == 200, r.text
        application_id = r.json()["application"]["application_id"]
        ad = requests.post(
            f"{API}/admin/rider-applications/{application_id}/decide",
            headers=_hdr(admin_token),
            json={"decision": "reject", "notes": "incomplete docs"},
        )
        assert ad.status_code == 200
        assert ad.json()["application"]["status"] == "rejected"
        # Role unchanged
        u_after = db.users.find_one({"user_id": u["user_id"]})
        assert u_after["role"] == "subscriber"


# --- /admin/role by phone or email -----------------------------------------
class TestAdminRoleByPhoneOrEmail:
    def test_set_role_by_phone_only(self, fresh_subscriber, admin_token):
        u, _ = fresh_subscriber
        r = requests.post(
            f"{API}/admin/role",
            headers=_hdr(admin_token),
            json={"phone": u["phone"], "role": "rider"},
        )
        assert r.status_code == 200, r.text
        assert db.users.find_one({"user_id": u["user_id"]})["role"] == "rider"

    def test_set_role_by_email_only(self, admin_token):
        # Seed a user with email
        phone = f"99{uuid.uuid4().int % 100000000:08d}"
        email = f"test_{uuid.uuid4().hex[:6]}@example.com"
        u = _seed_user(phone=phone, role="subscriber", name="TEST_Email", email=email)
        r = requests.post(
            f"{API}/admin/role",
            headers=_hdr(admin_token),
            json={"email": email, "role": "staff"},
        )
        assert r.status_code == 200, r.text
        assert db.users.find_one({"user_id": u["user_id"]})["role"] == "staff"

    def test_set_role_missing_both_400(self, admin_token):
        r = requests.post(
            f"{API}/admin/role",
            headers=_hdr(admin_token),
            json={"role": "rider"},
        )
        assert r.status_code in (400, 422), r.text

    def test_set_role_unknown_user_404(self, admin_token):
        r = requests.post(
            f"{API}/admin/role",
            headers=_hdr(admin_token),
            json={"phone": "0000000000", "role": "rider"},
        )
        assert r.status_code == 404


# --- Multi-order: orders list returns 2 in-flight ---------------------------
class TestMultiOrderList:
    def test_two_in_flight_orders_listed(self, fresh_subscriber):
        u, tok = fresh_subscriber
        # Create two paid orders directly in mongo for the user
        for i in range(2):
            oid = f"rorder_TEST_{uuid.uuid4().hex[:14]}"
            db.restaurant_orders.insert_one({
                "order_id": oid,
                "user_id": u["user_id"],
                "phone": u["phone"], "name": u["name"], "address": "X",
                "items": [{"id": "x", "name": "x", "qty": 1, "unit_price": 100, "line_total": 100}],
                "subtotal": 100, "delivery_fee": 0, "total": 100,
                "wallet_used": 0, "payable": 100,
                "status": "paid" if i == 0 else "preparing",
                "created_at": _iso(datetime.now(timezone.utc)),
                "paid_at": _iso(datetime.now(timezone.utc)),
            })
        r = requests.get(f"{API}/restaurant/orders", headers=_hdr(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        orders = body.get("orders") or body
        assert isinstance(orders, list)
        statuses = [o["status"] for o in orders]
        assert "paid" in statuses
        assert "preparing" in statuses


# --- Cleanup ----------------------------------------------------------------
def teardown_module(module):
    db.users.delete_many({"name": {"$regex": "^TEST_"}})
    db.user_sessions.delete_many({"session_token": {"$regex": "^sess_TEST_"}})
    db.restaurant_orders.delete_many({"$or": [
        {"order_id": {"$regex": "^rorder_TEST_"}},
        {"name": "Test Foo"},
        {"name": "T"},
    ]})
    db.rider_applications.delete_many({"full_name": {"$regex": "^Test "}})
    db.wallet_transactions.delete_many({"reason": {"$regex": "Restaurant order payment"}})
