"""iter-177 · Active dining subscriber details endpoint.

Powers the admin/mess-owner dashboard's "Active dining" tile drill-down.
Returns the list of currently active DINING subscribers (i.e. not tiffin)
with their name, phone (clickable via tel: on the frontend) and address.

Scoped by `effective_mess_id()`:
    - mess_owner: their branch only
    - admin unimpersonated: platform-wide
    - admin impersonating: that branch

Response row shape:
    {sub_id, user_id, name, phone, address, plan_name, meals_left, days_left}
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from shared import server

router = APIRouter()


@router.get("/admin/active-dining-details")
async def admin_active_dining_details(
    as_mess_id: Optional[str] = None,
    user: server.User = Depends(server.get_current_user),
):
    if user.role not in ("admin", "mess_owner", "staff"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)

    # A dining subscription is anything active that ISN'T explicitly tiffin.
    # We mirror the /admin/active-tiffin-details predicate so the two tiles
    # partition the active-subs universe correctly.
    sub_query: dict = {
        "status": "active",
        "$and": [
            {"$or": [
                {"service_type": {"$exists": False}},
                {"service_type": None},
                {"service_type": ""},
                {"service_type": {"$ne": "tiffin"}},
            ]},
            {"$or": [
                {"category": {"$exists": False}},
                {"category": None},
                {"category": ""},
                {"category": {"$ne": "tiffin"}},
            ]},
        ],
    }
    if mid:
        sub_query["mess_id"] = mid

    subs = await server.db.subscriptions.find(sub_query, {"_id": 0}).to_list(1000)
    ids = list({s.get("user_id") for s in subs if s.get("user_id")})

    users_by_id: dict = {}
    if ids:
        async for u in server.db.users.find(
            {"user_id": {"$in": ids}},
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "address": 1},
        ):
            users_by_id[u["user_id"]] = u

    # iter-184 · Auto-pause detection · exclude subs where the user hasn't
    # scanned in >=4 consecutive days (matches server.py auto-pause rule).
    # Also excludes any explicit user_paused flag.
    from datetime import date, timedelta
    today = server.ist_today() if hasattr(server, "ist_today") else date.today()
    pause_cutoff = today - timedelta(days=4)
    last_scan_map: dict = {}
    if ids:
        async for a in server.db.attendance.find(
            {"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "date_str": 1},
        ).sort([("date_str", -1)]):
            uid = a["user_id"]
            if uid not in last_scan_map:
                last_scan_map[uid] = a.get("date_str")

    now = server.now_utc()
    rows = []
    for s in subs:
        uid = s.get("user_id")
        if s.get("user_paused"):
            continue
        last_scan = last_scan_map.get(uid)
        if last_scan:
            try:
                if date.fromisoformat(str(last_scan)[:10]) < pause_cutoff:
                    continue  # auto-paused (>=4 days no scan)
            except Exception:
                pass
        # No scan ever + started 4+ days ago → auto-paused
        elif s.get("start_date"):
            try:
                if date.fromisoformat(str(s["start_date"])[:10]) < pause_cutoff:
                    continue
            except Exception:
                pass
        u = users_by_id.get(uid) or {}
        meals_left = max(0, int(s.get("meals_total") or 0) - int(s.get("meals_used") or 0))
        try:
            end_dt = server.parse_dt(s["end_date"]) if s.get("end_date") else None
            days_left = max(0, (end_dt.date() - now.date()).days) if end_dt else 0
        except Exception:  # noqa: BLE001
            days_left = 0
        meals_left = min(meals_left, days_left * 2 or meals_left)
        rows.append({
            "sub_id": s.get("sub_id"),
            "user_id": uid,
            "name": u.get("name") or "—",
            "phone": u.get("phone") or "",
            "address": u.get("address") or "",
            "plan_name": s.get("plan_name") or s.get("plan_id") or "Dining",
            "meals_left": meals_left,
            "days_left": days_left,
            "renewal_date": s.get("end_date"),
        })

    rows.sort(key=lambda r: r["name"].lower())
    return {"count": len(rows), "rows": rows, "mess_id": mid}
