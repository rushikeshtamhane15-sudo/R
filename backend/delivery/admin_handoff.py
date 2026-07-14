"""Handoff creation, item marking, and reconciliation endpoints."""
from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException

from .shared import (
    DEFAULT_SETTINGS, MEALS, HandoffCreate, MarkItem,
    _load_settings_db, compute_late_flag, haversine_m, iso, now_utc,
)


async def _handle_delivered_mark(db, roster_id: str, item: dict, payload: MarkItem, upd: dict) -> None:
    """Geofence-verify a delivered mark and record the attempt.

    Mutates `upd` in-place with distance/geofence fields. Raises HTTPException on failure.
    """
    settings = await _load_settings_db(db)
    if payload.lat is None or payload.lng is None:
        raise HTTPException(
            status_code=400,
            detail="Location required — please allow GPS access on the delivery boy's phone",
        )
    upd["delivery_lat"] = float(payload.lat)
    upd["delivery_lng"] = float(payload.lng)
    user = await db.users.find_one({"user_id": item["user_id"]}, {"_id": 0})
    if not user or user.get("lat") is None or user.get("lng") is None:
        raise HTTPException(
            status_code=400,
            detail="Customer hasn't pinned their location yet — ask them to open the app and tap 'Pin location'",
        )
    dist = haversine_m(payload.lat, payload.lng, user["lat"], user["lng"])
    upd["distance_m"] = round(dist, 1)
    geofence = float(settings.get("geofence_meters") or DEFAULT_SETTINGS["geofence_meters"])
    outcome_base = {
        "ts": iso(now_utc()),
        "distance_m": round(dist, 1),
        "geofence_meters": geofence,
        "roster_id": roster_id,
        "user_id": item["user_id"],
        "meal_type": item["meal_type"],
    }
    if dist > geofence:
        await db.delivery_attempts.insert_one({**outcome_base, "outcome": "rejected_too_far"})
        raise HTTPException(
            status_code=400,
            detail=f"You're {round(dist)}m away from the customer — geofence limit is {int(geofence)}m. Walk to the door and try again.",
        )
    await db.delivery_attempts.insert_one({**outcome_base, "outcome": "delivered"})
    upd["distance_warning"] = False


async def _debit_tiffin_stock(db, roster_id: str, item: dict) -> None:
    """Deduct one physical tiffin from raw stock when delivery completes."""
    await db.users.update_one({"user_id": item["user_id"]}, {"$inc": {"tiffin_balance": 1}})
    await db.tiffin_movements.insert_one({
        "ts": iso(now_utc()),
        "kind": "issued",
        "user_id": item["user_id"],
        "roster_id": roster_id,
        "meal_type": item["meal_type"],
        "delta": 1,
    })
    try:
        from routes.tiffin_stock import decrement_stock_db
        await decrement_stock_db(
            db, count=1,
            reason=f"Delivered to roster {roster_id} ({item['meal_type']})",
            source="admin-deliver", user_id=item["user_id"],
            mess_id=item.get("mess_id"),
        )
    except Exception:  # noqa: BLE001
        pass


