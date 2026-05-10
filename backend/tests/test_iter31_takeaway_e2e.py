"""iter31 — End-to-end take-away tiffin pendency choreography.

Flow:
  1. Subscriber places a restaurant order with a returnable-tiffin item
  2. Payment verified (mock-mode)
  3. Admin marks order ready for pickup
  4. Rider claims + picks up
  5. Rider delivers (with delivery OTP)
  6. Admin sees the pendency row in /admin/restaurant/takeaway-pendency
"""
import os
import uuid
import pytest
import httpx
from datetime import datetime, timezone


pytestmark = pytest.mark.asyncio

API_BASE = os.environ.get("BACKEND_URL") or "http://localhost:8001"
API = f"{API_BASE}/api"


async def _otp_login(client, phone: str, name: str = "Test"):
    r = await client.post(f"{API}/auth/send-otp", json={"phone": phone})
    assert r.status_code == 200
    otp = r.json().get("dev_otp")
    assert otp, "dev_otp missing — backend must run with DEV_OTP=on"
    r = await client.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": name})
    assert r.status_code == 200
    return r.json()["session_token"], r.json()["user"]


async def _promote_to_role(phone: str, role: str):
    """Direct DB role bump — avoids needing seeded admin tokens for setup."""
    import sys; sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv; load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    await db.users.update_one({"phone": phone}, {"$set": {"role": role}})


async def test_takeaway_pendency_e2e_choreography():
    async with httpx.AsyncClient(timeout=30) as client:
        # 1. Subscriber
        sub_phone = f"99{datetime.now().strftime('%H%M%S')}{int(uuid.uuid4().int % 10000):04d}"[:10]
        sub_tok, sub_user = await _otp_login(client, sub_phone, "Pendency Sub")
        sub_h = {"Authorization": f"Bearer {sub_tok}"}

        # 2. Pull menu, pick a tiffin (returnable) item
        r = await client.get(f"{API}/restaurant/menu")
        assert r.status_code == 200
        items = r.json()["items"]
        tiffin = next((i for i in items if i.get("is_returnable_tiffin")), None)
        assert tiffin, "No returnable-tiffin item seeded in default menu"

        # 3. Place order with mock payment
        r = await client.post(
            f"{API}/restaurant/order",
            headers=sub_h,
            json={
                "items": [{"id": tiffin["id"], "qty": 2}],
                "name": "Pendency Sub",
                "phone": sub_phone,
                "address": "1 E2E Lane, Pune",
                "customer_lat": 18.52,
                "customer_lng": 73.85,
                "use_wallet": False,
            },
        )
        assert r.status_code == 200, r.text
        order = r.json()
        order_id = order["order_id"]

        # Verify mock payment
        r = await client.post(
            f"{API}/restaurant/verify",
            headers=sub_h,
            json={"order_id": order_id, "razorpay_payment_id": "pay_mock_e2e", "razorpay_order_id": "mock", "razorpay_signature": "mock"},
        )
        assert r.status_code == 200, r.text

        # 4. Admin — needs an admin user. Use ADMIN_PHONES if set, else promote ourselves.
        admin_phone = (os.environ.get("ADMIN_PHONES") or "").split(",")[0].strip() or sub_phone
        if admin_phone == sub_phone:
            await _promote_to_role(sub_phone, "admin")
            admin_tok, _ = sub_tok, None
        else:
            admin_tok, _ = await _otp_login(client, admin_phone, "Admin")
        admin_h = {"Authorization": f"Bearer {admin_tok}"}

        # Admin moves order to preparing → ready_for_pickup
        for status in ("preparing", "ready_for_pickup"):
            r = await client.post(f"{API}/admin/restaurant/orders/{order_id}/status", headers=admin_h, json={"status": status})
            assert r.status_code == 200, f"{status}: {r.text}"

        # 5. Rider — promote a fresh phone to rider
        rider_phone = f"99{(int(sub_phone[2:]) + 1) % 10**8:08d}"[:10]
        rider_tok, _ = await _otp_login(client, rider_phone, "Rider")
        await _promote_to_role(rider_phone, "rider")
        # Re-login so the session token reflects the new role
        rider_tok, _ = await _otp_login(client, rider_phone, "Rider")
        rider_h = {"Authorization": f"Bearer {rider_tok}"}

        # Claim available order (pickup auto-claims if rider_id is null)
        r = await client.post(f"{API}/rider/orders/{order_id}/pickup", headers=rider_h)
        assert r.status_code == 200, r.text

        # Rider arrives at customer location — generates delivery OTP
        r = await client.post(f"{API}/rider/orders/{order_id}/arrived", headers=rider_h)
        assert r.status_code == 200, r.text

        # Fetch delivery OTP — should now be exposed since status=out_for_delivery
        r = await client.get(f"{API}/restaurant/orders/{order_id}/track", headers=sub_h)
        assert r.status_code == 200
        delivery_otp = r.json().get("delivery_otp")
        assert delivery_otp and len(delivery_otp) == 4, f"OTP not exposed in out_for_delivery: {r.json()}"

        # Deliver
        r = await client.post(
            f"{API}/rider/orders/{order_id}/deliver",
            headers=rider_h,
            json={"otp": delivery_otp, "payment_mode": "online"},
        )
        assert r.status_code == 200, r.text

        # 6. Admin pendency list — should contain the new row
        r = await client.get(f"{API}/admin/restaurant/takeaway-pendency", headers=admin_h)
        assert r.status_code == 200
        rows = r.json()["rows"]
        match = next((row for row in rows if row.get("order_id") == order_id), None)
        assert match, f"Pendency row missing for {order_id} · got {len(rows)} rows"
        assert match["tiffin_count"] == 2
        assert match["phone"] == sub_phone
        assert match["collected"] is False

        # Cleanup — mark collected so the pendency doesn't accumulate across reruns
        r = await client.post(
            f"{API}/admin/restaurant/takeaway-pendency/collect",
            headers=admin_h,
            json={"pendency_id": match["pendency_id"], "notes": "E2E cleanup"},
        )
        assert r.status_code == 200
