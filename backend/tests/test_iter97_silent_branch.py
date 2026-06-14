"""iter-97 backend regression — silent branch detection + OTP dev echo.

Covers FRs:
  • /api/auth/send-otp still echoes dev_otp in dev_mode (frontend now hides it).
  • /api/auth/verify-otp + /auth/me end-to-end OTP login flow.
  • /api/messes lists branches; /api/messes/nearby returns nearest first.
  • /api/me/mess GET/POST silent auto-save still persists for logged-in users.
"""
import os
import time
import uuid

import pytest
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0]).rstrip("/")
API = f"{BASE}/api"


def _phone():
    # unique 10-digit
    return "98" + str(int(time.time()) % 100000000).zfill(8)


@pytest.fixture(scope="module")
def session_and_user():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    phone = _phone()
    r = s.post(f"{API}/auth/send-otp", json={"phone": phone})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "dev_otp" in data, "Backend MUST still echo dev_otp in dev_mode (FE just hides it)"
    otp = data["dev_otp"]
    name = f"TEST_IT97_{uuid.uuid4().hex[:6]}"
    r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name})
    assert r.status_code == 200, r.text
    body = r.json()
    user = body.get("user") or {}
    uid = user.get("id") or user.get("user_id")
    token = body.get("session_token")
    assert uid, f"verify-otp must return user id: {r.text}"
    if token:
        s.headers["Authorization"] = f"Bearer {token}"
        # Also set as cookie in case backend uses cookie auth
        s.cookies.set("session_token", token)
    return s, {**user, "id": uid}, phone, name


# === OTP dev echo (frontend hides banner — backend still emits) =============
class TestOtpDevEcho:
    def test_send_otp_returns_dev_otp(self):
        r = requests.post(f"{API}/auth/send-otp", json={"phone": _phone()})
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("dev_otp"), str) and len(body["dev_otp"]) >= 4

    def test_verify_otp_full_flow(self, session_and_user):
        s, user, _, name = session_and_user
        # /auth/me should return the freshly logged-in user
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200, r.text
        me = r.json()
        # Endpoint shape varies — accept either flat or {user:...}
        u = me.get("user") or me
        assert (u.get("id") or u.get("user_id")) == user["id"]


# === Messes & nearby ========================================================
class TestMessesNearby:
    def test_messes_list(self):
        r = requests.get(f"{API}/messes")
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("messes"), list) and len(body["messes"]) >= 1
        assert body.get("default_mess_id")

    def test_nearby_amravati_returns_amravati_first(self):
        r = requests.get(f"{API}/messes/nearby", params={"lat": 20.93, "lng": 77.75})
        assert r.status_code == 200
        body = r.json()
        assert body.get("closest_mess_id") == "efoodcare-amravati"
        first = body["messes"][0]
        assert first["mess_id"] == "efoodcare-amravati"
        assert first.get("distance_km") is not None


# === Silent /me/mess persistence ===========================================
class TestMeMessPersistence:
    def test_post_me_mess_persists(self, session_and_user):
        s, _user, _phone, _name = session_and_user
        # auto-save (silent flow): pick nearest, POST mess_id
        r = s.post(f"{API}/me/mess", json={"mess_id": "efoodcare-amravati"})
        assert r.status_code in (200, 201, 204), r.text
        # GET must echo back
        r = s.get(f"{API}/me/mess")
        assert r.status_code == 200, r.text
        body = r.json()
        mess = body.get("mess") or {}
        assert mess.get("mess_id") == "efoodcare-amravati", body
