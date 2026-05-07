"""Iter17: Restaurant order cancel/refund + reorder banner backend coverage.

Covers:
  * POST /api/restaurant/orders/{id}/cancel
      - 401/403 unauth
      - 404 order not found
      - 403 cross-user
      - 400 status != "paid"
      - 200 happy path: status="cancelled", refund credited to wallet,
        wallet_transactions entry created, response shape correct
      - 400 idempotency (cancel twice)
  * Regression: GET /restaurant/orders, POST /restaurant/order, /verify,
    /restaurant/orders/{id}/track still working.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest  # noqa: F401
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

API = f"{BASE_URL}/api"
mcli = MongoClient(MONGO_URL)
db = mcli[DB_NAME]


def _phone():
    return f"9{uuid.uuid4().int % 1_000_000_000:09d}"


def _seed_user(role="subscriber"):
    uid = f"TEST_{role}_{uuid.uuid4().hex[:10]}"
    tok = f"TEST_st_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": uid,
        "email": f"TEST_{uuid.uuid4().hex[:6]}@efoodcare.com",
        "phone": _phone(),
        "name": f"Test {role.title()}",
        "role": role,
        "qr_token": f"qr_TEST_{uuid.uuid4().hex[:10]}",
        "photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "wallet_balance": 0.0,
        "address": "123 TEST Street",
    })
    db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": "2099-01-01T00:00:00+00:00",
    })
    return uid, tok


def _cleanup(uid, tok):
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_one({"session_token": tok})
    db.restaurant_orders.delete_many({"user_id": uid})
    db.wallet_transactions.delete_many({"user_id": uid})


def _place_and_pay(tok, items=None):
    items = items or [{"id": "tiffin_half", "qty": 2}]
    r = requests.post(f"{API}/restaurant/order", json={"items": items, "address": "TEST iter17"},
                      cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200, r.text
    oid = r.json()["order_id"]
    v = requests.post(f"{API}/restaurant/verify", json={"order_id": oid},
                      cookies={"session_token": tok}, timeout=10)
    assert v.status_code == 200, v.text
    assert v.json()["order"]["status"] == "paid"
    total = float(v.json()["order"]["total"])
    return oid, total


@pytest.fixture(scope="module")
def subscriber():
    uid, tok = _seed_user("subscriber")
    yield uid, tok
    _cleanup(uid, tok)


@pytest.fixture(scope="module")
def other_subscriber():
    uid, tok = _seed_user("subscriber")
    yield uid, tok
    _cleanup(uid, tok)


# ---------- AUTH ----------
def test_cancel_unauth_401():
    r = requests.post(f"{API}/restaurant/orders/some-id/cancel", timeout=10)
    assert r.status_code in (401, 403)


# ---------- 404 ----------
def test_cancel_not_found_404(subscriber):
    _, tok = subscriber
    r = requests.post(f"{API}/restaurant/orders/does-not-exist-{uuid.uuid4().hex}/cancel",
                      cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 404


# ---------- 403 cross-user ----------
def test_cancel_other_users_order_403(subscriber, other_subscriber):
    _, tok_a = subscriber
    _, tok_b = other_subscriber
    oid, _ = _place_and_pay(tok_a)
    r = requests.post(f"{API}/restaurant/orders/{oid}/cancel",
                      cookies={"session_token": tok_b}, timeout=10)
    assert r.status_code == 403


# ---------- 400 invalid state (preparing / delivered / cancelled) ----------
@pytest.mark.parametrize("bad_status", ["preparing", "delivered", "cancelled", "out_for_delivery"])
def test_cancel_blocked_when_not_paid(subscriber, bad_status):
    uid, tok = subscriber
    oid, _ = _place_and_pay(tok)
    db.restaurant_orders.update_one({"order_id": oid}, {"$set": {"status": bad_status}})
    r = requests.post(f"{API}/restaurant/orders/{oid}/cancel",
                      cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 400, r.text


# ---------- 200 happy path + wallet ----------
def test_cancel_happy_path_credits_wallet(subscriber):
    uid, tok = subscriber
    # snapshot baseline wallet
    before = db.users.find_one({"user_id": uid}) or {}
    base_bal = round(float(before.get("wallet_balance") or 0), 2)

    oid, total = _place_and_pay(tok)

    r = requests.post(f"{API}/restaurant/orders/{oid}/cancel",
                      cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["refund_amount"] == round(total, 2)
    assert body["order"]["status"] == "cancelled"
    assert body["order"].get("refund_amount") == round(total, 2)
    assert body["order"].get("refund_mode") == "wallet"
    assert round(float(body["wallet_balance"]), 2) == round(base_bal + total, 2)

    # DB persistence: user balance updated
    after = db.users.find_one({"user_id": uid}) or {}
    assert round(float(after.get("wallet_balance") or 0), 2) == round(base_bal + total, 2)

    # wallet_transactions has a credit row referencing cancellation
    txns = list(db.wallet_transactions.find({"user_id": uid}).sort("created_at", -1).limit(5))
    assert any(
        t.get("type") == "credit"
        and round(float(t.get("amount") or 0), 2) == round(total, 2)
        and "cancel" in str(t.get("reason", "")).lower()
        for t in txns
    ), f"No matching credit txn found in {txns}"

    # GET /orders returns it cancelled
    h = requests.get(f"{API}/restaurant/orders", cookies={"session_token": tok}, timeout=10)
    assert h.status_code == 200
    rec = next((o for o in h.json()["orders"] if o["order_id"] == oid), None)
    assert rec and rec["status"] == "cancelled"


# ---------- idempotency: 2nd call → 400 ----------
def test_cancel_twice_idempotent_400(subscriber):
    _, tok = subscriber
    oid, _ = _place_and_pay(tok)

    r1 = requests.post(f"{API}/restaurant/orders/{oid}/cancel",
                       cookies={"session_token": tok}, timeout=10)
    assert r1.status_code == 200, r1.text

    r2 = requests.post(f"{API}/restaurant/orders/{oid}/cancel",
                       cookies={"session_token": tok}, timeout=10)
    assert r2.status_code == 400, r2.text


# ---------- REGRESSION ----------
def test_regression_orders_list(subscriber):
    _, tok = subscriber
    r = requests.get(f"{API}/restaurant/orders", cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200
    assert "orders" in r.json()


def test_regression_track_endpoint(subscriber):
    _, tok = subscriber
    oid, _ = _place_and_pay(tok)
    t = requests.get(f"{API}/restaurant/orders/{oid}/track",
                     cookies={"session_token": tok}, timeout=10)
    assert t.status_code == 200
    body = t.json()
    assert body["order_id"] == oid
    assert isinstance(body.get("items"), list) and body["items"]


def test_regression_menu_still_serves():
    r = requests.get(f"{API}/restaurant/menu", timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json().get("items"), list) and len(r.json()["items"]) > 0
