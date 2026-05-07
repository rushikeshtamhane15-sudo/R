"""Iter15: Restaurant ordering mini-app + Raw materials Cylinder/staff-write tests.

Covers:
  * GET  /api/restaurant/menu               (public, 15 default items, fee fields)
  * PUT  /api/admin/restaurant/menu         (admin only; add/edit/dedupe/negative-price/strip-discount)
  * POST /api/admin/restaurant/menu/reset   (admin only; restores 15 defaults)
  * POST /api/restaurant/order              (auth; mock=True; persists; computes delivery fee)
  * POST /api/restaurant/verify             (auth; mock auto-verify; status=paid + paid_at + eta_at)
  * GET  /api/restaurant/orders             (own history)
  * GET  /api/admin/restaurant/orders       (admin only; all)
  * Raw materials: Cylinder default present at ₹100/person/month
  * Raw materials: PUT accepts new custom item + computes lunch/dinner/day costs (/60 formula)
  * Raw materials: PUT now allows STAFF role
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


# -------------------- helpers --------------------
def _phone() -> str:
    return f"9{uuid.uuid4().int % 1_000_000_000:09d}"


def _seed_user(role: str = "subscriber"):
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
def admin():
    uid, tok = _seed_user("admin")
    yield uid, tok
    _cleanup(uid, tok)


@pytest.fixture(scope="module")
def subscriber():
    uid, tok = _seed_user("subscriber")
    yield uid, tok
    _cleanup(uid, tok)


@pytest.fixture(scope="module")
def staff():
    uid, tok = _seed_user("staff")
    yield uid, tok
    _cleanup(uid, tok)


# ============== Restaurant menu (public) ==============
def test_public_menu_returns_15_defaults_and_fee_fields():
    # ensure fresh defaults if previous test mutated
    r = requests.get(f"{API}/restaurant/menu", timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and isinstance(body["items"], list)
    assert body["delivery_fee_flat"] == 30
    assert body["delivery_free_over"] == 400
    # Categories present
    cats = {i["category"] for i in body["items"]}
    expected_cats = {"Starters", "Mains", "Tiffin Specials", "Beverages", "Desserts"}
    assert expected_cats.issubset(cats), f"missing categories: {expected_cats - cats}"
    # Should be at least 15 (default seed)
    assert len(body["items"]) >= 15


def test_public_menu_no_auth_required():
    r = requests.get(f"{API}/restaurant/menu", timeout=10)
    assert r.status_code == 200


# ============== Admin menu CRUD ==============
def test_admin_menu_unauth_401():
    r = requests.get(f"{API}/admin/restaurant/menu", timeout=10)
    assert r.status_code == 401


def test_admin_menu_non_admin_403(subscriber):
    _, tok = subscriber
    r = requests.get(f"{API}/admin/restaurant/menu", cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 403


def test_admin_menu_save_negative_price_400(admin):
    _, tok = admin
    payload = {"items": [{"id": "x", "name": "Bad", "price": -5}]}
    r = requests.put(f"{API}/admin/restaurant/menu", json=payload, cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 400


def test_admin_menu_save_duplicate_id_400(admin):
    _, tok = admin
    payload = {"items": [
        {"id": "dup_x", "name": "A", "price": 10},
        {"id": "dup_x", "name": "B", "price": 20},
    ]}
    r = requests.put(f"{API}/admin/restaurant/menu", json=payload, cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 400
    assert "Duplicate" in r.text


def test_admin_menu_strips_useless_discount(admin):
    _, tok = admin
    payload = {"items": [
        {"id": "test_disc_1", "name": "Disc", "price": 100, "discounted_price": 120, "category": "Mains"}
    ]}
    r = requests.put(f"{API}/admin/restaurant/menu", json=payload, cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200
    items = r.json()["items"]
    assert items[0]["discounted_price"] is None  # silently stripped because >=price
    # Reset for downstream tests
    rr = requests.post(f"{API}/admin/restaurant/menu/reset", cookies={"session_token": tok}, timeout=10)
    assert rr.status_code == 200


def test_admin_menu_reset_restores_15(admin):
    _, tok = admin
    r = requests.post(f"{API}/admin/restaurant/menu/reset", cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 15


def test_admin_menu_add_new_item_auto_id(admin):
    _, tok = admin
    # Load current
    g = requests.get(f"{API}/admin/restaurant/menu", cookies={"session_token": tok}, timeout=10)
    assert g.status_code == 200
    items = g.json()["items"]
    items.append({"id": "", "name": "TEST_New_Item", "price": 50, "category": "Beverages"})
    r = requests.put(f"{API}/admin/restaurant/menu", json={"items": items}, cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200, r.text
    saved = r.json()["items"]
    new_item = next((x for x in saved if x["name"] == "TEST_New_Item"), None)
    assert new_item is not None
    assert new_item["id"].startswith("custom_")
    # Reset
    requests.post(f"{API}/admin/restaurant/menu/reset", cookies={"session_token": tok}, timeout=10)


# ============== Restaurant order flow ==============
def test_create_order_unauth_401():
    r = requests.post(f"{API}/restaurant/order", json={"items": [{"id": "tiffin_full", "qty": 1}]}, timeout=10)
    assert r.status_code == 401


def test_create_order_empty_cart_400(subscriber):
    _, tok = subscriber
    r = requests.post(f"{API}/restaurant/order", json={"items": []}, cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 400


def test_create_order_invalid_item_400(subscriber):
    _, tok = subscriber
    r = requests.post(f"{API}/restaurant/order", json={"items": [{"id": "doesnt_exist", "qty": 1}]},
                      cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 400


def test_create_order_under_400_charges_30_flat(subscriber):
    _, tok = subscriber
    # tiffin_half discounted ₹50 × 2 = ₹100 → delivery 30
    r = requests.post(f"{API}/restaurant/order",
                      json={"items": [{"id": "tiffin_half", "qty": 2}], "address": "TEST addr"},
                      cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mock"] is True
    assert body["subtotal"] == 100.0
    assert body["delivery_fee"] == 30.0
    assert body["total"] == 130.0
    assert body["order_id"].startswith("rorder_")
    # Persisted with status=created
    doc = db.restaurant_orders.find_one({"order_id": body["order_id"]}, {"_id": 0})
    assert doc is not None
    assert doc["status"] == "created"


def test_create_order_over_400_free_delivery_then_verify(subscriber):
    _, tok = subscriber
    # main_butter_chicken disc 330 × 2 = 660 → free
    r = requests.post(f"{API}/restaurant/order",
                      json={"items": [{"id": "main_butter_chicken", "qty": 2}]},
                      cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["subtotal"] == 660.0
    assert body["delivery_fee"] == 0.0
    assert body["total"] == 660.0
    order_id = body["order_id"]

    # Verify (mock auto-succeeds)
    v = requests.post(f"{API}/restaurant/verify",
                      json={"order_id": order_id},
                      cookies={"session_token": tok}, timeout=10)
    assert v.status_code == 200, v.text
    vbody = v.json()
    assert vbody["ok"] is True
    assert vbody["order"]["status"] == "paid"
    assert vbody["order"]["paid_at"]
    assert vbody["order"]["eta_at"]


def test_my_orders_returns_history(subscriber):
    _, tok = subscriber
    r = requests.get(f"{API}/restaurant/orders", cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "orders" in body and isinstance(body["orders"], list)
    # Should have at least the orders we created
    assert len(body["orders"]) >= 1


def test_admin_orders_admin_only(admin, subscriber):
    _, atok = admin
    _, stok = subscriber
    # subscriber forbidden
    r1 = requests.get(f"{API}/admin/restaurant/orders", cookies={"session_token": stok}, timeout=10)
    assert r1.status_code == 403
    # admin OK
    r2 = requests.get(f"{API}/admin/restaurant/orders", cookies={"session_token": atok}, timeout=10)
    assert r2.status_code == 200
    assert "orders" in r2.json()


def test_verify_other_user_order_403(admin, subscriber):
    _, atok = admin
    _, stok = subscriber
    # subscriber creates an order
    r = requests.post(f"{API}/restaurant/order",
                      json={"items": [{"id": "bev_masala_chai", "qty": 1}]},
                      cookies={"session_token": stok}, timeout=10)
    assert r.status_code == 200
    oid = r.json()["order_id"]
    # admin tries to verify someone else's order → 403
    v = requests.post(f"{API}/restaurant/verify",
                      json={"order_id": oid},
                      cookies={"session_token": atok}, timeout=10)
    assert v.status_code == 403


# ============== Raw materials ==============
def test_cylinder_default_present():
    # Public-ish: try via admin first since GET requires auth
    uid, tok = _seed_user("admin")
    try:
        r = requests.get(f"{API}/admin/raw-materials", cookies={"session_token": tok}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body.get("items") or []
        cyl = next((i for i in items if i["key"] == "cylinder"), None)
        assert cyl is not None, "Cylinder default missing"
        assert cyl.get("is_amount_based") is True
        assert float(cyl.get("amount_per_person_month") or 0) == 100.0
    finally:
        _cleanup(uid, tok)


def test_staff_can_edit_raw_materials_with_custom_item(staff, admin):
    _, stok = staff
    _, atok = admin

    # Get current items via admin
    g = requests.get(f"{API}/admin/raw-materials", cookies={"session_token": atok}, timeout=10)
    assert g.status_code == 200
    items = g.json().get("items") or []

    # Append custom item
    custom = {"key": "custom_test", "label": "Sugar", "unit": "₹",
              "is_amount_based": True, "amount_per_person_month": 80.0,
              "qty_per_person_month": None, "price_per_unit": None}
    new_items = [{k: v for k, v in i.items() if k in (
        "key", "label", "unit", "qty_per_person_month", "price_per_unit",
        "is_amount_based", "amount_per_person_month")} for i in items]
    new_items.append(custom)

    # PUT as STAFF (not admin) — must succeed per the iter15 change
    r = requests.put(f"{API}/admin/raw-materials",
                     json={"items": new_items},
                     cookies={"session_token": stok}, timeout=10)
    assert r.status_code == 200, f"staff PUT must be allowed; got {r.status_code} {r.text}"

    body = r.json()
    saved = body.get("items") or []
    sugar_item = next((i for i in saved if i["key"] == "custom_test"), None)
    assert sugar_item is not None, "custom_test row not persisted"
    assert float(sugar_item.get("amount_per_person_month") or 0) == 80.0
    # /60 formula goes in breakdown rows
    breakdown = body.get("breakdown") or []
    sugar_bd = next((i for i in breakdown if i["key"] == "custom_test"), None)
    assert sugar_bd is not None, "custom_test missing in breakdown"
    expected_per_meal = round(80.0 / 60.0, 4)
    assert abs(float(sugar_bd.get("amount_per_person_meal") or 0) - expected_per_meal) < 0.001
    assert "lunch_cost" in sugar_bd and "dinner_cost" in sugar_bd and "day_cost" in sugar_bd

    # Cleanup: reset to defaults
    requests.post(f"{API}/admin/raw-materials/reset",
                  cookies={"session_token": atok}, timeout=10)


def test_subscriber_cannot_edit_raw_materials_403(subscriber):
    _, tok = subscriber
    r = requests.put(f"{API}/admin/raw-materials",
                     json={"items": [{"key": "x", "label": "X",
                                      "is_amount_based": True,
                                      "amount_per_person_month": 1.0}]},
                     cookies={"session_token": tok}, timeout=10)
    assert r.status_code == 403
