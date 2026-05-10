"""iter31 — Persistent guest cart endpoints."""
import os
import uuid
import pytest
import httpx

pytestmark = pytest.mark.asyncio

API_BASE = os.environ.get("BACKEND_URL") or "http://localhost:8001"
API = f"{API_BASE}/api"


async def test_guest_cart_upsert_and_get_roundtrip():
    token = f"tok_{uuid.uuid4().hex}"  # > 8 chars
    cart = {"item_a": {"id": "item_a", "qty": 3}, "item_b": {"id": "item_b", "qty": 1}}

    async with httpx.AsyncClient(timeout=15) as client:
        # PUT
        r = await client.put(f"{API}/guest-cart", json={"token": token, "cart": cart})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["token"] == token
        assert body["count"] == 4

        # GET
        r = await client.get(f"{API}/guest-cart/{token}")
        assert r.status_code == 200
        body = r.json()
        assert body["cart"] == cart
        assert body["token"] == token
        assert "updated_at" in body

        # Overwrite with new cart
        new_cart = {"item_c": {"id": "item_c", "qty": 7}}
        r = await client.put(f"{API}/guest-cart", json={"token": token, "cart": new_cart})
        assert r.status_code == 200

        r = await client.get(f"{API}/guest-cart/{token}")
        assert r.status_code == 200
        assert r.json()["cart"] == new_cart

    # Cleanup
    import sys; sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv; load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    await db.guest_carts.delete_one({"token": token})


async def test_guest_cart_invalid_token_get_returns_400():
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{API}/guest-cart/short")  # <8 chars
        assert r.status_code == 400


async def test_guest_cart_invalid_token_put_returns_422_or_400():
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.put(f"{API}/guest-cart", json={"token": "abc", "cart": {}})
        # Pydantic min_length=8 → 422
        assert r.status_code in (400, 422)


async def test_guest_cart_unknown_token_returns_empty_cart():
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{API}/guest-cart/unknown_token_xyz123")
        assert r.status_code == 200
        assert r.json()["cart"] == {}
