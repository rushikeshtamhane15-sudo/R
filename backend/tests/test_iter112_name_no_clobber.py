"""iter-112 — OTP re-login never overwrites a saved name + letters-only validation."""
import os
import uuid
import requests

API = os.environ.get("API_URL", "http://localhost:8001/api")


def _login(phone, name="x"):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10)
    r.raise_for_status()
    otp = r.json()["dev_otp"]
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name}, timeout=10)
    r.raise_for_status()
    return r.json()["session_token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def test_reloging_in_does_not_clobber_saved_name():
    """Exact bug user reported: save name 'sunny jawal', log out, log in again,
    name must STILL be 'sunny jawal' (not 'User 4744')."""
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    token = _login(phone, "x")

    # Save real profile
    r = requests.post(f"{API}/auth/profile", json={
        "name": "sunny jawal",
        "phone": phone,
        "address": "Block C, Sai Nagar, Amravati 444601",
        "photo_url": "",
    }, headers=_h(token), timeout=15)
    assert r.status_code == 200, r.text

    # Logout
    requests.post(f"{API}/auth/logout", headers=_h(token), timeout=10)

    # Log back in — verify-otp is the path that was clobbering the name.
    # Note we pass NO name so the backend uses the "User 4744" default.
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10).json()
    new_token = requests.post(f"{API}/auth/verify-otp", json={
        "phone": phone, "otp": r["dev_otp"],
    }, timeout=10).json()["session_token"]

    me = requests.get(f"{API}/auth/me", headers=_h(new_token), timeout=10).json()
    assert me["name"] == "sunny jawal", f"name was clobbered to {me['name']!r}"

    # And even if a "User 4744"-style default IS passed, the saved name must win
    requests.post(f"{API}/auth/logout", headers=_h(new_token), timeout=10)
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=10).json()
    t3 = requests.post(f"{API}/auth/verify-otp", json={
        "phone": phone, "otp": r["dev_otp"], "name": f"User {phone[-4:]}",
    }, timeout=10).json()["session_token"]
    me = requests.get(f"{API}/auth/me", headers=_h(t3), timeout=10).json()
    assert me["name"] == "sunny jawal", f"name was clobbered to {me['name']!r}"

    requests.delete(f"{API}/auth/me", headers=_h(t3), timeout=10)


def test_profile_save_rejects_digits_and_specials():
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    token = _login(phone, "x")
    addr = "12 Main Rd, Amravati 444601"

    for bad_name in ["User 4744", "John123", "John@", "_underscore", "a"]:
        r = requests.post(f"{API}/auth/profile", json={
            "name": bad_name, "phone": phone, "address": addr, "photo_url": "",
        }, headers=_h(token), timeout=10)
        assert r.status_code == 400, f"{bad_name!r} should have been rejected, got {r.status_code}"
        assert "letters only" in r.json()["detail"].lower(), r.json()

    # Sanity: a clean name still works
    r = requests.post(f"{API}/auth/profile", json={
        "name": "Sunny Jawal", "phone": phone, "address": addr, "photo_url": "",
    }, headers=_h(token), timeout=10)
    assert r.status_code == 200, r.text

    # And so do Indic scripts + hyphens + apostrophes
    for good in ["Mary-Jane", "D'Souza", "Dr. Smith", "रुषीकेश तामहाने"]:
        r = requests.post(f"{API}/auth/profile", json={
            "name": good, "phone": phone, "address": addr, "photo_url": "",
        }, headers=_h(token), timeout=10)
        assert r.status_code == 200, f"{good!r} should be allowed, got {r.text}"

    requests.delete(f"{API}/auth/me", headers=_h(token), timeout=10)
