"""Admin router — users, role, stats, attendance.

Extracted from server.py — same late-binding pattern as routes/auth and
routes/payments. Wallet override + cron triggers stay in server.py for now
since they touch many internals. Future iterations can move more here.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
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
    """Iter-55: upload landing CMS image as a data-URL stored in Mongo
    (survives production redeploys)."""
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
    import base64 as _b64
    from image_optim import optimize_to_webp_bytes
    webp = optimize_to_webp_bytes(data)
    data_url = "data:image/webp;base64," + _b64.b64encode(webp).decode("ascii")
    return {"url": data_url, "bytes": len(webp)}


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
async def admin_stats(
    user: server.User = Depends(server.get_current_user),
    period: str = "cycle",
    date: Optional[str] = None,
):
    """Iter-65 #10: revenue+attendance now respect a billing cycle that
    resets on the 6th of every month (5th = last day of cycle). Admin can
    also drill in via ?period=day|month|year|cycle&date=YYYY-MM-DD.

    `active_subscriptions` now only counts subs whose user still exists
    with role='subscriber' — stops phantom counts from orphaned seeds.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    if period not in {"day", "month", "year", "cycle"}:
        period = "cycle"

    # Anchor date for the requested window — defaults to "today" (IST).
    IST = timezone(timedelta(hours=5, minutes=30))
    now_ist = datetime.now(IST)
    try:
        anchor = datetime.fromisoformat(date).date() if date else now_ist.date()
    except Exception:  # noqa: BLE001
        anchor = now_ist.date()

    if period == "day":
        win_start = datetime(anchor.year, anchor.month, anchor.day, tzinfo=IST)
        win_end = win_start + timedelta(days=1)
        win_label = anchor.strftime("%a, %d %b %Y")
    elif period == "month":
        win_start = datetime(anchor.year, anchor.month, 1, tzinfo=IST)
        nm_year = anchor.year + (1 if anchor.month == 12 else 0)
        nm_month = 1 if anchor.month == 12 else anchor.month + 1
        win_end = datetime(nm_year, nm_month, 1, tzinfo=IST)
        win_label = anchor.strftime("%B %Y")
    elif period == "year":
        win_start = datetime(anchor.year, 1, 1, tzinfo=IST)
        win_end = datetime(anchor.year + 1, 1, 1, tzinfo=IST)
        win_label = str(anchor.year)
    else:  # cycle — 6th of last month → 6th of this month (anchor inside cycle)
        if anchor.day >= 6:
            cs_year, cs_month = anchor.year, anchor.month
        else:
            cs_year = anchor.year - (1 if anchor.month == 1 else 0)
            cs_month = 12 if anchor.month == 1 else anchor.month - 1
        win_start = datetime(cs_year, cs_month, 6, tzinfo=IST)
        ne_year = cs_year + (1 if cs_month == 12 else 0)
        ne_month = 1 if cs_month == 12 else cs_month + 1
        win_end = datetime(ne_year, ne_month, 6, tzinfo=IST)
        win_label = f"6 {win_start.strftime('%b')} → 5 {(win_end - timedelta(days=1)).strftime('%b %Y')}"

    win_start_iso = win_start.astimezone(timezone.utc).isoformat()
    win_end_iso = win_end.astimezone(timezone.utc).isoformat()

    total_users = await server.db.users.count_documents({})
    total_subscribers = await server.db.users.count_documents({"role": "subscriber"})

    # iter-65 #10 fix: only count subs whose user record still exists
    # with role=subscriber (drops orphans + seeded stale rows).
    active_subs = 0
    async for sub in server.db.subscriptions.find(
        {"status": "active"}, {"_id": 0, "user_id": 1},
    ):
        uid = sub.get("user_id")
        if not uid:
            continue
        owner = await server.db.users.find_one(
            {"user_id": uid, "role": "subscriber"}, {"_id": 0, "user_id": 1},
        )
        if owner:
            active_subs += 1

    # Today's attendance — still anchored to "today" (not the window) so
    # the Today's check-ins card always reads the live counter.
    d = server.today_str()
    today_att = await server.db.attendance.count_documents({"date_str": d})

    # Revenue inside the chosen window only
    revenue = 0.0
    async for p in server.db.payment_orders.find(
        {"status": "paid", "created_at": {"$gte": win_start_iso, "$lt": win_end_iso}},
        {"_id": 0, "amount": 1},
    ):
        revenue += float(p.get("amount", 0) or 0)

    # Attendance trend — last 7 days for the cycle view, full window otherwise (capped at 30 buckets)
    if period == "day":
        trend = [{"date": anchor.isoformat(), "count": today_att}]
    else:
        # Build day buckets across the window (capped at 31 entries)
        days_span = max(1, min(31, (win_end.date() - win_start.date()).days))
        trend = []
        for i in range(days_span):
            day = (win_start + timedelta(days=i)).strftime("%Y-%m-%d")
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
        "period": period,
        "period_label": win_label,
        "window_start": win_start.date().isoformat(),
        "window_end": (win_end - timedelta(seconds=1)).date().isoformat(),
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
    # iter-89 #2: franchise_owner can view users — scoped to their branch.
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    q: dict = {}
    if user.role == "franchise_owner":
        mess_doc = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        branch = (mess_doc or {}).get("mess_id")
        if branch:
            # Include themselves + anyone with mess_id matching their branch
            # OR any subscription tying them to this branch.
            sub_user_ids = [
                s["user_id"]
                async for s in server.db.subscriptions.find({"mess_id": branch}, {"_id": 0, "user_id": 1})
                if s.get("user_id")
            ]
            q = {"$or": [{"mess_id": branch}, {"user_id": {"$in": sub_user_ids + [user.user_id]}}]}
        else:
            q = {"user_id": user.user_id}
    users = await server.db.users.find(q, {"_id": 0}).to_list(1000)
    return {"users": users}


# Roles a franchise_owner is allowed to ASSIGN (cannot create admin /
# franchise_owner, that's HQ-only).
FRANCHISE_ASSIGNABLE_ROLES = {"subscriber", "staff", "rider", "delivery_boy"}


@router.post("/admin/role")
async def admin_set_role(payload: server.SetRoleRequest, user: server.User = Depends(server.get_current_user)):
    # iter-89 #2: franchise_owner can assign limited roles within their branch.
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if not payload.email and not payload.phone:
        raise HTTPException(status_code=400, detail="email or phone required")
    if user.role == "franchise_owner" and payload.role not in FRANCHISE_ASSIGNABLE_ROLES:
        raise HTTPException(status_code=403, detail=f"Franchise can only assign: {', '.join(sorted(FRANCHISE_ASSIGNABLE_ROLES))}")
    query = {}
    if payload.email:
        query["email"] = payload.email.strip().lower()
    if payload.phone:
        query["phone"] = payload.phone.strip()
    if payload.email and payload.phone:
        match = {"$or": [{"email": query["email"]}, {"phone": query["phone"]}]}
    else:
        match = query
    # Franchise can only update users in their own branch — refuse if the
    # target user has a different mess_id or a higher-privilege role.
    if user.role == "franchise_owner":
        mess_doc = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        branch = (mess_doc or {}).get("mess_id")
        target = await server.db.users.find_one(match, {"_id": 0, "user_id": 1, "mess_id": 1, "role": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("role") in ("admin", "franchise_owner"):
            raise HTTPException(status_code=403, detail="Cannot change role of admin or another franchise owner")
        # Pin the user to this franchise's branch when assigning a role.
        result = await server.db.users.update_one(
            {"user_id": target["user_id"]},
            {"$set": {"role": payload.role, "mess_id": branch}},
        )
    else:
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
