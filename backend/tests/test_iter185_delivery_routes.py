"""iter-185 · Pytest suite for the manual Tiffin Delivery Route system.

Tests hit the LIVE local backend via requests using the mocked OTP flow —
identical harness pattern to test_iter177_batch.py.

Coverage:
    * Auth required
    * Full mess-owner planner flow (create → dispatch → mark delivered)
    * State-machine transitions (pending → dispatched → delivered)
    * Reject non-tiffin user assignment
    * Boy w/o route can't dispatch
    * Re-assign same user pulls them off the previous boy's route
    * Summary endpoint for the dashboard tile
"""
from __future__ import annotations

import json
import os
import time
import uuid
from datetime import date
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient
from dotenv import dotenv_values

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")
ADMIN_PHONE = "9970705391"
CACHE = Path("/tmp/iter185_tokens.json")


def _login(phone: str) -> str:
    cache: dict = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text())
        except Exception:
            cache = {}
    tok = cache.get(phone)
    if tok:
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        if r.status_code == 200:
            return tok
    last = None
    for _ in range(3):
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=15)
        last = r
        if r.status_code == 429:
            time.sleep(65)
            continue
        if r.status_code != 200:
            break
        otp = r.json().get("dev_otp")
        if not otp:
            break
        r2 = requests.post(f"{BASE_URL}/api/auth/verify-otp", json={"phone": phone, "otp": otp}, timeout=15)
        assert r2.status_code == 200, r2.text
        tok = r2.json().get("session_token")
        cache[phone] = tok
        CACHE.write_text(json.dumps(cache))
        return tok
    pytest.skip(f"OTP login unavailable for {phone}: {last and last.status_code}")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_PHONE)}"}


