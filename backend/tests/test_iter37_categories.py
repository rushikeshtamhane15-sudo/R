"""Iter-37 backend tests: restaurant categories CRUD + rename propagation."""
import os
import time
import requests
import pytest

def _load_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        # Read from frontend/.env
        env_path = "/app/frontend/.env"
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
    assert url, "REACT_APP_BACKEND_URL not set"
    return url.rstrip("/")

BASE_URL = _load_base_url()
ADMIN_PHONE = "9970705391"  # in ADMIN_PHONES
USER_PHONE = "9876543210"


def _get_token(phone: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, r.text
    otp = r.json().get("dev_otp")
    assert otp, f"no dev_otp in send-otp: {r.text}"
    r2 = requests.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": phone, "otp": otp, "name": "Tester"},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    return r2.json()["session_token"]


@pytest.fixture(scope="module")
def admin_token():
    return _get_token(ADMIN_PHONE)


@pytest.fixture(scope="module")
def user_token():
    return _get_token(USER_PHONE)


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---- Public categories ----
def test_public_categories_returns_list():
    r = requests.get(f"{BASE_URL}/api/restaurant/categories", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "categories" in data
    assert isinstance(data["categories"], list)
    assert len(data["categories"]) >= 1


# ---- Admin auth gates ----
def test_admin_categories_requires_auth():
    r = requests.get(f"{BASE_URL}/api/admin/restaurant/categories", timeout=15)
    assert r.status_code == 401


def test_admin_categories_forbidden_for_non_admin(user_token):
    # verify role
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(user_token), timeout=15).json()
    if me.get("role") == "admin":
        pytest.skip("test user is admin in this env")
    r = requests.get(
        f"{BASE_URL}/api/admin/restaurant/categories", headers=_h(user_token), timeout=15
    )
    assert r.status_code == 403


def test_admin_categories_get_ok(admin_token):
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(admin_token), timeout=15).json()
    assert me.get("role") == "admin", f"admin phone not admin: {me}"
    r = requests.get(
        f"{BASE_URL}/api/admin/restaurant/categories", headers=_h(admin_token), timeout=15
    )
    assert r.status_code == 200
    assert "categories" in r.json()


# ---- Validation ----
def test_admin_put_categories_rejects_empty(admin_token):
    r = requests.put(
        f"{BASE_URL}/api/admin/restaurant/categories",
        headers=_h(admin_token),
        json={"categories": []},
        timeout=15,
    )
    assert r.status_code == 400


def test_admin_put_categories_rejects_duplicate(admin_token):
    r = requests.put(
        f"{BASE_URL}/api/admin/restaurant/categories",
        headers=_h(admin_token),
        json={"categories": ["Mains", "Mains"]},
        timeout=15,
    )
    assert r.status_code == 400


def test_admin_put_categories_rejects_too_long(admin_token):
    r = requests.put(
        f"{BASE_URL}/api/admin/restaurant/categories",
        headers=_h(admin_token),
        json={"categories": ["A" * 61]},
        timeout=15,
    )
    assert r.status_code == 400


# ---- Rename propagation ----
def test_rename_propagation_to_menu_items(admin_token):
    # Get current categories
    r = requests.get(
        f"{BASE_URL}/api/admin/restaurant/categories", headers=_h(admin_token), timeout=15
    )
    original = r.json()["categories"]

    # Get current menu to find a category in use
    r_menu = requests.get(
        f"{BASE_URL}/api/admin/restaurant/menu", headers=_h(admin_token), timeout=15
    )
    assert r_menu.status_code == 200
    items_before = r_menu.json()["items"]

    # Find an in-use category to rename
    in_use = None
    for c in original:
        if any(it.get("category") == c for it in items_before):
            in_use = c
            break
    assert in_use, f"no in-use category among {original}"
    idx = original.index(in_use)
    renamed = f"TESTCAT_{int(time.time())}"
    new_list = list(original)
    new_list[idx] = renamed

    r2 = requests.put(
        f"{BASE_URL}/api/admin/restaurant/categories",
        headers=_h(admin_token),
        json={"categories": new_list},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["categories"] == new_list
    assert body["renames"].get(in_use) == renamed

    # Verify menu items rename propagated
    r_menu2 = requests.get(
        f"{BASE_URL}/api/admin/restaurant/menu", headers=_h(admin_token), timeout=15
    )
    items_after = r_menu2.json()["items"]
    assert not any(it.get("category") == in_use for it in items_after), (
        f"old category {in_use} still present after rename"
    )
    assert any(it.get("category") == renamed for it in items_after), (
        f"new category {renamed} not found"
    )

    # Restore
    restore = list(new_list)
    restore[idx] = in_use
    rr = requests.put(
        f"{BASE_URL}/api/admin/restaurant/categories",
        headers=_h(admin_token),
        json={"categories": restore},
        timeout=15,
    )
    assert rr.status_code == 200


# ---- Regression ----
def test_public_menu_still_works():
    r = requests.get(f"{BASE_URL}/api/restaurant/menu", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and len(body["items"]) >= 1


def test_public_theme_still_works():
    r = requests.get(f"{BASE_URL}/api/restaurant/theme", timeout=15)
    assert r.status_code == 200


def test_admin_menu_put_still_works(admin_token):
    r = requests.get(
        f"{BASE_URL}/api/admin/restaurant/menu", headers=_h(admin_token), timeout=15
    )
    assert r.status_code == 200
    items = r.json()["items"]
    r2 = requests.put(
        f"{BASE_URL}/api/admin/restaurant/menu",
        headers=_h(admin_token),
        json={"items": items},
        timeout=15,
    )
    assert r2.status_code == 200
