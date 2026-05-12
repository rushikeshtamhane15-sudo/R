"""Admin WhatsApp tooling — outbox listing + resend.

Lets admin audit branded message previews + retry a failed/stub send once
real MSG91 templates are approved (so messages from stub-mode can be re-fired
to capture the real send).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared import server  # late-binding via shared shim
import whatsapp

router = APIRouter()


class ResendPayload(BaseModel):
    event_id: str | None = None  # outbox row id (mongo _id is internal; we store ts as fallback key)
    phone: str
    kind: str  # registration | payment_success | expiry_reminder | restaurant_order | delivery_otp
    vars: dict


@router.get("/admin/whatsapp/outbox")
async def admin_wa_outbox(limit: int = 50, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    limit = max(1, min(500, int(limit)))
    rows = await server.db.whatsapp_outbox.find({}, {"_id": 0}).sort("ts", -1).to_list(limit)
    counts = {
        "total": await server.db.whatsapp_outbox.estimated_document_count(),
        "stub_mode_now": whatsapp.is_stub_mode(),
        "live_sent": await server.db.whatsapp_outbox.count_documents({"status": "live"}),
        "stub_logged": await server.db.whatsapp_outbox.count_documents({"status": "stub_mode"}),
        "errored": await server.db.whatsapp_outbox.count_documents({"status": "error"}),
    }
    return {"events": rows, "counts": counts}


@router.post("/admin/whatsapp/resend")
async def admin_wa_resend(payload: ResendPayload, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Admin only")
    senders = {
        "registration": lambda: whatsapp.send_registration(server.db, phone=payload.phone, name=payload.vars.get("name", "")),
        "payment_success": lambda: whatsapp.send_payment_success(server.db, phone=payload.phone, name=payload.vars.get("name", ""), amount=float(payload.vars.get("amount") or 0), plan_name=payload.vars.get("plan_name", ""), invoice_url=payload.vars.get("invoice_url")),
        "expiry_reminder": lambda: whatsapp.send_expiry_reminder(server.db, phone=payload.phone, name=payload.vars.get("name", ""), days_left=int(payload.vars.get("days_left") or 0), plan_name=payload.vars.get("plan_name", ""), end_date=payload.vars.get("end_date", "")),
        "restaurant_order": lambda: whatsapp.send_restaurant_order_confirmation(server.db, phone=payload.phone, name=payload.vars.get("name", ""), order_id=payload.vars.get("order_id", ""), total=float(payload.vars.get("total") or 0), eta_minutes=int(payload.vars.get("eta_minutes") or 40)),
        "delivery_otp": lambda: whatsapp.send_delivery_otp(server.db, phone=payload.phone, name=payload.vars.get("name", ""), otp=payload.vars.get("otp", ""), order_id=payload.vars.get("order_id", "")),
    }
    fn = senders.get(payload.kind)
    if not fn:
        raise HTTPException(400, f"Unknown kind: {payload.kind}")
    try:
        res = await fn()
        return {"ok": True, "result": res, "stub_mode": whatsapp.is_stub_mode()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Resend failed: {e}")
