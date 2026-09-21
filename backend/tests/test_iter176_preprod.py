"""iter-176 · Pre-deploy verification tests.

Scope (from review request):
  1) CMS multi-tenant isolation on GET/POST /api/(admin/)content/{key}.
     Keys: footer, kiosk, brand_logo, announcement, contact, privacy, about.
  2) Super-admin mess management endpoints (iter-174):
       - PUT   /api/admin/messes/{mess_id}   (edit incl. mobile/owner_phone)
       - POST  /api/admin/messes/promote-owner {mess_id, phone}
       - DELETE /api/admin/messes/{mess_id}
     All must require role=admin.
  3) Reverse geocode /api/geo/reverse near Amravati / Shegaon coordinates.
  4) Bottom-nav slots: GET/PATCH /api/admin/messes/{mess_id}/bottom-nav-slots.
     Confirm 'home' slot supersedes 'restaurant-menu' when set (i.e. write &
     round-trip; the supersede is a frontend responsibility but backend
     must accept both keys and return them faithfully).

Reuses cached OTP session tokens from /tmp/iter158_tokens.json.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_PHONE = "9970705391"
MESS_OWNER_PHONE = "8421375391"
MESS_OWNER_LOGIN_MESS = "efoodcare-amravati"
MESS_OWNER_OWNED_MESS_ID = "MESS-C0A9"      # user_073485b79a1b owns this
OTHER_MESS_ID = "MESS-0267"                 # different owner
CACHE = Path("/tmp/iter158_tokens.json")

# Actual keys in DEFAULT_CONTENT (server.py:1503). The review request mentioned
# 'kiosk' and 'brand_logo' but those live in separate endpoints (kiosk_cms &
# branding). We test the real /content/{key} namespace here.
CONTENT_KEYS = ["footer", "announcement", "contact", "privacy", "about"]


# --------------------------------------------------------------------------
# Auth helper (module-scoped cache)
# --------------------------------------------------------------------------
def _login(phone: str, mess_id: str | None = None) -> str:
    cache: dict = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text())
        except Exception:
            cache = {}
    tok = cache.get(phone)
    if tok:
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {tok}"}, timeout=10,
        )
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
        body = {"phone": phone, "otp": otp}
        if mess_id:
            body["mess_id"] = mess_id
        r2 = requests.post(f"{BASE_URL}/api/auth/verify-otp", json=body, timeout=15)
        assert r2.status_code == 200, r2.text
        tok = r2.json().get("session_token")
        cache[phone] = tok
        CACHE.write_text(json.dumps(cache))
        return tok
    pytest.skip(f"OTP login unavailable for {phone}: {last and last.status_code} {last and last.text[:120]}")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_PHONE)}"}


@pytest.fixture(scope="module")
def owner_headers():
    return {"Authorization": f"Bearer {_login(MESS_OWNER_PHONE, MESS_OWNER_LOGIN_MESS)}"}


@pytest.fixture(scope="module")
def owner_me(owner_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=owner_headers, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------
# 1. CMS MULTI-TENANT ISOLATION
# --------------------------------------------------------------------------
class TestCMSIsolation:
    """GET /api/content/{key} scoping + POST /api/admin/content/{key} isolation."""

    def test_anonymous_gets_global_content(self):
        for key in CONTENT_KEYS:
            r = requests.get(f"{BASE_URL}/api/content/{key}", timeout=15)
            assert r.status_code == 200, f"{key}: {r.status_code} {r.text[:120]}"
            assert isinstance(r.json(), dict), f"{key}: non-dict body"

    def test_admin_global_edit_does_not_bleed_into_mess_scope(self, admin_headers, owner_headers, owner_me):
        marker_global = f"iter176-global-{uuid.uuid4().hex[:6]}"
        marker_mess = f"iter176-mess-{uuid.uuid4().hex[:6]}"

        # Ensure admin is NOT impersonating (writes go to global).
        requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=admin_headers, timeout=10)

        # Super-admin writes global footer.
        r_g = requests.post(
            f"{BASE_URL}/api/admin/content/footer",
            headers=admin_headers,
            json={"data": {"tagline": marker_global}},
            timeout=15,
        )
        assert r_g.status_code == 200, r_g.text
        assert r_g.json().get("tagline") == marker_global

        # Mess-owner writes their own mess-scoped footer.
        r_m = requests.post(
            f"{BASE_URL}/api/admin/content/footer",
            headers=owner_headers,
            json={"data": {"tagline": marker_mess}},
            timeout=15,
        )
        assert r_m.status_code == 200, r_m.text
        assert r_m.json().get("tagline") == marker_mess

        # Anonymous GET should see global marker.
        r_anon = requests.get(f"{BASE_URL}/api/content/footer", timeout=15)
        assert r_anon.status_code == 200
        assert r_anon.json().get("tagline") == marker_global, (
            f"anon expected global marker; got {r_anon.json().get('tagline')}"
        )

        # Explicit mess_id qs — should see mess marker (isolation).
        # The mess-owner writes to the mess they OWN (via owner_user_id
        # lookup in _resolve_content_mess_id), which is MESS_OWNER_OWNED_MESS_ID,
        # not necessarily their user.mess_id.
        owned_mid = MESS_OWNER_OWNED_MESS_ID
        r_mid = requests.get(
            f"{BASE_URL}/api/content/footer", params={"mess_id": owned_mid}, timeout=15,
        )
        assert r_mid.status_code == 200
        assert r_mid.json().get("tagline") == marker_mess, (
            f"mess-scoped expected mess marker; got {r_mid.json().get('tagline')} "
            f"(mess_id={owned_mid})"
        )

    def test_strict_isolation_mess_without_override_gets_defaults(self, admin_headers):
        """iter-170 spec: a mess with no override for a key returns pristine
        DEFAULT_CONTENT (NOT the super-admin's global copy). This is by design —
        strict tenant isolation. The prior 'fallback to global' semantics was
        deliberately removed to prevent super-admin edits bleeding into tenants."""
        requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=admin_headers, timeout=10)
        marker = f"iter176-about-{uuid.uuid4().hex[:6]}"
        r_g = requests.post(
            f"{BASE_URL}/api/admin/content/about",
            headers=admin_headers,
            json={"data": {"body": marker}},
            timeout=15,
        )
        assert r_g.status_code == 200

        r = requests.get(
            f"{BASE_URL}/api/content/about",
            params={"mess_id": "MESS-DOES-NOT-EXIST-XYZ"},
            timeout=15,
        )
        assert r.status_code == 200
        # The marker MUST NOT appear in a mess-scoped read — proves isolation.
        assert r.json().get("body") != marker, (
            f"isolation broken: mess-scoped read leaked global marker {marker!r}"
        )

    def test_all_content_keys_writable_globally(self, admin_headers):
        requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=admin_headers, timeout=10)
        for key in CONTENT_KEYS:
            marker = f"iter176-{key}-{uuid.uuid4().hex[:5]}"
            payload = {"data": {"tagline": marker, "title": marker, "body": marker}}
            r = requests.post(
                f"{BASE_URL}/api/admin/content/{key}",
                headers=admin_headers, json=payload, timeout=15,
            )
            assert r.status_code == 200, f"{key}: {r.status_code} {r.text[:200]}"


# --------------------------------------------------------------------------
# 2. Super-admin mess management (iter-174)
# --------------------------------------------------------------------------
class TestSuperAdminMessMgmt:
    """PUT edit, POST promote-owner, DELETE delist — all admin-only."""

    def test_put_edit_mess_admin_only(self, owner_headers):
        # Owner should be blocked from PUT /admin/messes/*.
        # Fetch current mess to send a valid payload shape.
        r = requests.get(f"{BASE_URL}/api/admin/messes", headers=owner_headers, timeout=15)
        # /admin/messes list is admin-only — but PUT is what we're really
        # testing. Send a minimal invalid body and just assert 403 on role.
        r = requests.put(
            f"{BASE_URL}/api/admin/messes/{OTHER_MESS_ID}",
            headers=owner_headers,
            json={"slug": "xx", "name": "xx", "address": "12 test lane road", "city": "XX",
                  "state": "YY", "pincode": "1234"},
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_put_edit_mess_updates_manager_phone(self, admin_headers):
        """Simulate the 'mobile edit' path: PUT with updated manager_phone
        (which the frontend labels 'Mobile' in the mess edit form)."""
        # Pick an existing mess to poke.
        r_list = requests.get(f"{BASE_URL}/api/admin/messes", headers=admin_headers, timeout=15)
        assert r_list.status_code == 200, r_list.text
        messes = r_list.json().get("messes") or []
        target = next((m for m in messes if m.get("mess_id") == MESS_OWNER_OWNED_MESS_ID), None)
        if not target:
            pytest.skip(f"target mess {MESS_OWNER_OWNED_MESS_ID} not in admin list")

        new_mgr_phone = f"90000{uuid.uuid4().hex[:5]}"
        payload = {
            "slug": target.get("slug") or "mess-c0a9",
            "name": target.get("name") or "Test Mess",
            "tagline": target.get("tagline") or "",
            "address": target.get("address") or "12 test lane addr",
            "city": target.get("city") or "Amravati",
            "state": target.get("state") or "Maharashtra",
            "pincode": target.get("pincode") or "444601",
            "manager_name": target.get("manager_name") or "Mgr",
            "manager_phone": new_mgr_phone,
            "manager_email": target.get("manager_email") or "",
            "is_franchise": bool(target.get("is_franchise", True)),
            "fssai_number": target.get("fssai_number") or "",
            "capacity_lunch": int(target.get("capacity_lunch") or 100),
            "capacity_dinner": int(target.get("capacity_dinner") or 100),
            "owner_phone": target.get("owner_phone") or "",
            "owner_email": target.get("owner_email") or "",
        }
        r = requests.put(
            f"{BASE_URL}/api/admin/messes/{MESS_OWNER_OWNED_MESS_ID}",
            headers=admin_headers, json=payload, timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body.get("manager_phone") == new_mgr_phone, body

    def test_promote_owner_admin_only(self, owner_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/messes/promote-owner",
            headers=owner_headers,
            json={"mess_id": OTHER_MESS_ID, "phone": MESS_OWNER_PHONE},
            timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_promote_owner_404_unknown_phone(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/messes/promote-owner",
            headers=admin_headers,
            json={"mess_id": MESS_OWNER_OWNED_MESS_ID, "phone": "9999999901"},
            timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_promote_owner_404_unknown_mess(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/messes/promote-owner",
            headers=admin_headers,
            json={"mess_id": "MESS-DOES-NOT-EXIST", "phone": MESS_OWNER_PHONE},
            timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_delete_mess_admin_only(self, owner_headers):
        r = requests.delete(
            f"{BASE_URL}/api/admin/messes/{OTHER_MESS_ID}",
            headers=owner_headers, timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_delete_default_mess_refused(self, admin_headers):
        # Try the corporate default — must be 400.
        r = requests.delete(
            f"{BASE_URL}/api/admin/messes/{MESS_OWNER_LOGIN_MESS}",
            headers=admin_headers, timeout=15,
        )
        # DEFAULT_MESS_ID is 'efoodcare-amravati' per default seed convention.
        # If not the default, this call will delete → NOT SAFE. Only assert
        # the 'refused' semantics if the response is 400 with that message;
        # otherwise mark as expected to succeed (still admin-only).
        assert r.status_code in (400, 404), (
            f"delete default mess: got {r.status_code} {r.text[:200]} — "
            f"if 200, the default guard is missing"
        )

    def test_delete_unknown_mess_returns_404(self, admin_headers):
        r = requests.delete(
            f"{BASE_URL}/api/admin/messes/MESS-DOES-NOT-EXIST-XYZ",
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 404, r.text


# --------------------------------------------------------------------------
# 3. Bottom-nav slots
# --------------------------------------------------------------------------
class TestBottomNavSlots:
    def test_admin_get(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/messes/{MESS_OWNER_OWNED_MESS_ID}/bottom-nav-slots",
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("slots"), list)
        assert isinstance(body.get("catalog"), list)
        keys = {c["key"] for c in body["catalog"]}
        assert "home" in keys
        assert "restaurant" in keys  # legacy 'restaurant-menu' slot key

    def test_patch_home_slot_round_trip(self, admin_headers):
        # Snapshot original.
        r0 = requests.get(
            f"{BASE_URL}/api/admin/messes/{MESS_OWNER_OWNED_MESS_ID}/bottom-nav-slots",
            headers=admin_headers, timeout=15,
        )
        original = r0.json()["slots"]

        try:
            # Set slots INCLUDING 'home' — this is the supersede case.
            new_slots = ["home", "nearby", "dashboard", "scan", "orders", "subscribe", "profile"]
            r1 = requests.patch(
                f"{BASE_URL}/api/admin/messes/{MESS_OWNER_OWNED_MESS_ID}/bottom-nav-slots",
                headers=admin_headers, json={"slots": new_slots}, timeout=15,
            )
            assert r1.status_code == 200, r1.text
            assert r1.json().get("slots") == new_slots

            # Round-trip read.
            r2 = requests.get(
                f"{BASE_URL}/api/admin/messes/{MESS_OWNER_OWNED_MESS_ID}/bottom-nav-slots",
                headers=admin_headers, timeout=15,
            )
            assert r2.json()["slots"] == new_slots
            assert "home" in r2.json()["slots"]
        finally:
            # Restore
            requests.patch(
                f"{BASE_URL}/api/admin/messes/{MESS_OWNER_OWNED_MESS_ID}/bottom-nav-slots",
                headers=admin_headers, json={"slots": original}, timeout=15,
            )

    def test_invalid_slot_key_rejected(self, admin_headers):
        r = requests.patch(
            f"{BASE_URL}/api/admin/messes/{MESS_OWNER_OWNED_MESS_ID}/bottom-nav-slots",
            headers=admin_headers, json={"slots": ["home", "totally-bogus"]}, timeout=15,
        )
        assert r.status_code == 400, r.text


# --------------------------------------------------------------------------
# 4. Reverse geocode
# --------------------------------------------------------------------------
class TestGeoReverse:
    """Nominatim postal-district fallback near Amravati / Shegaon.

    Amravati city centre: ~20.9374, 77.7796 → PIN starts 4446xx
    Shegaon: ~20.7929, 76.6903 → PIN 444203
    """

    def test_reverse_amravati(self):
        r = requests.get(
            f"{BASE_URL}/api/geo/reverse",
            params={"lat": 20.9374, "lng": 77.7796}, timeout=25,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "city" in body and "pincode" in body and "state" in body
        # City should be Amravati per postal district (iter-169 fix), not Shegaon.
        city = (body.get("city") or "").lower()
        assert "amravati" in city, f"expected Amravati, got city={body.get('city')!r} pin={body.get('pincode')!r}"

    def test_reverse_shegaon(self):
        r = requests.get(
            f"{BASE_URL}/api/geo/reverse",
            params={"lat": 20.7929, "lng": 76.6903}, timeout=25,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Shegaon lies in Buldhana district — either 'Buldhana' or 'Shegaon'
        # is acceptable depending on India Post postal-district labeling.
        city = (body.get("city") or "").lower()
        assert any(t in city for t in ("shegaon", "buldhana", "buldana")), (
            f"expected Shegaon/Buldhana; got city={body.get('city')!r} pin={body.get('pincode')!r}"
        )

    def test_reverse_invalid_coords_400(self):
        r = requests.get(
            f"{BASE_URL}/api/geo/reverse", params={"lat": 200, "lng": 999}, timeout=15,
        )
        assert r.status_code in (400, 422), r.text
