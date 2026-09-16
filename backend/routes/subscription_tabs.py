"""iter-171 · Subscription tabs API.

Serves the Active / Expiring / Expired lists for the mess-owner and
super-admin dashboard tabs. Scoped by `effective_mess_id()` — mess owners
see only their branch, unimpersonated super-admins see the platform view.

Tabs semantics:
    active   → status="active"  AND  end_date > today + 3 days
    expiring → status="active"  AND  end_date within next 3 days (inclusive)
    expired  → status IN ("expired", "cancelled")

Response row shape (matches the screenshot the user posted):
    { user_id, name, plan_name, meals_left, renewal (ISO date), status_label }
"""
from __future__ import annotations

from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from shared import server

router = APIRouter()

TabName = Literal["active", "expiring", "expired"]


@router.get("/admin/subscriptions/tabs")
async def admin_subscription_tabs(
    tab: TabName = Query(default="active"),
    limit: int = Query(default=200, ge=1, le=1000),
    as_mess_id: Optional[str] = None,
    user: server.User = Depends(server.get_current_user),
):
    if user.role not in ("admin", "mess_owner", "staff"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await server.effective_mess_id(user, as_mess_id)

    now = server.now_utc()
    soon_cutoff = server.iso(now + timedelta(days=3))

    query: dict = {}
    if mid:
        query["mess_id"] = mid

    if tab == "expired":
        query["status"] = {"$in": ["expired", "cancelled"]}
    else:
        query["status"] = "active"
        if tab == "expiring":
            query["end_date"] = {"$lte": soon_cutoff}
        else:  # active — strictly beyond the 3-day expiring window
            query["end_date"] = {"$gt": soon_cutoff}

    subs_cursor = server.db.subscriptions.find(query, {"_id": 0}).sort("end_date", 1 if tab != "expired" else -1)
    subs = await subs_cursor.to_list(limit)

    # Batch-hydrate users
    ids = list({s.get("user_id") for s in subs if s.get("user_id")})
    by_uid: dict = {}
    if ids:
        async for u in server.db.users.find(
            {"user_id": {"$in": ids}},
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "email": 1, "mess_id": 1},
        ):
            by_uid[u["user_id"]] = u

    rows = []
    for s in subs:
        u = by_uid.get(s.get("user_id")) or {}
        meals_left = max(0, int(s.get("meals_total") or 0) - int(s.get("meals_used") or 0))
        # iter-140 coherency clamp mirroring the SubscriberDashboard UI
        try:
            end_dt = server.parse_dt(s["end_date"]) if s.get("end_date") else None
            days_left = max(0, (end_dt.date() - now.date()).days) if end_dt else 0
        except Exception:  # noqa: BLE001
            days_left = 0
        meals_left = min(meals_left, days_left * 2 or meals_left)

        # Status label matches the pill in the user's screenshot
        raw_status = s.get("status") or "active"
        if raw_status == "active":
            status_label = "Expiring" if tab == "expiring" or days_left <= 3 else "Active"
        elif raw_status == "cancelled":
            status_label = "Cancelled"
        else:
            status_label = "Expired"

        rows.append({
            "sub_id": s.get("sub_id"),
            "user_id": s.get("user_id"),
            "name": u.get("name") or "—",
            "phone": u.get("phone"),
            "plan_id": s.get("plan_id"),
            "plan_name": s.get("plan_name") or s.get("plan_id") or "—",
            "service_type": s.get("service_type") or "dining",
            "meals_left": meals_left,
            "days_left": days_left,
            "renewal_date": s.get("end_date"),
            "status": raw_status,
            "status_label": status_label,
        })

    return {"tab": tab, "count": len(rows), "rows": rows, "mess_id": mid}
