"""Empties inventory, geofence health, and live-map endpoints."""
from __future__ import annotations

import math
from datetime import timedelta

from fastapi import APIRouter, Body, Depends

from .shared import (
    CollectEmpty,
    _load_settings_db, _record_empty_collection_db, iso, now_utc, today_local,
)


def register(router: APIRouter, db, admin_only) -> None:
    @router.post("/empty/collect")
    async def admin_collect_empty(payload: CollectEmpty = Body(...), _=Depends(admin_only)):
        return await _record_empty_collection_db(
            db, payload.user_id, int(payload.count), payload.notes, source="admin",
        )

    @router.get("/empties")
    async def list_empties(_=Depends(admin_only)):
        users = await db.users.find(
            {"tiffin_balance": {"$gt": 0}},
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "address": 1,
             "pincode": 1, "tiffin_balance": 1, "lat": 1, "lng": 1},
        ).sort("tiffin_balance", -1).to_list(2000)
        total = sum(u.get("tiffin_balance", 0) for u in users)
        return {"users": users, "total_outstanding": total, "count": len(users)}

    @router.get("/health")
    async def geofence_health(_=Depends(admin_only)):
        """Last-7-days delivery attempt stats with a suggested geofence radius."""
        cutoff = iso(now_utc() - timedelta(days=7))
        attempts = await db.delivery_attempts.find({"ts": {"$gte": cutoff}}, {"_id": 0}).to_list(20000)
        total = len(attempts)
        rejected = [a for a in attempts if a["outcome"] == "rejected_too_far"]
        delivered = [a for a in attempts if a["outcome"] == "delivered"]
        rejection_rate = (len(rejected) / total) if total else 0.0
        # Suggest a radius that would have admitted ~95% of recent rejections
        # (P95 of their distances), rounded up to the nearest 5m.
        suggested = None
        if rejected:
            distances = sorted(r.get("distance_m", 0) for r in rejected)
            idx = max(0, min(len(distances) - 1, int(round(0.95 * (len(distances) - 1)))))
            suggested = int(math.ceil(distances[idx] / 5.0) * 5)
        settings = await _load_settings_db(db)
        current = int(settings.get("geofence_meters") or 10)
        return {
            "window_days": 7,
            "total_attempts": total,
            "delivered": len(delivered),
            "rejected_too_far": len(rejected),
            "rejection_rate": round(rejection_rate, 3),
            "current_geofence_m": current,
            "suggested_geofence_m": suggested,
            "show_hint": rejection_rate >= 0.25 and total >= 5,
        }

    @router.get("/live")
    async def live_map(_=Depends(admin_only)):
        """Live positions of every active delivery boy + today's roster overview."""
        d = today_local()
        boys = await db.delivery_boys.find({"active": True}, {"_id": 0}).to_list(500)
        items = await db.daily_rosters.find({"date": d}, {"_id": 0, "otp": 0}).to_list(20000)
        user_ids = list({i["user_id"] for i in items})
        users = {u["user_id"]: u async for u in db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0})}
        for it in items:
            u = users.get(it["user_id"]) or {}
            it["customer_lat"] = u.get("lat")
            it["customer_lng"] = u.get("lng")
            it["customer_pincode"] = u.get("pincode") or it.get("pincode")
            it["tiffin_balance"] = int(u.get("tiffin_balance") or 0)
        settings = await _load_settings_db(db)
        return {
            "date": d,
            "boys": boys,
            "items": items,
            "dispatch": {
                "lat": settings.get("dispatch_lat"),
                "lng": settings.get("dispatch_lng"),
                "radius_km": settings.get("dispatch_radius_km") or 15,
            },
        }