@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture()
def test_mess(db):
    """Creates a scratch mess, subscriber, and delivery boy for one test.

    Returns dict with:
      mess_id, sub1_id, sub2_id, boy_id, boy_token, owner_id
    Cleanup runs in teardown.
    """
    tag = uuid.uuid4().hex[:6].upper()
    mess_id = f"TEST-MESS-{tag}"

    owner_uid = f"tu_own_{tag}"
    owner_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    db.users.insert_one({
        "user_id": owner_uid, "phone": owner_phone, "name": f"Owner {tag}",
        "role": "mess_owner", "mess_id": mess_id,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    db.messes.insert_one({
        "mess_id": mess_id, "name": mess_id, "owner_user_id": owner_uid,
        "owner_phone": owner_phone,
        "created_at": "2026-01-01T00:00:00+00:00",
    })

    def _mk_sub(letter: str) -> str:
        uid = f"tu_sub{letter}_{tag}"
        db.users.insert_one({
            "user_id": uid, "phone": f"8{uuid.uuid4().int % 10**9:09d}",
            "name": f"Sub{letter}", "role": "subscriber", "mess_id": mess_id,
            "address": f"Addr {letter}",
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        db.subscriptions.insert_one({
            "sub_id": f"tsub_{letter}_{tag}", "user_id": uid, "mess_id": mess_id,
            "status": "active", "service_type": "tiffin",
            "start_date": "2026-02-20", "end_date": "2026-03-20",
            "meals_total": 60, "meals_used": 5,
        })
        # Recent scan → not auto-paused
        db.attendance.insert_one({
            "att_id": f"tat_{letter}_{tag}", "user_id": uid,
            "date_str": date.today().isoformat(), "meal_type": "lunch",
        })
        return uid

    sub1 = _mk_sub("A")
    sub2 = _mk_sub("B")

    # Delivery boy — role + real login via OTP
    boy_uid = f"tu_boy_{tag}"
    boy_phone = f"7{uuid.uuid4().int % 10**9:09d}"
    db.users.insert_one({
        "user_id": boy_uid, "phone": boy_phone, "name": f"Boy {tag}",
        "role": "delivery_boy", "mess_id": mess_id,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    boy_id = f"dlv_{tag}"
    db.delivery_boys.insert_one({
        "boy_id": boy_id, "user_id": boy_uid,
        "name": f"Boy {tag}", "phone": boy_phone, "active": True, "mess_id": mess_id,
    })
    # Direct session insert (avoid OTP roundtrip for scratch boys — cleaner).
    boy_token = f"tsess_{tag}"
    db.user_sessions.insert_one({
        "session_token": boy_token, "user_id": boy_uid,
        "created_at": "2026-01-01T00:00:00+00:00",
        "expires_at": "2099-01-01T00:00:00+00:00",
    })

    # Owner session — same shortcut.
    owner_token = f"tsess_own_{tag}"
    db.user_sessions.insert_one({
        "session_token": owner_token, "user_id": owner_uid,
        "created_at": "2026-01-01T00:00:00+00:00",
        "expires_at": "2099-01-01T00:00:00+00:00",
    })

    ctx = {
        "mess_id": mess_id, "owner_id": owner_uid, "owner_token": owner_token,
        "sub1_id": sub1, "sub2_id": sub2,
        "boy_id": boy_id, "boy_uid": boy_uid, "boy_token": boy_token,
        "tag": tag,
    }
    yield ctx

    # ---- cleanup
    db.users.delete_many({"mess_id": mess_id})
    db.messes.delete_many({"mess_id": mess_id})
    db.subscriptions.delete_many({"mess_id": mess_id})
    db.delivery_routes.delete_many({"mess_id": mess_id})
    db.delivery_boys.delete_many({"mess_id": mess_id})
    db.attendance.delete_many({"user_id": {"$in": [sub1, sub2]}})
    db.user_sessions.delete_many({"session_token": {"$in": [owner_token, boy_token]}})


def test_auth_required():
    r = requests.get(f"{BASE_URL}/api/admin/delivery-routes", timeout=10)
    assert r.status_code == 401
    r = requests.get(f"{BASE_URL}/api/boy/delivery-routes/today", timeout=10)
    assert r.status_code == 401


def test_full_planner_and_dispatch_flow(test_mess):
    ctx = test_mess
    owner_h = {"Authorization": f"Bearer {ctx['owner_token']}"}
    boy_h = {"Authorization": f"Bearer {ctx['boy_token']}"}

    # 1. See no routes yet + 2 unassigned tiffin subs
    r = requests.get(f"{BASE_URL}/api/admin/delivery-routes", headers=owner_h, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["routes"] == []
    assert len(data["unassigned"]) == 2
    assert data["remaining_count"] == 0

    # 2. Assign both to boy — priority 1 & 2
    r = requests.post(f"{BASE_URL}/api/admin/delivery-routes", headers=owner_h,
                      json={"delivery_boy_id": ctx["boy_id"],
                            "checkpoints": [
                                {"user_id": ctx["sub1_id"], "priority": 1},
                                {"user_id": ctx["sub2_id"], "priority": 2},
                            ]}, timeout=15)
    assert r.status_code == 200, r.text
    route = r.json()["route"]
    assert route["status"] == "draft"
    assert all(cp["status"] == "pending" for cp in route["checkpoints"])

    # 3. Boy sees the route
    r = requests.get(f"{BASE_URL}/api/boy/delivery-routes/today", headers=boy_h, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["total_count"] == 2
    assert r.json()["remaining_count"] == 2

    # 4. Boy taps Dispatch → all turn red (dispatched)
    r = requests.post(f"{BASE_URL}/api/boy/delivery-routes/dispatch", headers=boy_h, timeout=15)
    assert r.status_code == 200, r.text
    after = r.json()["route"]
    assert after["status"] == "out_for_delivery"
    assert all(cp["status"] == "dispatched" for cp in after["checkpoints"])
    assert after["dispatched_at"]

    # 5. Summary endpoint (dashboard tile) reflects red state
    r = requests.get(f"{BASE_URL}/api/admin/delivery-routes/summary", headers=owner_h, timeout=15)
    summ = r.json()
    assert summ["remaining"] == 2
    assert summ["delivered"] == 0
    assert summ["any_dispatched"] is True

    # 6. Boy marks first stop delivered — status still out_for_delivery
    r = requests.post(f"{BASE_URL}/api/boy/delivery-routes/mark-delivered", headers=boy_h,
                      json={"route_id": after["route_id"], "user_id": ctx["sub1_id"]}, timeout=15)
    assert r.status_code == 200, r.text
    mid = r.json()["route"]
    assert mid["status"] == "out_for_delivery"
    statuses = {cp["user_id"]: cp["status"] for cp in mid["checkpoints"]}
    assert statuses[ctx["sub1_id"]] == "delivered"
    assert statuses[ctx["sub2_id"]] == "dispatched"

    # 7. Second delivered → route completed
    r = requests.post(f"{BASE_URL}/api/boy/delivery-routes/mark-delivered", headers=boy_h,
                      json={"route_id": mid["route_id"], "user_id": ctx["sub2_id"]}, timeout=15)
    done = r.json()["route"]
    assert done["status"] == "completed"
    assert done["completed_at"]

    # 8. Summary is green
    r = requests.get(f"{BASE_URL}/api/admin/delivery-routes/summary", headers=owner_h, timeout=15)
    summ = r.json()
    assert summ["remaining"] == 0
    assert summ["delivered"] == 2


def test_reject_non_tiffin_user(test_mess):
    ctx = test_mess
    r = requests.post(f"{BASE_URL}/api/admin/delivery-routes",
                      headers={"Authorization": f"Bearer {ctx['owner_token']}"},
                      json={"delivery_boy_id": ctx["boy_id"],
                            "checkpoints": [{"user_id": "definitely_not_real", "priority": 1}]},
                      timeout=15)
    assert r.status_code == 400
    assert "not an active tiffin subscriber" in r.text.lower()


def test_boy_cannot_dispatch_without_route(test_mess):
    ctx = test_mess
    r = requests.post(f"{BASE_URL}/api/boy/delivery-routes/dispatch",
                      headers={"Authorization": f"Bearer {ctx['boy_token']}"},
                      timeout=15)
    assert r.status_code == 404


def test_reassign_removes_from_other_boy(test_mess, db):
    ctx = test_mess
    owner_h = {"Authorization": f"Bearer {ctx['owner_token']}"}

    # Create a second boy via DB (same shortcut)
    tag = ctx["tag"]
    boy2_uid = f"tu_boy2_{tag}"
    db.users.insert_one({
        "user_id": boy2_uid, "phone": f"7{uuid.uuid4().int % 10**9:09d}",
        "name": "Boy2", "role": "delivery_boy", "mess_id": ctx["mess_id"],
    })
    boy2_id = f"dlv2_{tag}"
    db.delivery_boys.insert_one({
        "boy_id": boy2_id, "user_id": boy2_uid, "name": "Boy2",
        "phone": "9999999999", "active": True, "mess_id": ctx["mess_id"],
    })

    try:
        # Assign sub1 to boy1
        r = requests.post(f"{BASE_URL}/api/admin/delivery-routes", headers=owner_h,
                          json={"delivery_boy_id": ctx["boy_id"],
                                "checkpoints": [{"user_id": ctx["sub1_id"], "priority": 1}]},
                          timeout=15)
        assert r.status_code == 200, r.text

        # Re-assign sub1 to boy2 → should vanish from boy1
        r = requests.post(f"{BASE_URL}/api/admin/delivery-routes", headers=owner_h,
                          json={"delivery_boy_id": boy2_id,
                                "checkpoints": [{"user_id": ctx["sub1_id"], "priority": 1}]},
                          timeout=15)
        assert r.status_code == 200, r.text

        r = requests.get(f"{BASE_URL}/api/admin/delivery-routes", headers=owner_h, timeout=15)
        data = r.json()
        by_boy = {rt["delivery_boy_id"]: rt for rt in data["routes"]}
        assert len(by_boy[ctx["boy_id"]]["checkpoints"]) == 0
        assert len(by_boy[boy2_id]["checkpoints"]) == 1
    finally:
        db.delivery_boys.delete_many({"boy_id": boy2_id})
        db.users.delete_many({"user_id": boy2_uid})
