"""iter-185 · Manual priority-ordered Tiffin Delivery Routes.

New Tiffin Delivery Route System (Points 5-9 of the user's Phase-3 spec).
Mess owners manually assign active tiffin subscribers to delivery boys with
a priority number. State machine per checkpoint:
    pending  ⚪  (assigned, not yet dispatched)
    dispatched 🔴 (boy tapped Dispatch, out for delivery)
    delivered ✅  (boy tapped delivered on this checkpoint)

Route-level status:
    draft            → any checkpoint pending, boy hasn't tapped Dispatch
    out_for_delivery → boy has dispatched, at least one checkpoint still not
                       delivered
    completed        → every checkpoint delivered

Collections: `delivery_routes` — one doc per (mess_id, date, delivery_boy_id).

Endpoints
---------
Mess-owner:
    GET    /admin/delivery-routes?date=YYYY-MM-DD
    POST   /admin/delivery-routes
    DELETE /admin/delivery-routes/{route_id}

Delivery-boy:
    GET  /boy/delivery-routes/today
    POST /boy/delivery-routes/dispatch
    POST /boy/delivery-routes/mark-delivered
"""
from __future__ import annotations

from datetime import date as date_cls, datetime, timezone
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()


# --------------------------- models ------------------------------------
class CheckpointIn(BaseModel):
    user_id: str
    priority: int = 1


class RouteUpsertIn(BaseModel):
    date: Optional[str] = None
    delivery_boy_id: str
    checkpoints: List[CheckpointIn] = Field(default_factory=list)


class MarkDeliveredIn(BaseModel):
    route_id: str
    user_id: str


# --------------------------- helpers -----------------------------------
def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_str() -> str:
    return server.today_str() if hasattr(server, "today_str") else date_cls.today().isoformat()


def _compute_status(checkpoints: list) -> str:
    if not checkpoints:
        return "draft"
    statuses = [c.get("status") for c in checkpoints]
    if all(s == "delivered" for s in statuses):
        return "completed"
    if any(s in ("dispatched", "delivered") for s in statuses):
        return "out_for_delivery"
    return "draft"


async def _active_tiffin_user_ids(mess_id: Optional[str]) -> list:
    """iter-184 · active tiffin subscribers for this mess, auto-pause excluded.

    Mirrors the rule used by /admin/active-tiffin-details: excludes subs with
    user_paused=True or with no scan in >=4 consecutive days.
    """
    sub_query: dict = {
        "status": "active",
        "$or": [{"service_type": "tiffin"}, {"category": "tiffin"}],
    }
    if mess_id:
        sub_query["mess_id"] = mess_id
    subs = await server.db.subscriptions.find(
        sub_query, {"_id": 0, "user_id": 1, "user_paused": 1, "start_date": 1}
    ).to_list(2000)
    ids = list({s.get("user_id") for s in subs if s.get("user_id")})
    if not ids:
        return []

    from datetime import timedelta
    today_d = server.ist_today() if hasattr(server, "ist_today") else date_cls.today()
    pause_cutoff = today_d - timedelta(days=4)
    last_scan_map: dict = {}
    async for a in server.db.attendance.find(
        {"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "date_str": 1},
    ).sort([("date_str", -1)]):
        uid = a["user_id"]
        if uid not in last_scan_map:
            last_scan_map[uid] = a.get("date_str")

    kept = []
    for s in subs:
        uid = s.get("user_id")
        if s.get("user_paused"):
            continue
        last_scan = last_scan_map.get(uid)
        try:
            if last_scan:
                if date_cls.fromisoformat(str(last_scan)[:10]) < pause_cutoff:
                    continue
            elif s.get("start_date"):
                if date_cls.fromisoformat(str(s["start_date"])[:10]) < pause_cutoff:
                    continue
        except Exception:
            pass
        kept.append(uid)
    return kept


async def _hydrate_checkpoint(user_id: str) -> dict:
    u = await server.db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "address": 1},
    ) or {}
    return {
        "user_id": user_id,
        "name": u.get("name") or "—",
        "phone": u.get("phone") or "",
        "address": u.get("address") or "",
    }


async def _resolve_boy(user: server.User) -> dict:
    boy = await server.db.delivery_boys.find_one({"user_id": user.user_id}, {"_id": 0})
    if not boy:
        raise HTTPException(status_code=403, detail="Not registered as a delivery boy")
    return boy


