"""Customer-facing delivery routes (pending list, self-confirm, track boy).
Extracted from the original monolithic delivery.py.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from .shared import (
    _load_settings_db, haversine_m, iso, logger, now_utc, today_local,
)


def _nearest_neighbour_order(items: list, start_lat, start_lng) -> list:
    """Greedy nearest-neighbour ordering. Items without coords go to the end."""
    located = [it for it in items if it.get("customer_lat") and it.get("customer_lng")]
    unlocated = [it for it in items if not (it.get("customer_lat") and it.get("customer_lng"))]
    if not located:
        return items
    if start_lat is None or start_lng is None:
        # Start from the first item
        first = located.pop(0)
        ordered = [first]
        cur = (first["customer_lat"], first["customer_lng"])
    else:
        ordered = []
        cur = (start_lat, start_lng)
    while located:
        located.sort(key=lambda i: haversine_m(cur[0], cur[1], i["customer_lat"], i["customer_lng"]))
        nxt = located.pop(0)
        ordered.append(nxt)
        cur = (nxt["customer_lat"], nxt["customer_lng"])
    return ordered + unlocated


def make_customer_router(db) -> APIRouter:
    """Customer-facing endpoints — list pending deliveries + self-confirm + track boy."""
    from server import get_current_user, User  # type: ignore

    router = APIRouter(prefix="/my/deliveries", tags=["my-deliveries"])

    @router.get("/pending")
    async def my_pending(user: User = Depends(get_current_user)):
        """Pending tiffin deliveries for the current customer (today only)."""
        today = today_local()
        items = await db.daily_rosters.find(
            {"user_id": user.user_id, "date": today, "status": {"$in": ["planned", "out"]}},
            {"_id": 0, "otp": 0},
        ).to_list(20)
        items.sort(key=lambda x: 0 if x["meal_type"] == "lunch" else 1)
        return {"pending": items, "date": today}

    @router.post("/{roster_id}/confirm")
    async def my_confirm(roster_id: str, user: User = Depends(get_current_user)):
        item = await db.daily_rosters.find_one({"roster_id": roster_id}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Delivery not found")
        if item["user_id"] != user.user_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        if item["status"] == "delivered":
            return {"ok": True, "already": True}
        await db.daily_rosters.update_one(
            {"roster_id": roster_id},
            {"$set": {
                "status": "delivered",
                "delivered_at": iso(now_utc()),
                "confirmed_by": "customer",
            }},
        )
        return {"ok": True}

    @router.get("/track")
    async def track_my_delivery(user: User = Depends(get_current_user)):
        """Customer-side live tracking — returns delivery boy's current position + ETA."""
        d = today_local()
        item = await db.daily_rosters.find_one(
            {"user_id": user.user_id, "date": d, "status": {"$in": ["planned", "out"]}, "delivery_boy_id": {"$ne": None}},
            {"_id": 0, "otp": 0},
        )
        if not item:
            return {"tracking": False}
        boy = await db.delivery_boys.find_one({"boy_id": item["delivery_boy_id"]}, {"_id": 0})
        if not boy or not boy.get("current_lat"):
            return {"tracking": True, "boy_name": boy.get("name") if boy else None, "boy_position": None}
        # Estimate ETA at 25 km/h
        u = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
        eta_min = None
        distance_m = None
        if u and u.get("lat") and u.get("lng"):
            distance_m = haversine_m(boy["current_lat"], boy["current_lng"], u["lat"], u["lng"])
            eta_min = round(distance_m / 1000.0 / 25.0 * 60.0, 1)
        settings = await _load_settings_db(db)
        return {
            "tracking": True,
            "boy_name": boy.get("name"),
            "boy_phone": boy.get("phone"),
            "boy_position": {"lat": boy["current_lat"], "lng": boy["current_lng"], "last_ping_at": boy.get("last_ping_at")},
            "your_position": {"lat": u.get("lat"), "lng": u.get("lng")} if u else None,
            "distance_m": round(distance_m, 1) if distance_m is not None else None,
            "eta_minutes": eta_min,
            "meal_type": item["meal_type"],
            "tiffin_size": item.get("tiffin_size"),
            "status": item["status"],
            "dispatch": {
                "lat": settings.get("dispatch_lat"),
                "lng": settings.get("dispatch_lng"),
                "radius_km": settings.get("dispatch_radius_km") or 15,
            },
            "tiffin_balance": int((u or {}).get("tiffin_balance") or 0),
        }

    return router
