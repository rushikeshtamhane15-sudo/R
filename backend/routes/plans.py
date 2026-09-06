"""Plans router — subscription plan CRUD.

Extracted from server.py (iter-47 refactor). Uses the shared.server
late-binding shim so route handlers can call server.* helpers without
creating a circular import at module-load time.
"""
from __future__ import annotations

import base64
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from shared import server

router = APIRouter()

# iter-131.18: valid icons for structured plan-feature bullets. Keep in sync
# with the AdminPlans <FeaturesEditor /> dropdown + Plans.jsx icon renderer.
_VALID_BULLET_ICONS = {"leaf", "clock", "star", "check", "truck", "utensils", "zap", "heart", "shield", "flame"}


def _clean_bullets(items):
    """Normalise a list of {icon, text} entries — drop empties, cap length."""
    if not items:
        return None
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        text = str(it.get("text") or "").strip()
        if not text:
            continue
        icon = str(it.get("icon") or "check").strip().lower()
        if icon not in _VALID_BULLET_ICONS:
            icon = "check"
        out.append({"icon": icon, "text": text[:120]})
    return out if out else None


@router.get("/plans")
async def get_plans(request: Request, mess_id: Optional[str] = None):
    await server.seed_plans()
    # iter-143 · efoodtech: multi-tenant plan scoping.
    #   • Explicit ?mess_id=... wins.
    #   • Else use the logged-in user's mess_id (from session cookie / Bearer).
    #   • Else return DEFAULT (efoodcare-amravati) so unauthenticated visitors
    #     still see something instead of an empty list.
    target_mess_id: Optional[str] = mess_id or None
    if not target_mess_id:
        try:
            token = request.cookies.get("session_token")
            if not token:
                auth_h = request.headers.get("Authorization", "")
                if auth_h.startswith("Bearer "):
                    token = auth_h[7:]
            if token:
                session = await server.db.user_sessions.find_one({"session_token": token}, {"_id": 0})
                if session:
                    u = await server.db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "mess_id": 1})
                    if u and u.get("mess_id"):
                        target_mess_id = u["mess_id"]
        except Exception:  # noqa: BLE001
            pass
    q: dict = {"active": True}
    if target_mess_id:
        q["mess_id"] = target_mess_id
    else:
        q["mess_id"] = server.DEFAULT_MESS_ID
    plans = await server.db.plans.find(q, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return {"plans": plans, "mess_id": target_mess_id or server.DEFAULT_MESS_ID}


@router.get("/admin/plans")
async def admin_list_plans(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    # iter-143 · efoodtech: franchise owners see only their mess's plans
    q: dict = {}
    if user.role == "franchise_owner":
        m = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            return {"plans": []}
        q["mess_id"] = m["mess_id"]
    plans = await server.db.plans.find(q, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return {"plans": plans}


@router.post("/admin/plans")
async def admin_upsert_plan(payload: server.PlanUpsert, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    plan_id = payload.plan_id or f"plan_{uuid.uuid4().hex[:8]}"
    # iter-143 · efoodtech: pin plan to the owner's mess so it can't cross tenants
    target_mess_id = (payload.mess_id or "").strip() or None
    if user.role == "franchise_owner":
        m = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned to this account")
        target_mess_id = m["mess_id"]
    if not target_mess_id:
        target_mess_id = server.DEFAULT_MESS_ID
    doc = {
        "plan_id": plan_id,
        "mess_id": target_mess_id,
        "name": payload.name,
        "description": payload.description,
        "amount": float(payload.amount),
        "currency": payload.currency,
        "duration_days": int(payload.duration_days),
        "meals": int(payload.meals),
        "active": bool(payload.active),
        "sort_order": int(payload.sort_order),
        # iter-51 bifurcation
        "category": (payload.category or "dining").lower(),
        "meal_window": (payload.meal_window or "both").lower(),
        # iter-131.17: admin-editable bullet features
        "features_override": (payload.features_override or "").strip() or None,
        "features_extra": [s.strip() for s in (payload.features_extra or []) if s and s.strip()],
        # iter-131.18: structured bullets + hero image.
        "features_override_v2": _clean_bullets(payload.features_override_v2),
        "features_extra_v2": _clean_bullets(payload.features_extra_v2),
        "hero_image_url": (payload.hero_image_url or "").strip() or None,
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
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    # iter-144: franchise owners may only delete plans from their own mess.
    if user.role == "franchise_owner":
        m = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned to this account")
        plan = await server.db.plans.find_one({"plan_id": plan_id}, {"_id": 0, "mess_id": 1})
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        if plan.get("mess_id") != m["mess_id"]:
            raise HTTPException(status_code=403, detail="You can only delete plans that belong to your mess.")
    result = await server.db.plans.delete_one({"plan_id": plan_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"ok": True}


# iter-131.18: Plan hero image upload — Zomato-style full-bleed card bg.
# Stored as an optimised WebP data-URL right on the plans doc, so no
# separate CDN/storage is needed and images survive deploys.
_HERO_MAX_BYTES = 3 * 1024 * 1024   # 3 MB — hero images can be larger than logos
_HERO_MIME = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


@router.post("/admin/plans/{plan_id}/hero-image")
async def admin_upload_hero_image(
    plan_id: str,
    file: UploadFile = File(...),
    user: server.User = Depends(server.get_current_user),
):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    existing = await server.db.plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Plan not found")
    ct = (file.content_type or "").lower()
    if ct not in _HERO_MIME:
        raise HTTPException(status_code=400, detail="Only JPG / PNG / WEBP images allowed")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _HERO_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {_HERO_MAX_BYTES // (1024*1024)} MB)")
    try:
        from image_optim import optimize_to_webp_bytes
        payload = optimize_to_webp_bytes(data)
        mime = "image/webp"
    except Exception:  # noqa: BLE001
        payload, mime = data, ct
    data_url = f"data:{mime};base64," + base64.b64encode(payload).decode("ascii")
    await server.db.plans.update_one(
        {"plan_id": plan_id},
        {"$set": {"hero_image_url": data_url, "updated_at": server.iso(server.now_utc())}},
    )
    return {"plan_id": plan_id, "hero_image_url": data_url, "bytes": len(payload)}


@router.post("/admin/plans/{plan_id}/hero-image/reset")
async def admin_reset_hero_image(plan_id: str, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.plans.update_one(
        {"plan_id": plan_id},
        {"$set": {"hero_image_url": None, "updated_at": server.iso(server.now_utc())}},
    )
    return {"plan_id": plan_id, "hero_image_url": None}
