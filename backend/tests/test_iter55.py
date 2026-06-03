"""Iter-55 backend tests: data-URL image persistence, cash totals, kitchen
settings, mix payment.
"""
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
        "lat": lat, "lng": lng, "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    tok = "sess_" + uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    c.close()
    return tok, uid


# --- 1×1 transparent WebP / PNG bytes for upload tests
_PNG_1x1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
    b"\x89\x00\x00\x00\rIDATx\x9cc\xfa\xcf\x00\x00\x00\x02\x00\x01\xe5\x27\xde\xfc\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.mark.asyncio
async def test_menu_image_upload_returns_data_url():
    tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
        files = {"file": ("a.png", _PNG_1x1, "image/png")}
        r = await cli.post(
            "/api/admin/restaurant/menu/upload-image",
            files=files, headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        url = r.json()["url"]
        assert url.startswith("data:image/"), f"expected data-URL, got {url[:80]}"


@pytest.mark.asyncio
async def test_kitchen_settings_admin_update_and_public_read():
    admin_tok, _ = await _make_session("admin")
    sub_tok, _ = await _make_session("subscriber")
    H_admin = {"Authorization": f"Bearer {admin_tok}"}
    H_sub = {"Authorization": f"Bearer {sub_tok}"}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        # Sub cannot edit
        r = await cli.put("/api/admin/kitchen-settings", headers=H_sub,
                          json={"dispatch_lat": 19, "dispatch_lng": 73, "dispatch_radius_km": 10})
        assert r.status_code == 403
        # Admin updates
        r = await cli.put("/api/admin/kitchen-settings", headers=H_admin,
                          json={"dispatch_lat": 18.5204, "dispatch_lng": 73.8567,
                                "dispatch_radius_km": 12, "address_label": "Kothrud, Pune"})
        assert r.status_code == 200
        # Public read
        r = await cli.get("/api/kitchen-location")
        assert r.status_code == 200
        body = r.json()
        assert body["dispatch_radius_km"] == 12
        assert body["address_label"] == "Kothrud, Pune"


@pytest.mark.asyncio
async def test_cash_totals_and_pending_deposit():
    admin_tok, _ = await _make_session("admin")
    H = {"Authorization": f"Bearer {admin_tok}"}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/admin/payments/cash-totals", headers=H)
        assert r.status_code == 200
        for k in ("today", "month", "year", "pending_bank_deposit"):
            assert k in r.json()
        # List pending (likely empty in fresh test db is OK)
        r = await cli.get("/api/admin/payments/cash-pending-deposit", headers=H)
        assert r.status_code == 200
        assert "rows" in r.json()


@pytest.mark.asyncio
async def test_mark_deposited_role_gate():
    staff_tok, _ = await _make_session("staff")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        r = await cli.post("/api/admin/payments/mark-deposited",
                           json={"order_ids": ["x"], "bank_ref": None},
                           headers={"Authorization": f"Bearer {staff_tok}"})
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_mix_payment_creates_two_orders():
    tok, uid = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
        plan = (await cli.get("/api/plans")).json()["plans"][0]
        H = {"Authorization": f"Bearer {tok}"}
        amt = float(plan["amount"])
        body = {"plan_id": plan["plan_id"], "online_amount": round(amt / 2, 2), "cash_amount": round(amt - (amt / 2), 2)}
        r = await cli.post("/api/payments/mix-order", json=body, headers=H)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["mix_cash_amount"] > 0
        assert out["mix_cash_order_id"]
        # Should now have a pending_cash_otp entry
        r = await cli.get("/api/my/pending-cash-otp", headers=H)
        assert r.status_code == 200
        assert r.json()["count"] >= 1
        # And verifying the online half should activate sub with pending_amount including surcharge
        rv = await cli.post("/api/payments/verify", headers=H,
                            json={"order_id": out["order_id"], "razorpay_payment_id": "m", "razorpay_signature": "s"})
        assert rv.status_code == 200
        bal = (await cli.get("/api/my/partial-balance", headers=H)).json()
        assert len(bal["items"]) == 1


@pytest.mark.asyncio
async def test_mix_payment_rejects_mismatch_sum():
    tok, _ = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        plan = (await cli.get("/api/plans")).json()["plans"][0]
        H = {"Authorization": f"Bearer {tok}"}
        r = await cli.post("/api/payments/mix-order", headers=H,
                           json={"plan_id": plan["plan_id"], "online_amount": 100, "cash_amount": 100})
        assert r.status_code == 400
        assert "sum" in r.json()["detail"].lower()
