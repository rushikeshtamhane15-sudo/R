"""iter-137 backend tests
Covers:
  - POST /api/admin/kiosk/order with optional customer_name (persisted, returned)
  - GET  /api/admin/kiosk/daily-report contract
  - POST /api/admin/kiosk/whatsapp/send-receipt (stub-mode OK)
  - GET  /api/admin/tiffin-stock new fields (raw_tiffins, engaged, on_delivery,
    takeaway_pending, next_slot, next_slot_required, shortage_for_next_run,
    expected_in_hand)
  - POST /api/admin/tiffin-stock/collect-empties bumps in-hand
Auth: OTP dev-mode using ADMIN_PHONES phone (9970705391 → admin role via allowlist).
"""

import os
import datetime as dt
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# admin phone from /app/backend/.env ADMIN_PHONES
ADMIN_PHONE = "9970705391"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/send-otp", json={"phone": ADMIN_PHONE}, timeout=15)
    if r.status_code == 429:
        pytest.skip(f"Rate-limited on send-otp: {r.text}")
    assert r.status_code == 200, f"send-otp failed: {r.status_code} {r.text}"
    body = r.json()
    otp = body.get("dev_otp")
    assert otp, f"dev_otp missing (dev_mode not enabled?): {body}"
    r2 = s.post(f"{API}/auth/verify-otp", json={"phone": ADMIN_PHONE, "otp": otp}, timeout=15)
    assert r2.status_code == 200, f"verify-otp failed: {r2.status_code} {r2.text}"
    token = r2.json().get("session_token")
    assert token
    s.headers.update({"Authorization": f"Bearer {token}"})
    role = r2.json().get("user", {}).get("role")
    if role not in ("admin", "staff", "franchise_owner"):
        pytest.skip(f"logged-in user role={role} is not admin — cannot exercise kiosk/tiffin endpoints")
    return s


def _today_ist():
    ist_now = dt.datetime.utcnow() + dt.timedelta(hours=5, minutes=30)
    return ist_now.strftime("%Y-%m-%d")


# --------- (1) Kiosk order accepts optional customer_name -----------------

def test_kiosk_order_with_customer_name_persisted(admin_session):
    day = _today_ist()
    # Seed today's menu (best-effort; needs admin role)
    admin_session.post(
        f"{API}/admin/mess-menu/upsert",
        json={"date": day, "lunch": "Dal Rice (TEST iter-137)", "dinner": "Roti Sabzi (TEST iter-137)", "note": ""},
        timeout=15,
    )
    payload = {
        "service": "takeaway",
        "qty": 1,
        "date": day,
        "meal_type": "lunch",
        "customer_name": "TEST_JohnDoe",
        "payment_method": "cash",
        "note": "iter-137 test",
    }
    r = admin_session.post(f"{API}/admin/kiosk/order", json=payload, timeout=20)
    if r.status_code == 400 and "No lunch planned" in r.text:
        # try dinner
        payload["meal_type"] = "dinner"
        r = admin_session.post(f"{API}/admin/kiosk/order", json=payload, timeout=20)
    if r.status_code == 400 and "No " in r.text and "planned" in r.text:
        pytest.skip(f"No mess menu for {day} — skipping order test: {r.text}")
    assert r.status_code == 200, f"kiosk order failed: {r.status_code} {r.text}"
    order = r.json()["order"]
    assert order.get("customer_name") == "TEST_JohnDoe", f"customer_name not persisted: {order.get('customer_name')}"
    assert order.get("kind") == "walk_in_kiosk"
    assert order.get("bill_no")

    # Also test empty customer_name → stored as None
    payload2 = dict(payload); payload2.pop("customer_name")
    r2 = admin_session.post(f"{API}/admin/kiosk/order", json=payload2, timeout=20)
    assert r2.status_code == 200
    order2 = r2.json()["order"]
    assert order2.get("customer_name") in (None, ""), f"expected null customer_name, got {order2.get('customer_name')}"


# --------- (2) Daily report contract --------------------------------------

def test_kiosk_daily_report_contract(admin_session):
    day = _today_ist()
    r = admin_session.get(f"{API}/admin/kiosk/daily-report", params={"date": day}, timeout=15)
    assert r.status_code == 200, f"daily-report failed: {r.status_code} {r.text}"
    b = r.json()
    expected_fields = {
        "ok", "date", "bill_count", "settled_count", "cash_total", "upi_total",
        "cash_pending", "upi_pending", "grand_total", "lunch_count", "dinner_count",
        "takeaway_count", "dining_count", "staff_breakdown", "top_bills",
    }
    missing = expected_fields - set(b.keys())
    assert not missing, f"daily-report missing fields: {missing} · got {list(b.keys())}"
    assert b["date"] == day
    assert isinstance(b["staff_breakdown"], list)
    assert isinstance(b["top_bills"], list)
    assert b["bill_count"] >= 0
    # staff_breakdown row shape
    if b["staff_breakdown"]:
        row = b["staff_breakdown"][0]
        for k in ("staff_id", "name", "bill_count", "cash_collected", "upi_collected", "cash_pending"):
            assert k in row, f"staff row missing {k}: {row}"


