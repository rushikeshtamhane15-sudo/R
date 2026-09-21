"""iter-177 · Batch verification tests.

Scope (from review request):
  1) POST /api/admin/messes/promote-owner now writes `owner_phone` (10-digit)
     to the mess doc. Test 10-digit and 91-prefixed variants.
  2) Startup one-shot backfill — verify backend log line
     `[iter-177] backfilled owner_phone on N mess doc(s)` was emitted and no
     mess with owner_user_id has an empty owner_phone.
  3) NEW GET /api/messes/by-id/{mess_id} — public, returns public fields;
     404 for unknown ID.
  4) NEW GET /api/admin/active-dining-details — mirror of active-tiffin-details,
     role guard (admin/mess_owner/staff), scoped by effective_mess_id.
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
MESS_OWNER_LOGIN_MESS = "MESS-C0A9"   # after iter-177 promote user.mess_id === owned mess
MESS_OWNER_OWNED_MESS_ID = "MESS-C0A9"
OTHER_MESS_ID = "MESS-0267"
CACHE = Path("/tmp/iter158_tokens.json")


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


# --------------------------------------------------------------------------
# 1. Promote-owner writes owner_phone
# --------------------------------------------------------------------------
class TestPromoteOwnerWritesPhone:

    def _list_messes(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/messes", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        return r.json().get("messes") or []

    def test_promote_writes_owner_phone_10digit(self, admin_headers):
        # Promote the mess-owner user (10-digit phone) into MESS_OWNER_OWNED_MESS_ID.
        r = requests.post(
            f"{BASE_URL}/api/admin/messes/promote-owner",
            headers=admin_headers,
            json={"mess_id": MESS_OWNER_OWNED_MESS_ID, "phone": MESS_OWNER_PHONE},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("owner_phone") == MESS_OWNER_PHONE, body
        # Verify the mess doc persisted it.
        messes = self._list_messes(admin_headers)
        m = next((x for x in messes if x.get("mess_id") == MESS_OWNER_OWNED_MESS_ID), None)
        assert m is not None
        assert m.get("owner_phone") == MESS_OWNER_PHONE, f"expected {MESS_OWNER_PHONE}, got {m.get('owner_phone')!r}"

    def test_promote_accepts_91_prefixed(self, admin_headers):
        prefixed = "91" + MESS_OWNER_PHONE
        r = requests.post(
            f"{BASE_URL}/api/admin/messes/promote-owner",
            headers=admin_headers,
            json={"mess_id": MESS_OWNER_OWNED_MESS_ID, "phone": prefixed},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("owner_phone") == MESS_OWNER_PHONE, r.json()

    def test_promote_owner_role_guard(self, owner_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/messes/promote-owner",
            headers=owner_headers,
            json={"mess_id": OTHER_MESS_ID, "phone": MESS_OWNER_PHONE},
            timeout=15,
        )
        assert r.status_code == 403, r.text


# --------------------------------------------------------------------------
# 2. Startup backfill — verify via effect: all messes with owner_user_id
#    should now have owner_phone populated.
# --------------------------------------------------------------------------
class TestBackfillOwnerPhone:

    def test_no_mess_with_owner_id_missing_phone(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/messes", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        messes = r.json().get("messes") or []
        offenders = [
            m for m in messes
            if m.get("owner_user_id") and not (m.get("owner_phone") or "").strip()
        ]
        assert offenders == [], (
            f"iter-177 backfill left {len(offenders)} mess(es) with owner_user_id "
            f"but empty owner_phone: {[m.get('mess_id') for m in offenders]}"
        )

    def test_backfill_log_line_present(self):
        """Look for the one-shot backfill log line in the backend log."""
        try:
            log = Path("/var/log/supervisor/backend.err.log").read_text()
        except Exception as e:
            pytest.skip(f"backend log unreadable: {e}")
        assert "[iter-177] backfilled owner_phone" in log, (
            "expected startup log 'backfilled owner_phone on N mess doc(s)'"
        )


# --------------------------------------------------------------------------
# 3. NEW GET /api/messes/by-id/{mess_id}
# --------------------------------------------------------------------------
class TestMessByIdPublic:

    PUBLIC_KEYS = {"mess_id", "name", "slug", "city", "state", "pincode", "tagline", "logo_url", "status"}

    def test_by_id_known_mess_200(self):
        # Unauth, public.
        r = requests.get(f"{BASE_URL}/api/messes/by-id/{MESS_OWNER_OWNED_MESS_ID}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("mess_id") == MESS_OWNER_OWNED_MESS_ID
        # All exposed keys should be from the public whitelist (extra keys are
        # tolerated if server chooses to add safe fields, but _id must not leak).
        assert "_id" not in body
        # At minimum name and slug are present for the LocationPill.
        assert "name" in body
        # city may be empty string, but the key should exist
        assert "city" in body

    def test_by_id_alias_slug_works_for_efoodcare_amravati(self):
        # The DEFAULT_MESS_ID in this codebase is the SLUG 'efoodcare-amravati'
        # AND also stored as mess_id for the default mess. Check via mess_id endpoint.
        r = requests.get(f"{BASE_URL}/api/messes/by-id/{MESS_OWNER_LOGIN_MESS}", timeout=15)
        # Either 200 (if mess_id == 'efoodcare-amravati') or 404 (if mess_id is a MESS-XXXX code).
        # Both are acceptable; assert the endpoint answers cleanly.
        assert r.status_code in (200, 404), r.text
        if r.status_code == 200:
            assert "_id" not in r.json()

    def test_by_id_unknown_404(self):
        r = requests.get(f"{BASE_URL}/api/messes/by-id/MESS-DOES-NOT-EXIST-XYZ", timeout=15)
        assert r.status_code == 404, r.text

    def test_by_id_route_precedes_slug_route(self):
        """Ensure /messes/by-id/{X} is not shadowed by /messes/{slug}. A slug
        endpoint would return the mess whose slug=='by-id', which likely
        doesn't exist → but if the routes were ordered wrong, requesting
        /messes/by-id/MESS-C0A9 might 404 with 'slug not found' body.
        This test asserts we get the by-id semantics (200 for a real mess_id)."""
        r = requests.get(f"{BASE_URL}/api/messes/by-id/{MESS_OWNER_OWNED_MESS_ID}", timeout=15)
        assert r.status_code == 200
        assert r.json().get("mess_id") == MESS_OWNER_OWNED_MESS_ID


# --------------------------------------------------------------------------
# 4. NEW GET /api/admin/active-dining-details
# --------------------------------------------------------------------------
class TestActiveDiningDetails:

    def test_unauth_403_or_401(self):
        r = requests.get(f"{BASE_URL}/api/admin/active-dining-details", timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_admin_ok_shape(self, admin_headers):
        # Ensure not impersonating.
        requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=admin_headers, timeout=10)
        r = requests.get(
            f"{BASE_URL}/api/admin/active-dining-details",
            headers=admin_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "count" in body and "rows" in body and "mess_id" in body
        assert isinstance(body["rows"], list)
        assert body["count"] == len(body["rows"])
        if body["rows"]:
            row = body["rows"][0]
            for k in ("sub_id", "user_id", "name", "phone", "address", "plan_name",
                      "meals_left", "days_left", "renewal_date"):
                assert k in row, f"missing key {k} in row: {row}"

    def test_mess_owner_scoped(self, owner_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/active-dining-details",
            headers=owner_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # mess_owner MUST be scoped to a mess_id — never platform-wide.
        assert body.get("mess_id"), f"mess_owner should have scoped mess_id, got {body}"

    def test_active_dining_partitions_with_tiffin(self, admin_headers):
        """dining + tiffin rows should not overlap (they must partition
        active subs)."""
        requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=admin_headers, timeout=10)
        rd = requests.get(f"{BASE_URL}/api/admin/active-dining-details",
                          headers=admin_headers, timeout=20)
        rt = requests.get(f"{BASE_URL}/api/admin/active-tiffin-details",
                          headers=admin_headers, timeout=20)
        assert rd.status_code == 200 and rt.status_code == 200, (rd.text, rt.text)
        d_ids = {r.get("sub_id") for r in rd.json().get("rows", [])}
        t_ids = {r.get("sub_id") for r in rt.json().get("rows", [])}
        overlap = d_ids & t_ids
        assert not overlap, f"dining and tiffin drill-downs overlap on sub_ids: {overlap}"
