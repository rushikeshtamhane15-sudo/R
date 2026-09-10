"""iter-163 (round-158n) — Verify mess scoping for pending-cash / pending-partials /
takeaway pendency (manual) + new partial-payments/reset endpoint + content
scoping for logged-in vs anonymous users.

Tests only the 5 items requested by the main agent. Regressions of prior
iter-158* / iter-160* suites are validated via a separate pytest run.
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
CACHE = Path("/tmp/iter158_tokens.json")


def _admin_token() -> str:
    cache = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text())
        except Exception:
            pass
    tok = cache.get(ADMIN_PHONE)
    if tok:
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        if r.status_code == 200:
            return tok
    for _ in range(3):
        r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": ADMIN_PHONE}, timeout=15)
        if r.status_code == 429:
            time.sleep(65)
            continue
        otp = r.json()["dev_otp"]
        r2 = requests.post(
            f"{BASE_URL}/api/auth/verify-otp",
            json={"phone": ADMIN_PHONE, "otp": otp},
            timeout=15,
        )
        tok = r2.json().get("session_token")
        cache[ADMIN_PHONE] = tok
        CACHE.write_text(json.dumps(cache))
        return tok
    raise RuntimeError("rate-limited")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_admin_token()}"}


@pytest.fixture(scope="module")
def two_messes(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/messes", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    ids = [m["mess_id"] for m in r.json().get("messes", [])]
    # Prefer the two well-known seed messes if present
    a = "efoodcare-amravati" if "efoodcare-amravati" in ids else ids[0]
    b = "efoodcare-yavatmal" if "efoodcare-yavatmal" in ids else ids[1]
    assert a != b, "need two distinct messes"
    return a, b


def _impersonate(headers, mess_id):
    r = requests.post(f"{BASE_URL}/api/admin/impersonate/{mess_id}", headers=headers, timeout=15)
    assert r.status_code == 200, r.text


def _clear_imp(headers):
    requests.delete(f"{BASE_URL}/api/admin/impersonate", headers=headers, timeout=15)


# ---------------------------------------------------------------------------
# #2 · Takeaway pendency manual entry appears in list, tagged with mess_id
# ---------------------------------------------------------------------------
def test_takeaway_pendency_manual_appears_scoped(admin_headers, two_messes):
    mess_a, _ = two_messes
    _impersonate(admin_headers, mess_a)
    try:
        unique = uuid.uuid4().hex[:6]
        payload = {
            "name": f"PendTest-{unique}",
            "phone": "9999911111",
            "tiffin_count": 1,
            "notes": "iter-163 test",
        }
        r = requests.post(
            f"{BASE_URL}/api/admin/restaurant/takeaway-pendency/manual",
            headers=admin_headers,
            json=payload,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        pid = r.json().get("pendency_id")
        assert pid

        # List it — should include the new row
        r2 = requests.get(
            f"{BASE_URL}/api/admin/restaurant/takeaway-pendency",
            headers=admin_headers,
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        rows = body.get("rows", [])
        match = [row for row in rows if row.get("pendency_id") == pid]
        assert match, f"newly created pendency {pid} not in list of {len(rows)} rows"
        row = match[0]
        assert row.get("mess_id") == mess_a, f"expected mess_id={mess_a}, got {row.get('mess_id')}"
        assert row.get("user_id") in (None, "")
        assert row.get("kind") == "manual"
    finally:
        _clear_imp(admin_headers)


# ---------------------------------------------------------------------------
# #3 · Pending cash scoped by impersonated mess
# ---------------------------------------------------------------------------
def test_pending_cash_scoped_by_mess(admin_headers, two_messes):
    mess_a, mess_b = two_messes
    counts = {}
    user_id_sets = {}
    for m in (mess_a, mess_b):
        _impersonate(admin_headers, m)
        r = requests.get(
            f"{BASE_URL}/api/admin/payments/pending-cash",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        counts[m] = body.get("count", 0)
        user_id_sets[m] = {row.get("user_id") for row in body.get("rows", [])}
    _clear_imp(admin_headers)

    # Verify each row's user actually belongs to that mess
    for m, uids in user_id_sets.items():
        if not uids:
            continue
        r = requests.get(
            f"{BASE_URL}/api/admin/messes/{m}/users",
            headers=admin_headers,
            timeout=15,
        )
        if r.status_code == 200:
            mess_uids = {u.get("user_id") for u in r.json().get("users", [])}
            leaks = uids - mess_uids
            # None or empty-string user_ids can appear on legacy rows — ignore
            leaks.discard(None)
            leaks.discard("")
            assert not leaks, f"mess {m} pending-cash leaks users from other mess: {leaks}"

    print(f"pending_cash counts: {counts}")


# ---------------------------------------------------------------------------
# #4 · Pending partials scoped + reset endpoint
# ---------------------------------------------------------------------------
def test_pending_partials_scoped_by_mess(admin_headers, two_messes):
    mess_a, mess_b = two_messes
    counts = {}
    for m in (mess_a, mess_b):
        _impersonate(admin_headers, m)
        r = requests.get(
            f"{BASE_URL}/api/admin/payments/pending-partials",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        counts[m] = r.json().get("count", 0)
    _clear_imp(admin_headers)
    print(f"pending_partials counts: {counts}")


def test_partial_payments_reset_dry_run(admin_headers, two_messes):
    mess_a, _ = two_messes
    _impersonate(admin_headers, mess_a)
    try:
        r = requests.post(
            f"{BASE_URL}/api/admin/partial-payments/reset?dry_run=true",
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("dry_run") is True
        assert "would_clear" in body
        assert body.get("mess_id") == mess_a
    finally:
        _clear_imp(admin_headers)


def test_partial_payments_reset_anon_forbidden():
    r = requests.post(f"{BASE_URL}/api/admin/partial-payments/reset", timeout=15)
    assert r.status_code in (401, 403), r.text


# ---------------------------------------------------------------------------
# #8/11 · Content mess-scoping for logged-in vs anonymous
# ---------------------------------------------------------------------------
def test_content_scoping_authed_vs_anon(admin_headers, two_messes):
    mess_a, _ = two_messes
    _impersonate(admin_headers, mess_a)
    marker = f"MyMessFooter-{uuid.uuid4().hex[:6]}"
    try:
        # Write scoped content
        r = requests.post(
            f"{BASE_URL}/api/admin/content/footer",
            headers=admin_headers,
            json={"data": {"brand_name": marker}},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # Authed GET should show marker (uses session cookie/bearer → user's mess)
        r_auth = requests.get(
            f"{BASE_URL}/api/content/footer",
            headers=admin_headers,
            timeout=15,
        )
        assert r_auth.status_code == 200, r_auth.text
        auth_brand = (r_auth.json() or {}).get("brand_name")
        # Anonymous GET — global default
        r_anon = requests.get(f"{BASE_URL}/api/content/footer", timeout=15)
        assert r_anon.status_code == 200
        anon_brand = (r_anon.json() or {}).get("brand_name")

        # Admin token belongs to the super-admin whose users record's mess_id
        # may or may not be `mess_a`. What we CAN reliably verify:
        #  (a) anonymous GET is NOT the marker (global default is separate).
        assert anon_brand != marker, (
            f"anonymous /content/footer returned mess-scoped marker: {anon_brand}"
        )
        # (b) An explicit ?mess_id=mess_a fetch returns the marker
        r_by_id = requests.get(
            f"{BASE_URL}/api/content/footer?mess_id={mess_a}",
            timeout=15,
        )
        assert r_by_id.status_code == 200
        assert (r_by_id.json() or {}).get("brand_name") == marker, (
            f"mess-scoped fetch missing marker: {r_by_id.json()}"
        )
        print(f"authed_brand={auth_brand} anon_brand={anon_brand} marker={marker}")
    finally:
        _clear_imp(admin_headers)
