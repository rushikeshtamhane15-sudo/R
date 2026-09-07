"""Mess reviews + geo top-5 discovery — iter-146.

Endpoints:
  POST   /api/messes/{mess_id}/reviews         → subscriber posts a 1-5 star review (one per user per mess)
  GET    /api/messes/{mess_id}/reviews         → list latest reviews (public)
  GET    /api/messes/nearby-top5               → top-5 messes near a pincode/lat-lng within 2km (pincode fallback)
  POST   /api/mess-owner/promote-featured      → mess owner records "I want to be featured" intent (payment in v2)

Rating is stored on each mess doc (`avg_rating`, `review_count`) so
list queries stay fast. Featured messes pin to slot 1-2.
"""
from __future__ import annotations

import math
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()


class ReviewIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    review: str = Field("", max_length=1000)


def _hav(a_lat, a_lng, b_lat, b_lng) -> float:
    R = 6371.0
    lat1, lat2 = math.radians(a_lat), math.radians(b_lat)
    dlat = lat2 - lat1
    dlng = math.radians(b_lng - a_lng)
    x = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(x), math.sqrt(1 - x))


async def _refresh_rating(mess_id: str) -> None:
    pipeline = [
        {"$match": {"mess_id": mess_id}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
    ]
    async for row in server.db.mess_reviews.aggregate(pipeline):
        await server.db.messes.update_one(
            {"mess_id": mess_id},
            {"$set": {"avg_rating": round(float(row["avg"]), 2), "review_count": int(row["count"])}},
        )
        return
    await server.db.messes.update_one({"mess_id": mess_id}, {"$set": {"avg_rating": 0.0, "review_count": 0}})


@router.post("/messes/{mess_id}/reviews")
async def post_review(mess_id: str, payload: ReviewIn, user: server.User = Depends(server.get_current_user)):
    mess = await server.db.messes.find_one({"mess_id": mess_id}, {"_id": 0, "mess_id": 1})
    if not mess:
        raise HTTPException(status_code=404, detail="Mess not found")
    doc = {
        "review_id": f"rev_{uuid.uuid4().hex[:12]}",
        "mess_id": mess_id,
        "user_id": user.user_id,
        "user_name": user.name,
        "user_picture": getattr(user, "picture", None) or getattr(user, "photo_url", None),
        "rating": int(payload.rating),
        "review": payload.review.strip(),
        "created_at": server.iso(server.now_utc()),
    }
    # One review per (mess, user) — upsert.
    await server.db.mess_reviews.update_one(
        {"mess_id": mess_id, "user_id": user.user_id},
        {"$set": doc},
        upsert=True,
    )
    await _refresh_rating(mess_id)
    return {"ok": True, "review": doc}


@router.get("/messes/{mess_id}/reviews")
async def list_reviews(mess_id: str, limit: int = 25):
    limit = max(1, min(200, int(limit)))
    rows = await server.db.mess_reviews.find({"mess_id": mess_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    agg = await server.db.messes.find_one({"mess_id": mess_id}, {"_id": 0, "avg_rating": 1, "review_count": 1}) or {}
    return {"reviews": rows, "avg_rating": agg.get("avg_rating", 0.0), "review_count": agg.get("review_count", 0)}


@router.get("/nearby/messes/top5")
async def nearby_top5(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    pincode: Optional[str] = None,
    radius_km: float = 2.0,
    limit: int = 5,
):
    """Top-5 messes within `radius_km` (default 2km) sorted by featured pin → rating → distance.

    Behaviour:
    - If lat/lng provided: strict 2 km Haversine radius.
    - Else if pincode: match `messes.pincode == pincode`.
    - Else: return the 5 highest-rated active messes as a soft fallback.
    """
    limit = max(1, min(20, int(limit)))
    q: dict = {"status": "active"}
    cursor = server.db.messes.find(q, {"_id": 0})
    items = await cursor.to_list(1000)
    scored = []
    for m in items:
        distance = None
        if lat is not None and lng is not None and m.get("lat") is not None and m.get("lng") is not None:
            try:
                distance = round(_hav(float(lat), float(lng), float(m["lat"]), float(m["lng"])), 3)
            except Exception:  # noqa: BLE001
                distance = None
        if lat is not None and lng is not None:
            if distance is None or distance > float(radius_km):
                continue
        elif pincode:
            if (m.get("pincode") or "").strip() != pincode.strip():
                continue
        scored.append({
            **m,
            "distance_km": distance,
            "is_featured": bool(m.get("is_featured")),
            "avg_rating": float(m.get("avg_rating") or 0),
            "review_count": int(m.get("review_count") or 0),
        })

    def sort_key(m):
        return (
            0 if m["is_featured"] else 1,
            -m["avg_rating"],
            m["distance_km"] if m["distance_km"] is not None else 999,
            -m["review_count"],
        )

    scored.sort(key=sort_key)
    return {
        "messes": scored[:limit],
        "total_in_radius": len(scored),
        "search_mode": "geo" if (lat is not None and lng is not None) else ("pincode" if pincode else "top-rated"),
    }


class FeatureRequestIn(BaseModel):
    plan_days: int = Field(30, ge=7, le=90)


@router.post("/mess-owner/promote-featured")
async def request_featured(payload: FeatureRequestIn, user: server.User = Depends(server.get_current_user)):
    """Mess owner records intent to be featured. Payment collection in v2 —
    for now we mark the mess as `featured_requested_at` and admin can approve."""
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Mess-owner portal only")
    if user.role == "admin":
        mess = await server.db.messes.find_one({"mess_id": server.DEFAULT_MESS_ID}, {"_id": 0})
    else:
        mess = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0})
    if not mess:
        raise HTTPException(status_code=403, detail="No mess assigned")
    await server.db.messes.update_one(
        {"mess_id": mess["mess_id"]},
        {"$set": {
            "featured_requested_at": server.iso(server.now_utc()),
            "featured_plan_days": int(payload.plan_days),
        }},
    )
    return {"ok": True, "message": "Your request is queued. We'll email you within 24 hours for payment.", "plan_days": int(payload.plan_days)}


@router.post("/admin/messes/{mess_id}/featured")
async def admin_set_featured(mess_id: str, on: bool = True, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.messes.update_one({"mess_id": mess_id}, {"$set": {"is_featured": bool(on)}})
    return {"ok": True, "mess_id": mess_id, "is_featured": bool(on)}