def register(router: APIRouter, db, admin_only) -> None:
    @router.post("/handoff")
    async def create_handoff(payload: HandoffCreate = Body(...), _=Depends(admin_only)):
        if payload.meal_type not in MEALS:
            raise HTTPException(status_code=400, detail="meal_type must be lunch|dinner")
        # Local import to avoid pulling shared today_local into hot path unnecessarily.
        from .shared import today_local
        d = payload.date or today_local()
        boy = await db.delivery_boys.find_one({"boy_id": payload.delivery_boy_id}, {"_id": 0})
        if not boy:
            raise HTTPException(status_code=404, detail="Delivery boy not found")

        items = await db.daily_rosters.find(
            {"date": d, "meal_type": payload.meal_type, "roster_id": {"$in": payload.roster_ids}},
            {"_id": 0},
        ).to_list(5000)
        if len(items) != len(payload.roster_ids):
            raise HTTPException(status_code=400, detail="Some roster items not found / already handed off")
        already = [i for i in items if i.get("handoff_id")]
        if already:
            raise HTTPException(status_code=400, detail=f"{len(already)} items already in another handoff")
        # iter-131.14: staff must mark every item as `ready` before a handoff
        # can be created. This is what gates the boy's dispatch button.
        not_ready = [i for i in items if i["status"] not in ("ready", "out", "delivered")]
        if not_ready:
            raise HTTPException(
                status_code=400,
                detail=f"{len(not_ready)} tiffins are not yet ready. Ask the kitchen to mark them ready first.",
            )

        expected_full = sum(1 for i in items if i.get("tiffin_size") == "full")
        expected_half = sum(1 for i in items if i.get("tiffin_size") == "half")
        taken_full = int(payload.tiffins_taken_full)
        taken_half = int(payload.tiffins_taken_half)

        handoff_id = f"hdf_{uuid4().hex[:12]}"
        handoff = {
            "handoff_id": handoff_id,
            "date": d,
            "meal_type": payload.meal_type,
            "delivery_boy_id": payload.delivery_boy_id,
            "delivery_boy_name": boy["name"],
            "roster_ids": payload.roster_ids,
            "expected_full": expected_full,
            "expected_half": expected_half,
            "expected_total": expected_full + expected_half,
            "tiffins_taken_full": taken_full,
            "tiffins_taken_half": taken_half,
            "tiffins_taken_total": taken_full + taken_half,
            "extra_taken": max(0, taken_full - expected_full) + max(0, taken_half - expected_half),
            "status": "out",       # out | reconciled
            "delivered_count": 0,
            "returned_count": 0,
            "loss_count": 0,
            "handed_over_at": iso(now_utc()),
            "reconciled_at": None,
            "notes": "",
        }
        await db.delivery_handoffs.insert_one(handoff.copy())
        await db.daily_rosters.update_many(
            {"roster_id": {"$in": payload.roster_ids}},
            {"$set": {"handoff_id": handoff_id, "delivery_boy_id": payload.delivery_boy_id, "status": "out"}},
        )
        return handoff

    @router.get("/handoff/{handoff_id}")
    async def get_handoff(handoff_id: str, _=Depends(admin_only)):
        h = await db.delivery_handoffs.find_one({"handoff_id": handoff_id}, {"_id": 0})
        if not h:
            raise HTTPException(status_code=404, detail="Handoff not found")
        items = await db.daily_rosters.find(
            {"roster_id": {"$in": h["roster_ids"]}}, {"_id": 0}
        ).to_list(5000)
        items.sort(key=lambda x: (x.get("pincode", ""), (x.get("name") or "").lower()))
        return {**h, "items": items}

    @router.post("/roster/{roster_id}/mark")
    async def mark_item(roster_id: str, payload: MarkItem = Body(...), _=Depends(admin_only)):
        if payload.status not in ("delivered", "undelivered", "returned"):
            raise HTTPException(status_code=400, detail="status must be delivered|undelivered|returned")
        item = await db.daily_rosters.find_one({"roster_id": roster_id}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Roster item not found")
        now_iso = iso(now_utc())
        upd: dict = {
            "status": payload.status,
            "delivered_at": now_iso if payload.status == "delivered" else None,
        }
        if payload.notes:
            upd["notes"] = payload.notes

        if payload.status == "delivered":
            upd["confirmed_by"] = "admin"
            # iter-131.16: flag late deliveries against the user's window.
            late, late_by = compute_late_flag(item.get("pref_end"), now_iso)
            upd["delivered_late"] = late
            upd["delivered_late_by"] = late_by
            await _handle_delivered_mark(db, roster_id, item, payload, upd)

        await db.daily_rosters.update_one({"roster_id": roster_id}, {"$set": upd})
        if payload.status == "delivered" and item["status"] != "delivered":
            await _debit_tiffin_stock(db, roster_id, item)
        return {"ok": True, **upd}

    @router.post("/handoff/{handoff_id}/reconcile")
    async def reconcile_handoff(handoff_id: str, payload: dict = Body(default=None), _=Depends(admin_only)):
        h = await db.delivery_handoffs.find_one({"handoff_id": handoff_id}, {"_id": 0})
        if not h:
            raise HTTPException(status_code=404, detail="Handoff not found")
        items = await db.daily_rosters.find({"roster_id": {"$in": h["roster_ids"]}}, {"_id": 0}).to_list(5000)
        delivered = sum(1 for i in items if i["status"] == "delivered")
        returned = sum(1 for i in items if i["status"] in ("returned", "undelivered"))
        unaccounted = sum(1 for i in items if i["status"] not in ("delivered", "returned", "undelivered"))
        # Loss = tiffins_taken_total - delivered - returned (never negative).
        loss = max(0, int(h["tiffins_taken_total"]) - delivered - returned)
        notes = (payload or {}).get("notes", "")
        upd = {
            "status": "reconciled",
            "delivered_count": delivered,
            "returned_count": returned,
            "unaccounted_count": unaccounted,
            "loss_count": loss,
            "reconciled_at": iso(now_utc()),
            "notes": notes,
        }
        await db.delivery_handoffs.update_one({"handoff_id": handoff_id}, {"$set": upd})
        return {**h, **upd}
