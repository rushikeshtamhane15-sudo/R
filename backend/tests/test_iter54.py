"""Iter-54 pytest: surcharge, multi-sub guard, cash dedup, delete, geo, profile validation."""
from __future__ import annotations
import os, uuid, pytest, httpx
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "test_database")


async def _make_session(role="subscriber", lat=18.5204, lng=73.8567):
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    phone = f"7{uuid.uuid4().hex[:9]}"
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": uid, "phone": phone, "name": "Test User",
        "role": role, "address": "Test addr Pune 411001",
        "photo_url": "data:image/png;base64,iV",
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "lat": lat, "lng": lng,
        "wallet_balance": 0.0, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    tok = "sess_" + uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    c.close()
    return tok, uid


@pytest.mark.asyncio
async def test_partial_surcharge_200():
    sub_tok, _ = await _make_session()
    admin_tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        plan = (await cli.get("/api/plans")).json()["plans"][0]
        down = round(float(plan["amount"]) * 0.5, 2)
        r = await cli.post("/api/payments/partial-order",
                           json={"plan_id": plan["plan_id"], "down_payment": down},
                           headers={"Authorization": f"Bearer {sub_tok}"})
        assert r.status_code == 200
        body = r.json()
        assert body["partial_surcharge"] == 200.0
        assert abs(body["partial_pending_with_surcharge"] - ((plan["amount"] - down) + 200)) < 0.01
        # Verify → sub gets pending_amount = (plan - down) + 200
        await cli.post("/api/payments/verify", headers={"Authorization": f"Bearer {sub_tok}"},
                       json={"order_id": body["order_id"], "razorpay_payment_id": "m", "razorpay_signature": "s"})
        bal = (await cli.get("/api/my/partial-balance", headers={"Authorization": f"Bearer {sub_tok}"})).json()
        assert abs(bal["items"][0]["pending_amount"] - ((plan["amount"] - down) + 200)) < 1


@pytest.mark.asyncio
async def test_multi_sub_block_same_plan():
    sub_tok, _ = await _make_session()
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        plans = (await cli.get("/api/plans")).json()["plans"]
        plan = plans[0]
        H = {"Authorization": f"Bearer {sub_tok}"}
        # 1st cash order — OK
        r = await cli.post("/api/payments/cash-order", json={"plan_id": plan["plan_id"]}, headers=H)
        assert r.status_code == 200, r.text
        # 2nd cash for SAME plan — must fail
        r2 = await cli.post("/api/payments/cash-order", json={"plan_id": plan["plan_id"]}, headers=H)
        assert r2.status_code == 400
        # DIFFERENT plan — should be OK (if there's another)
        if len(plans) > 1:
            r3 = await cli.post("/api/payments/cash-order", json={"plan_id": plans[1]["plan_id"]}, headers=H)
            assert r3.status_code == 200


@pytest.mark.asyncio
async def test_admin_delete_cash_entry():
    sub_tok, _ = await _make_session()
    admin_tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        plan = (await cli.get("/api/plans")).json()["plans"][0]
        r = await cli.post("/api/payments/cash-order", json={"plan_id": plan["plan_id"]},
                           headers={"Authorization": f"Bearer {sub_tok}"})
        oid = r.json()["order_id"]
        # Delete as admin
        r = await cli.delete(f"/api/admin/payments/cash-collect/{oid}",
                             headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200
        # Now user can subscribe to same plan again
        r2 = await cli.post("/api/payments/cash-order", json={"plan_id": plan["plan_id"]},
                            headers={"Authorization": f"Bearer {sub_tok}"})
        assert r2.status_code == 200


@pytest.mark.asyncio
async def test_my_pending_cash_otp():
    sub_tok, _ = await _make_session()
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        plan = (await cli.get("/api/plans")).json()["plans"][0]
        H = {"Authorization": f"Bearer {sub_tok}"}
        r = await cli.post("/api/payments/cash-order", json={"plan_id": plan["plan_id"]}, headers=H)
        assert r.status_code == 200
        otp = r.json()["dev_otp"]
        r = await cli.get("/api/my/pending-cash-otp", headers=H)
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 1
        assert body["items"][0]["cash_otp"] == otp


@pytest.mark.asyncio
async def test_geo_block_out_of_area():
    # User in Mumbai (~150 km from Pune) → should be blocked
    sub_tok, _ = await _make_session(lat=19.0760, lng=72.8777)
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        plan = (await cli.get("/api/plans")).json()["plans"][0]
        r = await cli.post("/api/payments/cash-order", json={"plan_id": plan["plan_id"]},
                           headers={"Authorization": f"Bearer {sub_tok}"})
        assert r.status_code == 400
        assert "service" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_profile_validation_strict():
    tok, _ = await _make_session()
    H = {"Authorization": f"Bearer {tok}"}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        # Bad name (has digits)
        r = await cli.post("/api/auth/profile", json={
            "name": "Test123", "phone": "9876543210", "address": "Some valid address 411001",
        }, headers=H)
        assert r.status_code == 400
        # Bad phone (8 digits)
        r = await cli.post("/api/auth/profile", json={
            "name": "Valid Name", "phone": "12345678", "address": "Some valid address 411001",
        }, headers=H)
        assert r.status_code == 400
        # Short address
        r = await cli.post("/api/auth/profile", json={
            "name": "Valid Name", "phone": "9876543210", "address": "Short",
        }, headers=H)
        assert r.status_code == 400
        # Good payload — should pass
        r = await cli.post("/api/auth/profile", json={
            "name": "Valid Name", "phone": "+91 9876543210", "address": "Flat 12, Kothrud, Pune 411038",
        }, headers=H)
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["phone"] == "9876543210"


@pytest.mark.asyncio
async def test_cash_for_partial_clear():
    sub_tok, _ = await _make_session()
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        plan = (await cli.get("/api/plans")).json()["plans"][0]
        H = {"Authorization": f"Bearer {sub_tok}"}
        # Make a partial order
        down = round(float(plan["amount"]) * 0.5, 2)
        r = await cli.post("/api/payments/partial-order",
                           json={"plan_id": plan["plan_id"], "down_payment": down}, headers=H)
        await cli.post("/api/payments/verify", headers=H,
                       json={"order_id": r.json()["order_id"], "razorpay_payment_id": "m", "razorpay_signature": "s"})
        bal = (await cli.get("/api/my/partial-balance", headers=H)).json()
        sub_id = bal["items"][0]["sub_id"]
        # Cash clear
        r = await cli.post("/api/payments/clear-partial-balance-cash",
                           json={"sub_id": sub_id, "amount": 200}, headers=H)
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "pending_cash"
        assert body["dev_otp"]
        # 2nd cash clear for same sub blocked
        r2 = await cli.post("/api/payments/clear-partial-balance-cash",
                            json={"sub_id": sub_id, "amount": 100}, headers=H)
        assert r2.status_code == 400


@pytest.mark.asyncio
async def test_tiffin_pref_heading_cms():
    admin_tok, _ = await _make_session("admin")
    H = {"Authorization": f"Bearer {admin_tok}"}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/admin/tiffin-preferences/catalog", headers=H)
        assert r.status_code == 200
        body = r.json()
        assert "page_title" in body and "page_subtitle" in body
        # Update
        r = await cli.put("/api/admin/tiffin-preferences/catalog", json={
            "items": body["items"],
            "page_title": "What's on your plate today?",
            "page_subtitle": "Pick your favorites.",
        }, headers=H)
        assert r.status_code == 200
        r2 = await cli.get("/api/tiffin-preferences/catalog")
        body2 = r2.json()
        assert body2["page_title"] == "What's on your plate today?"
