"""Daily roster generation and today-summary endpoints.

Exposes `generate_roster_for_date(db, date_str)` so other modules
(e.g. cron) can call it without going through HTTP.
"""
from __future__ import annotations

from datetime import date as date_cls
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .shared import (
    MEALS,
    _load_settings_db, extract_pincode, gen_otp, iso, now_utc, parse_dt,
    today_local,
)


async def generate_roster_for_date(db, date_str: str) -> dict:
    """Idempotent — won't duplicate items already present."""
    settings = await _load_settings_db(db)
    service_pins = set(settings.get("service_pincodes") or [])
    subs = await db.subscriptions.find({"status": "active"}, {"_id": 0}).to_list(10000)
    plans = {p["plan_id"]: p async for p in db.plans.find({}, {"_id": 0})}
    users = {u["user_id"]: u async for u in db.users.find({}, {"_id": 0})}

    target = date_cls.fromisoformat(date_str)
    created_lunch = created_dinner = 0

    for sub in subs:
        # iter-158k: defensively skip malformed subs (legacy/incomplete rows
        # missing plan_id / user_id) instead of crashing the whole roster.
        if not sub.get("plan_id") or not sub.get("user_id"):
            continue
        plan = plans.get(sub["plan_id"]) or {}
        service = sub.get("service_type") or plan.get("service_type") or (
            "tiffin" if plan.get("plan_type") == "delivery" else "dining"
        )
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
        # iter-131.16: snapshot the user's chosen delivery window for each meal
        # onto the roster row so downstream sorting/late-checks don't re-query users.
        user_prefs = (user.get("delivery_prefs") or {})
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
        window = (sub.get("meal_window") or plan.get("meal_window") or "both").lower()
        for meal in MEALS:
            # Iter-51: tiffin subs with a meal_window of "lunch" or "dinner"
            # only get a single dispatch entry per day. "both" (the default)
            # keeps the legacy 2-meal behaviour.
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
                # Iter-52: snapshot the user's tiffin food preferences so
                # dispatch staff packs exactly what was requested.
                "tiffin_preferences": sub.get("tiffin_preferences") or None,
                # iter-131.16: delivery-window snapshot (per meal).
                "pref_start": ((user_prefs.get(meal) or {}).get("start")) or None,
                "pref_end": ((user_prefs.get(meal) or {}).get("end")) or None,
            }
            await db.daily_rosters.insert_one(doc.copy())
            if meal == "lunch":
                created_lunch += 1
            else:
                created_dinner += 1
    return {"date": date_str, "created_lunch": created_lunch, "created_dinner": created_dinner}


def _bucket_for_meal(meal: str, items: list[dict], settings: dict) -> dict:
    meal_items = [it for it in items if it["meal_type"] == meal]
    full = [it for it in meal_items if it.get("tiffin_size") == "full"]
    half = [it for it in meal_items if it.get("tiffin_size") == "half"]
    outside = [it for it in meal_items if it.get("is_outside")]
    unknown = [it for it in meal_items if it.get("is_unknown_pincode")]
    service_pins = settings.get("service_pincodes") or []

    groups: dict[str, list[dict]] = {}
    for it in meal_items:
        groups.setdefault(it["pincode"], []).append(it)
    group_summaries = [
        {
            "pincode": pc,
            "count": len(g),
            "full": sum(1 for x in g if x.get("tiffin_size") == "full"),
            "half": sum(1 for x in g if x.get("tiffin_size") == "half"),
            "is_outside": pc != "unknown" and bool(service_pins) and pc not in service_pins,
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


def register(router: APIRouter, db, admin_only) -> None:
    @router.post("/generate")
    async def generate_roster(date: str | None = Query(None), _=Depends(admin_only)):
        d = date or today_local()
        return await generate_roster_for_date(db, d)

    @router.post("/roster/{roster_id}/ready")
    async def mark_ready(
        roster_id: str,
        payload: dict = Body(default=None),
        user=Depends(admin_only),
    ):
        """iter-131.14: Staff flips a roster item to `ready` (or unsets it).
        Records `ready_by` + `ready_at` for audit. Delivery-boy dispatch
        button turns green only when ALL items in the boy's handoff are ready.
        """
        want_ready = True if payload is None else bool((payload or {}).get("ready", True))
        item = await db.daily_rosters.find_one({"roster_id": roster_id}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Roster item not found")
        if item["status"] not in ("planned", "ready"):
            raise HTTPException(status_code=400, detail=f"Cannot toggle ready on item with status={item['status']}")
        new_status = "ready" if want_ready else "planned"
        upd = {"status": new_status}
        if want_ready:
            upd["ready_by"] = getattr(user, "user_id", "admin")
            upd["ready_at"] = iso(now_utc())
        else:
            upd["ready_by"] = None
            upd["ready_at"] = None
        await db.daily_rosters.update_one({"roster_id": roster_id}, {"$set": upd})
        return {"roster_id": roster_id, **upd}

    @router.post("/roster/batch-ready")
    async def batch_ready(payload: dict = Body(...), user=Depends(admin_only)):
        """Mark a whole meal batch as ready in one click.

        Body: `{"date": "YYYY-MM-DD", "meal_type": "lunch"|"dinner"}` — flips
        every roster item for that meal from planned → ready.
        """
        d = str(payload.get("date") or today_local())
        meal = str(payload.get("meal_type") or "").lower()
        if meal not in MEALS:
            raise HTTPException(status_code=400, detail="meal_type must be lunch|dinner")
        r = await db.daily_rosters.update_many(
            {"date": d, "meal_type": meal, "status": {"$in": ["planned"]}},
            {"$set": {
                "status": "ready",
                "ready_by": getattr(user, "user_id", "admin"),
                "ready_at": iso(now_utc()),
            }},
        )
        return {"date": d, "meal_type": meal, "marked": r.modified_count}

    @router.get("/today")
    async def today_summary(date: str | None = Query(None), _=Depends(admin_only)):
        d = date or today_local()
        cnt = await db.daily_rosters.count_documents({"date": d})
        gen_info = None
        if cnt == 0:
            gen_info = await generate_roster_for_date(db, d)
        items = await db.daily_rosters.find({"date": d}, {"_id": 0}).to_list(20000)
        settings = await _load_settings_db(db)
        handoffs = await db.delivery_handoffs.find({"date": d}, {"_id": 0}).to_list(500)
        # iter-131.14: per-meal ready counts for the dispatch gating UI.
        def _ready_stats(meal: str) -> dict:
            meal_items = [i for i in items if i["meal_type"] == meal]
            ready = sum(1 for i in meal_items if i["status"] in ("ready", "out", "delivered"))
            return {"total": len(meal_items), "ready": ready, "pending": max(0, len(meal_items) - ready)}
        # iter-131.16: late-delivery + missing-prefs counts so admin can nudge users.
        def _late_stats(meal: str) -> dict:
            meal_items = [i for i in items if i["meal_type"] == meal]
            delivered_late = sum(1 for i in meal_items if i.get("delivered_late"))
            no_pref = sum(1 for i in meal_items if not i.get("pref_start"))
            return {"delivered_late": delivered_late, "no_pref": no_pref}
        return {
            "date": d,
            "settings": settings,
            "generated_now": gen_info,
            "lunch": _bucket_for_meal("lunch", items, settings),
            "dinner": _bucket_for_meal("dinner", items, settings),
            "ready_stats": {"lunch": _ready_stats("lunch"), "dinner": _ready_stats("dinner")},
            "late_stats": {"lunch": _late_stats("lunch"), "dinner": _late_stats("dinner")},
            "handoffs": handoffs,
        }