# --------------------------- admin-side --------------------------------
@router.get("/admin/delivery-routes")
async def admin_list_routes(
    date: Optional[str] = Query(default=None),
    as_mess_id: Optional[str] = Query(default=None),
    user: server.User = Depends(server.get_current_user),
):
    if user.role not in ("admin", "mess_owner", "staff"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)
    d = date or _today_str()

    q: dict = {"date": d}
    if mid:
        q["mess_id"] = mid
    routes_raw = await server.db.delivery_routes.find(q, {"_id": 0}).to_list(500)

    # Attach boy info + refresh contact info (customer might have edited phone
    # since the route was created).
    boy_ids = list({r.get("delivery_boy_id") for r in routes_raw if r.get("delivery_boy_id")})
    boys_by_id: dict = {}
    if boy_ids:
        async for b in server.db.delivery_boys.find(
            {"boy_id": {"$in": boy_ids}}, {"_id": 0, "boy_id": 1, "name": 1, "phone": 1}
        ):
            boys_by_id[b["boy_id"]] = b

    assigned_user_ids: set = set()
    routes = []
    remaining = 0
    total = 0
    for r in routes_raw:
        cps = r.get("checkpoints") or []
        cps_hydrated = []
        for cp in sorted(cps, key=lambda c: int(c.get("priority") or 1)):
            uid = cp.get("user_id")
            if not uid:
                continue
            assigned_user_ids.add(uid)
            fresh = await _hydrate_checkpoint(uid)
            merged = {
                **fresh,
                "priority": int(cp.get("priority") or 1),
                "status": cp.get("status") or "pending",
                "delivered_at": cp.get("delivered_at"),
            }
            cps_hydrated.append(merged)
            total += 1
            if merged["status"] != "delivered":
                remaining += 1

        boy = boys_by_id.get(r.get("delivery_boy_id")) or {}
        routes.append({
            "route_id": r.get("route_id"),
            "delivery_boy_id": r.get("delivery_boy_id"),
            "boy_name": boy.get("name") or "—",
            "boy_phone": boy.get("phone") or "",
            "status": _compute_status(cps_hydrated),
            "dispatched_at": r.get("dispatched_at"),
            "completed_at": r.get("completed_at"),
            "checkpoints": cps_hydrated,
        })

    # Unassigned active tiffin users for this mess.
    active_ids = await _active_tiffin_user_ids(mid)
    unassigned_ids = [uid for uid in active_ids if uid not in assigned_user_ids]
    unassigned = []
    if unassigned_ids:
        async for u in server.db.users.find(
            {"user_id": {"$in": unassigned_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "address": 1},
        ):
            unassigned.append({
                "user_id": u["user_id"],
                "name": u.get("name") or "—",
                "phone": u.get("phone") or "",
                "address": u.get("address") or "",
            })
    unassigned.sort(key=lambda x: x["name"].lower())

    # List of active boys (for the "Assign to boy" picker).
    boy_query: dict = {"active": {"$ne": False}}
    all_boys = []
    async for b in server.db.delivery_boys.find(boy_query, {"_id": 0, "boy_id": 1, "name": 1, "phone": 1}):
        all_boys.append(b)
    all_boys.sort(key=lambda x: (x.get("name") or "").lower())

    return {
        "date": d,
        "mess_id": mid,
        "routes": routes,
        "unassigned": unassigned,
        "boys": all_boys,
        "remaining_count": remaining,
        "total_count": total,
    }


@router.post("/admin/delivery-routes")
async def admin_upsert_route(
    payload: RouteUpsertIn = Body(...),
    as_mess_id: Optional[str] = Query(default=None),
    user: server.User = Depends(server.get_current_user),
):
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Mess owner or admin only")
    mid = await server.effective_mess_id(user, as_mess_id)
    d = payload.date or _today_str()

    boy = await server.db.delivery_boys.find_one(
        {"boy_id": payload.delivery_boy_id}, {"_id": 0, "boy_id": 1}
    )
    if not boy:
        raise HTTPException(status_code=404, detail="Delivery boy not found")

    # Reject checkpoints for users not on the active tiffin roster (prevents
    # accidentally assigning random users).
    valid_uids = set(await _active_tiffin_user_ids(mid))
    seen_uids: set = set()
    new_checkpoints: list = []
    for cp in payload.checkpoints:
        uid = cp.user_id.strip()
        if not uid or uid in seen_uids:
            continue
        if uid not in valid_uids:
            raise HTTPException(status_code=400, detail=f"User {uid} is not an active tiffin subscriber")
        seen_uids.add(uid)
        new_checkpoints.append({
            "user_id": uid,
            "priority": int(cp.priority or 1),
            "status": "pending",
            "delivered_at": None,
        })

    # Also drop these users off ANY other route on the same date so the same
    # customer can't be assigned to two boys simultaneously.
    if new_checkpoints and mid:
        for cp in new_checkpoints:
            await server.db.delivery_routes.update_many(
                {"mess_id": mid, "date": d, "delivery_boy_id": {"$ne": payload.delivery_boy_id}},
                {"$pull": {"checkpoints": {"user_id": cp["user_id"]}}},
            )

    existing = await server.db.delivery_routes.find_one(
        {"mess_id": mid, "date": d, "delivery_boy_id": payload.delivery_boy_id},
        {"_id": 0},
    )
    if existing:
        # Preserve status/delivered_at for checkpoints that already existed
        # (so a re-assign doesn't accidentally reset a delivered stop).
        prev_by_uid = {c["user_id"]: c for c in (existing.get("checkpoints") or [])}
        for cp in new_checkpoints:
            prev = prev_by_uid.get(cp["user_id"])
            if prev:
                cp["status"] = prev.get("status") or "pending"
                cp["delivered_at"] = prev.get("delivered_at")
        new_status = _compute_status(new_checkpoints)
        await server.db.delivery_routes.update_one(
            {"route_id": existing["route_id"]},
            {"$set": {
                "checkpoints": new_checkpoints,
                "status": new_status,
                "updated_at": _iso_now(),
            }},
        )
        route_id = existing["route_id"]
    else:
        route_id = f"rt_{uuid4().hex[:12]}"
        await server.db.delivery_routes.insert_one({
            "route_id": route_id,
            "mess_id": mid,
            "date": d,
            "delivery_boy_id": payload.delivery_boy_id,
            "checkpoints": new_checkpoints,
            "status": _compute_status(new_checkpoints),
            "dispatched_at": None,
            "completed_at": None,
            "created_at": _iso_now(),
            "updated_at": _iso_now(),
        })

    doc = await server.db.delivery_routes.find_one({"route_id": route_id}, {"_id": 0})
    return {"ok": True, "route": doc}


@router.delete("/admin/delivery-routes/{route_id}")
async def admin_delete_route(
    route_id: str,
    as_mess_id: Optional[str] = Query(default=None),
    user: server.User = Depends(server.get_current_user),
):
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Mess owner or admin only")
    mid = await server.effective_mess_id(user, as_mess_id)
    q: dict = {"route_id": route_id}
    if mid:
        q["mess_id"] = mid
    r = await server.db.delivery_routes.delete_one(q)
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Route not found")
    return {"ok": True}


# --------------------------- boy-side ----------------------------------
@router.get("/boy/delivery-routes/today")
async def boy_route_today(user: server.User = Depends(server.get_current_user)):
    boy = await _resolve_boy(user)
    d = _today_str()
    route = await server.db.delivery_routes.find_one(
        {"delivery_boy_id": boy["boy_id"], "date": d}, {"_id": 0}
    )
    if not route:
        return {"date": d, "route": None, "remaining_count": 0, "total_count": 0}

    cps = route.get("checkpoints") or []
    hydrated = []
    remaining = 0
    for cp in sorted(cps, key=lambda c: int(c.get("priority") or 1)):
        uid = cp.get("user_id")
        if not uid:
            continue
        fresh = await _hydrate_checkpoint(uid)
        merged = {
            **fresh,
            "priority": int(cp.get("priority") or 1),
            "status": cp.get("status") or "pending",
            "delivered_at": cp.get("delivered_at"),
        }
        hydrated.append(merged)
        if merged["status"] != "delivered":
            remaining += 1
    return {
        "date": d,
        "remaining_count": remaining,
        "total_count": len(hydrated),
        "route": {
            "route_id": route.get("route_id"),
            "status": _compute_status(hydrated),
            "dispatched_at": route.get("dispatched_at"),
            "completed_at": route.get("completed_at"),
            "checkpoints": hydrated,
        },
    }


@router.post("/boy/delivery-routes/dispatch")
async def boy_dispatch(user: server.User = Depends(server.get_current_user)):
    boy = await _resolve_boy(user)
    d = _today_str()
    route = await server.db.delivery_routes.find_one(
        {"delivery_boy_id": boy["boy_id"], "date": d}, {"_id": 0}
    )
    if not route:
        raise HTTPException(status_code=404, detail="No route assigned for today")
    cps = route.get("checkpoints") or []
    if not cps:
        raise HTTPException(status_code=400, detail="Route is empty — ask your mess to add stops")
    new_cps = []
    for cp in cps:
        new_cps.append({
            **cp,
            "status": "dispatched" if cp.get("status") in (None, "pending") else cp.get("status"),
        })
    new_status = _compute_status(new_cps)
    await server.db.delivery_routes.update_one(
        {"route_id": route["route_id"]},
        {"$set": {
            "checkpoints": new_cps,
            "status": new_status,
            "dispatched_at": route.get("dispatched_at") or _iso_now(),
            "updated_at": _iso_now(),
        }},
    )
    updated = await server.db.delivery_routes.find_one({"route_id": route["route_id"]}, {"_id": 0})
    return {"ok": True, "route": updated}


@router.post("/boy/delivery-routes/mark-delivered")
async def boy_mark_delivered(
    payload: MarkDeliveredIn = Body(...),
    user: server.User = Depends(server.get_current_user),
):
    boy = await _resolve_boy(user)
    route = await server.db.delivery_routes.find_one(
        {"route_id": payload.route_id, "delivery_boy_id": boy["boy_id"]},
        {"_id": 0},
    )
    if not route:
        raise HTTPException(status_code=404, detail="Route not found for this boy")

    cps = route.get("checkpoints") or []
    hit = False
    for cp in cps:
        if cp.get("user_id") == payload.user_id:
            cp["status"] = "delivered"
            cp["delivered_at"] = _iso_now()
            hit = True
            break
    if not hit:
        raise HTTPException(status_code=404, detail="Checkpoint not found in this route")

    new_status = _compute_status(cps)
    set_patch = {
        "checkpoints": cps,
        "status": new_status,
        "updated_at": _iso_now(),
    }
    if new_status == "completed":
        set_patch["completed_at"] = _iso_now()
    await server.db.delivery_routes.update_one(
        {"route_id": route["route_id"]}, {"$set": set_patch}
    )
    updated = await server.db.delivery_routes.find_one({"route_id": route["route_id"]}, {"_id": 0})
    return {"ok": True, "route": updated}


# --------------------------- shared: live count ------------------------
@router.get("/admin/delivery-routes/summary")
async def admin_route_summary(
    as_mess_id: Optional[str] = Query(default=None),
    user: server.User = Depends(server.get_current_user),
):
    """Fast polling endpoint powering the 'Remaining tiffins' dashboard tile.

    Returns a lightweight count (pending + dispatched) across every route for
    this mess for today — used by the AdminDashboard tile that polls every
    30 s and turns red while any tiffin is out and green when all delivered.
    """
    if user.role not in ("admin", "mess_owner", "staff"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)
    d = _today_str()
    q: dict = {"date": d}
    if mid:
        q["mess_id"] = mid
    routes = await server.db.delivery_routes.find(q, {"_id": 0, "checkpoints": 1, "status": 1}).to_list(500)
    total = 0
    remaining = 0
    delivered = 0
    dispatched = 0
    any_dispatched = False
    for r in routes:
        if r.get("status") in ("out_for_delivery", "completed"):
            any_dispatched = True
        for cp in r.get("checkpoints") or []:
            total += 1
            st = cp.get("status") or "pending"
            if st == "delivered":
                delivered += 1
            else:
                remaining += 1
                if st == "dispatched":
                    dispatched += 1
    return {
        "date": d,
        "mess_id": mid,
        "total": total,
        "delivered": delivered,
        "dispatched": dispatched,
        "remaining": remaining,
        "any_dispatched": any_dispatched,
    }
