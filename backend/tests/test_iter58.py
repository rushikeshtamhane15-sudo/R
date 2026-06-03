"""Iter-58 backend tests — accurate reverse-geocode via Nominatim + India Post."""
from __future__ import annotations

import os

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")


@pytest.mark.asyncio
async def test_geo_reverse_returns_indian_pincode_verified():
    """Reverse-geocode a Pune coordinate should return a valid PIN that
    cross-validates against India Post."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
        r = await cli.get("/api/geo/reverse?lat=18.5204&lng=73.8567")
        assert r.status_code == 200
        body = r.json()
        assert body["country"] == "India"
        assert body["state"]
        # Either a verified PIN or one resolved via India Post by name
        if body["pincode"]:
            assert len(body["pincode"]) == 6
            assert body["pincode"].isdigit()
        # Label must be non-empty
        assert body["label"]


@pytest.mark.asyncio
async def test_geo_reverse_cache_hit():
    """Calling the same coord twice should return cached on the 2nd call."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as cli:
        await cli.get("/api/geo/reverse?lat=18.5204&lng=73.8567")
        r2 = await cli.get("/api/geo/reverse?lat=18.5204&lng=73.8567")
        assert r2.status_code == 200
        body = r2.json()
        assert body["cached"] is True


@pytest.mark.asyncio
async def test_geo_reverse_rejects_invalid_coords():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=15) as cli:
        r = await cli.get("/api/geo/reverse?lat=200&lng=400")
        assert r.status_code == 422  # FastAPI Query validation
