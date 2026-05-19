"""Testimonials router — admin CRUD + public listing.

Extracted from server.py for readability. Mirrors the late-binding pattern
used by routes/payments.py and routes/auth.py: this module imports `server`
via `shared` so the route bodies can call server.* helpers without creating
a circular import.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from shared import server

router = APIRouter()


@router.get("/testimonials")
async def get_testimonials():
    """Public — landing page renders these. Returns only visible testimonials."""
    items = await server._load_testimonials()
    return {"items": [t for t in items if t.get("visible") is not False]}


@router.get("/admin/testimonials")
async def admin_get_testimonials(user: server.User = Depends(server.get_current_user)):
    """Admin sees ALL (incl. hidden) testimonials."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return {"items": await server._load_testimonials()}


@router.put("/admin/testimonials")
async def admin_set_testimonials(payload: server.TestimonialsPatch, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cleaned = []
    for i, t in enumerate(payload.items):
        # Allow data-URL images up to ~1.5 MB; URL paste is small
        img = t.image_url or ""
        if len(img) > 2_000_000:
            raise HTTPException(status_code=400, detail=f"Testimonial #{i+1} image is too large (max ~1.5 MB)")
        cleaned.append({
            "id": t.id or f"t_{uuid.uuid4().hex[:10]}",
            "name": (t.name or "").strip()[:80] or "Anonymous",
            "role": (t.role or "").strip()[:80],
            "quote": (t.quote or "").strip()[:600],
            "image_url": img.strip()[:2_000_000],
            "rating": max(1, min(5, int(t.rating) if t.rating is not None else 5)),
            "order": int(t.order if t.order is not None else i),
            "visible": bool(t.visible if t.visible is not None else True),
        })
    await server.db.testimonials_config.update_one(
        {"_id": "active"},
        {"$set": {"items": cleaned, "updated_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return {"items": await server._load_testimonials()}


@router.post("/admin/testimonials/reset")
async def admin_reset_testimonials(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.testimonials_config.update_one(
        {"_id": "active"},
        {"$set": {"items": server.TESTIMONIAL_DEFAULTS, "updated_at": server.iso(server.now_utc())}},
        upsert=True,
    )
    return {"items": await server._load_testimonials()}
