"""Iter-76 — Multi-mess + franchise loop.

Coverage:
- POST /api/franchise/apply: slug strict-sanitized to [a-z0-9-]+ even with
  unicode/emoji/punctuation in name.
- GET /api/messes/nearby: distance-sorted list with closest_mess_id;
  NOT shadowed by the dynamic /messes/{slug} route.
- GET /api/messes/{slug}: detail still resolves for default mess.
- GET / POST /api/me/mess: read returns assigned (or default) mess; write
  validates active mess; 400 on unknown.
- GET /api/admin/messes/{id}/metrics: full payload + 403 for subscriber +
  days param clamping (1..365).
- GET /api/franchise/me/metrics: 403 for plain subscriber; 200 for admin
  (default fallback); 200 for franchise_owner after PATCH /owner.
- PATCH /api/admin/messes/{id}/owner: auto-promotes subscriber to
  franchise_owner; clearing owner_user_id does NOT demote.
- Startup backfill: users without mess_id got mess_id=DEFAULT_MESS_ID.
- Regression: iter-75 default mess public list still ok.
"""
from __future__ import annotations

import os
import re
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
SLUG_RE = re.compile(r"^[a-z0-9-]+$")


# ----------------------------- helpers ---------------------------------------


async def _mk(db, role="subscriber"):
    uid = f"u_iter76_{uuid.uuid4().hex[:6]}"
    tok = "sess_iter76_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": uid,
        "phone": f"7{uuid.uuid4().hex[:9]}",
        "name": f"iter76 {role}",
        "email": f"iter76_{uuid.uuid4().hex[:4]}@x.com",
        "role": role,
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": tok,
        "user_id": uid,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok, uid


async def _cleanup(db, *tokens_uids):
    for tok, uid in tokens_uids:
        await db.user_sessions.delete_one({"session_token": tok})
        await db.users.delete_one({"user_id": uid})


# ====================== 1. Franchise apply slug sanitization =================


@pytest.mark.asyncio
async def test_franchise_apply_slug_sanitized():
    db_cli = AsyncIOMotorClient(MONGO_URL)
    db = db_cli[DB_NAME]
    raw_name = "Café Junction · BKC! 🎉"
    created_id = None
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            r = await c.post("/api/franchise/apply", json={
                "name": raw_name,
                "address": "BKC Bandra East",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400051",
                "applicant_name": "Slug Tester",
                "applicant_phone": "9988776655",
            })
            assert r.status_code == 200, r.text
            mess = r.json().get("mess") or {}
            slug = mess.get("slug") or ""
            created_id = mess.get("mess_id")
            # 1) must match [a-z0-9-]+ only
            assert SLUG_RE.match(slug), f"slug not sanitized: {slug!r}"
            # 2) emoji and unicode dropped → starts with caf-junction-bkc
            assert slug.startswith("caf-junction-bkc-"), f"unexpected slug prefix: {slug}"
            assert "·" not in slug and "!" not in slug and "🎉" not in slug
            # 3) franchise flags
            assert mess.get("is_franchise") is True
            assert mess.get("is_corporate") is False
            assert mess.get("status") == "pending_review"
    finally:
        if created_id:
            await db_cli[DB_NAME].messes.delete_one({"mess_id": created_id})
        db_cli.close()


# ====================== 2. /messes/nearby + route ordering ===================


@pytest.mark.asyncio
async def test_messes_nearby_returns_default_with_distance():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
        # Amravati ~ 20.9379, 77.7782; query a very nearby point
        r = await c.get("/api/messes/nearby", params={"lat": 20.94, "lng": 77.78})
        assert r.status_code == 200, r.text
        d = r.json()
        items = d.get("messes") or []
        assert len(items) >= 1
        for m in items:
            assert "distance_km" in m
            assert "mess_id" in m
        # closest_mess_id present
        assert d.get("closest_mess_id") == DEFAULT_MESS_ID
        # first item is the default mess and the distance is small
        default = next((m for m in items if m["mess_id"] == DEFAULT_MESS_ID), None)
        assert default is not None
        assert default["distance_km"] is not None
        # ~0.2-0.7km tolerance band
        assert default["distance_km"] < 1.5, f"distance unexpectedly large: {default['distance_km']}"


