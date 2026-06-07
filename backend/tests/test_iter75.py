"""Iter-75 — About CMS + Privacy/Refund CMS + Multi-mess / franchise MVP.

Coverage:
- GET /api/content/{about,privacy,refund} contract.
- POST /api/admin/content/about merge + persistence.
- GET/POST/PUT/PATCH /api/admin/messes + /api/messes/* + /api/franchise/apply.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "test_database")
DEFAULT_MESS_ID = "efoodcare-amravati"


async def _mk(db, role="subscriber"):
    uid = f"u_iter75_{uuid.uuid4().hex[:6]}"
    tok = "sess_iter75_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid, "phone": f"7{uuid.uuid4().hex[:9]}",
        "name": f"iter75 {role}",
        "email": f"iter75_{uuid.uuid4().hex[:4]}@x.com", "role": role,
        "qr_token": f"qr_{uuid.uuid4().hex}", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _cleanup(db, *tokens_uids):
    for tok, uid in tokens_uids:
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})


# ============================ About CMS =====================================


@pytest.mark.asyncio
async def test_content_about_full_schema():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
        r = await c.get("/api/content/about")
        assert r.status_code == 200, r.text
        d = r.json()
        # Required text fields
        for k in [
            "hero_headline", "hero_lede",
            "promise_1_title", "promise_1_body",
            "promise_2_title", "promise_2_body",
            "promise_3_title", "promise_3_body",
            "promise_4_title", "promise_4_body",
            "tl_1_year", "tl_1_title", "tl_1_body",
            "tl_2_year", "tl_2_title", "tl_2_body",
            "tl_3_year", "tl_3_title", "tl_3_body",
            "tl_4_year", "tl_4_title", "tl_4_body",
            "founder_quote", "founder_body", "founder_name", "founder_role",
            "visit_address", "visit_phone", "visit_email",
            # Per-section color fields
            "hero_bg_from", "promise_bg", "timeline_bg", "founder_bg", "visit_bg_from",
        ]:
            assert k in d, f"missing key '{k}' in /api/content/about"


@pytest.mark.asyncio
async def test_content_about_admin_merge_persists():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin")
    # Capture original hero_headline so we restore after merge
    original = None
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r0 = await c.get("/api/content/about")
            original = r0.json().get("hero_headline")
            test_val = f"iter75 merge test {uuid.uuid4().hex[:6]}"
            r = await c.post(
                "/api/admin/content/about",
                headers={"Authorization": f"Bearer {tok}"},
                json={"data": {"hero_headline": test_val}},
            )
            assert r.status_code == 200, r.text
            # Subsequent GET returns the merged value but keeps other defaults
            r2 = await c.get("/api/content/about")
            assert r2.status_code == 200
            d2 = r2.json()
            assert d2.get("hero_headline") == test_val
            # Defaults still present
            assert d2.get("founder_quote"), "founder_quote default must be retained after merge"
            assert d2.get("promise_1_title"), "promise_1_title default must be retained"
            # Restore original
            if original:
                await c.post("/api/admin/content/about",
                             headers={"Authorization": f"Bearer {tok}"},
                             json={"data": {"hero_headline": original}})
    finally:
        await _cleanup(db, (tok, uid))
        db_cli.close()


# ============================ Privacy + Refund ==============================


@pytest.mark.asyncio
async def test_content_privacy_structure():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
        r = await c.get("/api/content/privacy")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("title", "effective_date", "intro", "sections", "contact_block"):
            assert k in d, f"privacy missing key '{k}'"
        assert isinstance(d["sections"], list)
        assert len(d["sections"]) >= 9, f"expected >=9 sections, got {len(d['sections'])}"
        for s in d["sections"]:
            assert "heading" in s and "body" in s


@pytest.mark.asyncio
async def test_content_refund_structure():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
        r = await c.get("/api/content/refund")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("title", "effective_date", "intro", "sections", "contact_block"):
            assert k in d, f"refund missing key '{k}'"
        assert len(d["sections"]) >= 9


# ============================ Multi-mess MVP ================================


@pytest.mark.asyncio
async def test_messes_public_list_has_default():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
        r = await c.get("/api/messes")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("default_mess_id") == DEFAULT_MESS_ID
        items = d.get("messes") or []
        assert len(items) >= 1
        default_item = next((m for m in items if m.get("mess_id") == DEFAULT_MESS_ID), None)
        assert default_item is not None, "default mess must appear in public list"
        for k in ("mess_id", "slug", "name", "address", "city", "state", "is_franchise", "is_corporate", "status"):
            assert k in default_item
        assert default_item["status"] == "active"


@pytest.mark.asyncio
async def test_mess_detail_by_slug():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
        r = await c.get(f"/api/messes/{DEFAULT_MESS_ID}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("mess_id") == DEFAULT_MESS_ID
        assert d.get("is_corporate") is True
        # 404 for unknown
        r2 = await c.get("/api/messes/does-not-exist-xyz")
        assert r2.status_code == 404


@pytest.mark.asyncio
async def test_admin_messes_list_requires_admin():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok_sub, uid_sub = await _mk(db, "subscriber")
    tok_adm, uid_adm = await _mk(db, "admin")
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r_sub = await c.get("/api/admin/messes",
                                headers={"Authorization": f"Bearer {tok_sub}"})
            assert r_sub.status_code == 403, r_sub.text
            r_adm = await c.get("/api/admin/messes",
                                headers={"Authorization": f"Bearer {tok_adm}"})
            assert r_adm.status_code == 200, r_adm.text
            d = r_adm.json()
            assert isinstance(d.get("messes"), list)
    finally:
        await _cleanup(db, (tok_sub, uid_sub), (tok_adm, uid_adm))
        db_cli.close()


@pytest.mark.asyncio
async def test_admin_mess_crud_and_dup_slug():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "admin")
    slug = f"iter75-test-mess-{uuid.uuid4().hex[:6]}"
    created_id = None
    try:
        payload = {
            "slug": slug,
            "name": "efoodcare · iter75 Nagpur",
            "city": "Nagpur",
            "address": "Some test address line",
            "state": "Maharashtra",
            "pincode": "440001",
            "is_franchise": False,
        }
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            # CREATE
            r = await c.post("/api/admin/messes",
                             headers={"Authorization": f"Bearer {tok}"},
                             json=payload)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["mess_id"].startswith("mess_")
            assert d["status"] == "active"
            assert d["is_corporate"] is True
            assert d["is_franchise"] is False
            created_id = d["mess_id"]

            # Verify persistence via GET /api/messes/{slug}
            r_g = await c.get(f"/api/messes/{slug}")
            assert r_g.status_code == 200, r_g.text
            assert r_g.json().get("mess_id") == created_id

            # Duplicate slug
            r_dup = await c.post("/api/admin/messes",
                                 headers={"Authorization": f"Bearer {tok}"},
                                 json=payload)
            assert r_dup.status_code == 400, r_dup.text
            assert "slug" in r_dup.text.lower()

            # PUT update name + capacity
            updated = {**payload, "name": "efoodcare · iter75 Nagpur Updated", "capacity_lunch": 250}
            r_u = await c.put(f"/api/admin/messes/{created_id}",
                              headers={"Authorization": f"Bearer {tok}"},
                              json=updated)
            assert r_u.status_code == 200, r_u.text
            assert r_u.json().get("name") == "efoodcare · iter75 Nagpur Updated"
            assert r_u.json().get("capacity_lunch") == 250

            # PATCH status -> inactive on non-default mess works
            r_s = await c.patch(f"/api/admin/messes/{created_id}/status",
                                headers={"Authorization": f"Bearer {tok}"},
                                json={"status": "inactive"})
            assert r_s.status_code == 200, r_s.text
            assert r_s.json().get("status") == "inactive"

            # PATCH status -> inactive on default mess must fail
            r_def = await c.patch(f"/api/admin/messes/{DEFAULT_MESS_ID}/status",
                                  headers={"Authorization": f"Bearer {tok}"},
                                  json={"status": "inactive"})
            assert r_def.status_code == 400, r_def.text
            assert "corporate" in r_def.text.lower() or "cannot" in r_def.text.lower()
    finally:
        if created_id:
            await db_cli[DB_NAME].messes.delete_one({"mess_id": created_id})
        await _cleanup(db, (tok, uid))
        db_cli.close()


@pytest.mark.asyncio
async def test_franchise_apply_public_creates_pending_review():
    db_cli = AsyncIOMotorClient(MONGO_URL); db = db_cli[DB_NAME]
    name = f"efoodcare partner · Pune iter75 {uuid.uuid4().hex[:4]}"
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            # PUBLIC (no auth)
            r = await c.post("/api/franchise/apply", json={
                "name": name,
                "address": "Some Pune address line",
                "city": "Pune",
                "state": "Maharashtra",
                "pincode": "411001",
                "applicant_name": "Test Applicant",
                "applicant_phone": "9999999999",
            })
            assert r.status_code == 200, r.text
            d = r.json()
            assert d.get("ok") is True
            mess = d.get("mess") or {}
            assert mess.get("is_franchise") is True
            assert mess.get("is_corporate") is False
            assert mess.get("status") == "pending_review"
            mess_id = mess.get("mess_id")
            assert mess_id and mess_id.startswith("mess_")

            # Public list filters status=active so franchise must NOT appear
            r2 = await c.get("/api/messes")
            assert r2.status_code == 200
            ids = {m.get("mess_id") for m in r2.json().get("messes", [])}
            assert mess_id not in ids, "pending_review franchise must NOT appear in public list"
    finally:
        await db_cli[DB_NAME].messes.delete_many({"name": name})
        db_cli.close()
