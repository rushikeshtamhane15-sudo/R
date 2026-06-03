"""Iter-55 extra checks: data-URL response on tiffin-prefs + landing uploads;
cash-totals response shape; mark-deposited admin path; LocationPill public
kitchen-location read.
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
    c = AsyncIOMotorClient(MONGO_URL); db = c[DB_NAME]
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}", "name": "T",
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


_PNG_1x1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
    b"\x89\x00\x00\x00\rIDATx\x9cc\xfa\xcf\x00\x00\x00\x02\x00\x01\xe5\x27\xde\xfc\x00\x00\x00\x00IEND\xaeB`\x82"
)


# --- upload endpoints all return data-URL --------------------------------
@pytest.mark.asyncio
async def test_tiffin_pref_upload_returns_data_url():
    tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
        files = {"file": ("a.png", _PNG_1x1, "image/png")}
        r = await cli.post("/api/admin/tiffin-preferences/upload-image",
                           files=files, headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        assert r.json()["url"].startswith("data:image/")


@pytest.mark.asyncio
async def test_landing_upload_returns_data_url():
    tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
        files = {"file": ("a.png", _PNG_1x1, "image/png")}
        r = await cli.post("/api/admin/landing/upload-image",
                           files=files, headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        assert r.json()["url"].startswith("data:image/")


# --- public kitchen-location is unauth ------------------------------------
@pytest.mark.asyncio
async def test_kitchen_location_public_no_auth():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        r = await cli.get("/api/kitchen-location")
        assert r.status_code == 200
        body = r.json()
        for k in ("dispatch_lat", "dispatch_lng", "dispatch_radius_km"):
            assert k in body


# --- cash totals are numeric ---------------------------------------------
@pytest.mark.asyncio
async def test_cash_totals_numeric_fields():
    tok, _ = await _make_session("admin")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as cli:
        r = await cli.get("/api/admin/payments/cash-totals",
                          headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        body = r.json()
        for k in ("today", "month", "year", "pending_bank_deposit"):
            assert isinstance(body[k], (int, float)), f"{k} is not numeric"


# --- admin kitchen-settings GET 200 --------------------------------------
@pytest.mark.asyncio
async def test_admin_kitchen_settings_get_role_gate():
    admin_tok, _ = await _make_session("admin")
    sub_tok, _ = await _make_session("subscriber")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as cli:
        r = await cli.get("/api/admin/kitchen-settings",
                          headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200
        # Unauth (sub) cannot read admin settings either
        r2 = await cli.get("/api/admin/kitchen-settings",
                           headers={"Authorization": f"Bearer {sub_tok}"})
        assert r2.status_code in (401, 403)
