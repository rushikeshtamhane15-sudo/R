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
    """iter-147: only visible (non-hidden) reviews count toward the aggregate."""
    pipeline = [
        {"$match": {"mess_id": mess_id, "$or": [{"hidden": {"$exists": False}}, {"hidden": False}]}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
    ]
    async for row in server.db.mess_reviews.aggregate(pipeline):
        # iter-147 · trusted-badge rule: 20+ visible reviews with 4.0+ average.
        avg = round(float(row["avg"]), 2)
        count = int(row["count"])
        await server.db.messes.update_one(
            {"mess_id": mess_id},
            {"$set": {
                "avg_rating": avg,
                "review_count": count,
                "is_trusted": bool(count >= 20 and avg >= 4.0),
            }},
        )
        return
    await server.db.messes.update_one(
        {"mess_id": mess_id},
        {"$set": {"avg_rating": 0.0, "review_count": 0, "is_trusted": False}},
    )


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
    # iter-147: exclude hidden reviews from public listing
    q = {"mess_id": mess_id, "$or": [{"hidden": {"$exists": False}}, {"hidden": False}]}
    rows = await server.db.mess_reviews.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
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


# ============================================================================
# iter-147 · Featured payment flow — mess owner pays ₹499 for 30-day slot-1 pin.
# ============================================================================
FEATURED_PLAN_AMOUNT_INR = 499
FEATURED_PLAN_DAYS = 30


@router.post("/mess-owner/featured/create-order")
async def featured_create_order(user: server.User = Depends(server.get_current_user)):
    """Create a Razorpay order for the ₹499 · 30-day 'featured slot 1' add-on.
    Uses the mess's own Razorpay keys if configured, else platform keys (so
    even messes still on platform keys can buy featuring)."""
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Mess-owner portal only")
    if user.role == "admin":
        mess = await server.db.messes.find_one({"mess_id": server.DEFAULT_MESS_ID}, {"_id": 0})
    else:
        mess = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0})
    if not mess:
        raise HTTPException(status_code=403, detail="No mess assigned")
    active_client, key_id, _using_mess = await server._resolve_razorpay_for_user({"mess_id": mess["mess_id"]})
    amount_paise = FEATURED_PLAN_AMOUNT_INR * 100
    receipt = f"feat_{server.uuid.uuid4().hex[:14]}"
    rzp_order = None
    if active_client is not None:
        try:
            rzp_order = active_client.order.create({
                "amount": amount_paise, "currency": "INR", "receipt": receipt,
                "payment_capture": 1,
                "notes": {"mess_id": mess["mess_id"], "kind": "featured_30_slot1"},
            })
        except Exception as e:  # noqa: BLE001
            import logging
            logging.getLogger("efoodcare").warning(f"[FEATURED] order.create failed → mock · {e}")
            rzp_order = None
    order_id = rzp_order["id"] if rzp_order else f"order_mock_{server.uuid.uuid4().hex[:12]}"
    mock = rzp_order is None
    await server.db.featured_orders.insert_one({
        "order_id": order_id,
        "receipt": receipt,
        "mess_id": mess["mess_id"],
        "user_id": user.user_id,
        "amount": FEATURED_PLAN_AMOUNT_INR,
        "amount_paise": amount_paise,
        "currency": "INR",
        "plan_days": FEATURED_PLAN_DAYS,
        "status": "created",
        "mock": mock,
        "created_at": server.iso(server.now_utc()),
    })
    return {
        "order_id": order_id, "amount_paise": amount_paise, "amount": FEATURED_PLAN_AMOUNT_INR,
        "currency": "INR", "key_id": key_id or "rzp_test_MOCK", "mock": mock,
        "plan_days": FEATURED_PLAN_DAYS, "receipt": receipt,
        "prefill": {"name": mess.get("name", ""), "email": mess.get("owner_email", ""), "contact": mess.get("owner_phone", "")},
    }


class FeaturedVerifyIn(BaseModel):
    order_id: str
    payment_id: Optional[str] = ""
    signature: Optional[str] = ""