# --------- (3) WhatsApp send stub -----------------------------------------

def test_kiosk_whatsapp_send_receipt_stub(admin_session):
    # find any kiosk order created today to reuse; otherwise skip
    r = admin_session.get(f"{API}/admin/kiosk/orders/today", timeout=15)
    if r.status_code != 200:
        pytest.skip(f"/admin/kiosk/orders/today failed: {r.status_code}")
    orders = r.json().get("orders") or r.json().get("items") or []
    if not orders and isinstance(r.json(), list):
        orders = r.json()
    if not orders:
        pytest.skip("no kiosk orders today to send whatsapp receipt for")
    order_id = orders[0].get("order_id")
    assert order_id
    r2 = admin_session.post(
        f"{API}/admin/kiosk/whatsapp/send-receipt",
        json={"order_id": order_id, "phone": "9999999999", "name": "TEST_WA"},
        timeout=20,
    )
    assert r2.status_code == 200, f"whatsapp send failed: {r2.status_code} {r2.text}"
    body = r2.json()
    assert body.get("ok") is True
    # In stub mode we expect status='stub_mode'; if creds live it will be 'sent'
    assert body.get("status") in ("stub_mode", "sent", "queued", "accepted", None), body


# --------- (4) Tiffin stock GET new fields --------------------------------

def test_tiffin_stock_get_new_fields(admin_session):
    r = admin_session.get(f"{API}/admin/tiffin-stock", timeout=15)
    assert r.status_code == 200, f"tiffin-stock GET failed: {r.status_code} {r.text}"
    b = r.json()
    for k in ("raw_tiffins", "quantity", "engaged", "on_delivery", "takeaway_pending",
              "next_slot", "next_slot_required", "shortage_for_next_run", "expected_in_hand"):
        assert k in b, f"tiffin-stock missing field {k}: keys={list(b.keys())}"
    # Sanity: raw = in_hand + engaged (per model)
    assert int(b["raw_tiffins"]) == int(b["quantity"]) + int(b["engaged"]), (
        f"raw({b['raw_tiffins']}) != in_hand({b['quantity']}) + engaged({b['engaged']})"
    )
    assert int(b["engaged"]) >= int(b["on_delivery"]) + int(b["takeaway_pending"]) - 1  # allow rounding
    assert b["next_slot"] in ("lunch", "dinner")


# --------- (5) collect-empties bumps in-hand ------------------------------

def test_tiffin_stock_collect_empties_increments_inhand(admin_session):
    before = admin_session.get(f"{API}/admin/tiffin-stock", timeout=15).json()
    in_hand_before = int(before["quantity"])
    raw_before = int(before["raw_tiffins"])
    r = admin_session.post(
        f"{API}/admin/tiffin-stock/collect-empties",
        json={"count": 3, "slot": "lunch", "note": "TEST_iter137"},
        timeout=15,
    )
    assert r.status_code == 200, f"collect-empties failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("ok") is True
    assert int(body.get("collected") or 0) == 3
    after = admin_session.get(f"{API}/admin/tiffin-stock", timeout=15).json()
    in_hand_after = int(after["quantity"])
    raw_after = int(after["raw_tiffins"])
    assert in_hand_after == in_hand_before + 3, (
        f"in-hand did not bump by 3: before={in_hand_before} after={in_hand_after}"
    )
    # Raw should stay the same (empty return doesn't create new tiffins)
    assert raw_after == raw_before, f"raw changed unexpectedly: {raw_before} → {raw_after}"
    # engaged should DECREMENT by 3
    assert int(after["engaged"]) == int(before["engaged"]) - 3, (
        f"engaged did not decrement by 3: {before['engaged']} → {after['engaged']}"
    )

    # cleanup: mark 3 broken to restore counts (broken decrements in-hand + raw bookkeeping)
    # Use manual-adjust to decrement in-hand back by 3 without touching lifetime.
    try:
        admin_session.post(
            f"{API}/admin/tiffin-stock/adjust",
            json={"delta": -3, "reason": "TEST_iter137 cleanup"},
            timeout=15,
        )
    except Exception:
        pass


# --------- (6) collect-empties validation ---------------------------------

def test_collect_empties_rejects_non_positive(admin_session):
    r = admin_session.post(
        f"{API}/admin/tiffin-stock/collect-empties",
        json={"count": 0, "slot": "lunch"},
        timeout=15,
    )
    assert r.status_code in (400, 422), f"expected 400/422 for count=0, got {r.status_code} {r.text}"
