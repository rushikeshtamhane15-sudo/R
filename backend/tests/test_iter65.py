"""Iter-65 backend tests:
- GET /admin/stats period selector + active_subs orphan filter
- GET/PUT /admin/mess-menu/config (CMS for BG + service prices)
- POST /mess-menu/order (auth required, validation, pricing)
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "test_database")


async def _mk_admin(db):
    uid = f"user_admin_iter65_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Iter65 Admin",
        "email": f"iter65admin_{uuid.uuid4().hex[:4]}@efoodcare.com", "role": "admin",
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _mk_sub(db):
    uid = f"user_sub_iter65_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"9{uuid.uuid4().hex[:9]}", "name": "Iter65 Sub",
        "email": f"iter65sub_{uuid.uuid4().hex[:4]}@example.com", "role": "subscriber",
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _cleanup(db, uids, toks, dates=None, order_ids=None):
    for u in uids:
        await db.users.delete_one({"user_id": u})
        await db.subscriptions.delete_many({"user_id": u})
    for t in toks:
        await db.user_sessions.delete_one({"session_token": t})
    if dates:
        await db.mess_menu.delete_many({"date": {"$in": dates}})
    if order_ids:
        await db.mess_menu_orders.delete_many({"order_id": {"$in": order_ids}})


# -------- /admin/stats --------
@pytest.mark.asyncio
async def test_admin_stats_period_cycle_and_label():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_admin(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.get("/api/admin/stats?period=cycle", cookies={"session_token": tok})
            assert r.status_code == 200, r.text
            data = r.json()
            for k in ("active_subscriptions", "revenue", "period", "period_label", "window_start", "window_end"):
                assert k in data, f"missing {k}"
            assert data["period"] == "cycle"
            # cycle label like "6 May → 5 Jun 2026"
            assert "→" in data["period_label"]
            assert isinstance(data["active_subscriptions"], int)
            assert isinstance(data["revenue"], (int, float))

            # day period with date
            r2 = await cli.get("/api/admin/stats?period=day&date=2026-01-15", cookies={"session_token": tok})
            assert r2.status_code == 200
            d2 = r2.json()
            assert d2["period"] == "day"
            assert d2["window_start"] == "2026-01-15"

            # month period
            r3 = await cli.get("/api/admin/stats?period=month&date=2026-01-15", cookies={"session_token": tok})
            assert r3.status_code == 200
            d3 = r3.json()
            assert d3["period"] == "month"
            assert d3["window_start"] == "2026-01-01"

            # year period
            r4 = await cli.get("/api/admin/stats?period=year&date=2026-06-15", cookies={"session_token": tok})
            assert r4.status_code == 200
            assert r4.json()["period_label"] == "2026"
    finally:
        await _cleanup(db, [uid], [tok]); c.close()


@pytest.mark.asyncio
async def test_admin_stats_active_subs_excludes_orphans():
    """A subscription whose user_id points to a missing/non-subscriber user
    must NOT be counted in active_subscriptions."""
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, admin_uid = await _mk_admin(db)
    sub_tok, sub_uid = await _mk_sub(db)
    orphan_uid = f"user_orphan_iter65_{uuid.uuid4().hex[:6]}"
    # Insert subs: one real, two orphans
    sub_ids = [f"sub_iter65_{uuid.uuid4().hex[:8]}" for _ in range(3)]
    await db.subscriptions.insert_many([
        {"subscription_id": sub_ids[0], "user_id": sub_uid, "status": "active", "plan_code": "monthly"},
        {"subscription_id": sub_ids[1], "user_id": orphan_uid, "status": "active", "plan_code": "monthly"},
        {"subscription_id": sub_ids[2], "user_id": admin_uid, "status": "active", "plan_code": "monthly"},  # role=admin, not subscriber
    ])
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.get("/api/admin/stats?period=cycle", cookies={"session_token": tok})
            assert r.status_code == 200
            data = r.json()
            # Count only subs created in THIS test that should be valid (1) — but other
            # real subscribers may also be active in the DB. So we just verify the orphan
            # subs are excluded by comparing before/after.
            # Re-fetch with orphan sub deleted and assert the count drops by exactly 1.
            cnt_with_orphan = data["active_subscriptions"]
            await db.subscriptions.delete_one({"subscription_id": sub_ids[1]})
            r2 = await cli.get("/api/admin/stats?period=cycle", cookies={"session_token": tok})
            cnt_no_orphan = r2.json()["active_subscriptions"]
            # Deleting the orphan should NOT change count (since orphan was already excluded)
            assert cnt_with_orphan == cnt_no_orphan, (
                f"orphan sub was counted! before={cnt_with_orphan} after_delete={cnt_no_orphan}"
            )
    finally:
        await db.subscriptions.delete_many({"subscription_id": {"$in": sub_ids}})
        await _cleanup(db, [admin_uid, sub_uid], [tok, sub_tok]); c.close()


@pytest.mark.asyncio
async def test_admin_stats_non_admin_forbidden():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_sub(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.get("/api/admin/stats", cookies={"session_token": tok})
            assert r.status_code == 403
    finally:
        await _cleanup(db, [uid], [tok]); c.close()


# -------- /admin/mess-menu/config --------
@pytest.mark.asyncio
async def test_mess_menu_config_get_put_persists():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_admin(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            # GET defaults / current
            r = await cli.get("/api/admin/mess-menu/config", cookies={"session_token": tok})
            assert r.status_code == 200, r.text
            cfg = r.json()
            for k in ("bg_gradient_from", "bg_gradient_mid", "bg_gradient_to", "text_color",
                      "price_delivery", "price_takeaway", "price_dining", "order_enabled"):
                assert k in cfg, f"missing {k}"

            # PUT new values
            new_cfg = {
                "bg_gradient_from": "#111111",
                "bg_gradient_mid": "#222222",
                "bg_gradient_to": "#333333",
                "text_color": "#ffffff",
                "price_delivery": 155,
                "price_takeaway": 130,
                "price_dining": 110,
                "order_enabled": True,
            }
            r2 = await cli.put("/api/admin/mess-menu/config", json=new_cfg, cookies={"session_token": tok})
            assert r2.status_code == 200, r2.text
            saved = r2.json()
            assert saved["price_delivery"] == 155
            assert saved["bg_gradient_from"] == "#111111"

            # GET back to verify persistence
            r3 = await cli.get("/api/admin/mess-menu/config", cookies={"session_token": tok})
            assert r3.json()["price_takeaway"] == 130

            # Public /mess-menu/today should include config block
            r4 = await cli.get("/api/mess-menu/today")
            assert r4.status_code == 200
            tdata = r4.json()
            assert "config" in tdata
            assert tdata["config"]["price_delivery"] == 155

            # Restore defaults so other tests aren't affected
            await cli.put("/api/admin/mess-menu/config", json={
                "bg_gradient_from": "#047857", "bg_gradient_mid": "#059669",
                "bg_gradient_to": "#065f46", "text_color": "#ecfdf5",
                "price_delivery": 140, "price_takeaway": 120, "price_dining": 100,
                "order_enabled": True,
            }, cookies={"session_token": tok})
    finally:
        await _cleanup(db, [uid], [tok]); c.close()


@pytest.mark.asyncio
async def test_mess_menu_config_subscriber_forbidden():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_sub(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.get("/api/admin/mess-menu/config", cookies={"session_token": tok})
            assert r.status_code == 403
            r2 = await cli.put("/api/admin/mess-menu/config", json={"price_delivery": 999}, cookies={"session_token": tok})
            assert r2.status_code == 403
    finally:
        await _cleanup(db, [uid], [tok]); c.close()


# -------- /mess-menu/order --------
@pytest.mark.asyncio
async def test_mess_menu_order_requires_auth():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
        r = await cli.post("/api/mess-menu/order", json={
            "service": "delivery", "qty": 1, "date": "2026-06-04", "meal_type": "lunch",
        })
        assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_mess_menu_order_validation_and_success():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_sub(db)
    test_date = "2026-07-15"
    order_ids = []
    # Seed a mess_menu doc with lunch only
    await db.mess_menu.update_one(
        {"date": test_date},
        {"$set": {"date": test_date, "lunch": "Paneer Butter Masala + Naan", "dinner": "", "note": ""}},
        upsert=True,
    )
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            # Invalid service
            r = await cli.post("/api/mess-menu/order", json={
                "service": "shipping", "qty": 1, "date": test_date, "meal_type": "lunch",
            }, cookies={"session_token": tok})
            assert r.status_code in (400, 422), r.text

            # Invalid meal_type
            r2 = await cli.post("/api/mess-menu/order", json={
                "service": "delivery", "qty": 1, "date": test_date, "meal_type": "brunch",
            }, cookies={"session_token": tok})
            assert r2.status_code in (400, 422)

            # No dinner planned for this date → expect 400
            r3 = await cli.post("/api/mess-menu/order", json={
                "service": "delivery", "qty": 1, "date": test_date, "meal_type": "dinner",
            }, cookies={"session_token": tok})
            assert r3.status_code == 400
            assert "dinner" in r3.json().get("detail", "").lower()

            # Date with no menu at all
            r4 = await cli.post("/api/mess-menu/order", json={
                "service": "delivery", "qty": 1, "date": "2050-01-01", "meal_type": "lunch",
            }, cookies={"session_token": tok})
            assert r4.status_code == 400

            # Valid order — delivery
            r5 = await cli.post("/api/mess-menu/order", json={
                "service": "delivery", "qty": 2, "date": test_date, "meal_type": "lunch", "note": "extra spicy",
            }, cookies={"session_token": tok})
            assert r5.status_code == 200, r5.text
            o5 = r5.json()["order"]
            assert o5["service"] == "delivery"
            assert o5["qty"] == 2
            assert o5["unit_price"] == 140
            assert o5["total"] == 280
            assert o5["status"] == "pending_payment"
            assert o5["menu_text"] == "Paneer Butter Masala + Naan"
            order_ids.append(o5["order_id"])

            # Verify persistence in Mongo
            persisted = await db.mess_menu_orders.find_one({"order_id": o5["order_id"]}, {"_id": 0})
            assert persisted is not None
            assert persisted["total"] == 280

            # Valid order — takeaway @ 120
            r6 = await cli.post("/api/mess-menu/order", json={
                "service": "takeaway", "qty": 1, "date": test_date, "meal_type": "lunch",
            }, cookies={"session_token": tok})
            assert r6.status_code == 200
            o6 = r6.json()["order"]
            assert o6["unit_price"] == 120
            assert o6["total"] == 120
            order_ids.append(o6["order_id"])

            # Valid order — dining @ 100
            r7 = await cli.post("/api/mess-menu/order", json={
                "service": "dining", "qty": 3, "date": test_date, "meal_type": "lunch",
            }, cookies={"session_token": tok})
            assert r7.status_code == 200
            assert r7.json()["order"]["total"] == 300
            order_ids.append(r7.json()["order"]["order_id"])

            # qty bounds
            r8 = await cli.post("/api/mess-menu/order", json={
                "service": "delivery", "qty": 0, "date": test_date, "meal_type": "lunch",
            }, cookies={"session_token": tok})
            assert r8.status_code in (400, 422)
    finally:
        await _cleanup(db, [uid], [tok], dates=[test_date], order_ids=order_ids); c.close()
