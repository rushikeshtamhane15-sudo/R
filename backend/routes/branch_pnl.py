"""Branch P&L card — iter-86 #5.

Surfaces a one-glance scoreboard for each branch:
  • Today's revenue (orders + new subscriptions started today)
  • Window revenue (7d / 30d default 30d)
  • Fixed costs (admin-configurable per-branch in `app_settings._id="branch_costs:{mess_id}"`)
  • Gross margin (window revenue - fixed costs * days_in_window)
  • % target hit (window revenue / target * 100), target also CMS-configurable

Designed to keep franchise owners engaged with their own scoreboard.

Endpoints:
  GET  /api/admin/branch-pnl?days=30           → P&L for caller's branch
  GET  /api/admin/branch-pnl?days=30&mess_id=X → HQ-only override
  GET  /api/admin/branch-pnl/config            → fixed_daily_cost + monthly_target
  POST /api/admin/branch-pnl/config            → admin-only update
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()
IST = timezone(timedelta(hours=5, minutes=30))


def _cost_key(mess_id: Optional[str]) -> str:
    return f"branch_costs:{mess_id or 'default'}"


async def _resolve_target(user, mess_id_param: Optional[str]) -> Optional[str]:
    if user.role == "franchise_owner":
        doc = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        return (doc or {}).get("mess_id")
    return mess_id_param


async def _load_costs(mess_id: Optional[str]) -> dict:
    doc = await server.db.app_settings.find_one({"_id": _cost_key(mess_id)}, {"_id": 0})
    return {
        "fixed_daily_cost": int((doc or {}).get("fixed_daily_cost") or 1500),
        "monthly_target": int((doc or {}).get("monthly_target") or 150000),
    }


async def _window_revenue(mess_id: Optional[str], days: int) -> dict:
    since_dt = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    since = server.iso(since_dt)
    q_orders: dict = {"status": {"$in": ["paid", "pending_collection"]}, "created_at": {"$gte": since}}
    q_subs: dict = {"start_date": {"$gte": since}}
    if mess_id:
        q_orders["mess_id"] = mess_id
        q_subs["mess_id"] = mess_id
    orders = await server.db.mess_menu_orders.find(q_orders, {"_id": 0, "total": 1, "created_at": 1}).to_list(50000)
    subs = await server.db.subscriptions.find(q_subs, {"_id": 0, "amount_paid": 1, "start_date": 1}).to_list(20000)
    order_rev = sum(int(o.get("total") or 0) for o in orders)
    sub_rev = sum(int(s.get("amount_paid") or 0) for s in subs)
    # Today's slice (IST midnight bucket)
    today_str = datetime.now(IST).strftime("%Y-%m-%d")
    today_orders = sum(int(o.get("total") or 0) for o in orders if str(o.get("created_at") or "")[:10] == today_str)
    today_subs = sum(int(s.get("amount_paid") or 0) for s in subs if str(s.get("start_date") or "")[:10] == today_str)
    return {
        "order_revenue_window": order_rev,
        "sub_revenue_window": sub_rev,
        "total_revenue_window": order_rev + sub_rev,
        "today_revenue": today_orders + today_subs,
        "order_count_window": len(orders),
        "sub_count_window": len(subs),
    }


@router.get("/admin/branch-pnl")
async def branch_pnl(days: int = 30, mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    days = max(1, min(90, int(days)))
    target = await _resolve_target(user, mess_id)
    rev = await _window_revenue(target, days)
    costs = await _load_costs(target)
    period_cost = costs["fixed_daily_cost"] * days
    gross_margin = rev["total_revenue_window"] - period_cost
    pct_target = round((rev["total_revenue_window"] / costs["monthly_target"]) * 100, 1) if costs["monthly_target"] else 0
    return {
        **rev,
        "fixed_daily_cost": costs["fixed_daily_cost"],
        "monthly_target": costs["monthly_target"],
        "period_cost": period_cost,
        "gross_margin": gross_margin,
        "gross_margin_pct": round((gross_margin / rev["total_revenue_window"]) * 100, 1) if rev["total_revenue_window"] else 0,
        "pct_target_hit": pct_target,
        "days": days,
        "mess_id": target,
        "scope": "branch" if target else "global",
    }


class CostsIn(BaseModel):
    fixed_daily_cost: int = Field(..., ge=0, le=1_000_000)
    monthly_target: int = Field(..., ge=0, le=100_000_000)


@router.get("/admin/branch-pnl/config")
async def get_pnl_config(mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    target = await _resolve_target(user, mess_id)
    return {"mess_id": target, **(await _load_costs(target))}


@router.post("/admin/branch-pnl/config")
async def set_pnl_config(payload: CostsIn, mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    # iter-86 #5: HQ admin sets per-branch costs (or default); franchise can
    # update only their own branch's costs.
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    target = await _resolve_target(user, mess_id)
    await server.db.app_settings.update_one(
        {"_id": _cost_key(target)},
        {"$set": {
            "fixed_daily_cost": payload.fixed_daily_cost,
            "monthly_target": payload.monthly_target,
            "mess_id": target,
            "updated_at": server.iso(server.now_utc()),
            "updated_by": user.user_id,
        }},
        upsert=True,
    )
    return await get_pnl_config(mess_id=mess_id, user=user)
