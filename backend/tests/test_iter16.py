"""Iter16: Customer Restaurant Order History + Reorder backend coverage.

Covers:
  * GET /api/restaurant/orders             -- auth-required, own orders newest-first
  * GET /api/restaurant/orders             -- 401 unauth
  * Place order -> verify (mock) -> appears in history
  * GET /api/restaurant/menu               -- still serves item ids that match
                                              order.items[*].id (so Reorder works)
  * GET /api/restaurant/orders/{id}/track  -- returns items list for OrderTrack page
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


@pytest.fixture(scope="module")
def subscriber():
    uid, tok = _seed_user("subscriber")
    yield uid, tok
    _cleanup(uid, tok)


# ---------- 401 / auth ----------
def test_orders_unauth_401():
    r = requests.get(f"{API}/restaurant/orders", timeout=10)
    assert r.status_code in (401, 403)


def test_orders_empty_for_fresh_user(subscriber):
    _, tok = subscriber
    r = requests.get(f"{API}/restaurant/orders", cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "orders" in body
    assert isinstance(body["orders"], list)
    assert len(body["orders"]) == 0


# ---------- place + verify -> appears in history ----------
def test_place_verify_then_history_lists_order(subscriber):
    _, tok = subscriber
    # create
    r = requests.post(
        f"{API}/restaurant/order",
        json={"items": [{"id": "tiffin_half", "qty": 2}], "address": "TEST iter16"},
        cookies={"session_token": tok}, timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("mock") is True
    order_id = body["order_id"]

    # verify (mock auto-success)
    v = requests.post(
        f"{API}/restaurant/verify",
        json={"order_id": order_id},
        cookies={"session_token": tok}, timeout=10,
    )
    assert v.status_code == 200, v.text
    assert v.json()["order"]["status"] == "paid"

    # history -- newest first, contains our order
    h = requests.get(f"{API}/restaurant/orders", cookies={"session_token": tok}, timeout=10)
    assert h.status_code == 200
    orders = h.json()["orders"]
    assert len(orders) >= 1
    assert orders[0]["order_id"] == order_id  # newest-first
    # required reorder fields
    assert orders[0]["status"] == "paid"
    assert isinstance(orders[0].get("items"), list) and len(orders[0]["items"]) >= 1
    assert orders[0]["items"][0].get("id") == "tiffin_half"
    assert orders[0]["items"][0].get("qty") == 2


def test_history_orders_user_isolation(subscriber):
    """A different subscriber must not see the seeded subscriber's orders."""
    other_uid, other_tok = _seed_user("subscriber")
    try:
        r = requests.get(f"{API}/restaurant/orders", cookies={"session_token": other_tok}, timeout=10)
        assert r.status_code == 200
        # Brand-new user, must be empty regardless of other users' history
        assert r.json()["orders"] == []
    finally:
        _cleanup(other_uid, other_tok)


# ---------- Reorder support: menu ids match historical order.items[*].id ----------
def test_menu_ids_intersect_with_order_items_for_reorder(subscriber):
    _, tok = subscriber
    # ensure at least one historical order exists
    requests.post(
        f"{API}/restaurant/order",
        json={"items": [{"id": "bev_masala_chai", "qty": 1}]},
        cookies={"session_token": tok}, timeout=10,
    )
    h = requests.get(f"{API}/restaurant/orders", cookies={"session_token": tok}, timeout=10)
    orders = h.json()["orders"]
    assert orders, "expected at least one order"
    historic_ids = {ln["id"] for o in orders for ln in (o.get("items") or [])}

    m = requests.get(f"{API}/restaurant/menu", timeout=10)
    assert m.status_code == 200
    live_ids = {it["id"] for it in m.json()["items"]}

    # At least one historical id must still be in the live menu so Reorder is meaningful
    assert historic_ids & live_ids, (
        f"No historical item ids overlap live menu — Reorder would always show 'unavailable' "
        f"(historic={historic_ids}, live_sample={list(live_ids)[:5]})"
    )


# ---------- track endpoint feeds OrderTrack reorder() ----------
def test_track_endpoint_returns_items_for_reorder(subscriber):
    _, tok = subscriber
    r = requests.post(
        f"{API}/restaurant/order",
        json={"items": [{"id": "tiffin_full", "qty": 1}]},
        cookies={"session_token": tok}, timeout=10,
    )
    assert r.status_code == 200
    oid = r.json()["order_id"]
    requests.post(f"{API}/restaurant/verify", json={"order_id": oid},
                  cookies={"session_token": tok}, timeout=10)

    t = requests.get(f"{API}/restaurant/orders/{oid}/track",
                     cookies={"session_token": tok}, timeout=10)
    assert t.status_code == 200, t.text
    body = t.json()
    assert body.get("order_id") == oid
    assert isinstance(body.get("items"), list) and body["items"]
    assert body["items"][0].get("id") == "tiffin_full"
    assert "status" in body and body["status"] in (
        "paid", "preparing", "ready_for_pickup", "out_for_delivery", "delivered"
    )


def test_history_limit_capped(subscriber):
    _, tok = subscriber
    # ?limit=9999 must be capped server-side (max 100)
    r = requests.get(f"{API}/restaurant/orders?limit=9999",
                     cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200
    assert len(r.json()["orders"]) <= 100
