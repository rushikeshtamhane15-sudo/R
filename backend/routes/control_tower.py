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
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    db = server.db
    start, end = _today_window()
    now = server.now_utc()
    five_min_ago = (now - timedelta(minutes=5)).isoformat()
    three_min_ago = (now - timedelta(minutes=3)).isoformat()

    # --- TODAY totals ----------------------------------------------------
    scans = await db.scans.count_documents({"created_at": {"$gte": start, "$lt": end}})
    # Cash collected today
    cash = 0.0
    online = 0.0
    async for d in db.payment_orders.find(
        {"status": "paid", "created_at": {"$gte": start, "$lt": end}},
        {"_id": 0, "amount": 1, "payment_mode": 1},
    ):
        amt = float(d.get("amount") or 0)
        if d.get("payment_mode") == "cash":
            cash += amt
        else:
            online += amt
    # Tiffins shipped today (sum of "out_for_delivery" + "delivered" tiffin orders)
    tiffins_shipped = await db.delivery_orders.count_documents({
        "created_at": {"$gte": start, "$lt": end},
        "status": {"$in": ["dispatched", "out_for_delivery", "delivered"]},
    })

    # --- LIVE ops --------------------------------------------------------
    tiffin_active = await db.delivery_orders.count_documents({
        "status": {"$in": ["dispatched", "out_for_delivery"]},
    })
    restaurant_active = await db.restaurant_orders.count_documents({
        "status": {"$in": ["confirmed", "preparing", "ready", "out_for_delivery"]},
    })
    tiffin_riders_online = await db.users.count_documents({
        "role": "delivery_boy",
        "last_seen_at": {"$gte": three_min_ago},
    })
    restaurant_riders_online = await db.users.count_documents({
        "role": "rider",
        "last_seen_at": {"$gte": three_min_ago},
    })
    staff_online = await db.users.count_documents({
        "role": {"$in": ["staff", "admin"]},
        "last_seen_at": {"$gte": five_min_ago},
    })
    admins_online = await db.users.count_documents({
        "role": "admin",
        "last_seen_at": {"$gte": five_min_ago},
    })
    counter_staff_online = await db.users.count_documents({
        "role": "staff",
        "last_seen_at": {"$gte": five_min_ago},
    })

    # --- ALERTS ----------------------------------------------------------
    pending_amt = 0.0
    pending_count = 0
    async for d in db.payment_orders.find(
        {"status": "paid", "payment_mode": "cash", "deposited_to_bank": {"$ne": True}},
        {"_id": 0, "amount": 1},
    ):
        pending_amt += float(d.get("amount") or 0)
        pending_count += 1
    kitchen_alerts = await db.admin_notifications.count_documents({
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
    }
