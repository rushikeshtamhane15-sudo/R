"""Admin-facing delivery routes (settings, roster, handoffs, reconciliation).
Extracted from the original monolithic delivery.py.
"""
from __future__ import annotations

import math
from datetime import date as date_cls, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .shared import (
    DEFAULT_SETTINGS, MEALS, SettingsPatch, CollectEmpty, BoyCreate, BoyPatch,
    HandoffCreate, MarkItem,
    _load_settings_db, _record_empty_collection_db, _slot_open_now,
    extract_pincode, gen_otp, haversine_m, iso, logger, now_utc, parse_dt,
    today_local,
)


def make_router(db) -> APIRouter:
    """Build and return the delivery API router. Imports `get_current_user` lazily
    via `auth_dep` injected from server.py to avoid circular imports."""
    from server import get_current_user, User  # type: ignore

    router = APIRouter(prefix="/admin/delivery", tags=["delivery"])

    async def admin_only(user: User = Depends(get_current_user)) -> User:
        if user.role not in ("admin", "franchise_owner"):
            raise HTTPException(status_code=403, detail="Admin only")
        return user

    # ---- settings ----
    async def _load_settings() -> dict:
        return await _load_settings_db(db)

    async def _record_empty_collection(user_id: str, count: int, notes: str | None, source: str):
        return await _record_empty_collection_db(db, user_id, count, notes, source)

    @router.get("/settings")
    async def get_settings(_=Depends(admin_only)):
        return await _load_settings()

    @router.patch("/settings")
    async def patch_settings(payload: SettingsPatch = Body(...), _=Depends(admin_only)):
        cur = await _load_settings()
        patch = {k: v for k, v in payload.dict(exclude_none=True).items()}
        if "service_pincodes" in patch:
            patch["service_pincodes"] = [str(p).strip() for p in patch["service_pincodes"] if str(p).strip()]
        cur.update(patch)
        await db.delivery_settings.update_one({"_id": "active"}, {"$set": patch}, upsert=True)
        return cur

    # ---- delivery boys ----
    @router.get("/boys")
    async def list_boys(_=Depends(admin_only)):
        boys = await db.delivery_boys.find({}, {"_id": 0}).sort("name", 1).to_list(500)
        return {"boys": boys}

    @router.post("/boys")
    async def create_boy(payload: BoyCreate = Body(...), _=Depends(admin_only)):
        # If a user with this phone already exists, reuse it; otherwise create one with role=delivery_boy
        existing_user = await db.users.find_one({"phone": payload.phone.strip()}, {"_id": 0})
        if existing_user:
            user_id = existing_user["user_id"]
            await db.users.update_one(
                {"user_id": user_id},
                {"$set": {"role": "delivery_boy", "name": payload.name.strip()}},
            )
        else:
            from server import _create_user_for_phone  # type: ignore
            new_user = await _create_user_for_phone(payload.phone.strip(), payload.name.strip(), role="delivery_boy")
            user_id = new_user["user_id"]
        boy = {
            "boy_id": f"dlv_{uuid4().hex[:10]}",
            "user_id": user_id,
            "name": payload.name.strip(),
            "phone": payload.phone.strip(),
            "assigned_pincodes": [str(p).strip() for p in payload.assigned_pincodes if str(p).strip()],
            "active": payload.active,
            "current_lat": None, "current_lng": None, "last_ping_at": None,
            "on_trip": False, "trip_handoff_id": None,
            "created_at": iso(now_utc()),
        }
        await db.delivery_boys.insert_one(boy.copy())
        return boy

    @router.patch("/boys/{boy_id}")
    async def patch_boy(boy_id: str, payload: BoyPatch = Body(...), _=Depends(admin_only)):
        patch = {k: v for k, v in payload.dict(exclude_none=True).items()}
        if "assigned_pincodes" in patch:
            patch["assigned_pincodes"] = [str(p).strip() for p in patch["assigned_pincodes"] if str(p).strip()]
        if not patch:
            raise HTTPException(status_code=400, detail="Nothing to update")
        r = await db.delivery_boys.update_one({"boy_id": boy_id}, {"$set": patch})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Boy not found")
        return await db.delivery_boys.find_one({"boy_id": boy_id}, {"_id": 0})

    @router.delete("/boys/{boy_id}")
    async def delete_boy(boy_id: str, _=Depends(admin_only)):
        await db.delivery_boys.delete_one({"boy_id": boy_id})
        return {"ok": True}

    # ---- roster generation ----
    async def _generate_roster_for_date(date_str: str) -> dict:
        """Idempotent — won't duplicate items already present."""
        settings = await _load_settings()
        service_pins = set(settings.get("service_pincodes") or [])
        # Find all active subscriptions whose plan is delivery type
        subs = await db.subscriptions.find({"status": "active"}, {"_id": 0}).to_list(10000)
        plans = {p["plan_id"]: p async for p in db.plans.find({}, {"_id": 0})}
        users = {u["user_id"]: u async for u in db.users.find({}, {"_id": 0})}

        target = date_cls.fromisoformat(date_str)
        created_lunch = created_dinner = 0

        for sub in subs:
            plan = plans.get(sub["plan_id"]) or {}
            service = sub.get("service_type") or plan.get("service_type") or ("tiffin" if plan.get("plan_type") == "delivery" else "dining")
            if service != "tiffin":
                continue   # eat-in subscribers don't get tiffin delivery
            if sub.get("user_paused"):
                continue   # subscriber paused their tiffin — skip dispatch
            try:
                start = parse_dt(sub["start_date"]).date()
                end = parse_dt(sub["end_date"]).date()
            except Exception:
                continue
            if not (start <= target <= end):
                continue
            user = users.get(sub["user_id"]) or {}
            address = user.get("address") or ""
            pincode = extract_pincode(address)
            is_outside = bool(service_pins) and (pincode != "unknown") and (pincode not in service_pins)
            base = {
                "user_id": sub["user_id"],
                "sub_id": sub["sub_id"],
                "plan_id": sub["plan_id"],
                "plan_name": plan.get("name") or sub["plan_id"],
                "tiffin_size": plan.get("tiffin_size") or "full",
                "name": user.get("name") or "—",
                "phone": user.get("phone") or "",
                "address": address,
                "pincode": pincode,
                "is_outside": is_outside,
                "is_unknown_pincode": pincode == "unknown",
                "date": date_str,
                "created_at": iso(now_utc()),
            }
            for meal in MEALS:
                # Iter-51: tiffin subs with a meal_window of "lunch" or
                # "dinner" only get a single dispatch entry per day. "both"
                # (the default) keeps the legacy 2-meal behaviour.
                window = (sub.get("meal_window") or plan.get("meal_window") or "both").lower()
                if window in ("lunch", "dinner") and meal != window:
                    continue
                exists = await db.daily_rosters.find_one(
                    {"date": date_str, "meal_type": meal, "sub_id": sub["sub_id"]}, {"_id": 0}
                )
                if exists:
                    continue
                doc = {
                    **base,
                    "roster_id": f"rst_{uuid4().hex[:12]}",
                    "meal_type": meal,
                    "status": "planned",
                    "delivery_boy_id": None,
                    "handoff_id": None,
                    "otp": gen_otp(),
                    "delivered_at": None,
                    "notes": "",
                    # Iter-52: snapshot the user's tiffin food preferences
                    # so dispatch staff packs exactly what was requested.
                    # Reads back via the existing /admin/delivery/roster
                    # endpoint without schema changes.
                    "tiffin_preferences": sub.get("tiffin_preferences") or None,
                }
                await db.daily_rosters.insert_one(doc.copy())
                if meal == "lunch":
                    created_lunch += 1
                else:
                    created_dinner += 1
        return {"date": date_str, "created_lunch": created_lunch, "created_dinner": created_dinner}

    @router.post("/generate")
    async def generate_roster(date: str | None = Query(None), _=Depends(admin_only)):
        d = date or today_local()
        return await _generate_roster_for_date(d)

    @router.get("/today")
    async def today_summary(date: str | None = Query(None), _=Depends(admin_only)):
        d = date or today_local()
        # auto-generate if empty
        cnt = await db.daily_rosters.count_documents({"date": d})
        gen_info = None
        if cnt == 0:
            gen_info = await _generate_roster_for_date(d)
        items = await db.daily_rosters.find({"date": d}, {"_id": 0}).to_list(20000)
        settings = await _load_settings()

        def _bucket(meal: str) -> dict:
            meal_items = [it for it in items if it["meal_type"] == meal]
            full = [it for it in meal_items if it.get("tiffin_size") == "full"]
            half = [it for it in meal_items if it.get("tiffin_size") == "half"]
            outside = [it for it in meal_items if it.get("is_outside")]
            unknown = [it for it in meal_items if it.get("is_unknown_pincode")]
            # group by pincode
            groups: dict[str, list[dict]] = {}
            for it in meal_items:
                groups.setdefault(it["pincode"], []).append(it)
            group_summaries = [
                {
                    "pincode": pc,
                    "count": len(g),
                    "full": sum(1 for x in g if x.get("tiffin_size") == "full"),
                    "half": sum(1 for x in g if x.get("tiffin_size") == "half"),
                    "is_outside": pc != "unknown" and bool(settings.get("service_pincodes")) and pc not in (settings.get("service_pincodes") or []),
                    "items": sorted(g, key=lambda x: (x.get("name") or "").lower()),
                }
                for pc, g in sorted(groups.items())
            ]
            return {
                "meal": meal,
                "total": len(meal_items),
                "full": len(full),
                "half": len(half),
                "outside_count": len(outside),
                "unknown_pincode_count": len(unknown),
                "groups": group_summaries,
            }

        # handoff summary
        handoffs = await db.delivery_handoffs.find({"date": d}, {"_id": 0}).to_list(500)

        return {
            "date": d,
            "settings": settings,
            "generated_now": gen_info,
            "lunch": _bucket("lunch"),
            "dinner": _bucket("dinner"),
            "handoffs": handoffs,
        }

    # ---- handoff to delivery boy ----
    @router.post("/handoff")
    async def create_handoff(payload: HandoffCreate = Body(...), _=Depends(admin_only)):
        if payload.meal_type not in MEALS:
            raise HTTPException(status_code=400, detail="meal_type must be lunch|dinner")
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

        expected_full = sum(1 for i in items if i.get("tiffin_size") == "full")
        expected_half = sum(1 for i in items if i.get("tiffin_size") == "half")

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
            "tiffins_taken_full": int(payload.tiffins_taken_full),
            "tiffins_taken_half": int(payload.tiffins_taken_half),
            "tiffins_taken_total": int(payload.tiffins_taken_full) + int(payload.tiffins_taken_half),
            "extra_taken": (
                max(0, int(payload.tiffins_taken_full) - expected_full)
                + max(0, int(payload.tiffins_taken_half) - expected_half)
            ),
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
        settings = await _load_settings()
        upd = {"status": payload.status, "delivered_at": iso(now_utc()) if payload.status == "delivered" else None}
        if payload.notes:
            upd["notes"] = payload.notes

        if payload.status == "delivered":
            upd["confirmed_by"] = "admin"
            # Geofence is the verification mechanism — no OTP.
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
            if dist > geofence:
                # Log the rejection so admins can see false-rejection patterns over time
                await db.delivery_attempts.insert_one({
                    "ts": iso(now_utc()),
                    "outcome": "rejected_too_far",
                    "distance_m": round(dist, 1),
                    "geofence_meters": geofence,
                    "roster_id": roster_id,
                    "user_id": item["user_id"],
                    "meal_type": item["meal_type"],
                })
                raise HTTPException(
                    status_code=400,
                    detail=f"You're {round(dist)}m away from the customer — geofence limit is {int(geofence)}m. Walk to the door and try again.",
                )
            await db.delivery_attempts.insert_one({
                "ts": iso(now_utc()),
                "outcome": "delivered",
                "distance_m": round(dist, 1),
                "geofence_meters": geofence,
                "roster_id": roster_id,
                "user_id": item["user_id"],
                "meal_type": item["meal_type"],
            })
            upd["distance_warning"] = False

        await db.daily_rosters.update_one({"roster_id": roster_id}, {"$set": upd})
        if payload.status == "delivered" and item["status"] != "delivered":
            # Customer now holds an empty tiffin (debt). Boy must collect on a future visit.
            await db.users.update_one({"user_id": item["user_id"]}, {"$inc": {"tiffin_balance": 1}})
            await db.tiffin_movements.insert_one({
                "ts": iso(now_utc()),
                "kind": "issued",
                "user_id": item["user_id"],
                "roster_id": roster_id,
                "meal_type": item["meal_type"],
                "delta": 1,
            })
            # Auto-deduct from physical raw tiffin stock (1 tiffin per delivery).
            try:
                from routes.tiffin_stock import decrement_stock_db
                await decrement_stock_db(
                    db, count=1,
                    reason=f"Delivered to roster {roster_id} ({item['meal_type']})",
                    source="admin-deliver", user_id=item["user_id"],
                    mess_id=item.get("mess_id"),
                )
            except Exception as _e:  # noqa: BLE001
                pass
        return {"ok": True, **upd}

    @router.post("/empty/collect")
    async def admin_collect_empty(payload: CollectEmpty = Body(...), _=Depends(admin_only)):
        return await _record_empty_collection(payload.user_id, int(payload.count), payload.notes, source="admin")

    @router.get("/empties")
    async def list_empties(_=Depends(admin_only)):
        users = await db.users.find(
            {"tiffin_balance": {"$gt": 0}},
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "address": 1, "pincode": 1, "tiffin_balance": 1, "lat": 1, "lng": 1},
        ).sort("tiffin_balance", -1).to_list(2000)
        total = sum(u.get("tiffin_balance", 0) for u in users)
        return {"users": users, "total_outstanding": total, "count": len(users)}

    @router.post("/handoff/{handoff_id}/reconcile")
    async def reconcile_handoff(handoff_id: str, payload: dict = Body(default=None), _=Depends(admin_only)):
        h = await db.delivery_handoffs.find_one({"handoff_id": handoff_id}, {"_id": 0})
        if not h:
            raise HTTPException(status_code=404, detail="Handoff not found")
        items = await db.daily_rosters.find({"roster_id": {"$in": h["roster_ids"]}}, {"_id": 0}).to_list(5000)
        delivered = sum(1 for i in items if i["status"] == "delivered")
        returned = sum(1 for i in items if i["status"] in ("returned", "undelivered"))
        # Items still at 'out' / 'planned' = delivery boy never closed them out
        unaccounted = sum(1 for i in items if i["status"] not in ("delivered", "returned", "undelivered"))
        # Loss = (taken − delivered − returned − any explicit returned-by-boy count override) + extra-taken
        # simplest, accurate model: loss = max(0, taken_total − delivered − returned)
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

    @router.get("/health")
    async def geofence_health(_=Depends(admin_only)):
        """Last-7-days delivery attempt stats with a suggested geofence radius."""
        cutoff = iso(now_utc() - timedelta(days=7))
        attempts = await db.delivery_attempts.find({"ts": {"$gte": cutoff}}, {"_id": 0}).to_list(20000)
        total = len(attempts)
        rejected = [a for a in attempts if a["outcome"] == "rejected_too_far"]
        delivered = [a for a in attempts if a["outcome"] == "delivered"]
        rejection_rate = (len(rejected) / total) if total else 0.0
        # Suggest a radius that would have admitted ~95% of recent rejections (P95 of their distances).
        suggested = None
        if rejected:
            distances = sorted(r.get("distance_m", 0) for r in rejected)
            idx = max(0, min(len(distances) - 1, int(round(0.95 * (len(distances) - 1)))))
            suggested = int(math.ceil(distances[idx] / 5.0) * 5)  # round up to nearest 5
        settings = await _load_settings()
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
        """Live positions of every active delivery boy + today's roster overview for admin map."""
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
        settings = await _load_settings()
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

    return router

