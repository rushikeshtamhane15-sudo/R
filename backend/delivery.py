"""
Tiffin delivery system — daily roster + reconciliation.

Entities
--------
delivery_settings  : single doc {_id:'active'} with cutoff times + service pincodes
delivery_boys      : {boy_id, name, phone, active, assigned_pincodes:[]}
daily_rosters      : per-(date, meal_type, sub_id) tiffin item — see ROSTER_FIELDS
delivery_handoffs  : per-(date, meal_type, boy_id) batch — tiffins handed out vs returned

Rules
-----
* Roster auto-generated on first GET each day if not yet generated.
* A subscription is included for both 'lunch' and 'dinner' rosters every day until expiry.
* Pincode is auto-extracted from address (first 6-digit run); fallback group = 'unknown'.
* Pincodes outside service_pincodes are tagged is_outside=True so admin can exclude.
* Reconciliation: tiffins_handed = sum(items handed) ; tiffins_returned must come from items
  marked 'returned'/'undelivered'. Anything left over is flagged as `loss_count`.
* Geofence: when admin/boy marks delivered with GPS, server computes distance to customer's
  saved coords and stores it. >250m is recorded as `distance_warning=True` (not blocked).
* Customer self-confirm: customer hits /api/my/deliveries/{roster_id}/confirm to mark
  delivered without OTP — bypasses the geofence check (the customer is the witness).
"""
from __future__ import annotations

import math
import re
import secrets
from datetime import date as date_cls, datetime, time, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from logging import getLogger
logger = getLogger("efoodcare.delivery")

PIN_RE = re.compile(r"\b(\d{6})\b")
MEALS = ("lunch", "dinner")

# Default settings — admin can override via /api/admin/delivery/settings
DEFAULT_SETTINGS = {
    "lunch_cutoff": "11:00",
    "dinner_cutoff": "18:00",
    "service_pincodes": [],   # empty = treat all as in-service
    "lunch_otp_required": True,
    "dinner_otp_required": True,
    "geofence_meters": 10,
    # Slot windows — boy can only start dispatch within these IST windows
    "lunch_dispatch_open": "08:00",
    "lunch_dispatch_close": "14:00",
    "dinner_dispatch_open": "15:00",
    "dinner_dispatch_close": "22:00",
    # Kitchen / dispatch location — anchors the map and the 15km radius
    "dispatch_lat": None,
    "dispatch_lng": None,
    "dispatch_radius_km": 15,
}


def _ist_now() -> datetime:
    return now_utc().astimezone(timezone(timedelta(hours=5, minutes=30)))


def _parse_hhmm(s: str) -> tuple[int, int]:
    try:
        h, m = s.split(":")
        return int(h), int(m)
    except Exception:
        return 0, 0


def _slot_open_now(settings: dict, meal_type: str) -> tuple[bool, str]:
    """Return (is_open, reason). Reason is empty when open, otherwise a friendly hint."""
    now = _ist_now()
    cur_min = now.hour * 60 + now.minute
    if meal_type == "lunch":
        oh, om = _parse_hhmm(settings.get("lunch_dispatch_open") or "08:00")
        ch, cm = _parse_hhmm(settings.get("lunch_dispatch_close") or "14:00")
    else:
        oh, om = _parse_hhmm(settings.get("dinner_dispatch_open") or "15:00")
        ch, cm = _parse_hhmm(settings.get("dinner_dispatch_close") or "22:00")
    open_min = oh * 60 + om
    close_min = ch * 60 + cm
    if open_min <= cur_min <= close_min:
        return True, ""
    if cur_min < open_min:
        return False, f"{meal_type.capitalize()} dispatch opens at {oh:02d}:{om:02d}"
    return False, f"{meal_type.capitalize()} dispatch closed at {ch:02d}:{cm:02d}"


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return float(2 * R * math.asin(math.sqrt(a)))


# Body models — kept at module scope so FastAPI/Pydantic can fully resolve them.
class SettingsPatch(BaseModel):
    lunch_cutoff: str | None = None
    dinner_cutoff: str | None = None
    service_pincodes: list[str] | None = None
    lunch_otp_required: bool | None = None
    dinner_otp_required: bool | None = None
    geofence_meters: int | None = None
    lunch_dispatch_open: str | None = None
    lunch_dispatch_close: str | None = None
    dinner_dispatch_open: str | None = None
    dinner_dispatch_close: str | None = None
    dispatch_lat: float | None = None
    dispatch_lng: float | None = None
    dispatch_radius_km: float | None = None


class CollectEmpty(BaseModel):
    user_id: str
    count: int = 1
    notes: str | None = None


class BoyCreate(BaseModel):
    name: str
    phone: str
    assigned_pincodes: list[str] = Field(default_factory=list)
    active: bool = True


class BoyPatch(BaseModel):
    name: str | None = None
    phone: str | None = None
    assigned_pincodes: list[str] | None = None
    active: bool | None = None


class HandoffCreate(BaseModel):
    date: str | None = None
    meal_type: str
    delivery_boy_id: str
    roster_ids: list[str]
    tiffins_taken_full: int
    tiffins_taken_half: int


class MarkItem(BaseModel):
    status: str   # delivered | undelivered | returned
    otp: str | None = None
    notes: str | None = None
    lat: float | None = None
    lng: float | None = None


class LocationPing(BaseModel):
    lat: float
    lng: float
    accuracy: float | None = None


class DispatchStart(BaseModel):
    meal_type: str   # lunch | dinner


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s)


def today_local() -> str:
    """Service-day key in IST (yyyy-mm-dd)."""
    ist = timezone(timedelta(hours=5, minutes=30))
    return now_utc().astimezone(ist).date().isoformat()


def extract_pincode(address: str | None) -> str:
    if not address:
        return "unknown"
    m = PIN_RE.search(address)
    return m.group(1) if m else "unknown"


def gen_otp() -> str:
    return f"{secrets.randbelow(10000):04d}"


async def _record_empty_collection_db(db, user_id: str, count: int, notes: str | None, source: str) -> dict:
    """Decrement the user's tiffin_balance and log the movement. Used by admin + boy routers."""
    if count <= 0:
        raise HTTPException(status_code=400, detail="count must be > 0")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    held = int(user.get("tiffin_balance") or 0)
    if held <= 0:
        raise HTTPException(status_code=400, detail="No empty tiffins outstanding for this customer")
    take = min(count, held)
    await db.users.update_one({"user_id": user_id}, {"$inc": {"tiffin_balance": -take}})
    await db.tiffin_movements.insert_one({
        "ts": iso(now_utc()),
        "kind": "collected",
        "user_id": user_id,
        "delta": -take,
        "source": source,
        "notes": notes or "",
    })
    return {"ok": True, "collected": take, "remaining": max(0, held - take)}


async def _load_settings_db(db) -> dict:
    s = await db.delivery_settings.find_one({"_id": "active"}, {"_id": 0})
    if not s:
        await db.delivery_settings.insert_one({"_id": "active", **DEFAULT_SETTINGS})
        return dict(DEFAULT_SETTINGS)
    return {**DEFAULT_SETTINGS, **s}


def make_router(db) -> APIRouter:
    """Build and return the delivery API router. Imports `get_current_user` lazily
    via `auth_dep` injected from server.py to avoid circular imports."""
    from server import get_current_user, User  # type: ignore

    router = APIRouter(prefix="/admin/delivery", tags=["delivery"])

    async def admin_only(user: User = Depends(get_current_user)) -> User:
        if user.role != "admin":
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
