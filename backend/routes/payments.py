"""Payments router — Razorpay status, order creation, verify, and webhook.

All shared helpers (`_create_order_record`, `_activate_subscription`,
`_persist_webhook_event`, `validate_razorpay_keys`) stay in `server.py` so
they remain callable from non-route paths (e.g. startup hook). This module
is thin glue from HTTP → those helpers.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from shared import server  # late-binding via shared shim (avoids circular-import flag)

router = APIRouter()


# ---------------------------------------------------------------------------
# Razorpay key health
# ---------------------------------------------------------------------------
@router.get("/admin/payments/razorpay-status")
async def admin_razorpay_status(user: server.User = Depends(server.get_current_user)):
    """Live ping to Razorpay to confirm the keys in .env actually work."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return await server.validate_razorpay_keys()


@router.get("/admin/payments/webhook-events")
async def admin_list_webhook_events(limit: int = 25, user: server.User = Depends(server.get_current_user)):
    """Admin diagnostic — last N webhook events with signature verification status."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    limit = max(1, min(200, int(limit)))
    rows = await server.db.webhook_events.find({}, {"_id": 0}).sort("ts", -1).to_list(limit)
    counts = {
        "total": await server.db.webhook_events.estimated_document_count(),
        "signature_ok": await server.db.webhook_events.count_documents({"signature_ok": True}),
        "signature_failed": await server.db.webhook_events.count_documents({"signature_ok": False}),
        "no_secret": await server.db.webhook_events.count_documents({"signature_ok": None}),
    }
    return {"events": rows, "counts": counts}


# ---------------------------------------------------------------------------
# Order creation
# ---------------------------------------------------------------------------
@router.post("/payments/order")
async def create_payment_order(payload: server.CreateOrderRequest, user: server.User = Depends(server.get_current_user)):
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    missing = [f for f in ("name", "phone", "address", "photo_url") if not (user_doc.get(f) or "")]
    if missing:
        raise HTTPException(status_code=400, detail=f"Profile incomplete: missing {', '.join(missing)}")

    plan = await server.db.plans.find_one({"plan_id": payload.plan_id, "active": True}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid or inactive plan")

    return await server._create_order_record(
        user=user, user_doc=user_doc,
        plan_id=plan["plan_id"], plan_name=plan["name"],
        amount=float(plan["amount"]), currency=plan["currency"],
        duration_days=int(plan["duration_days"]), meals=int(plan["meals"]),
        custom=False,
    )


@router.post("/payments/custom-order")
async def create_custom_order(payload: server.CustomOrderRequest, user: server.User = Depends(server.get_current_user)):
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    missing = [f for f in ("name", "phone", "address", "photo_url") if not (user_doc.get(f) or "")]
    if missing:
        raise HTTPException(status_code=400, detail=f"Profile incomplete: missing {', '.join(missing)}")
    days = int(payload.days)
    if days < server.CUSTOM_MIN_DAYS or days > server.CUSTOM_MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Days must be between {server.CUSTOM_MIN_DAYS} and {server.CUSTOM_MAX_DAYS}")
    meals = days * server.MEALS_PER_DAY
    service_type = payload.service_type or "dining"
    tiffin_size = payload.tiffin_size if service_type == "tiffin" else None
    meal_price = server.MEAL_PRICE_HALF_INR if (service_type == "tiffin" and tiffin_size == "half") else server.MEAL_PRICE_INR
    amount = round(meals * meal_price, 2)
    name_suffix = "Tiffin" if service_type == "tiffin" else "Dining"
    if service_type == "tiffin" and tiffin_size:
        name_suffix = f"{tiffin_size.capitalize()} Tiffin"
    return await server._create_order_record(
        user=user, user_doc=user_doc,
        plan_id=f"custom_{service_type}_{days}d",
        plan_name=f"Custom {name_suffix} — {days} day{'s' if days > 1 else ''}",
        amount=amount, currency="INR",
        duration_days=days, meals=meals,
        custom=True,
        service_type=service_type,
        tiffin_size=tiffin_size,
        plan_type="delivery" if service_type == "tiffin" else "kiosk",
    )


@router.get("/plans/custom/preview")
async def custom_plan_preview(days: int, service_type: str = "dining", tiffin_size: Optional[str] = None):
    if days < server.CUSTOM_MIN_DAYS or days > server.CUSTOM_MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Days must be between {server.CUSTOM_MIN_DAYS} and {server.CUSTOM_MAX_DAYS}")
    meals = days * server.MEALS_PER_DAY
    meal_price = server.MEAL_PRICE_HALF_INR if (service_type == "tiffin" and tiffin_size == "half") else server.MEAL_PRICE_INR
    amount = round(meals * meal_price, 2)
    return {
        "days": days, "meals": meals, "meal_price": meal_price,
        "amount": amount, "currency": "INR",
        "per_day_amount": round(amount / days, 2),
        "service_type": service_type, "tiffin_size": tiffin_size if service_type == "tiffin" else None,
    }


# ---------------------------------------------------------------------------
# Payment verification + webhook receiver
# ---------------------------------------------------------------------------
@router.post("/payments/verify")
async def verify_payment(payload: server.VerifyPaymentRequest, user: server.User = Depends(server.get_current_user)):
    order = await server.db.payment_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if order.get("mock"):
        # [MOCKED] Razorpay stub — accept any signature in dev
        server.logger.warning(f"[MOCKED] Auto-verifying mock order {payload.order_id}")
    else:
        try:
            server.rzp_client.utility.verify_payment_signature({
                "razorpay_order_id": payload.order_id,
                "razorpay_payment_id": payload.razorpay_payment_id,
                "razorpay_signature": payload.razorpay_signature,
            })
        except Exception as e:
            server.logger.error(f"Signature verify failed: {e}")
            raise HTTPException(status_code=400, detail="Invalid payment signature")

    await server._activate_subscription(order)
    fresh = await server.db.payment_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    return {"ok": True, "status": fresh["status"], "sub_id": fresh.get("sub_id")}


@router.post("/webhook/razorpay")
async def rzp_webhook(request: Request):
    """Razorpay webhook receiver — every event recorded in db.webhook_events
    with signature_ok flag for ops visibility (admin /admin/payments/webhook-events).

    Returns 200 always (Razorpay retries on 4xx/5xx for ~1 day → spam).
    """
    import os
    import uuid
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")

    event_log: dict = {
        "event_id": f"wh_{uuid.uuid4().hex[:14]}",
        "ts": server.iso(server.now_utc()),
        "event": "",
        "signature_ok": None,
        "signature_error": None,
        "body_size": len(body or b""),
        "has_signature_header": bool(signature),
        "order_id": None,
        "payment_id": None,
        "amount": None,
        "processed": False,
        "processing_error": None,
        "ip": "",
    }
    try:
        from rate_limit import client_ip
        event_log["ip"] = client_ip(request)
    except Exception:
        pass

    # ---- 1) Signature verify ----
    if server.RZP_ENABLED and secret:
        try:
            server.rzp_client.utility.verify_webhook_signature(body.decode(), signature, secret)
            event_log["signature_ok"] = True
        except Exception as e:  # noqa: BLE001
            event_log["signature_ok"] = False
            event_log["signature_error"] = str(e)[:300]
            server.logger.error(f"[WEBHOOK] signature INVALID · sig_present={bool(signature)} · {e}")
            await server._persist_webhook_event(event_log)
            return {"received": False, "reason": "invalid_signature"}
    else:
        event_log["signature_ok"] = None
        event_log["signature_error"] = "RAZORPAY_WEBHOOK_SECRET not configured" if not secret else "Razorpay client disabled"
        server.logger.warning(f"[WEBHOOK] received but secret/keys missing → not processed · sig_present={bool(signature)}")
        await server._persist_webhook_event(event_log)
        return {"received": False, "reason": "secret_missing"}

    # ---- 2) Parse body ----
    try:
        data = await request.json()
    except Exception as e:  # noqa: BLE001
        event_log["processing_error"] = f"body parse failed: {e}"[:300]
        await server._persist_webhook_event(event_log)
        return {"received": False, "reason": "invalid_body"}

    event_log["event"] = data.get("event", "") or ""
    payload = data.get("payload") or {}
    order_entity = (payload.get("order") or {}).get("entity") or {}
    payment_entity = (payload.get("payment") or {}).get("entity") or {}
    event_log["order_id"] = order_entity.get("id") or payment_entity.get("order_id")
    event_log["payment_id"] = payment_entity.get("id")
    event_log["amount"] = payment_entity.get("amount") or order_entity.get("amount")

    # ---- 3) Activate subscription on payment success ----
    try:
        if event_log["event"] in ("payment.captured", "order.paid") and event_log["order_id"]:
            order = await server.db.payment_orders.find_one({"order_id": event_log["order_id"]}, {"_id": 0})
            if order and order.get("status") != "paid":
                await server._activate_subscription(order)
                event_log["processed"] = True
            elif order:
                event_log["processed"] = True
                event_log["processing_error"] = "already paid (idempotent skip)"
            else:
                event_log["processing_error"] = "order not found in db"
        else:
            event_log["processed"] = True
            event_log["processing_error"] = "ignored (no-op event type)" if event_log["event"] not in ("payment.captured", "order.paid") else None
    except Exception as e:  # noqa: BLE001
        server.logger.exception(f"[WEBHOOK] processing failed: {e}")
        event_log["processed"] = False
        event_log["processing_error"] = str(e)[:300]

    await server._persist_webhook_event(event_log)
    server.logger.info(
        f"[WEBHOOK] event={event_log['event']} sig_ok={event_log['signature_ok']} "
        f"order={event_log['order_id']} processed={event_log['processed']}"
    )
    return {"received": True, "processed": event_log["processed"], "event_id": event_log["event_id"]}
