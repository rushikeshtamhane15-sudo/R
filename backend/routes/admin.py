"""Admin router — users, role, stats, attendance.

Extracted from server.py — same late-binding pattern as routes/auth and
routes/payments. Wallet override + cron triggers stay in server.py for now
since they touch many internals. Future iterations can move more here.
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from shared import server  # late-binding via shared shim

router = APIRouter()


# Reuse the same upload pipeline as the menu image upload so admins get
# WebP optimization + size cap + extension whitelist consistently.
_LANDING_EXT_BY_MIME = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
}
_LANDING_MAX_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/admin/landing/upload-image")
async def admin_landing_upload_image(
    file: UploadFile = File(...),
    user: server.User = Depends(server.get_current_user),
):
    """Upload an image for the /home (landing) CMS. Saves to
    /api/uploads/landing_images/<uuid>.<ext> and returns the public URL.
    Mirrors the menu image upload pipeline (WebP optimization + size cap).
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    ext = _LANDING_EXT_BY_MIME.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPG / PNG / WEBP / GIF supported")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _LANDING_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 5 MB)")
    from pathlib import Path
    from image_optim import optimize_to_webp

    upload_root = Path(__file__).resolve().parent.parent / "uploads"
    folder = upload_root / "landing_images"
    folder.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = folder / fname
    written = optimize_to_webp(data, fpath)
    final_name = (
        fpath.with_suffix(".webp").name
        if (folder / fname.replace(ext, ".webp")).exists()
        else fname
    )
    return {"url": f"/api/uploads/landing_images/{final_name}", "bytes": written}


class RiderApplyRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=10, max_length=15)
    licence_no: str = Field(min_length=4, max_length=30)
    bike_number: str = Field(min_length=4, max_length=20)
    bank_acc_last4: str = Field(min_length=4, max_length=4)
    city: str = Field(min_length=2, max_length=60)


class RiderApplyDecision(BaseModel):
    decision: Literal["approve", "reject"]
    notes: Optional[str] = None


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
    # Enrich each attendance row with the user's name + phone so the admin
    # "today's check-ins" list shows WHO checked in, not just IDs. We batch-load
    # the user profiles via a single $in lookup and stitch them in.
    user_ids = list({r.get("user_id") for r in recs if r.get("user_id")})
    profiles: dict = {}
    if user_ids:
        cursor = server.db.users.find(
            {"user_id": {"$in": user_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "profile_photo_url": 1},
        )
        async for u in cursor:
            profiles[u["user_id"]] = u
    for r in recs:
        p = profiles.get(r.get("user_id"), {})
        r["subscriber_name"] = p.get("name")
        r["subscriber_phone"] = p.get("phone")
        r["profile_photo_url"] = p.get("profile_photo_url")
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
    if not payload.email and not payload.phone:
        raise HTTPException(status_code=400, detail="email or phone required")
    query = {}
    if payload.email:
        query["email"] = payload.email.strip().lower()
    if payload.phone:
        query["phone"] = payload.phone.strip()
    # Match user by EITHER email OR phone (using $or so admins can pass just one)
    if payload.email and payload.phone:
        match = {"$or": [{"email": query["email"]}, {"phone": query["phone"]}]}
    else:
        match = query
    result = await server.db.users.update_one(match, {"$set": {"role": payload.role}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Self-service rider application — any logged-in user can submit
# ---------------------------------------------------------------------------
@router.post("/rider/apply")
async def rider_apply(payload: RiderApplyRequest, user: server.User = Depends(server.get_current_user)):
    # Block duplicates — only one PENDING application per user at a time
    existing = await server.db.rider_applications.find_one(
        {"user_id": user.user_id, "status": "pending"}, {"_id": 0}
    )
    if existing:
        raise HTTPException(status_code=400, detail="Application already pending. Please wait for admin review.")
    doc = {
        "application_id": f"rapp_{uuid.uuid4().hex[:14]}",
        "user_id": user.user_id,
        "full_name": payload.full_name.strip(),
        "phone": payload.phone.strip(),
        "licence_no": payload.licence_no.strip(),
        "bike_number": payload.bike_number.strip().upper(),
        "bank_acc_last4": payload.bank_acc_last4.strip(),
        "city": payload.city.strip(),
        "status": "pending",
        "created_at": server.iso(server.now_utc()),
    }
    await server.db.rider_applications.insert_one(dict(doc))
    return {"ok": True, "application": doc}


@router.get("/rider/apply/me")
async def rider_apply_me(user: server.User = Depends(server.get_current_user)):
    doc = await server.db.rider_applications.find_one(
        {"user_id": user.user_id}, {"_id": 0}, sort=[("created_at", -1)],
    )
    return {"application": doc}


@router.get("/admin/rider-applications")
async def admin_list_rider_applications(user: server.User = Depends(server.get_current_user), status: str = "pending"):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    q = {} if status == "all" else {"status": status}
    rows = await server.db.rider_applications.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"applications": rows}


@router.post("/admin/rider-applications/{application_id}/decide")
async def admin_decide_rider_application(application_id: str, payload: RiderApplyDecision, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    app_doc = await server.db.rider_applications.find_one({"application_id": application_id}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")
    if app_doc["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Already {app_doc['status']}")
    new_status = "approved" if payload.decision == "approve" else "rejected"
    updates = {
        "status": new_status,
        "decided_by": user.user_id,
        "decided_at": server.iso(server.now_utc()),
        "decision_notes": (payload.notes or "")[:500],
    }
    await server.db.rider_applications.update_one({"application_id": application_id}, {"$set": updates})
    if payload.decision == "approve":
        # Promote the user; carry over their bike + payout details onto the user doc
        await server.db.users.update_one(
            {"user_id": app_doc["user_id"]},
            {"$set": {
                "role": "rider",
                "rider_bike_number": app_doc.get("bike_number"),
                "rider_licence_no": app_doc.get("licence_no"),
                "rider_bank_acc_last4": app_doc.get("bank_acc_last4"),
                "rider_city": app_doc.get("city"),
            }},
        )
    fresh = await server.db.rider_applications.find_one({"application_id": application_id}, {"_id": 0})
    return {"ok": True, "application": fresh}
