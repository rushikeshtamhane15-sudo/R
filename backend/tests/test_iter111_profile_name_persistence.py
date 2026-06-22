"""iter-111 regression — profile save persists name; subsequent /auth/me returns it."""
import os
import uuid
import requests

API = os.environ.get("API_URL", "http://localhost:8001/api")


def _login_otp(phone, name="x"):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10)
    r.raise_for_status()
    otp = r.json()["dev_otp"]
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name}, timeout=10)
    r.raise_for_status()
    return r.json()["session_token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_profile_save_persists_name_across_reads():
    """Reproduces user's bug: name was 'breaking' on profile save. After
    save, /auth/me must return the exact name the user typed."""
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    token = _login_otp(phone, "x")

    # Save a real profile
    body = {
        "name": "Rushikesh Tamhane",
        "phone": phone,
        "address": "1, Sai Nagar, Amravati 444607",
        "photo_url": "",  # photo is required by FE but backend allows empty
    }
    r = requests.post(f"{API}/auth/profile", json=body, headers=_h(token), timeout=20)
    assert r.status_code == 200, r.text
    saved = r.json()["user"]
    assert saved["name"] == "Rushikesh Tamhane", saved
    assert saved["address"] == "1, Sai Nagar, Amravati 444607"

    # Fresh /auth/me must also reflect the saved name
    me = requests.get(f"{API}/auth/me", headers=_h(token), timeout=10).json()
    assert me["name"] == "Rushikesh Tamhane", me
    assert me["address"] == "1, Sai Nagar, Amravati 444607"

    requests.delete(f"{API}/auth/me", headers=_h(token), timeout=10)


def test_profile_save_returns_user_without_huge_photo_url():
    """Photo url must NOT echo back on save (it was crashing Cloudflare).
    iter-111 just verifies the contract."""
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    token = _login_otp(phone, "x")

    # A small data-url photo (~1 KB)
    data_url = "data:image/png;base64," + ("A" * 1024)
    body = {
        "name": "Photo User",
        "phone": phone,
        "address": "Block 12, Sample area, Amravati 444601",
        "photo_url": data_url,
    }
    r = requests.post(f"{API}/auth/profile", json=body, headers=_h(token), timeout=20)
    assert r.status_code == 200, r.text
    saved = r.json()["user"]
    assert "photo_url" not in saved, "photo_url should be excluded from save response"
    # But name + address still come back
    assert saved["name"] == "Photo User"

    requests.delete(f"{API}/auth/me", headers=_h(token), timeout=10)