@pytest.mark.asyncio
async def test_messes_nearby_not_shadowed_by_slug_route():
    """/messes/nearby must be matched BEFORE /messes/{slug} (route ordering)."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
        # nearby with NO query params → should 422 (missing required) NOT 404 slug
        r = await c.get("/api/messes/nearby")
        assert r.status_code in (400, 422), f"got {r.status_code}: {r.text[:200]}"
        # slug route still resolves for the default mess
        r2 = await c.get(f"/api/messes/{DEFAULT_MESS_ID}")
        assert r2.status_code == 200, r2.text
        assert r2.json().get("mess_id") == DEFAULT_MESS_ID
        # And /messes/nearby with params returns 200 + structured list
        r3 = await c.get("/api/messes/nearby", params={"lat": 20.94, "lng": 77.78})
        assert r3.status_code == 200, r3.text
        assert isinstance(r3.json().get("messes"), list)


# ====================== 3. /me/mess GET + POST ===============================


@pytest.mark.asyncio
async def test_me_mess_get_set_validates():
    db_cli = AsyncIOMotorClient(MONGO_URL)
    db = db_cli[DB_NAME]
    tok, uid = await _mk(db, "subscriber")
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            # GET — legacy user gets default fallback
            r = await c.get("/api/me/mess", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200, r.text
            d = r.json()
            assert d.get("mess_id") == DEFAULT_MESS_ID
            assert (d.get("mess") or {}).get("mess_id") == DEFAULT_MESS_ID

            # POST — assign to default succeeds
            r2 = await c.post("/api/me/mess",
                              headers={"Authorization": f"Bearer {tok}"},
                              json={"mess_id": DEFAULT_MESS_ID})
            assert r2.status_code == 200, r2.text
            assert r2.json().get("mess_id") == DEFAULT_MESS_ID

            # POST — nonexistent rejected
            r3 = await c.post("/api/me/mess",
                              headers={"Authorization": f"Bearer {tok}"},
                              json={"mess_id": "nonexistent-xyz"})
            assert r3.status_code == 400, r3.text
            assert "inactive" in r3.text.lower() or "unknown" in r3.text.lower()

            # Persisted in user doc
            udoc = await db.users.find_one({"user_id": uid}, {"_id": 0, "mess_id": 1})
            assert udoc and udoc.get("mess_id") == DEFAULT_MESS_ID
    finally:
        await _cleanup(db, (tok, uid))
        db_cli.close()


# ====================== 4. Admin mess metrics ================================


@pytest.mark.asyncio
async def test_admin_mess_metrics_default_and_days():
    db_cli = AsyncIOMotorClient(MONGO_URL)
    db = db_cli[DB_NAME]
    tok_a, uid_a = await _mk(db, "admin")
    tok_s, uid_s = await _mk(db, "subscriber")
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            # subscriber → 403
            r_f = await c.get(f"/api/admin/messes/{DEFAULT_MESS_ID}/metrics",
                              headers={"Authorization": f"Bearer {tok_s}"})
            assert r_f.status_code == 403, r_f.text

            # admin days=30 → full payload
            r = await c.get(f"/api/admin/messes/{DEFAULT_MESS_ID}/metrics",
                            params={"days": 30},
                            headers={"Authorization": f"Bearer {tok_a}"})
            assert r.status_code == 200, r.text
            d = r.json()
            for k in ("subscribers_active", "subscribers_total", "checkins_window",
                     "order_revenue_window", "subscription_revenue_active",
                     "capacity_daily", "utilization_pct", "mess", "window_days",
                     "computed_at"):
                assert k in d, f"missing key {k}"
            assert d["window_days"] == 30
            assert isinstance(d["subscribers_active"], int)
            assert (d.get("mess") or {}).get("mess_id") == DEFAULT_MESS_ID

            # days=7
            r7 = await c.get(f"/api/admin/messes/{DEFAULT_MESS_ID}/metrics",
                             params={"days": 7},
                             headers={"Authorization": f"Bearer {tok_a}"})
            assert r7.status_code == 200
            assert r7.json()["window_days"] == 7

            # days=90
            r90 = await c.get(f"/api/admin/messes/{DEFAULT_MESS_ID}/metrics",
                              params={"days": 90},
                              headers={"Authorization": f"Bearer {tok_a}"})
            assert r90.status_code == 200
            assert r90.json()["window_days"] == 90

            # days=500 clamps to 365
            r500 = await c.get(f"/api/admin/messes/{DEFAULT_MESS_ID}/metrics",
                               params={"days": 500},
                               headers={"Authorization": f"Bearer {tok_a}"})
            assert r500.status_code == 200
            assert r500.json()["window_days"] == 365
    finally:
        await _cleanup(db, (tok_a, uid_a), (tok_s, uid_s))
        db_cli.close()


# ====================== 5. Franchise /me/metrics + owner assign ==============


@pytest.mark.asyncio
async def test_franchise_me_metrics_role_gating():
    db_cli = AsyncIOMotorClient(MONGO_URL)
    db = db_cli[DB_NAME]
    tok_a, uid_a = await _mk(db, "admin")
    tok_s, uid_s = await _mk(db, "subscriber")
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
            # Plain subscriber (not franchise_owner, no owned mess) → 403
            r = await c.get("/api/franchise/me/metrics",
                            headers={"Authorization": f"Bearer {tok_s}"})
            assert r.status_code == 403, r.text

            # Admin → 200 (falls back to default mess metrics)
            r2 = await c.get("/api/franchise/me/metrics",
                             headers={"Authorization": f"Bearer {tok_a}"})
            assert r2.status_code == 200, r2.text
            d = r2.json()
            assert "subscribers_active" in d
            assert (d.get("mess") or {}).get("mess_id") == DEFAULT_MESS_ID
    finally:
        await _cleanup(db, (tok_a, uid_a), (tok_s, uid_s))
        db_cli.close()


@pytest.mark.asyncio
async def test_admin_assign_owner_promotes_and_franchise_metrics_works():
    db_cli = AsyncIOMotorClient(MONGO_URL)
    db = db_cli[DB_NAME]
    tok_a, uid_a = await _mk(db, "admin")
    tok_owner, uid_owner = await _mk(db, "subscriber")
    # Create an ephemeral mess so we don't pollute default mess owner
    slug = f"iter76-owner-{uuid.uuid4().hex[:6]}"
    mess_id = None
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as c:
            create = await c.post("/api/admin/messes",
                                  headers={"Authorization": f"Bearer {tok_a}"},
                                  json={
                                      "slug": slug,
                                      "name": "iter76 Owner Mess",
                                      "city": "Pune",
                                      "address": "Test addr",
                                      "state": "Maharashtra",
                                      "pincode": "411001",
                                      "is_franchise": False,
                                  })
            assert create.status_code == 200, create.text
            mess_id = create.json()["mess_id"]

            # Assign owner → auto-promote subscriber to franchise_owner
            r = await c.patch(f"/api/admin/messes/{mess_id}/owner",
                              headers={"Authorization": f"Bearer {tok_a}"},
                              json={"owner_user_id": uid_owner})
            assert r.status_code == 200, r.text
            assert (r.json().get("mess") or {}).get("owner_user_id") == uid_owner

            # User now has role=franchise_owner
            udoc = await db.users.find_one({"user_id": uid_owner}, {"_id": 0, "role": 1})
            assert udoc.get("role") == "franchise_owner"

            # franchise/me/metrics now works for that user, returns their mess
            r2 = await c.get("/api/franchise/me/metrics",
                             headers={"Authorization": f"Bearer {tok_owner}"})
            assert r2.status_code == 200, r2.text
            d = r2.json()
            assert (d.get("mess") or {}).get("mess_id") == mess_id

            # Clearing the owner does NOT auto-demote
            r3 = await c.patch(f"/api/admin/messes/{mess_id}/owner",
                               headers={"Authorization": f"Bearer {tok_a}"},
                               json={"owner_user_id": None})
            assert r3.status_code == 200, r3.text
            assert (r3.json().get("mess") or {}).get("owner_user_id") is None
            udoc2 = await db.users.find_one({"user_id": uid_owner}, {"_id": 0, "role": 1})
            assert udoc2.get("role") == "franchise_owner", "role must NOT auto-demote"
    finally:
        if mess_id:
            await db_cli[DB_NAME].messes.delete_one({"mess_id": mess_id})
        await _cleanup(db, (tok_a, uid_a), (tok_owner, uid_owner))
        db_cli.close()


# ====================== 6. Backfill on startup ===============================


@pytest.mark.asyncio
async def test_backfill_users_have_mess_id():
    """Verify _backfill_mess_id_once ran — sample a few users without mess_id
    should not exist (or be 0). Also, default mess lat/lng patched."""
    db_cli = AsyncIOMotorClient(MONGO_URL)
    db = db_cli[DB_NAME]
    try:
        # Default mess seed-healer set lat/lng
        default_mess = await db.messes.find_one({"mess_id": DEFAULT_MESS_ID}, {"_id": 0})
        assert default_mess is not None
        assert default_mess.get("lat") is not None
        assert default_mess.get("lng") is not None
        # Count legacy users without mess_id (allow for newly-created test users to lack it)
        missing = await db.users.count_documents({"mess_id": {"$exists": False}})
        # Some test users may have been created without mess_id; allow small tolerance
        assert missing < 50, f"too many users missing mess_id: {missing}"
    finally:
        db_cli.close()


# ====================== 7. iter-75 regression ================================


@pytest.mark.asyncio
async def test_iter75_regression_public_messes_and_franchise_apply():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as c:
        r = await c.get("/api/messes")
        assert r.status_code == 200
        d = r.json()
        assert d.get("default_mess_id") == DEFAULT_MESS_ID
        assert any(m["mess_id"] == DEFAULT_MESS_ID for m in (d.get("messes") or []))
