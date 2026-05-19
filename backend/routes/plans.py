"""Plans router — subscription plan CRUD.

Extracted from server.py (iter-47 refactor). Uses the shared.server
late-binding shim so route handlers can call server.* helpers without
creating a circular import at module-load time.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from shared import server

router = APIRouter()


@router.get("/plans")
async def get_plans():
    await server.seed_plans()
    plans = await server.db.plans.find({"active": True}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return {"plans": plans}


@router.get("/admin/plans")
async def admin_list_plans(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    plans = await server.db.plans.find({}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return {"plans": plans}


@router.post("/admin/plans")
async def admin_upsert_plan(payload: server.PlanUpsert, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    plan_id = payload.plan_id or f"plan_{uuid.uuid4().hex[:8]}"
    doc = {
        "plan_id": plan_id,
        "name": payload.name,
        "description": payload.description,
        "amount": float(payload.amount),
        "currency": payload.currency,
        "duration_days": int(payload.duration_days),
        "meals": int(payload.meals),
        "active": bool(payload.active),
        "sort_order": int(payload.sort_order),
        "updated_at": server.iso(server.now_utc()),
    }
    existing = await server.db.plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if existing:
        await server.db.plans.update_one({"plan_id": plan_id}, {"$set": doc})
    else:
        doc["created_at"] = server.iso(server.now_utc())
        await server.db.plans.insert_one(doc.copy())
    return {"ok": True, "plan": await server.db.plans.find_one({"plan_id": plan_id}, {"_id": 0})}


@router.delete("/admin/plans/{plan_id}")
async def admin_delete_plan(plan_id: str, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await server.db.plans.delete_one({"plan_id": plan_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"ok": True}
