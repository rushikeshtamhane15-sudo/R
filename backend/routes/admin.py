"""Admin router — users, role, stats, attendance.

Extracted from server.py — same late-binding pattern as routes/auth and
routes/payments. Wallet override + cron triggers stay in server.py for now
since they touch many internals. Future iterations can move more here.
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException

import server  # late-binding access

router = APIRouter()


@router.get("/admin/stats")
async def admin_stats(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    total_users = await server.db.users.count_documents({})
    total_subscribers = await server.db.users.count_documents({"role": "subscriber"})
    active_subs = await server.db.subscriptions.count_documents({"status": "active"})
    d = server.today_str()
    today_att = await server.db.attendance.count_documents({"date_str": d})
    paid = await server.db.payment_orders.find({"status": "paid"}, {"_id": 0}).to_list(10000)
    revenue = sum(float(p.get("amount", 0)) for p in paid)
    trend = []
    for i in range(6, -1, -1):
        day = (server.now_utc() - timedelta(days=i)).strftime("%Y-%m-%d")
        cnt = await server.db.attendance.count_documents({"date_str": day})
        trend.append({"date": day, "count": cnt})
    return {
        "total_users": total_users,
        "total_subscribers": total_subscribers,
        "active_subscriptions": active_subs,
        "today_attendance": today_att,
        "revenue": round(revenue, 2),
        "currency": "INR",
        "attendance_trend": trend,
    }


@router.get("/admin/attendance/today")
async def admin_today_attendance(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    d = server.today_str()
    recs = await server.db.attendance.find({"date_str": d}, {"_id": 0}).sort("checked_at", -1).to_list(500)
    return {"attendance": recs}


@router.get("/admin/users")
async def admin_users(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    users = await server.db.users.find({}, {"_id": 0}).to_list(1000)
    return {"users": users}


@router.post("/admin/role")
async def admin_set_role(payload: server.SetRoleRequest, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await server.db.users.update_one(
        {"email": payload.email.lower()}, {"$set": {"role": payload.role}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}