@router.post("/mess-owner/featured/verify")
async def featured_verify(payload: FeaturedVerifyIn, user: server.User = Depends(server.get_current_user)):
    """Verify + activate a featured order. Accepts either signed Razorpay
    response (production) OR a mocked order (dev)."""
    order = await server.db.featured_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("user_id") != user.user_id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Not your order")
    # If it's a real Razorpay order, verify signature.
    if not order.get("mock") and payload.signature:
        import hmac
        import hashlib
        mess = await server.db.messes.find_one({"mess_id": order["mess_id"]}, {"_id": 0, "razorpay_key_secret": 1})
        secret = (mess or {}).get("razorpay_key_secret") or server.RZP_SECRET
        body_str = f"{payload.order_id}|{payload.payment_id}"
        computed = hmac.new(secret.encode(), body_str.encode(), hashlib.sha256).hexdigest()
        if computed != payload.signature:
            raise HTTPException(status_code=400, detail="Invalid Razorpay signature")
    from datetime import timedelta as _td
    featured_until = server.now_utc() + _td(days=int(order.get("plan_days", FEATURED_PLAN_DAYS)))
    await server.db.messes.update_one(
        {"mess_id": order["mess_id"]},
        {"$set": {
            "is_featured": True,
            "featured_until": server.iso(featured_until),
            "featured_activated_at": server.iso(server.now_utc()),
        }},
    )
    await server.db.featured_orders.update_one(
        {"order_id": payload.order_id},
        {"$set": {"status": "paid", "payment_id": payload.payment_id or "", "paid_at": server.iso(server.now_utc())}},
    )
    return {"ok": True, "featured_until": server.iso(featured_until), "mess_id": order["mess_id"]}


# ============================================================================
# iter-147 · Review moderation — super-admin inbox to hide abusive reviews.
# ============================================================================
@router.get("/admin/reviews")
async def admin_list_reviews(
    limit: int = 200,
    hidden: Optional[bool] = None,
    user: server.User = Depends(server.get_current_user),
):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    q: dict = {}
    if hidden is True:
        q["hidden"] = True
    elif hidden is False:
        q["$or"] = [{"hidden": {"$exists": False}}, {"hidden": False}]
    rows = await server.db.mess_reviews.find(q, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(500, int(limit))))
    # Attach mess names
    mess_ids = list({r.get("mess_id") for r in rows if r.get("mess_id")})
    mmap = {}
    if mess_ids:
        async for m in server.db.messes.find({"mess_id": {"$in": mess_ids}}, {"_id": 0, "mess_id": 1, "name": 1}):
            mmap[m["mess_id"]] = m.get("name")
    for r in rows:
        r["mess_name"] = mmap.get(r.get("mess_id"), "—")
    return {"reviews": rows, "count": len(rows)}


@router.post("/admin/reviews/{review_id}/toggle-hidden")
async def admin_toggle_review_hidden(review_id: str, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    rev = await server.db.mess_reviews.find_one({"review_id": review_id}, {"_id": 0})
    if not rev:
        raise HTTPException(status_code=404, detail="Review not found")
    next_hidden = not bool(rev.get("hidden"))
    await server.db.mess_reviews.update_one(
        {"review_id": review_id},
        {"$set": {"hidden": next_hidden, "hidden_at": server.iso(server.now_utc()) if next_hidden else None,
                  "hidden_by": user.user_id if next_hidden else None}},
    )
    # Recompute the aggregate (visible reviews only)
    await _refresh_rating(rev["mess_id"])
    return {"ok": True, "review_id": review_id, "hidden": next_hidden}


# ============================================================================
# iter-147 · Verified badge — super-admin manual verify.
# ============================================================================
@router.post("/admin/messes/{mess_id}/verified")
async def admin_set_verified(mess_id: str, on: bool = True, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.messes.update_one(
        {"mess_id": mess_id},
        {"$set": {"is_verified": bool(on), "verified_at": server.iso(server.now_utc()) if on else None}},
    )
    return {"ok": True, "mess_id": mess_id, "is_verified": bool(on)}
