"""iter-172 · Active tiffin subscriber details endpoint.

Powers the mess-owner dashboard's Active Tiffin popup. Returns a list of
active tiffin subscribers along with today's delivery status per meal
(delivered / pending / — for meals whose slot isn't reached yet) and user
contact info (name, phone, address).

Scoped by `effective_mess_id()`:
    - mess_owner: their branch only
    - admin unimpersonated: platform-wide
    - admin impersonating: that branch
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from shared import server

router = APIRouter()


@router.get("/admin/active-tiffin-details")
async def admin_active_tiffin_details(
    as_mess_id: Optional[str] = None,
    user: server.User = Depends(server.get_current_user),
):
    if user.role not in ("admin", "mess_owner", "staff"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)

    sub_query: dict = {
        "status": "active",
        "$or": [{"service_type": "tiffin"}, {"category": "tiffin"}],
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

    # iter-184 · Auto-pause exclusion — mirror the /admin/active-dining-details
    # rule: subs with no scan for 4+ consecutive days OR user_paused=true are
    # in the auto-pause window and shouldn't count against today's raw-material
    # prep or the "currently active tiffin users" tile.
    from datetime import date, timedelta
    today_d = server.ist_today() if hasattr(server, "ist_today") else date.today()
    pause_cutoff = today_d - timedelta(days=4)
    last_scan_map: dict = {}
    if ids:
        async for a in server.db.attendance.find(
            {"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "date_str": 1},
        ).sort([("date_str", -1)]):
            uid = a["user_id"]
            if uid not in last_scan_map:
                last_scan_map[uid] = a.get("date_str")

    def _is_auto_paused(sub: dict) -> bool:
        if sub.get("user_paused"):
            return True
        uid = sub.get("user_id")
        last_scan = last_scan_map.get(uid)
        try:
            if last_scan:
                return date.fromisoformat(str(last_scan)[:10]) < pause_cutoff
            if sub.get("start_date"):
                return date.fromisoformat(str(sub["start_date"])[:10]) < pause_cutoff
        except Exception:
            pass
        return False

    # Today's attendance rows key the "delivered" status per meal for tiffin
    # subs (each attendance row = one meal delivered / marked collected).
    date_str = server.today_str()
    att_map: dict = {}  # user_id → {"lunch": bool, "dinner": bool}
    async for a in server.db.attendance.find(
        {"date_str": date_str, "user_id": {"$in": ids}},
        {"_id": 0, "user_id": 1, "meal_type": 1},
    ):
        d = att_map.setdefault(a["user_id"], {"lunch": False, "dinner": False})
        m = str(a.get("meal_type") or "").lower()
        if m in d:
            d[m] = True

    rows = []
    for s in subs:
        if _is_auto_paused(s):
            continue  # iter-184 · not currently receiving tiffins
        uid = s.get("user_id")
        u = users_by_id.get(uid) or {}
        att = att_map.get(uid) or {"lunch": False, "dinner": False}
        rows.append({
            "sub_id": s.get("sub_id"),
            "user_id": uid,
            "name": u.get("name") or "—",
            "phone": u.get("phone") or "",
            "address": u.get("address") or "",
            "plan_name": s.get("plan_name") or s.get("plan_id") or "Tiffin",
            "meal_window": s.get("meal_window") or "both",
            "lunch_delivered": bool(att.get("lunch")),
            "dinner_delivered": bool(att.get("dinner")),
        })

    rows.sort(key=lambda r: (
        # Pending first (both not delivered), then partial, then complete.
        (1 if r["lunch_delivered"] and r["dinner_delivered"] else 0),
        r["name"].lower(),
    ))
    return {
        "date": date_str,
        "count": len(rows),
        "rows": rows,
        "mess_id": mid,
    }
