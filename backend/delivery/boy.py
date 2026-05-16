"""Delivery-boy-facing routes (today's assignments, location ping, dispatch).
Extracted from the original monolithic delivery.py.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .customer import _nearest_neighbour_order
from .shared import (
    MEALS, CollectEmpty, DispatchStart, LocationPing, MarkItem,
    _ist_now, _load_settings_db, _record_empty_collection_db, _slot_open_now,
    haversine_m, iso, logger, now_utc, today_local,
)


def make_boy_router(db) -> APIRouter:
    """Endpoints used by the delivery-boy app: today's assignments, location ping, dispatch."""
    from server import get_current_user, User  # type: ignore

    router = APIRouter(prefix="/boy", tags=["delivery-boy"])

    async def _load_settings_local() -> dict:
        return await _load_settings_db(db)

    async def _resolve_boy(user: User) -> dict:
        boy = await db.delivery_boys.find_one({"user_id": user.user_id}, {"_id": 0})
        if not boy:
            raise HTTPException(status_code=403, detail="Not registered as a delivery boy")
        return boy

    @router.get("/me")
    async def me(user: User = Depends(get_current_user)):
        boy = await _resolve_boy(user)
        return boy

    @router.get("/slots")
    async def slot_status(user: User = Depends(get_current_user)):
        await _resolve_boy(user)
        s = await _load_settings_local()
        out = {}
        for meal in MEALS:
            ok, reason = _slot_open_now(s, meal)
            out[meal] = {
                "open": ok,
                "reason": reason,
                "window": {
                    "open_at": s.get(f"{meal}_dispatch_open"),
                    "close_at": s.get(f"{meal}_dispatch_close"),
                },
            }
        return {"slots": out, "now_ist": _ist_now().strftime("%H:%M")}

    @router.get("/today")
    async def today(user: User = Depends(get_current_user)):
        """Today's deliveries assigned to this boy + nearest-neighbour route order."""
        boy = await _resolve_boy(user)
        d = today_local()
        # Either pull items already in a handoff to this boy, OR items in any of his pincodes (preview before dispatch)
        handoff_items = await db.daily_rosters.find(
            {"date": d, "delivery_boy_id": boy["boy_id"]}, {"_id": 0}
        ).to_list(5000)
        if handoff_items:
            items = handoff_items
        else:
            pincodes = boy.get("assigned_pincodes") or []
            items = await db.daily_rosters.find(
                {"date": d, "pincode": {"$in": pincodes}, "is_outside": {"$ne": True}}, {"_id": 0}
            ).to_list(5000)
        # Attach customer locations + tiffin debt
        user_ids = list({i["user_id"] for i in items})
        users = {u["user_id"]: u async for u in db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0})}
        for it in items:
            u = users.get(it["user_id"]) or {}
            it["customer_lat"] = u.get("lat")
            it["customer_lng"] = u.get("lng")
            it["customer_pincode"] = u.get("pincode") or it.get("pincode")
            it["tiffin_balance"] = int(u.get("tiffin_balance") or 0)
        # Nearest-neighbour route order from boy's current position (or from first item if unknown)
        ordered = _nearest_neighbour_order(items, boy.get("current_lat"), boy.get("current_lng"))
        settings = await _load_settings_local()
        return {
            "date": d,
            "boy": boy,
            "items": ordered,
            "totals": {
                "total": len(items),
                "full": sum(1 for i in items if i.get("tiffin_size") == "full"),
                "half": sum(1 for i in items if i.get("tiffin_size") == "half"),
                "delivered": sum(1 for i in items if i.get("status") == "delivered"),
                "pending": sum(1 for i in items if i.get("status") in ("planned", "out")),
            },
            "dispatch": {
                "lat": settings.get("dispatch_lat"),
                "lng": settings.get("dispatch_lng"),
                "radius_km": settings.get("dispatch_radius_km") or 15,
            },
        }

    @router.post("/location")
    async def location_ping(payload: LocationPing = Body(...), user: User = Depends(get_current_user)):
        boy = await _resolve_boy(user)
        # Sanity-check coords so a buggy/unset GPS can't pollute the live map.
        if not (-90 <= payload.lat <= 90) or not (-180 <= payload.lng <= 180):
            raise HTTPException(status_code=400, detail="Invalid GPS coordinates")
        await db.delivery_boys.update_one(
            {"boy_id": boy["boy_id"]},
            {"$set": {
                "current_lat": float(payload.lat),
                "current_lng": float(payload.lng),
                "current_accuracy": float(payload.accuracy or 0),
                "last_ping_at": iso(now_utc()),
            }},
        )
        return {"ok": True}

    @router.post("/dispatch/start")
    async def dispatch_start(payload: DispatchStart = Body(...), user: User = Depends(get_current_user)):
        """Boy taps 'Start dispatch' — claims all unassigned items in his pincodes for today."""
        if payload.meal_type not in MEALS:
            raise HTTPException(status_code=400, detail="meal_type must be lunch|dinner")
        boy = await _resolve_boy(user)
        # Hard slot-window lock — guards against accidental wrong-slot dispatches
        settings = await _load_settings_local()
        is_open, reason = _slot_open_now(settings, payload.meal_type)
        if not is_open:
            raise HTTPException(status_code=400, detail=reason)
        d = today_local()
        pincodes = boy.get("assigned_pincodes") or []
        if not pincodes:
            raise HTTPException(status_code=400, detail="No pincodes assigned. Ask admin to assign your delivery zones.")
        unassigned = await db.daily_rosters.find(
            {"date": d, "meal_type": payload.meal_type,
             "pincode": {"$in": pincodes},
             "is_outside": {"$ne": True},
             "delivery_boy_id": None,
             "status": "planned"},
            {"_id": 0},
        ).to_list(5000)
        if not unassigned:
            raise HTTPException(status_code=400, detail="No tiffins available to dispatch in your zones right now.")
        full = sum(1 for i in unassigned if i.get("tiffin_size") == "full")
        half = sum(1 for i in unassigned if i.get("tiffin_size") == "half")
        handoff_id = f"hdf_{uuid4().hex[:12]}"
        roster_ids = [i["roster_id"] for i in unassigned]
        handoff = {
            "handoff_id": handoff_id,
            "date": d,
            "meal_type": payload.meal_type,
            "delivery_boy_id": boy["boy_id"],
            "delivery_boy_name": boy["name"],
            "roster_ids": roster_ids,
            "expected_full": full, "expected_half": half, "expected_total": full + half,
            "tiffins_taken_full": full, "tiffins_taken_half": half, "tiffins_taken_total": full + half,
            "extra_taken": 0,
            "status": "out",
            "delivered_count": 0, "returned_count": 0, "loss_count": 0,
            "handed_over_at": iso(now_utc()),
            "reconciled_at": None,
            "self_dispatched": True,
            "notes": "",
        }
        await db.delivery_handoffs.insert_one(handoff.copy())
        await db.daily_rosters.update_many(
            {"roster_id": {"$in": roster_ids}},
            {"$set": {"handoff_id": handoff_id, "delivery_boy_id": boy["boy_id"], "status": "out"}},
        )
        await db.delivery_boys.update_one({"boy_id": boy["boy_id"]}, {"$set": {"on_trip": True, "trip_handoff_id": handoff_id}})
        return handoff

    @router.post("/dispatch/end")
    async def dispatch_end(user: User = Depends(get_current_user)):
        boy = await _resolve_boy(user)
        if not boy.get("on_trip"):
            return {"ok": True, "already": True}
        # Auto-reconcile the trip's handoff so it doesn't sit at 'out' forever.
        handoff_id = boy.get("trip_handoff_id")
        reconciled = None
        if handoff_id:
            h = await db.delivery_handoffs.find_one({"handoff_id": handoff_id}, {"_id": 0})
            if h and h.get("status") != "reconciled":
                items = await db.daily_rosters.find({"roster_id": {"$in": h["roster_ids"]}}, {"_id": 0}).to_list(5000)
                delivered = sum(1 for i in items if i["status"] == "delivered")
                returned = sum(1 for i in items if i["status"] in ("returned", "undelivered"))
                unaccounted = sum(1 for i in items if i["status"] not in ("delivered", "returned", "undelivered"))
                loss = max(0, int(h["tiffins_taken_total"]) - delivered - returned)
                upd = {
                    "status": "reconciled",
                    "delivered_count": delivered,
                    "returned_count": returned,
                    "unaccounted_count": unaccounted,
                    "loss_count": loss,
                    "reconciled_at": iso(now_utc()),
                    "auto_reconciled": True,
                }
                await db.delivery_handoffs.update_one({"handoff_id": handoff_id}, {"$set": upd})
                reconciled = {**h, **upd}
        await db.delivery_boys.update_one({"boy_id": boy["boy_id"]}, {"$set": {"on_trip": False, "trip_handoff_id": None}})
        return {"ok": True, "reconciled": reconciled}

    @router.post("/empty/collect")
    async def boy_collect_empty(payload: CollectEmpty = Body(...), user: User = Depends(get_current_user)):
        await _resolve_boy(user)
        return await _record_empty_collection_db(db, payload.user_id, int(payload.count), payload.notes, source="boy")

    @router.get("/empties")
    async def boy_outstanding(user: User = Depends(get_current_user)):
        """Customers with outstanding empty tiffins in this boy's pincodes — surface on next visit."""
        boy = await _resolve_boy(user)
        pins = boy.get("assigned_pincodes") or []
        q = {"tiffin_balance": {"$gt": 0}}
        if pins:
            q["pincode"] = {"$in": pins}
        users = await db.users.find(
            q,
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "address": 1, "pincode": 1, "tiffin_balance": 1, "lat": 1, "lng": 1},
        ).sort("tiffin_balance", -1).to_list(2000)
        return {"users": users, "count": len(users)}

    return router
