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
"""
from __future__ import annotations

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
}


# Body models — kept at module scope so FastAPI/Pydantic can fully resolve them.
class SettingsPatch(BaseModel):
    lunch_cutoff: str | None = None
    dinner_cutoff: str | None = None
    service_pincodes: list[str] | None = None
    lunch_otp_required: bool | None = None
    dinner_otp_required: bool | None = None


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
        s = await db.delivery_settings.find_one({"_id": "active"}, {"_id": 0})
        if not s:
            await db.delivery_settings.insert_one({"_id": "active", **DEFAULT_SETTINGS})
            return dict(DEFAULT_SETTINGS)
        # merge defaults for any newly-added settings keys
        return {**DEFAULT_SETTINGS, **s}

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
        boy = {
            "boy_id": f"dlv_{uuid4().hex[:10]}",
            "name": payload.name.strip(),
            "phone": payload.phone.strip(),
            "assigned_pincodes": [str(p).strip() for p in payload.assigned_pincodes if str(p).strip()],
            "active": payload.active,
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
            if plan.get("plan_type") != "delivery":
                continue
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
        if payload.status == "delivered":
            settings = await _load_settings()
            otp_required = settings.get(f"{item['meal_type']}_otp_required", True)
            if otp_required and (payload.otp or "").strip() != (item.get("otp") or ""):
                raise HTTPException(status_code=400, detail="Wrong OTP — ask the customer to read it from their phone")
        upd = {"status": payload.status, "delivered_at": iso(now_utc()) if payload.status == "delivered" else None}
        if payload.notes:
            upd["notes"] = payload.notes
        await db.daily_rosters.update_one({"roster_id": roster_id}, {"$set": upd})
        return {"ok": True, **upd}

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

    return router
