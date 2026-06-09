"""Restaurant orders router — Razorpay checkout + payment verification + history.

Extracted from routes/restaurant.py (iter-47 refactor). Reuses menu helpers
(_load_menu, _compute_totals, PORTION_*) from the sibling restaurant module
so this file owns ONLY checkout / verify / cancel / admin listing.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared import server

# Reuse helpers + models from sibling module — single source of truth.
from .restaurant import (
    _load_menu,
    _compute_totals,
    DELIVERY_FEE_FLAT,
    DELIVERY_FEE_FREE_OVER,
    PORTION_LABEL,
    PORTION_MULTIPLIER,
    CartLine,
    CreateRestaurantOrder,
    VerifyRestaurantPayment,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Order checkout — creates Razorpay order, persists cart, returns payment intent
# ---------------------------------------------------------------------------
@router.post("/restaurant/order")
async def create_restaurant_order(payload: CreateRestaurantOrder, user: server.User = Depends(server.get_current_user)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    # iter-79 Batch B #4: enforce restaurant operating hours / capacity gate
    # BEFORE any Razorpay order is generated.
    from routes.restaurant_hours import _assert_open
    await _assert_open()

    menu = await _load_menu()
    menu_by_id = {m["id"]: m for m in menu}
    priced, subtotal, delivery_fee, total = _compute_totals(menu_by_id, payload.items)

    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0})

    # Iter-54 #6: enforce serviceable area before order creation
    from routes.subscription_payment import _enforce_serviceable_area
    # Allow checkout-supplied lat/lng to override saved profile (LocationPicker)
    if payload.customer_lat is not None and payload.customer_lng is not None:
        user_doc = {**(user_doc or {}), "lat": payload.customer_lat, "lng": payload.customer_lng}
    await _enforce_serviceable_area(user_doc or {})

    # Wallet redemption: cap at wallet_balance, applied BEFORE Razorpay so
    # the gateway only ever charges the remaining amount.
    wallet_avail = round(float((user_doc or {}).get("wallet_balance") or 0), 2)
    wallet_used = 0.0
    if payload.apply_wallet and wallet_avail > 0:
        wallet_used = min(wallet_avail, total)
    payable = round(total - wallet_used, 2)

    order_id = f"rorder_{uuid.uuid4().hex[:18]}"
    rzp_order_id = order_id  # default to our id (mock mode)
    mock = True
    razorpay_options = None
    full_wallet_payment = wallet_used > 0 and payable <= 0

    # Try real Razorpay; fall back to mock if disabled / errors.
    if server.RZP_ENABLED and server.rzp_client and not full_wallet_payment:
        try:
            rzp = server.rzp_client.order.create(dict(
                amount=int(round(payable * 100)),
                currency="INR",
                receipt=order_id[:40],
                payment_capture=1,
                notes={"order_type": "restaurant", "user_id": user.user_id, "internal_id": order_id},
            ))
            rzp_order_id = rzp["id"]
            mock = False
            razorpay_options = {
                "key": server.RZP_KEY_ID,
                "amount": rzp["amount"],
                "currency": rzp["currency"],
                "order_id": rzp_order_id,
                "name": "efoodcare Restaurant",
                "description": f"{len(payload.items)} item(s)",
                "prefill": {
                    "name": (payload.name or user_doc.get("name") or "")[:40],
                    "contact": (payload.phone or user_doc.get("phone") or "")[:15],
                    "email": (user_doc.get("email") or "")[:60],
                },
            }
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RESTAURANT] Razorpay create_order failed → mock fallback · {e}")

    doc = {
        "order_id": order_id,
        "razorpay_order_id": rzp_order_id,
        "user_id": user.user_id,
        "items": priced,
        "subtotal": subtotal,
        "delivery_fee": delivery_fee,
        "total": total,
        "wallet_used": wallet_used,
        "payable": payable,
        "status": "created",
        "mock": mock,
        "name": payload.name or user_doc.get("name") or "",
        "phone": payload.phone or user_doc.get("phone") or "",
        "address": payload.address or user_doc.get("address") or "",
        "customer_lat": payload.customer_lat if payload.customer_lat is not None else user_doc.get("lat"),
        "customer_lng": payload.customer_lng if payload.customer_lng is not None else user_doc.get("lng"),
        "notes": (payload.notes or "")[:500],
        "created_at": server.iso(server.now_utc()),
    }
    await server.db.restaurant_orders.insert_one(dict(doc))

    # Auto-save delivery details to the user's profile so future checkouts
    # are pre-filled. Only update fields the user actually typed in this checkout
    # AND that are missing/different on their profile.
    profile_updates = {}
    if payload.name and (user_doc.get("name") or "").strip() != payload.name.strip():
        profile_updates["name"] = payload.name.strip()
    if payload.phone and (user_doc.get("phone") or "").strip() != payload.phone.strip():
        profile_updates["phone"] = payload.phone.strip()
    if payload.address and (user_doc.get("address") or "").strip() != payload.address.strip():
        profile_updates["address"] = payload.address.strip()
    if payload.customer_lat is not None and payload.customer_lng is not None:
        profile_updates["lat"] = float(payload.customer_lat)
        profile_updates["lng"] = float(payload.customer_lng)
    if profile_updates:
        try:
            await server.db.users.update_one({"user_id": user.user_id}, {"$set": profile_updates})
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RESTAURANT] profile auto-save skipped · {e}")

    return {
        "order_id": order_id,
        "razorpay": razorpay_options,  # null in mock mode → frontend auto-verifies
        "mock": mock or full_wallet_payment,
        "subtotal": subtotal,
        "delivery_fee": delivery_fee,
        "total": total,
        "wallet_used": wallet_used,
        "payable": payable,
        "items": priced,
    }


@router.post("/restaurant/verify")
async def verify_restaurant_payment(payload: VerifyRestaurantPayment, user: server.User = Depends(server.get_current_user)):
    order = await server.db.restaurant_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if order.get("mock"):
        server.logger.warning(f"[MOCKED RESTAURANT] auto-verifying {payload.order_id}")
    else:
        try:
            server.rzp_client.utility.verify_payment_signature({
                "razorpay_order_id": order["razorpay_order_id"],
                "razorpay_payment_id": payload.razorpay_payment_id,
                "razorpay_signature": payload.razorpay_signature,
            })
        except Exception as e:  # noqa: BLE001
            server.logger.error(f"[RESTAURANT] signature verify failed: {e}")
            raise HTTPException(status_code=400, detail="Invalid payment signature")

    await server.db.restaurant_orders.update_one(
        {"order_id": payload.order_id},
        {"$set": {
            "status": "paid",
            "razorpay_payment_id": payload.razorpay_payment_id or "",
            "paid_at": server.iso(server.now_utc()),
            # ETA: 35-45 min from now
            "eta_at": server.iso(server.now_utc() + timedelta(minutes=40)),
        }},
    )
    # Deduct wallet AFTER order is confirmed paid (debit and ledger entry)
    wallet_used = round(float(order.get("wallet_used") or 0), 2)
    if wallet_used > 0:
        u = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
        new_bal = round(float(u.get("wallet_balance") or 0) - wallet_used, 2)
        if new_bal < 0:
            server.logger.warning(f"[RESTAURANT] wallet went negative on {payload.order_id} — clamping to 0")
            new_bal = 0.0
        await server.db.users.update_one(
            {"user_id": user.user_id},
            {"$inc": {"wallet_balance": -wallet_used}},
        )
        try:
            await server._log_wallet_txn(
                user.user_id, None, "debit", wallet_used, new_bal,
                f"Restaurant order payment · {payload.order_id}",
            )
        except Exception as e:  # noqa: BLE001
            server.logger.warning(f"[RESTAURANT] wallet txn log failed: {e}")
    fresh = await server.db.restaurant_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    # Fire WhatsApp order confirmation (stub-mode safe)
    try:
        from whatsapp import send_restaurant_order_confirmation
        import asyncio
        if fresh.get("phone"):
            asyncio.create_task(send_restaurant_order_confirmation(
                server.db,
                phone=fresh["phone"],
                name=fresh.get("name") or "there",
                order_id=fresh["order_id"],
                total=float(fresh.get("total", 0)),
                eta_minutes=40,
            ))
    except Exception as e:
        server.logger.warning(f"[WA] restaurant order confirmation enqueue failed: {e}")
    return {"ok": True, "order": fresh}


# ---------------------------------------------------------------------------
# Order history
# ---------------------------------------------------------------------------
@router.get("/restaurant/orders")
async def my_orders(user: server.User = Depends(server.get_current_user), limit: int = 20):
    limit = max(1, min(100, int(limit)))
    rows = await server.db.restaurant_orders.find(
        {"user_id": user.user_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return {"orders": rows}


@router.get("/admin/restaurant/orders")
async def admin_orders(user: server.User = Depends(server.get_current_user), limit: int = 50):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    limit = max(1, min(500, int(limit)))
    rows = await server.db.restaurant_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"orders": rows}


# ---------------------------------------------------------------------------
# Combined live map for admin — tiffin delivery boys + restaurant riders +
# in-flight restaurant orders + their customer pins. Frontend renders all on
# one screen so ops can see everything at a glance.
# ---------------------------------------------------------------------------
@router.get("/admin/live/restaurant")
async def admin_live_restaurant(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    # Active in-flight restaurant orders only (out_for_delivery / ready_for_pickup / preparing)
    statuses = ["paid", "preparing", "ready_for_pickup", "out_for_delivery"]
    orders = await server.db.restaurant_orders.find(
        {"status": {"$in": statuses}}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    # Riders with recent location pings (last 10 min)
    cutoff = server.iso(server.now_utc() - timedelta(minutes=10))
    rider_docs = await server.db.users.find(
        {"role": "rider"}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "rider_lat": 1, "rider_lng": 1, "rider_location_at": 1},
    ).to_list(200)
    riders = [
        {
            "rider_id": r["user_id"], "name": r.get("name"), "phone": r.get("phone"),
            "lat": r.get("rider_lat"), "lng": r.get("rider_lng"),
            "location_at": r.get("rider_location_at"),
            "is_live": bool(r.get("rider_lat") and r.get("rider_location_at") and r.get("rider_location_at") >= cutoff),
        }
        for r in rider_docs if r.get("rider_lat") is not None
    ]
    # Sanitise orders to only the fields the map needs
    out_orders = [
        {
            "order_id": o["order_id"], "status": o["status"], "user_id": o.get("user_id"),
            "name": o.get("name"), "phone": o.get("phone"), "address": o.get("address"),
            "total": o.get("total"), "rider_id": o.get("rider_id"),
            "rider_lat": o.get("rider_lat"), "rider_lng": o.get("rider_lng"),
            "customer_lat": o.get("customer_lat"), "customer_lng": o.get("customer_lng"),
            "created_at": o.get("created_at"),
        }
        for o in orders
    ]
    return {"orders": out_orders, "riders": riders}


# ---------------------------------------------------------------------------
# Customer-initiated cancel — only allowed while status == "paid" (kitchen
# hasn't started yet). Auto-credits the order total back to the user's wallet.
# ---------------------------------------------------------------------------
@router.post("/restaurant/orders/{order_id}/cancel")
async def customer_cancel_order(order_id: str, user: server.User = Depends(server.get_current_user)):
    order = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if order.get("status") != "paid":
        raise HTTPException(
            status_code=400,
            detail="Order can no longer be cancelled — kitchen has already started or it has been delivered.",
        )

    refund_amount = round(float(order.get("total") or 0), 2)
    now_iso = server.iso(server.now_utc())

    # Credit user wallet (refunds always land in the smart wallet for instant reuse).
    user_doc = await server.db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    new_balance = round(float(user_doc.get("wallet_balance") or 0) + refund_amount, 2)
    await server.db.users.update_one(
        {"user_id": user.user_id},
        {"$inc": {"wallet_balance": refund_amount}},
    )
    await server._log_wallet_txn(
        user.user_id, None, "credit", refund_amount, new_balance,
        f"Restaurant order cancellation refund · {order_id}",
    )

    await server.db.restaurant_orders.update_one(
        {"order_id": order_id},
        {"$set": {
            "status": "cancelled",
            "cancelled_at": now_iso,
            "cancelled_by": "customer",
            "refund_amount": refund_amount,
            "refund_mode": "wallet",
        }},
    )
    fresh = await server.db.restaurant_orders.find_one({"order_id": order_id}, {"_id": 0})
    return {"ok": True, "order": fresh, "refund_amount": refund_amount, "wallet_balance": new_balance}
