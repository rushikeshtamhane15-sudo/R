"""Iter-66 backend tests:
- Daily mess-menu push: CMS config, preview, send-now, idempotency, public read
- POST /mess-menu/order now returns checkout block (Razorpay mock fallback)
- POST /mess-menu/order/verify auto-verifies mock orders + 404/403 errors
- tick_daily_menu_push() unit-style call at configured hour
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "test_database")

IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist():
    return datetime.now(IST).date().isoformat()


async def _mk_admin(db):
    uid = f"user_admin_iter66_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "Iter66 Admin",
        "email": f"iter66admin_{uuid.uuid4().hex[:4]}@efoodcare.com", "role": "admin",
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
    uid = f"user_sub_iter66_{uuid.uuid4().hex[:6]}"
    tok = "sess_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"9{uuid.uuid4().hex[:9]}", "name": "Iter66 Sub",
        "email": f"iter66sub_{uuid.uuid4().hex[:4]}@example.com", "role": "subscriber",
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _cleanup(db, uids, toks, dates=None, order_ids=None, clear_broadcast_date=None):
    for u in uids:
        await db.users.delete_one({"user_id": u})
    for t in toks:
        await db.user_sessions.delete_one({"session_token": t})
    if dates:
        await db.mess_menu.delete_many({"date": {"$in": dates}})
    if order_ids:
        await db.mess_menu_orders.delete_many({"order_id": {"$in": order_ids}})
    if clear_broadcast_date:
        await db.mess_menu_broadcasts.delete_many({"date": clear_broadcast_date})


# --------------------------------------------------------------------------
# Push config CRUD
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_push_config_get_put_persists():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_admin(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.get("/api/admin/mess-menu/push/config", cookies={"session_token": tok})
            assert r.status_code == 200, r.text
            for k in ("enabled", "hour_ist", "title_template", "body_template", "cta_label", "cta_route"):
                assert k in r.json()

            new_cfg = {
                "enabled": True, "hour_ist": 11,
                "title_template": "Today's {meal}",
                "body_template": "{menu} · ₹{delivery_price} delivery",
                "cta_label": "Order now", "cta_route": "/dashboard",
            }
            r2 = await cli.put("/api/admin/mess-menu/push/config", json=new_cfg, cookies={"session_token": tok})
            assert r2.status_code == 200, r2.text
            saved = r2.json()
            assert saved["hour_ist"] == 11
            assert saved["title_template"] == "Today's {meal}"

            r3 = await cli.get("/api/admin/mess-menu/push/config", cookies={"session_token": tok})
            assert r3.json()["cta_label"] == "Order now"
    finally:
        await _cleanup(db, [uid], [tok]); c.close()


@pytest.mark.asyncio
async def test_push_config_subscriber_forbidden():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_sub(db)
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.get("/api/admin/mess-menu/push/config", cookies={"session_token": tok})
            assert r.status_code == 403
            r2 = await cli.put("/api/admin/mess-menu/push/config", json={"enabled": False}, cookies={"session_token": tok})
            assert r2.status_code == 403
    finally:
        await _cleanup(db, [uid], [tok]); c.close()


# --------------------------------------------------------------------------
# Preview
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_push_preview_400_without_menu_then_200_with_menu():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_admin(db)
    today = _today_ist()
    # Ensure no menu doc exists for today
    await db.mess_menu.delete_many({"date": today})
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.post("/api/admin/mess-menu/push/preview", cookies={"session_token": tok})
            assert r.status_code == 400, r.text

            # Seed today's menu (lunch only)
            await db.mess_menu.update_one(
                {"date": today},
                {"$set": {"date": today, "lunch": "Dal Tadka + Roti", "dinner": "", "note": ""}},
                upsert=True,
            )
            r2 = await cli.post("/api/admin/mess-menu/push/preview", cookies={"session_token": tok})
            assert r2.status_code == 200, r2.text
            preview = r2.json().get("preview")
            assert preview
            assert "title" in preview and "body" in preview
            # body must substitute {menu} and {delivery_price}
            assert "Dal Tadka + Roti" in preview["body"]
            assert "140" in preview["body"] or "₹" in preview["body"]
            # title should use {meal}
            assert preview["title"].lower().startswith("today's")
    finally:
        await db.mess_menu.delete_many({"date": today})
        await _cleanup(db, [uid], [tok]); c.close()


# --------------------------------------------------------------------------
# Send-now idempotency + public read
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_send_now_idempotent_and_public_read():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_admin(db)
    today = _today_ist()
    await db.mess_menu_broadcasts.delete_many({"date": today})
    await db.mess_menu.update_one(
        {"date": today},
        {"$set": {"date": today, "lunch": "Veg Pulao + Raita", "dinner": "", "note": ""}},
        upsert=True,
    )
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.post("/api/admin/mess-menu/push/send-now", cookies={"session_token": tok})
            assert r.status_code == 200, r.text
            bc1 = r.json()["broadcast"]
            assert bc1["date"] == today
            first_sent_at = bc1["sent_at"]

            # Call again — should not duplicate
            r2 = await cli.post("/api/admin/mess-menu/push/send-now", cookies={"session_token": tok})
            assert r2.status_code == 200
            bc2 = r2.json()["broadcast"]
            assert bc2["date"] == today

            count = await db.mess_menu_broadcasts.count_documents({"date": today})
            assert count == 1, f"send-now duplicated rows: {count}"

            # sent_at should refresh; first_sent_at preserved in DB
            doc = await db.mess_menu_broadcasts.find_one({"date": today}, {"_id": 0})
            assert doc.get("first_sent_at") == first_sent_at

            # Public read — no auth required
            async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as anon:
                r3 = await anon.get("/api/mess-menu/push")
                assert r3.status_code == 200
                pub = r3.json().get("broadcast")
                assert pub is not None
                assert pub["date"] == today
                assert "title" in pub and "body" in pub
    finally:
        await db.mess_menu_broadcasts.delete_many({"date": today})
        await db.mess_menu.delete_many({"date": today})
        await _cleanup(db, [uid], [tok]); c.close()


@pytest.mark.asyncio
async def test_send_now_400_when_no_menu():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_admin(db)
    today = _today_ist()
    await db.mess_menu.delete_many({"date": today})
    await db.mess_menu_broadcasts.delete_many({"date": today})
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.post("/api/admin/mess-menu/push/send-now", cookies={"session_token": tok})
            assert r.status_code == 400
    finally:
        await _cleanup(db, [uid], [tok]); c.close()


# --------------------------------------------------------------------------
# Mess-menu order + verify chain (Razorpay mock)
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mess_order_returns_checkout_block_with_mock():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_sub(db)
    test_date = "2026-08-15"
    order_ids = []
    await db.mess_menu.update_one(
        {"date": test_date},
        {"$set": {"date": test_date, "lunch": "Rajma Chawal", "dinner": "", "note": ""}},
        upsert=True,
    )
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.post("/api/mess-menu/order", json={
                "service": "delivery", "qty": 1, "date": test_date, "meal_type": "lunch",
            }, cookies={"session_token": tok})
            assert r.status_code == 200, r.text
            body = r.json()
            assert "checkout" in body, body
            co = body["checkout"]
            for k in ("order_id", "amount_paise", "currency", "key_id", "mock", "name", "description", "prefill"):
                assert k in co, f"missing {k} in checkout"
            assert co["currency"] == "INR"
            assert co["amount_paise"] == 140 * 100
            # Razorpay LIVE keys are failing in preview → mock fallback expected
            if co["mock"]:
                assert co["order_id"].startswith("order_mock_")
            order_ids.append(co["order_id"])
    finally:
        await _cleanup(db, [uid], [tok], dates=[test_date], order_ids=order_ids); c.close()


@pytest.mark.asyncio
async def test_mess_order_verify_mock_auto_verifies_and_is_idempotent():
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    tok, uid = await _mk_sub(db)
    other_tok, other_uid = await _mk_sub(db)
    test_date = "2026-08-16"
    order_ids = []
    await db.mess_menu.update_one(
        {"date": test_date},
        {"$set": {"date": test_date, "lunch": "Chole Bhature", "dinner": "", "note": ""}},
        upsert=True,
    )
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
            r = await cli.post("/api/mess-menu/order", json={
                "service": "takeaway", "qty": 2, "date": test_date, "meal_type": "lunch",
            }, cookies={"session_token": tok})
            assert r.status_code == 200
            co = r.json()["checkout"]
            order_id = co["order_id"]
            order_ids.append(order_id)

            # Verify mock order auto-verifies
            v = await cli.post("/api/mess-menu/order/verify", json={"order_id": order_id},
                               cookies={"session_token": tok})
            assert v.status_code == 200, v.text
            assert v.json()["status"] == "paid"
            assert v.json()["order"].get("paid_at")

            # Verify twice — harmless
            v2 = await cli.post("/api/mess-menu/order/verify", json={"order_id": order_id},
                                cookies={"session_token": tok})
            assert v2.status_code == 200
            assert v2.json()["status"] == "paid"

            # Persisted in DB
            doc = await db.mess_menu_orders.find_one({"order_id": order_id}, {"_id": 0})
            assert doc and doc["status"] == "paid"

            # 404 for unknown
            v3 = await cli.post("/api/mess-menu/order/verify", json={"order_id": "order_does_not_exist"},
                                cookies={"session_token": tok})
            assert v3.status_code == 404

            # 403 for another user's order
            v4 = await cli.post("/api/mess-menu/order/verify", json={"order_id": order_id},
                                cookies={"session_token": other_tok})
            assert v4.status_code == 403
    finally:
        await _cleanup(db, [uid, other_uid], [tok, other_tok], dates=[test_date], order_ids=order_ids); c.close()


# --------------------------------------------------------------------------
# tick_daily_menu_push() — unit-style at configured hour
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_tick_broadcasts_at_configured_hour_and_is_idempotent():
    # Import within test so we don't break collection if server import fails earlier
    sys.path.insert(0, "/app/backend")
    import server  # noqa: F401
    import routes.mess_menu_push as mmp  # type: ignore

    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    # Rebind server.db to a client owned by this test's event loop
    server.db = db
    today = _today_ist()
    await db.mess_menu_broadcasts.delete_many({"date": today})
    # Seed today's menu
    await db.mess_menu.update_one(
        {"date": today},
        {"$set": {"date": today, "lunch": "Tick Test Lunch", "dinner": "", "note": ""}},
        upsert=True,
    )
    # Ensure push enabled
    await db.app_config.update_one(
        {"key": mmp.PUSH_CONFIG_KEY},
        {"$set": {
            "key": mmp.PUSH_CONFIG_KEY,
            "enabled": True, "hour_ist": 11,
            "title_template": "Today's {meal}",
            "body_template": "{menu} · ₹{delivery_price}",
            "cta_label": "Order now", "cta_route": "/dashboard",
        }},
        upsert=True,
    )
    try:
        # Patch datetime.now(IST) inside mess_menu_push module → return 11:30 IST today
        real_dt = mmp.datetime

        class _DT(real_dt):
            @classmethod
            def now(cls, tz=None):  # type: ignore[override]
                base = real_dt.now(tz)
                # Override hour to match configured hour_ist=11
                return base.replace(hour=11, minute=30, second=0, microsecond=0)

        with patch.object(mmp, "datetime", _DT):
            # First call should broadcast
            await mmp.tick_daily_menu_push()
            cnt = await db.mess_menu_broadcasts.count_documents({"date": today})
            assert cnt == 1, f"expected 1 broadcast row, got {cnt}"

            # Second call same hour → no duplicate
            await mmp.tick_daily_menu_push()
            cnt2 = await db.mess_menu_broadcasts.count_documents({"date": today})
            assert cnt2 == 1, f"tick_daily_menu_push not idempotent, got {cnt2}"

            doc = await db.mess_menu_broadcasts.find_one({"date": today}, {"_id": 0})
            assert doc["reason"] == "scheduled"
            assert "Tick Test Lunch" in doc["body"]
    finally:
        await db.mess_menu_broadcasts.delete_many({"date": today})
        await db.mess_menu.delete_many({"date": today})
        c.close()


@pytest.mark.asyncio
async def test_tick_skips_outside_hour():
    sys.path.insert(0, "/app/backend")
    import server  # noqa: F401
    import routes.mess_menu_push as mmp  # type: ignore

    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    server.db = db
    today = _today_ist()
    await db.mess_menu_broadcasts.delete_many({"date": today})
    await db.mess_menu.update_one(
        {"date": today},
        {"$set": {"date": today, "lunch": "Skip Lunch", "dinner": "", "note": ""}},
        upsert=True,
    )
    await db.app_config.update_one(
        {"key": mmp.PUSH_CONFIG_KEY},
        {"$set": {"key": mmp.PUSH_CONFIG_KEY, "enabled": True, "hour_ist": 11,
                  "title_template": "Today's {meal}", "body_template": "{menu}",
                  "cta_label": "Order now", "cta_route": "/dashboard"}},
        upsert=True,
    )
    try:
        real_dt = mmp.datetime

        class _DT(real_dt):
            @classmethod
            def now(cls, tz=None):  # type: ignore[override]
                base = real_dt.now(tz)
                return base.replace(hour=9, minute=30, second=0, microsecond=0)

        with patch.object(mmp, "datetime", _DT):
            await mmp.tick_daily_menu_push()
            cnt = await db.mess_menu_broadcasts.count_documents({"date": today})
            assert cnt == 0, "tick fired outside configured hour"
    finally:
        await db.mess_menu_broadcasts.delete_many({"date": today})
        await db.mess_menu.delete_many({"date": today})
        c.close()
