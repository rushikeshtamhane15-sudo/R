"""Iter-59 #8: Unified control-tower endpoint.

Single GET that returns every live tracking signal the admin would otherwise
have to hunt across five different pages. Heavy aggregation, all under one
route, served fresh for the AdminControlTower page.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from shared import server

router = APIRouter()


def _today_window():
    today = server.now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = today + timedelta(days=1)
    return today.isoformat(), tomorrow.isoformat()


@router.get("/admin/control-tower")
async def control_tower(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff/franchise only")
    db = server.db
    start, end = _today_window()
    now = server.now_utc()
    five_min_ago = (now - timedelta(minutes=5)).isoformat()
    three_min_ago = (now - timedelta(minutes=3)).isoformat()

    # iter-94 #3: franchise_owner sees ONLY their branch's data. Build a
    # user_id filter once and stamp it onto every order/scan/payment count.
    branch_mess_id: str | None = None
    branch_user_filter: dict = {}
    if user.role == "franchise_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned")
        branch_mess_id = m["mess_id"]
        user_ids: list = []
        async for u in db.users.find({"mess_id": branch_mess_id}, {"_id": 0, "user_id": 1}):
            uid = u.get("user_id")
            if uid:
                user_ids.append(uid)
        branch_user_filter = {"user_id": {"$in": user_ids}}

    def with_branch(q: dict) -> dict:
        if not branch_user_filter:
            return q
        return {**q, **branch_user_filter}

    # --- TODAY totals ----------------------------------------------------
    scans = await db.scans.count_documents(with_branch({"created_at": {"$gte": start, "$lt": end}}))
    cash = 0.0
    online = 0.0
    async for d in db.payment_orders.find(
        with_branch({"status": "paid", "created_at": {"$gte": start, "$lt": end}}),
        {"_id": 0, "amount": 1, "payment_mode": 1},
    ):
        amt = float(d.get("amount") or 0)
        if d.get("payment_mode") == "cash":
            cash += amt
        else:
            online += amt
    tiffins_shipped = await db.delivery_orders.count_documents(with_branch({
        "created_at": {"$gte": start, "$lt": end},
        "status": {"$in": ["dispatched", "out_for_delivery", "delivered"]},
    }))

    # --- LIVE ops --------------------------------------------------------
    tiffin_active = await db.delivery_orders.count_documents(with_branch({
        "status": {"$in": ["dispatched", "out_for_delivery"]},
    }))
    restaurant_active = await db.restaurant_orders.count_documents(with_branch({
        "status": {"$in": ["confirmed", "preparing", "ready", "out_for_delivery"]},
    }))
    # Riders/staff "online" counts: franchise sees only riders/staff whose
    # mess_id matches their branch (admin sees global).
    rider_extra: dict = {"mess_id": branch_mess_id} if branch_mess_id else {}
    tiffin_riders_online = await db.users.count_documents({
        "role": "delivery_boy",
        "last_seen_at": {"$gte": three_min_ago},
        **rider_extra,
    })
    restaurant_riders_online = await db.users.count_documents({
        "role": "rider",
        "last_seen_at": {"$gte": three_min_ago},
        **rider_extra,
    })
    staff_online = await db.users.count_documents({
        "role": {"$in": ["staff", "admin"]},
        "last_seen_at": {"$gte": five_min_ago},
        **rider_extra,
    })
    admins_online = await db.users.count_documents({
        "role": "admin",
        "last_seen_at": {"$gte": five_min_ago},
        **({} if branch_mess_id else {}),  # admin role is global; keep unfiltered
    }) if not branch_mess_id else 0
    counter_staff_online = await db.users.count_documents({
        "role": "staff",
        "last_seen_at": {"$gte": five_min_ago},
        **rider_extra,
    })

    # --- ALERTS ----------------------------------------------------------
    pending_amt = 0.0
    pending_count = 0
    async for d in db.payment_orders.find(
        with_branch({"status": "paid", "payment_mode": "cash", "deposited_to_bank": {"$ne": True}}),
        {"_id": 0, "amount": 1},
    ):
        pending_amt += float(d.get("amount") or 0)
        pending_count += 1
    # iter-94 #3: kitchen-fraud alerts are global-only (not branch-tagged).
    kitchen_alerts = 0 if branch_mess_id else await db.admin_notifications.count_documents({
        "kind": "kitchen_fraud_alert",
        "read": {"$ne": True},
    })

    return {
        "today": {
            "tiffins_shipped": tiffins_shipped,
            "scans": scans,
            "cash": round(cash, 2),
            "online": round(online, 2),
        },
        "live": {
            "tiffin_deliveries_active": tiffin_active,
            "tiffin_riders_online": tiffin_riders_online,
            "restaurant_orders_active": restaurant_active,
            "restaurant_riders_online": restaurant_riders_online,
            "staff_online": staff_online,
            "admins_online": admins_online,
            "counter_staff_online": counter_staff_online,
        },
        "notifications": {
            "pending_bank_amt": round(pending_amt, 2),
            "pending_bank_count": pending_count,
            "kitchen_alerts": kitchen_alerts,
        },
        "as_of": server.iso(now),
        "scope": "branch" if branch_mess_id else "global",
        "mess_id": branch_mess_id,
    }
