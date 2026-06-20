from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Cookie, Depends, Body
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import hmac
import hashlib
import time
import io
import random
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta, date

import asyncio
import base64
import httpx
import qrcode
import razorpay

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("efoodcare")

# ---------------------------
# Config
# ---------------------------
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}
ADMIN_PHONES = {p.strip() for p in os.environ.get("ADMIN_PHONES", "").split(",") if p.strip()}

RZP_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RZP_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
RZP_ENABLED = bool(RZP_KEY_ID and RZP_SECRET)
rzp_client = razorpay.Client(auth=(RZP_KEY_ID, RZP_SECRET)) if RZP_ENABLED else None
if not RZP_ENABLED:
    logger.warning("[MOCKED] Razorpay keys not set — using STUB payment mode for demos.")

# Platform fee — recovers the payment-gateway cost from the customer.
# Configurable via env; default 2%. Applied on top of plan amount; wallet still loads the plan amount.
PLATFORM_FEE_PCT = float(os.environ.get("PLATFORM_FEE_PCT", "2.0"))

OTP_DEV_MODE = os.environ.get("OTP_DEV_MODE", "true").lower() == "true"
if OTP_DEV_MODE:
    logger.warning("[MOCKED] OTP is in DEV MODE — generated OTP is returned in the send_otp response and logged; swap to MSG91/Twilio for production.")

COUNTER_SECRET = os.environ.get("COUNTER_SECRET", "efoodcare-counter-secret-2026")
ROTATION_SECONDS = 300
GRACE_BUCKETS = 2

# Custom subscription pricing — fixed per-meal rate
MEAL_PRICE_INR = 70.0           # default — full tiffin / dining
MEAL_PRICE_HALF_INR = 50.0      # half tiffin (3 chapati portion)
MEALS_PER_DAY = 2
CUSTOM_MIN_DAYS = 1
CUSTOM_MAX_DAYS = 90

# Iter-54: surcharge for partial / split-payment subscriptions. Added to the
# user's pending_amount so admin sees full dues + user pays it as part of
# clearing balance. NOT added to wallet (it's a service fee).
PARTIAL_PAYMENT_SURCHARGE_INR = 200.0

DEFAULT_PLANS = [
    {"plan_id": "premium_60", "name": "Premium Dining", "description": "Eat at our hall · 60 home-style meals across 30 days · scan QR at counter", "amount": 2800.0, "currency": "INR", "duration_days": 30, "meals": 60, "active": True, "sort_order": 1, "plan_type": "kiosk", "service_type": "dining", "tiffin_size": None, "tiffins_per_day": 0},
    {"plan_id": "classic_60", "name": "Classic Full Tiffin", "description": "Full home-style tiffin — 5 chapati + sabzi/dal/rice, delivered twice daily", "amount": 2600.0, "currency": "INR", "duration_days": 30, "meals": 60, "active": True, "sort_order": 2, "plan_type": "delivery", "service_type": "tiffin", "tiffin_size": "full", "tiffins_per_day": 2},
    {"plan_id": "saver_60", "name": "Classic Half Tiffin", "description": "Lighter portion tiffin — 3 chapati + sabzi/dal, delivered twice daily", "amount": 1800.0, "currency": "INR", "duration_days": 30, "meals": 60, "active": True, "sort_order": 3, "plan_type": "delivery", "service_type": "tiffin", "tiffin_size": "half", "tiffins_per_day": 2},
]


# ---------------------------
# Helpers
# ---------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_str() -> str:
    return now_utc().strftime("%Y-%m-%d")


def iso(d: datetime) -> str:
    return d.isoformat()


def parse_dt(d) -> datetime:
    if isinstance(d, str):
        d = datetime.fromisoformat(d)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


# ---------------------------
# Models
# ---------------------------
class User(BaseModel):
    user_id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    name: str
    address: Optional[str] = None
    photo_url: Optional[str] = None
    picture: Optional[str] = None
    role: Literal["admin", "staff", "subscriber", "delivery_boy", "rider", "franchise_owner"] = "subscriber"
    qr_token: str
    created_at: datetime
    lat: Optional[float] = None
    lng: Optional[float] = None
    wallet_balance: Optional[float] = 0.0
    mess_id: Optional[str] = None  # iter-76: which mess (branch) this user is assigned to


class Plan(BaseModel):
    plan_id: str
    name: str
    description: str
    amount: float
    currency: str = "INR"
    duration_days: int
    meals: int
    active: bool = True
    sort_order: int = 100


class PlanUpsert(BaseModel):
    plan_id: Optional[str] = None
    name: str
    description: str
    amount: float
    currency: str = "INR"
    duration_days: int
    meals: int
    active: bool = True
    sort_order: int = 100
    # Iter-51: bifurcation
    # category: "dining" (eat-in / QR) | "tiffin" (home delivery)
    # meal_window: "both" | "lunch" | "dinner" — for single-meal plans
    category: Optional[Literal["dining", "tiffin"]] = "dining"
    meal_window: Optional[Literal["both", "lunch", "dinner"]] = "both"


class ProfileUpdate(BaseModel):
    name: str
    phone: str
    address: str
    photo_url: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class LocationUpdate(BaseModel):
    lat: float
    lng: float


class SendOtpRequest(BaseModel):
    phone: str


class VerifyOtpRequest(BaseModel):
    phone: str
    otp: str
    name: Optional[str] = None


class CreateOrderRequest(BaseModel):
    plan_id: str


class CustomOrderRequest(BaseModel):
    days: int
    service_type: Literal["dining", "tiffin"] = "dining"
    tiffin_size: Optional[Literal["full", "half"]] = "full"


class VerifyPaymentRequest(BaseModel):
    order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class StaffScanRequest(BaseModel):
    qr_token: str
    meal_type: Literal["lunch", "dinner"]


class SelfScanRequest(BaseModel):
    counter_code: str
    meal_type: Optional[Literal["lunch", "dinner"]] = None


class SetRoleRequest(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Literal["admin", "staff", "subscriber", "delivery_boy", "rider", "franchise_owner"]


class MenuUpdateRequest(BaseModel):
    menu_date: str
    lunch_items: List[str]
    dinner_items: List[str]


# ---------------------------
# Seed plans
# ---------------------------
async def seed_plans():
    for p in DEFAULT_PLANS:
        existing = await db.plans.find_one({"plan_id": p["plan_id"]}, {"_id": 0})
        if not existing:
            doc = {**p, "created_at": iso(now_utc()), "updated_at": iso(now_utc())}
            await db.plans.insert_one(doc)
        else:
            # One-shot migration: ensure new delivery fields exist on existing rows
            patch = {k: v for k, v in p.items() if k in ("plan_type", "service_type", "tiffin_size", "tiffins_per_day", "name", "description") and existing.get(k) != v}
            if patch:
                patch["updated_at"] = iso(now_utc())
                await db.plans.update_one({"plan_id": p["plan_id"]}, {"$set": patch})
                logger.info(f"[PLAN MIGRATION] {p['plan_id']} updated with {list(patch.keys())}")


# ---------------------------
# Auth helpers
# ---------------------------
def doc_to_user(doc) -> User:
    return User(
        user_id=doc["user_id"],
        email=doc.get("email"),
        phone=doc.get("phone"),
        name=doc["name"],
        address=doc.get("address"),
        photo_url=doc.get("photo_url"),
        picture=doc.get("picture"),
        role=doc.get("role", "subscriber"),
        qr_token=doc.get("qr_token", ""),
        created_at=parse_dt(doc["created_at"]),
        lat=doc.get("lat"),
        lng=doc.get("lng"),
        wallet_balance=float(doc.get("wallet_balance") or 0),
        mess_id=doc.get("mess_id"),
    )


async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(default=None),
) -> User:
    token = session_token
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = parse_dt(session["expires_at"])
    if expires_at < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return doc_to_user(user_doc)


async def issue_session(user_id: str, response: Response) -> str:
    token = f"sess_{uuid.uuid4().hex}"
    expires_at = now_utc() + timedelta(days=7)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": iso(expires_at),
        "created_at": iso(now_utc()),
    })
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=7 * 24 * 60 * 60,
    )
    return token


async def create_or_get_user(email: Optional[str], phone: Optional[str], name: str, picture: Optional[str] = None) -> dict:
    query = {"email": email.lower()} if email else {"phone": phone}
    existing = await db.users.find_one(query, {"_id": 0})
    is_admin = (email and email.lower() in ADMIN_EMAILS) or (phone and phone in ADMIN_PHONES)
    if existing:
        updates = {}
        if name and existing.get("name") != name:
            updates["name"] = name
        if picture and existing.get("picture") != picture:
            updates["picture"] = picture
        # Auto-promote on every login if email/phone is in admin list
        if is_admin and existing.get("role") != "admin":
            updates["role"] = "admin"
        # Resilience: heal seeded/migrated docs that may be missing user_id (some
        # legacy seed scripts use 'id' instead). Otherwise downstream lookups
        # (sessions, dashboards, etc.) will silently fail after login.
        existing_uid = existing.get("user_id") or existing.get("id")
        if not existing_uid:
            existing_uid = f"user_{uuid.uuid4().hex[:12]}"
            updates["user_id"] = existing_uid
        elif not existing.get("user_id"):
            updates["user_id"] = existing_uid
        if not existing.get("qr_token"):
            updates["qr_token"] = f"qr_{uuid.uuid4().hex}"
        if existing.get("wallet_balance") is None:
            updates["wallet_balance"] = 0.0
        if updates:
            await db.users.update_one(
                {"_id": existing.get("_id")} if existing.get("_id") else {"phone": existing.get("phone"), "email": existing.get("email")},
                {"$set": updates},
            )
            existing.update(updates)
            existing["user_id"] = existing_uid
        return existing
    role = "admin" if is_admin else "subscriber"
    user_doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email.lower() if email else None,
        "phone": phone,
        "name": name,
        "address": None,
        "picture": picture,
        "role": role,
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "wallet_balance": 0.0,
        "created_at": iso(now_utc()),
    }
    await db.users.insert_one(user_doc.copy())
    # Fire WhatsApp registration welcome (stub-mode safe — never raises)
    if phone:
        try:
            from whatsapp import send_registration
            import asyncio
            asyncio.create_task(send_registration(db, phone=phone, name=name))
        except Exception as e:
            logger.warning(f"[WA] registration enqueue failed: {e}")
    return user_doc


async def _create_user_for_phone(phone: str, name: str, role: str = "subscriber") -> dict:
    """Create a minimal user record (used by admin when adding delivery boys)."""
    existing = await db.users.find_one({"phone": phone}, {"_id": 0})
    if existing:
        return existing
    user_doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": None,
        "phone": phone,
        "name": name,
        "address": None,
        "picture": None,
        "role": role,
        "qr_token": f"qr_{uuid.uuid4().hex}",
        "wallet_balance": 0.0,
        "created_at": iso(now_utc()),
    }
    await db.users.insert_one(user_doc.copy())
    return user_doc


# ---------------------------
# Auth, OTP, profile, location → routes/auth.py
# ---------------------------
# Reverse-geocode helper stays here (used by the location route via server._reverse_geocode_pincode)
_GEOCODE_CACHE_TTL_HOURS = 24


async def _reverse_geocode_pincode(lat: float, lng: float) -> tuple[str | None, str]:
    """Best-effort reverse geocode using Nominatim (free OSM), cached 24h by rounded coords.
    Returns (pincode, status). Status: 'ok' | 'cached' | 'no_pincode' | 'rate_limited' | 'error' | 'invalid'."""
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return None, "invalid"
    # Round to ~100m precision for caching
    cache_key = f"{round(lat, 3)},{round(lng, 3)}"
    cached = await db.geocode_cache.find_one({"_id": cache_key}, {"_id": 0})
    if cached:
        ts = parse_dt(cached["ts"]) if isinstance(cached.get("ts"), str) else None
        if ts and (now_utc() - ts) < timedelta(hours=_GEOCODE_CACHE_TTL_HOURS):
            return cached.get("pincode"), "cached"
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lng, "format": "json", "zoom": 18, "addressdetails": 1},
                headers={"User-Agent": "efoodcare/1.0 (delivery-routing)"},
            )
            if r.status_code == 429:
                return None, "rate_limited"
            if r.status_code != 200:
                return None, "error"
            data = r.json() or {}
            pin_raw = (data.get("address") or {}).get("postcode") or ""
            digits = "".join(ch for ch in str(pin_raw) if ch.isdigit())
            pincode = digits if len(digits) == 6 else None
            await db.geocode_cache.update_one(
                {"_id": cache_key},
                {"$set": {"pincode": pincode, "ts": iso(now_utc())}},
                upsert=True,
            )
            return pincode, ("ok" if pincode else "no_pincode")
    except Exception as e:  # noqa: BLE001
        logger.warning("Reverse geocode failed: %s", e)
        return None, "error"


# ---------------------------
# Plans (DB-backed + admin CRUD)
# ---------------------------
# -----------------------------------------------------------------------------
# Plans CRUD moved to routes/plans.py (iter-47 refactor).
# -----------------------------------------------------------------------------


# ---------------------------
# Razorpay (MOCKED when keys missing)
# ---------------------------
async def validate_razorpay_keys() -> dict:
    """Test live Razorpay keys with a cheap auth-checked call. Returns:
        {ok, status: 'live'|'mock'|'auth_failed'|'error', detail, key_id_masked}

    `live`         — keys present AND auth succeeds (real payments will work)
    `mock`         — keys not configured (env empty); using stub-mode fallback
    `auth_failed`  — keys present but Razorpay rejected them (invalid/rotated)
    `error`        — network/SDK error (transient)
    """
    masked = (RZP_KEY_ID[:8] + "…") if RZP_KEY_ID else ""
    if not RZP_ENABLED or not rzp_client:
        return {"ok": False, "status": "mock", "detail": "RAZORPAY_KEY_ID/SECRET not set in backend/.env", "key_id_masked": masked}
    # `orders.all({count: 1})` is auth-checked, read-only, and doesn't create anything.
    try:
        await asyncio.to_thread(rzp_client.order.all, {"count": 1})
        return {"ok": True, "status": "live", "detail": "Razorpay authentication succeeded — live payments enabled.", "key_id_masked": masked}
    except razorpay.errors.BadRequestError as e:
        return {"ok": False, "status": "auth_failed", "detail": f"Razorpay rejected the keys: {e}", "key_id_masked": masked}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status": "error", "detail": f"Razorpay validation errored: {e}", "key_id_masked": masked}


# Razorpay routes → routes/payments.py (admin status, order, custom-order, preview, verify, webhook)


async def _create_order_record(*, user, user_doc, plan_id, plan_name, amount, currency, duration_days, meals, custom, service_type=None, tiffin_size=None, plan_type=None):
    # Platform fee on top of plan amount — recovers payment-gateway cost
    base_amount = round(float(amount), 2)
    fee_pct = float(PLATFORM_FEE_PCT)
    platform_fee = round(base_amount * fee_pct / 100.0, 2)
    total_amount = round(base_amount + platform_fee, 2)
    amount_paise = int(round(total_amount * 100))
    receipt = f"rcpt_{uuid.uuid4().hex[:16]}"
    rzp_order = None
    if RZP_ENABLED:
        try:
            rzp_order = rzp_client.order.create({
                "amount": amount_paise, "currency": currency, "receipt": receipt,
                "payment_capture": 1,
                "notes": {
                    "plan_id": plan_id, "user_id": user.user_id, "custom": str(custom).lower(),
                    "base_amount": str(base_amount), "platform_fee": str(platform_fee),
                },
            })
        except razorpay.errors.BadRequestError as e:
            # Auth failed / invalid key etc. — fall back to mock mode so dev/preview keeps working.
            # Production should be alerted to rotate the key.
            logger.warning(f"[RZP] order.create auth failed → falling back to MOCK mode · {e}")
            rzp_order = None
        except Exception as e:  # noqa: BLE001 — network / unexpected
            logger.warning(f"[RZP] order.create errored → falling back to MOCK mode · {e}")
            rzp_order = None
    if rzp_order is not None:
        order_id = rzp_order["id"]
        mock = False
    else:
        order_id = f"order_mock_{uuid.uuid4().hex[:14]}"
        mock = True

    await db.payment_orders.insert_one({
        "order_id": order_id, "receipt": receipt,
        "user_id": user.user_id, "plan_id": plan_id, "plan_name": plan_name,
        "amount": total_amount,
        "base_amount": base_amount,
        "platform_fee": platform_fee,
        "platform_fee_pct": fee_pct,
        "amount_paise": amount_paise, "currency": currency,
        "duration_days": duration_days, "meals": meals,
        "custom": custom, "status": "created", "mock": mock,
        "service_type": service_type,
        "tiffin_size": tiffin_size,
        "plan_type": plan_type,
        "created_at": iso(now_utc()),
    })

    return {
        "order_id": order_id,
        "amount_paise": amount_paise,
        "amount": total_amount,
        "base_amount": base_amount,
        "platform_fee": platform_fee,
        "platform_fee_pct": fee_pct,
        "currency": currency,
        "key_id": RZP_KEY_ID if RZP_ENABLED else "rzp_test_MOCK",
        "mock": mock,
        "plan_name": plan_name,
        "duration_days": duration_days,
        "meals": meals,
        "prefill": {"name": user_doc.get("name", ""), "email": user_doc.get("email", ""), "contact": user_doc.get("phone", "")},
    }


async def _log_wallet_txn(user_id: str, sub_id: Optional[str], txn_type: str, amount: float, balance_after: float, reason: str):
    await db.wallet_transactions.insert_one({
        "txn_id": f"wtxn_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "sub_id": sub_id,
        "type": txn_type,  # credit | debit | pause
        "amount": round(float(amount), 2),
        "balance_after": round(float(balance_after), 2),
        "reason": reason,
        "date_str": today_str(),
        "created_at": iso(now_utc()),
    })


async def _activate_subscription(order: dict):
    """Create subscription + credit wallet. Idempotent on order_id. Supports both standard plans and custom orders."""
    if order.get("status") == "paid":
        return

    # Partial-clear orders: don't create a new sub, just zero out pending_amount.
    if order.get("is_partial_clear") and order.get("linked_sub_id"):
        sub_id = order["linked_sub_id"]
        sub_doc = await db.subscriptions.find_one({"sub_id": sub_id}, {"_id": 0})
        if not sub_doc:
            return
        clear_amt = float(order.get("clear_amount") or order.get("base_amount") or 0)
        new_pending = max(0.0, round(float(sub_doc.get("pending_amount") or 0) - clear_amt, 2))
        new_amount_paid = round(float(sub_doc.get("amount_paid") or 0) + clear_amt, 2)
        await db.subscriptions.update_one(
            {"sub_id": sub_id},
            {"$set": {"pending_amount": new_pending, "amount_paid": new_amount_paid}},
        )
        # Wallet top-up for the cleared amount
        await db.users.update_one({"user_id": order["user_id"]}, {"$inc": {"wallet_balance": clear_amt}})
        user_doc_w = await db.users.find_one({"user_id": order["user_id"]}, {"_id": 0, "wallet_balance": 1})
        await _log_wallet_txn(order["user_id"], sub_id, "credit", clear_amt, float((user_doc_w or {}).get("wallet_balance") or 0), f"Partial-payment top-up · {order.get('plan_name')}")
        await db.payment_orders.update_one({"order_id": order["order_id"]}, {"$set": {"status": "paid", "sub_id": sub_id, "paid_at": iso(now_utc())}})
        logger.info(f"[PARTIAL CLEARED] user={order['user_id']} sub={sub_id} amount={clear_amt} pending={new_pending}")
        return

    user_id = order["user_id"]

    # Iter-54: For partial/split orders, FULL plan amount drives wallet load
    # + per-day deduction. base_amount stays = down-payment paid. Surcharge
    # ₹200 is added to pending_amount so user owes (pending + surcharge) total.
    is_partial = bool(order.get("is_partial"))
    full_plan_amount = float(order.get("partial_total") or order.get("base_amount") or order["amount"])
    plan_amount = full_plan_amount  # used for wallet + per_day calcs
    down_paid = float(order.get("partial_down") or order.get("base_amount") or order["amount"])
    # For custom orders, fields come from the order; for standard, from the DB plan doc.
    if order.get("custom"):
        plan = {
            "plan_id": order["plan_id"],
            "name": order.get("plan_name", "Custom plan"),
            "amount": plan_amount,
            "currency": order.get("currency", "INR"),
            "duration_days": int(order["duration_days"]),
            "meals": int(order["meals"]),
            "service_type": order.get("service_type") or "dining",
            "tiffin_size": order.get("tiffin_size"),
            "plan_type": order.get("plan_type") or ("delivery" if order.get("service_type") == "tiffin" else "kiosk"),
        }
    else:
        plan_doc = await db.plans.find_one({"plan_id": order["plan_id"]}, {"_id": 0})
        if not plan_doc:
            return
        plan = {**plan_doc, "amount": plan_amount}

    start = now_utc()
    end = start + timedelta(days=plan["duration_days"])
    # Wallet deduction per day always = full plan / duration (NOT down/duration).
    per_day = round(float(plan["amount"]) / max(1, plan["duration_days"]), 2)
    # Pending: for partial = remaining + surcharge. Else 0.
    if is_partial:
        partial_surcharge = float(PARTIAL_PAYMENT_SURCHARGE_INR)
        pending_amount = round(float(order.get("partial_pending") or 0) + partial_surcharge, 2)
        wallet_load = round(down_paid, 2)  # only what user paid sits in wallet
    else:
        partial_surcharge = 0.0
        pending_amount = 0.0
        wallet_load = round(float(plan["amount"]), 2)
    payment_mode = order.get("payment_mode") or ("cash" if order.get("status") == "pending_cash" else "online")
    sub = {
        "sub_id": f"sub_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "plan_id": plan["plan_id"],
        "plan_name": plan["name"],
        "amount_paid": round(down_paid, 2),
        "plan_amount": round(float(plan["amount"]), 2),
        "pending_amount": pending_amount,
        "partial_surcharge": partial_surcharge,
        "is_partial": is_partial,
        "payment_mode": payment_mode,
        "deposit_slip_no": order.get("deposit_slip_no"),
        "currency": plan["currency"],
        "meals_total": plan["meals"],
        "meals_used": 0,
        "wallet_balance": wallet_load,
        "per_day_amount": per_day,
        "start_date": iso(start),
        "end_date": iso(end),
        "last_tick_date": start.strftime("%Y-%m-%d"),
        "paused_days": 0,
        "status": "active",
        "order_id": order["order_id"],
        "is_custom": bool(order.get("custom")),
        "service_type": plan.get("service_type") or "dining",
        "plan_type": plan.get("plan_type") or "kiosk",
        "tiffin_size": plan.get("tiffin_size"),
        "user_paused": False,
        "user_pause_started_at": None,
        # Iter-51: copy meal_window from plan onto sub so scans & dispatch
        # can enforce lunch-only / dinner-only without re-querying plans.
        "meal_window": (plan.get("meal_window") or "both").lower(),
        "category": (plan.get("category") or ("tiffin" if (plan.get("service_type") == "tiffin") else "dining")).lower(),
        "created_at": iso(start),
    }
    await db.subscriptions.insert_one(sub.copy())
    await db.users.update_one({"user_id": user_id}, {"$inc": {"wallet_balance": wallet_load}})
    await _log_wallet_txn(user_id, sub["sub_id"], "credit", wallet_load, wallet_load, f"{plan['name']} subscription{' (partial)' if is_partial else ''}")
    # Record the platform fee as a separate informational entry (does not affect wallet balance)
    fee_amt = float(order.get("platform_fee") or 0)
    if fee_amt > 0:
        await _log_wallet_txn(user_id, sub["sub_id"], "fee", fee_amt, wallet_load, f"Platform fee ({order.get('platform_fee_pct', 2)}%)")
    await db.payment_orders.update_one({"order_id": order["order_id"]}, {"$set": {"status": "paid", "sub_id": sub["sub_id"], "paid_at": iso(start)}})
    logger.info(f"[SUB ACTIVATED] user={user_id} plan={plan['plan_id']} amount={plan['amount']} per_day={per_day}")

    # Fire WhatsApp payment-success confirmation (stub-mode safe)
    try:
        from whatsapp import send_payment_success
        user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "name": 1, "phone": 1})
        if user_doc and user_doc.get("phone"):
            invoice_url = order.get("invoice_url")  # populated when Razorpay returns one
            asyncio.create_task(send_payment_success(
                db,
                phone=user_doc["phone"],
                name=user_doc.get("name") or "there",
                amount=float(plan["amount"]),
                plan_name=plan.get("name") or "Subscription",
                invoice_url=invoice_url,
            ))
    except Exception as e:
        logger.warning(f"[WA] payment_success enqueue failed: {e}")


async def _persist_webhook_event(event_log: dict) -> None:
    """Insert + best-effort cap webhook_events collection at 500 rows (drops oldest)."""
    try:
        await db.webhook_events.insert_one(dict(event_log))
        # Lazy cap — when the collection exceeds 500 rows, prune anything below the oldest 500.
        if (await db.webhook_events.estimated_document_count()) > 500:
            cutoff = await db.webhook_events.find({}, {"_id": 1}).sort("ts", -1).skip(500).limit(1).to_list(1)
            if cutoff:
                await db.webhook_events.delete_many({"_id": {"$lte": cutoff[0]["_id"]}})
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[WEBHOOK] failed to persist event log: {e}")


# /payments/verify and /webhook/razorpay → routes/payments.py


# ---------------------------
# Subscription tick / catch-up with 3-day pause rule
# ---------------------------
INACTIVITY_THRESHOLD_DAYS = 3


async def catch_up_subscription(sub: dict) -> dict:
    """Apply per-day deductions + pause extension for days between last_tick and today.

    Two pause modes:
      * Auto-pause (existing): no kiosk scan in last 3 days → no deduction, end-date +1 day.
      * User-pause (tiffin only): subscriber tapped Pause Delivery → wallet still ticks daily;
        after a continuous 7-day streak, every subsequent paused day extends end-date by 1.
    """
    today = date.today()
    last = date.fromisoformat(sub["last_tick_date"])
    if last >= today or sub["status"] != "active":
        return sub

    per_day = float(sub.get("per_day_amount", 0))
    user_id = sub["user_id"]
    paused_added = 0
    deducted_amount = 0.0
    days_processed = 0

    current = last
    while current < today:
        current = current + timedelta(days=1)
        # ---- USER-PAUSED branch (tiffin only) ----
        if sub.get("user_paused") and sub.get("service_type") == "tiffin":
            # Always deduct (matches eat-in deduction rate).
            new_balance = round(float(sub["wallet_balance"]) - per_day, 2)
            if new_balance < 0:
                new_balance = 0.0
            sub["wallet_balance"] = new_balance
            deducted_amount += per_day
            new_used = min(int(sub.get("meals_total", 0)), int(sub.get("meals_used", 0)) + MEALS_PER_DAY)
            sub["meals_used"] = new_used
            await _log_wallet_txn(user_id, sub["sub_id"], "debit", per_day, new_balance, f"Daily deduction (paused) · {current.isoformat()}")
            # Extend end-date once consecutive paused streak exceeds 7 days
            pause_start = sub.get("user_pause_started_at")
            if pause_start:
                streak = (current - date.fromisoformat(pause_start[:10])).days + 1
                if streak > 7:
                    sub["end_date"] = iso(parse_dt(sub["end_date"]) + timedelta(days=1))
                    sub["paused_days"] = int(sub.get("paused_days", 0)) + 1
                    paused_added += 1
                    await _log_wallet_txn(user_id, sub["sub_id"], "pause", 0.0, new_balance, f"Pause-extension · {current.isoformat()} (day {streak})")
            days_processed += 1
            continue

        # ---- AUTO-PAUSE branch (kiosk) ----
        # Determine inactivity: look at attendance in window [current - INACTIVITY_THRESHOLD, current)
        window_start = (current - timedelta(days=INACTIVITY_THRESHOLD_DAYS)).isoformat()
        window_end = current.isoformat()
        recent_scan = await db.attendance.find_one({
            "user_id": user_id,
            "date_str": {"$gte": window_start, "$lt": window_end},
        }, {"_id": 0})

        if recent_scan or sub.get("service_type") == "tiffin":
            # Active day — deduct money + consume the day's 2 meals from balance.
            new_balance = round(float(sub["wallet_balance"]) - per_day, 2)
            if new_balance < 0:
                new_balance = 0.0
            sub["wallet_balance"] = new_balance
            deducted_amount += per_day
            # Bump meals_used by 2 (lunch + dinner) — capped at meals_total
            new_used = min(int(sub.get("meals_total", 0)), int(sub.get("meals_used", 0)) + MEALS_PER_DAY)
            sub["meals_used"] = new_used
            await _log_wallet_txn(user_id, sub["sub_id"], "debit", per_day, new_balance, f"Daily deduction · {current.isoformat()} · 2 meals consumed")
        else:
            # Inactive day (3+ consecutive no-scan) — no debit, no meal consumption, end-date extends.
            sub["paused_days"] = int(sub.get("paused_days", 0)) + 1
            sub["end_date"] = iso(parse_dt(sub["end_date"]) + timedelta(days=1))
            paused_added += 1
            await _log_wallet_txn(user_id, sub["sub_id"], "pause", 0.0, float(sub["wallet_balance"]), f"Auto-pause · {current.isoformat()} (no scan in last 3 days · meals + day credited back)")

        days_processed += 1

    sub["last_tick_date"] = today.isoformat()

    # Persist
    await db.subscriptions.update_one({"sub_id": sub["sub_id"]}, {"$set": {
        "wallet_balance": sub["wallet_balance"],
        "paused_days": sub["paused_days"],
        "end_date": sub["end_date"],
        "last_tick_date": sub["last_tick_date"],
        "meals_used": sub.get("meals_used", 0),
    }})
    if deducted_amount > 0:
        await db.users.update_one({"user_id": user_id}, {"$inc": {"wallet_balance": -deducted_amount}})
    if days_processed:
        logger.info(f"[TICK] sub={sub['sub_id']} days={days_processed} deducted=₹{deducted_amount:.2f} paused_added={paused_added}")
    return sub


async def get_active_subscription(user_id: str) -> Optional[dict]:
    subs = await db.subscriptions.find({"user_id": user_id, "status": "active"}, {"_id": 0}).to_list(50)
    for s in subs:
        end_dt = parse_dt(s["end_date"])
        if end_dt <= now_utc() or s["meals_used"] >= s["meals_total"]:
            await db.subscriptions.update_one({"sub_id": s["sub_id"]}, {"$set": {"status": "expired"}})
            continue
        s = await catch_up_subscription(s)
        return s
    return None


async def _send_in_grace_warning(sub: dict, fresh: dict, pending_amount: float) -> None:
    """Iter-57: dispatch a final-warning push (WhatsApp + SMS) the moment a
    paid subscription with pending dues enters its 24h in-grace window.

    Idempotent: writes a sentinel onto the sub doc so duplicate ticks within
    the grace window won't re-fire.
    """
    if fresh.get("in_grace_warning_sent"):
        return
    uid = sub.get("user_id")
    if not uid:
        return
    user = await db.users.find_one({"user_id": uid}, {"_id": 0}) or {}
    phone = user.get("phone")
    name = user.get("name") or "there"
    plan_name = sub.get("plan_name") or "tiffin plan"
    if phone:
        try:
            import whatsapp
            await whatsapp.send_in_grace_warning(db, phone=phone, name=name, pending_amount=pending_amount, plan_name=plan_name)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[GRACE] WhatsApp send failed sub={sub.get('sub_id')}: {e}")
        try:
            from sms import send_in_grace_warning as sms_grace
            await sms_grace(phone=phone, name=name, pending_amount=pending_amount, plan_name=plan_name)
        except Exception as e:  # noqa: BLE001
            logger.info(f"[GRACE] SMS send skipped sub={sub.get('sub_id')}: {e}")
    await db.subscriptions.update_one(
        {"sub_id": sub["sub_id"]},
        {"$set": {"in_grace_warning_sent": True, "in_grace_warning_sent_at": iso(now_utc())}},
    )



# ---------------------------
# Background scheduler — daily subscription tick (3-day inactivity extension)
# ---------------------------


async def run_subscription_tick() -> dict:
    """Process every active subscription: apply daily deductions + auto-pause when 3+ inactive days.
    Auto-expires subs when wallet hits 0 (after a 1-day grace window — protects against rounding edge cases)."""
    processed = 0
    expired = 0
    errors = 0
    grace_started = 0
    subs = await db.subscriptions.find({"status": "active"}, {"_id": 0}).to_list(10000)
    for s in subs:
        try:
            # Expire if past end-date or all meals consumed
            end_dt = parse_dt(s["end_date"])
            if end_dt <= now_utc() or s.get("meals_used", 0) >= s.get("meals_total", 0):
                await db.subscriptions.update_one({"sub_id": s["sub_id"]}, {"$set": {"status": "expired", "expired_at": iso(now_utc()), "expired_reason": "end_date_or_meals"}})
                expired += 1
                continue
            await catch_up_subscription(s)
            # Re-fetch after tick for latest wallet
            fresh = await db.subscriptions.find_one({"sub_id": s["sub_id"]}, {"_id": 0})
            if fresh and float(fresh.get("wallet_balance") or 0) <= 0.005:
                grace_until_iso = fresh.get("zero_wallet_grace_until")
                pending_amt = float(fresh.get("pending_amount") or 0)
                if not grace_until_iso:
                    # Start the 24h grace window — subscription stays ACTIVE but flagged in_grace
                    grace_until = now_utc() + timedelta(hours=24)
                    await db.subscriptions.update_one(
                        {"sub_id": s["sub_id"]},
                        {"$set": {
                            "zero_wallet_grace_until": iso(grace_until),
                            "in_grace": True,
                            "in_grace_started_at": iso(now_utc()),
                        }},
                    )
                    grace_started += 1
                    # Fire a final-warning push when there's still money owed —
                    # the partial-payment cohort is at highest churn risk here.
                    if pending_amt > 0:
                        try:
                            await _send_in_grace_warning(s, fresh, pending_amt)
                        except Exception as e:  # noqa: BLE001
                            logger.warning(f"[TICK] grace-warning send failed sub={s['sub_id']}: {e}")
                    logger.info(f"[TICK] sub={s['sub_id']} wallet=0 → IN-GRACE until {grace_until.isoformat()} · pending=₹{pending_amt}")
                else:
                    if parse_dt(grace_until_iso) <= now_utc():
                        await db.subscriptions.update_one(
                            {"sub_id": s["sub_id"]},
                            {"$set": {"status": "expired", "expired_at": iso(now_utc()), "expired_reason": "wallet_zero", "in_grace": False}},
                        )
                        expired += 1
                        logger.info(f"[TICK] sub={s['sub_id']} EXPIRED · wallet=0 + grace elapsed")
                        continue
            else:
                # Wallet recovered (refund/topup) — clear any grace flag
                if fresh and fresh.get("zero_wallet_grace_until"):
                    await db.subscriptions.update_one(
                        {"sub_id": s["sub_id"]},
                        {"$unset": {"zero_wallet_grace_until": "", "in_grace_started_at": ""},
                         "$set": {"in_grace": False}},
                    )
            processed += 1
        except Exception as e:
            errors += 1
            logger.exception(f"[TICK] error sub={s.get('sub_id')}: {e}")
    logger.info(f"[CRON TICK] processed={processed} expired={expired} grace_started={grace_started} errors={errors}")
    return {"processed": processed, "expired": expired, "grace_started": grace_started, "errors": errors, "ran_at": iso(now_utc())}


# ---------------------------
# Empty-tiffin SMS reminder scanner — runs every 5 min
# ---------------------------


async def _ist_now_dt() -> datetime:
    return now_utc().astimezone(timezone(timedelta(hours=5, minutes=30)))


async def run_empty_tiffin_reminders() -> dict:
    """Scan customers with tiffin_balance>0 + a tiffin delivery scheduled within the next ~30 min IST.
    Fire ONE SMS per (user, slot, day). Idempotency stored in db.tiffin_reminders_sent."""
    from sms import send_tiffin_reminder  # local import — avoid loading at startup if MSG91 disabled

    settings_doc = await db.delivery_settings.find_one({"_id": "active"}, {"_id": 0})
    settings_doc = {**(settings_doc or {})}
    lead_min = int(settings_doc.get("reminder_lead_minutes") or 30)
    if not bool(settings_doc.get("reminder_enabled", True)):
        return {"skipped": "disabled"}

    ist = await _ist_now_dt()
    today_iso = ist.date().isoformat()
    # Identify which slot's reminder window we're inside.
    # A reminder fires when current time is between (slot_open_at - lead) and slot_open_at.
    # i.e. lunch window: 07:30-08:00 if lunch opens at 08:00.
    slots = []
    for meal in ("lunch", "dinner"):
        open_at = settings_doc.get(f"{meal}_dispatch_open") or ("08:00" if meal == "lunch" else "15:00")
        try:
            oh, om = [int(x) for x in open_at.split(":")]
        except Exception:
            continue
        slot_open = ist.replace(hour=oh, minute=om, second=0, microsecond=0)
        window_start = slot_open - timedelta(minutes=lead_min)
        if window_start <= ist <= slot_open:
            slots.append(meal)
    if not slots:
        return {"sent": 0, "skipped": "outside_reminder_window"}

    sent = 0
    skipped = 0
    failed = 0
    cursor = db.users.find({"tiffin_balance": {"$gt": 0}}, {"_id": 0})
    async for u in cursor:
        if not u.get("phone"):
            continue
        # Only remind if user has an active tiffin sub today
        sub = await db.subscriptions.find_one({"user_id": u["user_id"], "status": "active", "service_type": "tiffin"}, {"_id": 0})
        if not sub:
            continue
        for meal in slots:
            dedupe = await db.tiffin_reminders_sent.find_one({"user_id": u["user_id"], "date": today_iso, "meal": meal}, {"_id": 0})
            if dedupe:
                skipped += 1
                continue
            open_at = settings_doc.get(f"{meal}_dispatch_open") or ("08:00" if meal == "lunch" else "15:00")
            res = await send_tiffin_reminder(
                phone=u["phone"],
                name=u.get("name") or "there",
                count=int(u.get("tiffin_balance") or 0),
                slot=meal,
                eta=open_at,
            )
            await db.tiffin_reminders_sent.insert_one({
                "user_id": u["user_id"],
                "phone": u["phone"],
                "date": today_iso,
                "meal": meal,
                "balance": int(u.get("tiffin_balance") or 0),
                "status": res.get("status"),
                "ts": iso(now_utc()),
            })
            if res.get("ok"):
                sent += 1
            else:
                failed += 1
    if sent or failed:
        logger.info(f"[REMINDER] sent={sent} skipped={skipped} failed={failed} slots={slots}")
    return {"sent": sent, "skipped": skipped, "failed": failed, "slots": slots}


# ---------------------------
# Subscription expiry reminders — WhatsApp + SMS, T-2 (2 days before) and T+1 (1 day after)
# ---------------------------
EXPIRY_LEAD_DAYS = [2, -1]


def _ist_today_iso() -> str:
    return (now_utc() + timedelta(hours=5, minutes=30)).date().isoformat()


async def run_expiry_reminders() -> dict:
    """Find subs ending in {2, -1} days. For each, fire SMS + WhatsApp reminder if not already sent today.
    Idempotent via db.expiry_reminders_sent (compound: sub_id + days_left + sent_date).

    NB: Email channel was removed Feb 7, 2026 per product decision.
        WhatsApp added Feb 8, 2026 per product spec (T-2 and T+1, then stop).
    """
    from sms import send_expiry_reminder  # local import — avoid loading deps at startup if disabled
    from whatsapp import send_expiry_reminder as wa_send_expiry

    today = (now_utc() + timedelta(hours=5, minutes=30)).date()
    sent_sms = skipped = failed = 0

    subs = await db.subscriptions.find({"status": "active"}, {"_id": 0}).to_list(20000)
    user_ids = list({s["user_id"] for s in subs})
    user_map = {u["user_id"]: u async for u in db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0})}

    for sub in subs:
        try:
            end_dt = parse_dt(sub["end_date"])
            days_left = (end_dt.date() - today).days
            if days_left not in EXPIRY_LEAD_DAYS:
                continue
            user = user_map.get(sub["user_id"])
            if not user:
                continue
            today_iso = today.isoformat()
            dedupe_key = {"sub_id": sub["sub_id"], "days_left": days_left, "sent_date": today_iso}
            already = await db.expiry_reminders_sent.find_one(dedupe_key, {"_id": 0})
            if already:
                skipped += 1
                continue

            end_pretty = end_dt.date().strftime("%d %b %Y")

            sms_res = {"status": "skipped"}
            if user.get("phone"):
                sms_res = await send_expiry_reminder(
                    phone=user["phone"], name=user.get("name") or "there",
                    days_left=days_left, plan_name=sub.get("plan_name") or "Your plan",
                    end_date=end_pretty,
                )
                if sms_res.get("ok"):
                    sent_sms += 1
                else:
                    failed += 1

            wa_res = {"status": "skipped"}
            if user.get("phone"):
                wa_res = await wa_send_expiry(
                    db, phone=user["phone"], name=user.get("name") or "there",
                    days_left=days_left, plan_name=sub.get("plan_name") or "Your plan",
                    end_date=end_pretty,
                )

            await db.expiry_reminders_sent.insert_one({
                **dedupe_key,
                "user_id": user["user_id"],
                "phone": user.get("phone"),
                "plan_name": sub.get("plan_name"),
                "end_date": sub["end_date"],
                "sms_status": sms_res.get("status"),
                "ts": iso(now_utc()),
            })
        except Exception as e:
            failed += 1
            logger.exception(f"[EXPIRY] error sub={sub.get('sub_id')}: {e}")

    if sent_sms or failed:
        logger.info(f"[EXPIRY REMINDERS] sms={sent_sms} skipped={skipped} failed={failed}")

    # ----- Iter-54 #1: partial-balance dues reminder (T-3 + T-1) -----
    try:
        partial_subs = await db.subscriptions.find(
            {"status": "active", "pending_amount": {"$gt": 0}}, {"_id": 0},
        ).to_list(5000)
        partial_user_ids = list({s["user_id"] for s in partial_subs})
        partial_user_map = user_map.copy()
        if partial_user_ids:
            async for u in db.users.find({"user_id": {"$in": partial_user_ids}}, {"_id": 0}):
                partial_user_map[u["user_id"]] = u
        partial_lead = [3, 1]
        dues_sent = 0
        for sub in partial_subs:
            try:
                end_dt = parse_dt(sub["end_date"])
                days_left = (end_dt.date() - today).days
                if days_left not in partial_lead:
                    continue
                user = partial_user_map.get(sub["user_id"])
                if not user or not user.get("phone"):
                    continue
                dedupe = {"sub_id": sub["sub_id"], "kind": "partial_dues", "days_left": days_left, "sent_date": today.isoformat()}
                if await db.expiry_reminders_sent.find_one(dedupe, {"_id": 0}):
                    continue
                msg = (
                    f"Hi {user.get('name') or 'there'}! Your eFoodCare plan '{sub.get('plan_name')}' "
                    f"has ₹{round(float(sub['pending_amount']), 2):.0f} pending. Plan ends in {days_left} day(s). "
                    "Clear dues now from your dashboard → Clear pending balance, or pay cash to staff."
                )
                try:
                    from whatsapp import send_payment_success as _wa_send  # reuse channel; brand-safe
                    await _wa_send(db, phone=user["phone"], name=user.get("name") or "there",
                                   amount=float(sub["pending_amount"]),
                                   plan_name=sub.get("plan_name") or "Subscription",
                                   invoice_url=None)
                except Exception:
                    pass
                logger.info(f"[PARTIAL DUES] reminder for sub={sub['sub_id']} pending=₹{sub['pending_amount']:.0f} (T-{days_left}) · {msg[:80]}")
                await db.expiry_reminders_sent.insert_one({
                    **dedupe, "user_id": user["user_id"], "phone": user.get("phone"),
                    "plan_name": sub.get("plan_name"), "pending_amount": sub.get("pending_amount"),
                    "ts": iso(now_utc()),
                })
                dues_sent += 1
            except Exception as e:  # noqa: BLE001
                logger.exception(f"[PARTIAL DUES] error sub={sub.get('sub_id')}: {e}")
        if dues_sent:
            logger.info(f"[PARTIAL DUES] reminders fired: {dues_sent}")
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[PARTIAL DUES] loop error: {e}")

    return {"sms_sent": sent_sms, "skipped": skipped, "failed": failed}


# ---------------------------
# Wallet + subscription views
# ---------------------------
# -----------------------------------------------------------------------------
# Wallet endpoints moved to routes/wallet.py (iter-47 refactor).
# -----------------------------------------------------------------------------


# ---------------------------
# Theme settings (admin-editable design tokens)
# ---------------------------
DEFAULT_THEME = {
    "brand_name": "efoodcare",
    "brand_tagline": "ghar se achha khana",
    "tokens": {
        "background": "0 0% 100%",
        "foreground": "220 55% 22%",
        "card": "0 0% 100%",
        "card_foreground": "220 55% 22%",
        "primary": "0 65% 38%",
        "primary_foreground": "0 0% 100%",
        "secondary": "220 70% 50%",
        "secondary_foreground": "0 0% 100%",
        "accent": "0 40% 96%",
        "accent_foreground": "0 65% 38%",
        "destructive": "0 70% 50%",
        "destructive_foreground": "0 0% 100%",
        "muted": "220 25% 96%",
        "muted_foreground": "220 20% 40%",
        "border": "220 20% 90%",
        "input": "220 20% 90%",
        "ring": "0 65% 38%",
        "radius": "0.75rem",
    },
}
THEME_VERSION = 2


class ThemeUpdate(BaseModel):
    brand_name: Optional[str] = None
    brand_tagline: Optional[str] = None
    tokens: Optional[dict] = None


async def _load_theme():
    doc = await db.theme_settings.find_one({"_id": "active"}, {"_id": 0})
    if not doc:
        await db.theme_settings.insert_one({"_id": "active", **DEFAULT_THEME, "_version": THEME_VERSION, "updated_at": iso(now_utc())})
        return DEFAULT_THEME
    return doc


async def _ensure_theme_version():
    """Force-apply latest DEFAULT_THEME tokens when version bumps (one-time migration)."""
    doc = await db.theme_settings.find_one({"_id": "active"}, {"_id": 0})
    if not doc or doc.get("_version", 0) < THEME_VERSION:
        await db.theme_settings.update_one(
            {"_id": "active"},
            {"$set": {**DEFAULT_THEME, "_version": THEME_VERSION, "updated_at": iso(now_utc())}},
            upsert=True,
        )
        logger.info(f"[THEME MIGRATION] Theme upgraded to version {THEME_VERSION} (dark red)")


@api_router.get("/theme")
async def get_theme():
    return await _load_theme()


@api_router.post("/admin/theme")
async def update_theme(payload: ThemeUpdate, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    current = await _load_theme()
    if payload.brand_name is not None:
        current["brand_name"] = payload.brand_name.strip() or DEFAULT_THEME["brand_name"]
    if payload.brand_tagline is not None:
        current["brand_tagline"] = payload.brand_tagline.strip() or DEFAULT_THEME["brand_tagline"]
    if payload.tokens:
        current["tokens"] = {**current.get("tokens", {}), **payload.tokens}
    await db.theme_settings.update_one({"_id": "active"}, {"$set": {**current, "updated_at": iso(now_utc())}}, upsert=True)
    return current


@api_router.post("/admin/theme/reset")
async def reset_theme(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.theme_settings.update_one({"_id": "active"}, {"$set": {**DEFAULT_THEME, "updated_at": iso(now_utc())}}, upsert=True)
    return DEFAULT_THEME


# ---------------------------
# Site content (admin-editable pages & footer & landing)
# ---------------------------
DEFAULT_CONTENT = {
    "footer": {
        "copyright": "copyright © efoodcare.in all rights reserved",
        "tagline": "ghar se achha khana",
        # iter-72 #1: full brand identity block — admin editable
        "brand_name": "efoodcare",
        "promise": "India's first zero meal adulteration app — proudly made by the genius team of efoodcare.",
        "corporate_address": "shilangan Road, behind bhaktidham mandir, sai nagar, Amravati 444607, Maharashtra",
        "support_phone": "+91 91755 60211",
        "website": "https://efoodcare.in",
        "email": "hello@efoodcare.in",
    },
    "landing": {
        "hero_overline": "UPI · WALLET · E-MEAL PASS",
        "hero_title_line1": "ghar se achha khana,",
        "hero_title_line2": "ab ek e-Meal Pass pe.",
        "hero_subtitle": "30-day tiffin subscriptions with a smart wallet. Pay once by UPI, check-in by QR, skip a few days — we pause your wallet, no meals wasted.",
        "hero_cta_primary": "Get your e-Meal Pass",
        "hero_cta_secondary": "View plans",
        "hero_image_url": "https://images.unsplash.com/photo-1600488999806-8efb986d87b1?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600",
        "sections": [],  # admin can add custom sections: {heading, body, image_url}
        # How it works section
        "how_overline": "How it works",
        "how_title": "Pay once. Eat for 30 days. Pause when you travel.",
        "how_body": "Money loads into your wallet on day one. Every day you eat, a small amount ticks down. Miss 3+ days in a row? Your subscription auto-extends — no wallet deduction on inactive days.",
        "how_image_1": "https://images.unsplash.com/photo-1676300186673-615bcc8d5d68?crop=entropy&cs=srgb&fm=jpg&q=85&w=900",
        "how_image_2": "https://images.unsplash.com/photo-1595079836278-25b7ad6d5ddb?crop=entropy&cs=srgb&fm=jpg&q=85&w=900",
        "how_features": [
            {"icon": "Smartphone", "title": "Pay by UPI in 10 seconds", "body": "Razorpay checkout with UPI, cards, netbanking."},
            {"icon": "Wallet", "title": "Your money lives in a wallet", "body": "See ₹ ticking down every day as you eat."},
            {"icon": "QrCode", "title": "Scan to check in", "body": "Show your QR or scan the counter — your choice."},
            {"icon": "ShieldCheck", "title": "Skip days? We pause.", "body": "3+ inactive days → no deductions, auto-extend."},
        ],
        # Features band
        "band_overline": "Built for modern tiffin halls",
        "band_title": "The wallet that eats with you.",
        "band_items": [
            {"icon": "Utensils", "title": "Daily menu", "body": "Lunch + dinner items published every day."},
            {"icon": "Wallet", "title": "Smart wallet", "body": "Auto-deduction · auto-pause · full transparency."},
            {"icon": "TrendingUp", "title": "Admin analytics", "body": "Attendance trends, revenue, wallet balances — live."},
        ],
        # Healthy promise
        "healthy_overline": "Our kitchen promise",
        "healthy_title_part_1": "What's ",
        "healthy_title_highlight_1": "NOT",
        "healthy_title_part_2": " in your tiffin matters as much as ",
        "healthy_title_highlight_2": "what is",
        "healthy_title_part_3": ".",
        "healthy_subtitle": "Real ghar ka khana means clean, honest ingredients. Here's what we promise — and what we'll never compromise on.",
        "healthy_never_title": "Never on your plate",
        "healthy_never_heading": "0% the bad stuff",
        "healthy_never_items": [
            {"label": "Ajinomoto / MSG", "note": "Zero added flavour enhancers"},
            {"label": "Maida", "note": "No refined white flour, ever"},
            {"label": "Artificial flavours", "note": "Only real spices, real aroma"},
            {"label": "Artificial colours", "note": "Naturally vibrant, never dyed"},
            {"label": "Polished grains", "note": "We keep the bran, you get the fibre"},
            {"label": "Refined / Palm oil", "note": "Cheap oils stay out of our kitchen"},
        ],
        "healthy_always_title": "Always on your plate",
        "healthy_always_heading": "100% the good stuff",
        "healthy_always_bg": "green",  # green | red | blue
        "healthy_always_items": [
            {"icon": "Wheat", "label": "Chakki atta", "note": "Stone-ground whole wheat"},
            {"icon": "Sprout", "label": "Unpolished toor dal", "note": "Naturally protein-rich"},
            {"icon": "Soup", "label": "Premium aged rice", "note": "Fragrant, perfectly aged grains"},
            {"icon": "Carrot", "label": "Fresh vegetables", "note": "Sourced fresh — every single day"},
            {"icon": "Droplet", "label": "Filter / Cold-pressed oil", "note": "Wood-pressed, full of nutrients"},
            {"icon": "BadgeCheck", "label": "Real ghar-style spices", "note": "Hand-blended, small batch"},
        ],
        # Final CTA
        "cta_title_line1": "ghar se achha khana,",
        "cta_title_line2": "ab UPI pe.",
        "cta_subtitle": "Plans start at ₹1,800 for 30 days.",
        "cta_button_label": "Start with OTP",
    },
    "contact": {
        "title": "We're a phone call away",
        "intro": "Reach out for orders, support or franchise enquiries — we usually reply within an hour.",
        "company": "efoodcare",
        "address": "Your full address line · City · State · PIN",
        "phone": "+91 99707 05391",
        "email": "hello@efoodcare.in",
        "hours": "Mon–Sun · 10 AM – 10 PM",
        "map_embed_src": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d60304.49!2d73.75!3d18.55!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2sPune!5e0!3m2!1sen!2sin!4v1700000000000",
        # iter-81 #1: full text editing rights for Contact page — every
        # visible label below is now admin-editable from /admin/content.
        "overline": "We're here for you",
        "nearest_label": "Your nearest branch:",
        "default_label": "Showing default branch:",
        "perm_hint": "Enable location to auto-pick your nearest branch.",
        "cta_directions": "Get directions",
        "distance_suffix": "km away",
        "label_branch": "Branch",
        "label_address": "Address",
        "label_phone": "Phone",
        "label_whatsapp": "WhatsApp",
        "whatsapp_value": "Chat with us on WhatsApp",
        "label_email": "Email",
        "label_manager": "Branch manager",
        "label_fssai": "FSSAI",
        "label_hours": "Hours",
    },
    "announcement": {
        "enabled": True,
        "text": "चंद पैसों के लिए मिलावटी खाना हमारे स्वास्थ्य और परिवार के लिए बहुत बड़ा खतरा है। सिर्फ स्वाद या कम कीमत देखकर खाने-पीने की चीजें न खरीदें।",
        "bg_color": "#FACC15",
        "text_color": "#1F2937",
        "speed_seconds": 45,
    },
    "login": {
        "title_line1": "Login or",
        "title_line2": "Sign up",
        "form_overline": "Enter your details",
        "form_heading": "India's smartest tiffin pass.",
        "form_subheading": "Login with your phone number to continue.",
        "phone_label": "Phone number",
        "phone_placeholder": "Enter 10-digit number",
        "name_label": "Your name",
        "name_optional_label": "(optional)",
        "name_placeholder": "e.g. Aman Gupta",
        "cta_label": "Continue",
        "or_divider": "Or",
        "google_label": "Continue with Google",
        "terms_prefix": "By continuing, you agree to our",
        "terms_separator": "and",
        "verify_overline": "Verify OTP",
        "verify_heading": "Enter the 6-digit code",
        "verify_cta_label": "Verify & Continue",
        "resend_prompt": "Didn't get it?",
        "resend_label": "Resend OTP",
    },
    # iter-75 #3: full CMS for the About-us page so admin can change copy,
    # colours, stats etc. without redeploying.
    "about": {
        "hero_bg_from": "#a02323",
        "hero_bg_to": "#7a1818",
        "hero_text_color": "#fff5f1",
        "hero_overline": "Our story · est. 2023 · Amravati",
        "hero_headline": "We started efoodcare because ghar se accha khana shouldn't disappear when you move out.",
        "hero_lede": "One licensed kitchen. Two seasonal thalis a day. A 30-day e-Meal Pass. A wallet that pauses when you travel. And a promise that everything we cook is what we'd eat at our own dining table — never anything else.",
        "cta_primary_label": "See subscription plans",
        "cta_primary_to": "/plans",
        "cta_secondary_label": "Visit our kitchen",
        "cta_secondary_to": "/contact",
        "stats_bg": "rgba(255,255,255,0.10)",
        "stats_text_color": "#ffffff",
        "stat_1_value": "21521243000086", "stat_1_label": "FSSAI Licence",
        "stat_2_value": "3 yrs+",         "stat_2_label": "Serving Amravati",
        "stat_3_value": "150+",            "stat_3_label": "Monthly Subscribers",
        "stat_4_value": "100%",            "stat_4_label": "Pure-veg Kitchen",
        "promise_bg": "#ffffff",
        "promise_text_color": "#0c0c0c",
        "promise_heading": "Four non-negotiables that make us different from a regular tiffin.",
        "promise_1_title": "Zero adulteration kitchen", "promise_1_body": "No Ajinomoto, no maida, no palm or refined oil. No pre-made gravy, no artificial flavours or colours. The promise that started efoodcare.",
        "promise_2_title": "Cold-pressed, local first", "promise_2_body": "Groundnut oil from Vidarbha farmers. Stone-ground spices. Fresh vegetables from Amravati's morning mandi — sourced before the kitchen turns on.",
        "promise_3_title": "Ghar-jaisa, every meal",     "promise_3_body": "Two seasonal Maharashtrian thalis a day. Recipes from our founder's mother — calibrated by an FSSAI-licensed chef so every plate tastes the same Tuesday or Sunday.",
        "promise_4_title": "Modern, paperless, audited","promise_4_body": "QR check-in, in-app wallet, e-Meal Pass, daily kitchen photos. Every meal you eat is logged — every meal you skip pauses your wallet.",
        "timeline_bg": "#f5efe7",
        "timeline_text_color": "#0c0c0c",
        "timeline_heading": "From a single hostel dabba to a 150-subscriber wall kiosk.",
        "tl_1_year": "2023", "tl_1_title": "The home-kitchen experiment",       "tl_1_body": "Rushikesh starts cooking lunch dabbas for engineering hostels in Amravati. The rule: nothing he wouldn't feed his mother.",
        "tl_2_year": "2024", "tl_2_title": "efoodcare licence + 30-day pass",   "tl_2_body": "FSSAI licensing, the first 30-day e-Meal Pass model, and the original 'ghar se accha khana' tagline.",
        "tl_3_year": "2025", "tl_3_title": "QR + wallet + delivery rails",       "tl_3_body": "QR-based attendance, an in-app wallet that pauses on skip-days, and partnered hyperlocal delivery for restaurant orders.",
        "tl_4_year": "2026", "tl_4_title": "Wall kiosk + dynamic thali pricing", "tl_4_body": "Self-order wall kiosks at the dining hall, single-use anti-fraud QRs, and Paytm Dynamic QR for instant counter payments.",
        "founder_bg": "#ffffff",
        "founder_text_color": "#0c0c0c",
        "founder_quote": "\"I built efoodcare for the version of myself that left home at 18.\"",
        "founder_body": "When I moved out for engineering, I traded my mother's kitchen for hostel mess food and corner-shop dabbas — and within a month I was eating Ajinomoto-laced gravy and reused refined oil without even knowing. efoodcare is the brand I wish I had then: a licensed kitchen with the same standards your mother applies at home, a wallet that respects the days you don't eat, and a counter that gives you a receipt for every thali. Nothing is hidden. Everything is logged. Every rupee is yours until you scan in.",
        "founder_name": "Rushikesh Tamhane",
        "founder_role": "Founder & head of kitchen, efoodcare",
        "visit_bg_from": "#a02323",
        "visit_bg_to": "#7a1818",
        "visit_text_color": "#ffffff",
        "visit_heading": "Our kitchen is yours to inspect. Always.",
        "visit_body": "Drop by during lunch (12:30-3pm) or dinner (7-10:30pm). We'll walk you through the storeroom, the oil bottles, the dal counter and the spice grinder. No appointment, no NDA — just open shelves.",
        "visit_address": "shilangan Road, behind bhaktidham mandir, sai nagar, Amravati 444607, Maharashtra",
        "visit_phone": "+91 91755 60211",
        "visit_email": "hello@efoodcare.in",
    },
    # iter-75 #7: Privacy + Refund policy CMS-driven, professionally drafted.
    "privacy": {
        "title": "Privacy Policy",
        "effective_date": "06 June 2026",
        "intro": "efoodcare (\"we\", \"our\", \"the company\") operates the efoodcare meal-subscription and food-ordering platform at efoodcare.in. This policy explains what personal information we collect, why we collect it, how we use it, and what choices you have. We comply with the Digital Personal Data Protection Act, 2023 (DPDPA) and applicable Indian regulations.",
        "sections": [
            {"heading": "1. Information we collect", "body": "Account & identity: name, phone number, email, date of birth (optional), profile photo (optional). Address & geolocation: delivery addresses you save, your live location when you tap 'Use my location' (we never store continuous GPS — only the lat/lng at the moment of the tap). Subscription & order data: subscription tier, meal-pass start/end dates, attendance logs (QR scans), wallet balance, individual order histories, payment-method tokens (we never store full card or UPI PIN). Device & analytics: device model, OS, browser version, page-view events, crash logs — only aggregated/pseudonymous, used to fix bugs and improve UX."},
            {"heading": "2. Why we collect it", "body": "Delivering meals on time, accurate billing and refunds, attendance and anti-fraud (single-use QR check-in), customer support and dispute resolution, kitchen capacity planning, sending order/wallet/menu notifications you've opted in to, complying with FSSAI / GST / tax obligations."},
            {"heading": "3. Cookies & similar technologies", "body": "We use session cookies for login (auth_token, HTTPOnly, SameSite=Lax), a 'last viewed' cookie to resume your cart, and Google Analytics 4 for traffic measurement (anonymised IP, no cross-site tracking). You can clear cookies any time in your browser settings — you'll be logged out but no other data is lost."},
            {"heading": "4. Who we share data with", "body": "Payment processors (Razorpay, Paytm) — for processing your UPI/card payments; they receive only the amount and a non-personal order ID. Hyperlocal delivery partners — your name, phone, address, and order summary so the rider can deliver. FSSAI / tax authorities — only when legally compelled. We do NOT sell your data, share it with advertisers, or use it for any third-party marketing."},
            {"heading": "5. Data retention", "body": "Active subscriber profiles: kept while you have a paid subscription + 7 years for GST/tax compliance. Order/attendance logs: 7 years. Crash & analytics: 90 days, then deleted. Inactive accounts (no login for 24 months) are auto-anonymised: phone + email replaced with sha-256 hashes, name redacted to 'efoodcare guest'."},
            {"heading": "6. Your rights", "body": "Access — request a copy of all data we hold on you. Correction — fix wrong details directly in your profile. Erasure — delete your account from Profile → Delete Account; we'll purge personal fields within 30 days. Portability — download your order/attendance history as JSON. Grievance officer: Rushikesh Tamhane, hello@efoodcare.in, +91 91755 60211."},
            {"heading": "7. Children", "body": "Our services are for adults aged 18+. We do not knowingly collect data from minors. If you believe a child has signed up, contact the grievance officer and we'll delete the account within 7 days."},
            {"heading": "8. Security", "body": "All data is transmitted over HTTPS (TLS 1.3). Passwords are bcrypt-hashed. Payment tokens are stored only by the gateway (Razorpay / Paytm) — we never see the raw card / UPI PIN. Database access is restricted to two named engineers and audited monthly."},
            {"heading": "9. Cross-border transfers", "body": "All data is stored on Indian-region MongoDB Atlas servers. We do not transfer personal data outside India except for payment gateways (Razorpay, Paytm — both India-domiciled)."},
            {"heading": "10. Changes to this policy", "body": "We'll notify you via in-app banner and email at least 7 days before any material change. The 'effective date' at the top is always the version you're seeing."},
        ],
        "contact_block": "Questions? Email hello@efoodcare.in or write to: efoodcare, shilangan Road, behind bhaktidham mandir, sai nagar, Amravati 444607, Maharashtra. We respond to every grievance within 72 hours.",
    },
    "refund": {
        "title": "Refund & Cancellation Policy",
        "effective_date": "06 June 2026",
        "intro": "efoodcare is a fresh-food meal-subscription and restaurant ordering service. Because our thalis are prepared on-demand using perishable ingredients (no frozen / pre-made gravy), refunds follow a meal-by-meal model rather than a blanket one. This policy covers the 30-day Meal Pass, à-la-carte restaurant orders, and wall-kiosk walk-in orders.",
        "sections": [
            {"heading": "1. 30-day Meal Pass — paused day refunds", "body": "Your e-Meal Pass works on a 'pay-for-what-you-eat' wallet model. Days you don't check in via the QR are automatically PAUSED — the wallet retains that day's value and your subscription end-date is extended by one day. No manual refund is needed; the system handles it nightly at 11:30 PM. Net effect: you pay only for the meals you actually eat, up to your subscription limit."},
            {"heading": "2. Cancelling an active subscription", "body": "You can cancel any time from Profile → Subscription → Cancel. We refund: (a) full pro-rata of unused meals × the day-rate of your tier, MINUS (b) a flat ₹100 administrative fee, MINUS (c) any unsettled wallet debits. The refund hits your original payment method within 5-7 business days via Razorpay. Cancellations after Day 25 of a 30-day cycle don't qualify for the pro-rata refund (administrative cut-off)."},
            {"heading": "3. Quality complaints — same-meal credit", "body": "If a delivered tiffin or dining-in thali is below standard (cold, missing items, contaminated, off-taste), raise a complaint via Profile → Orders → Report Issue WITHIN 60 minutes of receiving / scanning in. If our kitchen verifies the complaint (photo + reason required), we credit your wallet with the FULL value of that meal — usable from the very next meal. We may also re-deliver the meal at no charge if the kitchen is still open."},
            {"heading": "4. Restaurant à-la-carte orders", "body": "Cancellable BEFORE the kitchen has started cooking — usually within 90 seconds of placing the order. Use 'Cancel order' on the Track Order screen. Full refund to original payment method in 3-5 business days. Once cooking has started, the order is non-cancellable, but quality complaints (#3) still apply."},
            {"heading": "5. Wall-kiosk / counter walk-in orders", "body": "Wall-kiosk orders are immediate and non-refundable once the kitchen receives the order ticket (≈10 seconds after Place Order). Cash + UPI mix payments: cash is refundable at the counter only if the order has NOT been printed to the kitchen; UPI portions follow the standard 5-7 day reversal."},
            {"heading": "6. Failed payments / double charges", "body": "If you were charged but the subscription / order didn't activate, contact us immediately at hello@efoodcare.in or +91 91755 60211 with the Razorpay / Paytm txn-ID. We escalate to the gateway within 24 hours; reversals typically land in 3-5 business days."},
            {"heading": "7. Refunds during force-majeure (kitchen down)", "body": "If our kitchen is closed for reasons beyond our control (power outage, FSSAI inspection, force majeure) and we can't deliver a paid meal, we automatically extend your subscription end-date by ONE day per unfulfilled meal — no need to claim. For long disruptions (>3 days), a full pro-rata refund is initiated automatically."},
            {"heading": "8. How to claim a refund", "body": "Always log in first. Then Profile → Refund Request → pick the order → describe the issue → attach photo if applicable → submit. You get a ticket number within 30 seconds. We respond within 24 hours, and resolve within 72 hours."},
            {"heading": "9. Wallet credit vs payment-method refund", "body": "Wallet credit (instant): same-meal complaints, paused days. Payment-method refund (5-7 days): cancelled subscriptions, double charges, kitchen-down force majeure. You can convert wallet credit to payment-method refund any time before subscription ends (₹100 fee applies)."},
        ],
        "contact_block": "Grievance officer: Rushikesh Tamhane, hello@efoodcare.in, +91 91755 60211. Mon-Sun, 10 AM - 10 PM. Tickets raised in-app via Profile → Help are tracked end-to-end with timestamps.",
    },
}


async def _load_content(key: str):
    default = DEFAULT_CONTENT.get(key)
    doc = await db.site_content.find_one({"key": key}, {"_id": 0})
    if doc:
        existing = doc.get("data", {}) or {}
        if isinstance(default, dict):
            # Merge default for any missing keys so schema upgrades flow through
            merged = {**default, **existing}
            return merged
        return existing
    if default is None:
        raise HTTPException(status_code=404, detail="Unknown content key")
    await db.site_content.insert_one({"key": key, "data": default, "updated_at": iso(now_utc())})
    return default


class ContentUpdate(BaseModel):
    data: dict


@api_router.get("/content/{key}")
async def get_content(key: str):
    return await _load_content(key)


@api_router.post("/admin/content/{key}")
async def update_content(key: str, payload: ContentUpdate, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if key not in DEFAULT_CONTENT:
        raise HTTPException(status_code=400, detail="Unknown content key")
    current = await _load_content(key)
    # Iter-57 fix: honor whatever the admin saves — including explicit empty
    # strings. Previously this endpoint silently dropped "" so when an admin
    # cleared the login heading, the default re-appeared on every reload.
    # Auto-reset is still available via POST /admin/content/{key}/reset.
    # We still strip "" for *color* / *bg* / *fg* keys because an empty CSS
    # value would render no color and break the UI; for text fields, "" means
    # "I want this gone, don't render it" — exactly what the admin asked for.
    defaults = DEFAULT_CONTENT.get(key, {})
    incoming = dict(payload.data or {})
    for k, v in list(incoming.items()):
        if isinstance(v, str) and v.strip() == "" and k in defaults:
            kl = k.lower()
            if ("color" in kl) or kl.endswith("_bg") or kl.endswith("_fg") or kl.endswith("_size"):
                incoming.pop(k)
    merged = {**current, **incoming}
    await db.site_content.update_one(
        {"key": key}, {"$set": {"key": key, "data": merged, "updated_at": iso(now_utc())}}, upsert=True,
    )
    return merged


@api_router.post("/admin/content/{key}/reset")
async def reset_content(key: str, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if key not in DEFAULT_CONTENT:
        raise HTTPException(status_code=400, detail="Unknown content key")
    await db.site_content.update_one(
        {"key": key}, {"$set": {"key": key, "data": DEFAULT_CONTENT[key], "updated_at": iso(now_utc())}}, upsert=True,
    )
    return DEFAULT_CONTENT[key]


# =====================================================================
# iter-75 #8 — multi-mess support (a + c).
# (a) Multiple physical branches (efoodcare-Amravati, efoodcare-Nagpur…)
# (c) Franchise mode: partner kitchens can apply and run their own data.
# MVP scope this iteration: Mess collection, CRUD, default-mess
# seeding, and a public list endpoint. mess_id pass-through on
# subscriptions/menu/orders comes in iter-76.
# =====================================================================

DEFAULT_MESS_ID = "efoodcare-amravati"

DEFAULT_MESS = {
    "mess_id": DEFAULT_MESS_ID,
    "slug": "efoodcare-amravati",
    "name": "efoodcare · Amravati",
    "tagline": "Zero-adulteration tiffin & restaurant",
    "address": "shilangan Road, behind bhaktidham mandir, sai nagar, Amravati 444607, Maharashtra",
    "city": "Amravati",
    "state": "Maharashtra",
    "pincode": "444607",
    "lat": 20.9379,
    "lng": 77.7782,
    "manager_name": "Rushikesh Tamhane",
    "manager_phone": "+91 91755 60211",
    "manager_email": "hello@efoodcare.in",
    "owner_user_id": None,      # null = corporate-run
    "is_franchise": False,
    "is_corporate": True,       # the home kitchen
    "status": "active",         # active | pending_review | inactive
    "fssai_number": "21521243000086",
    "capacity_lunch": 200,
    "capacity_dinner": 200,
    "currency": "INR",
}


class MessIn(BaseModel):
    slug: str = Field(..., min_length=2, max_length=64)
    name: str = Field(..., min_length=2, max_length=120)
    tagline: Optional[str] = ""
    address: str = Field(..., min_length=3)
    city: str = Field(..., min_length=2)
    state: str = Field(..., min_length=2)
    pincode: str = Field(..., min_length=4, max_length=10)
    lat: Optional[float] = None
    lng: Optional[float] = None
    manager_name: str = ""
    manager_phone: str = ""
    manager_email: Optional[str] = ""
    is_franchise: bool = False
    fssai_number: Optional[str] = ""
    capacity_lunch: int = Field(default=100, ge=1, le=10000)
    capacity_dinner: int = Field(default=100, ge=1, le=10000)


class FranchiseApplyIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    address: str = Field(..., min_length=3)
    city: str = Field(..., min_length=2)
    state: str = Field(..., min_length=2)
    pincode: str = Field(..., min_length=4, max_length=10)
    applicant_name: str = Field(..., min_length=2)
    applicant_phone: str = Field(..., min_length=10)
    applicant_email: Optional[str] = ""
    notes: str = ""


async def _seed_default_mess():
    existing = await db.messes.find_one({"mess_id": DEFAULT_MESS_ID})
    if not existing:
        doc = {**DEFAULT_MESS, "created_at": iso(now_utc()), "updated_at": iso(now_utc())}
        await db.messes.insert_one(doc)
        logger.info(f"[messes] seeded default mess · {DEFAULT_MESS_ID}")
    else:
        # iter-76: heal old seed where lat/lng were null (added in iter-76).
        patch = {}
        if existing.get("lat") is None and DEFAULT_MESS.get("lat") is not None:
            patch["lat"] = DEFAULT_MESS["lat"]
        if existing.get("lng") is None and DEFAULT_MESS.get("lng") is not None:
            patch["lng"] = DEFAULT_MESS["lng"]
        if patch:
            patch["updated_at"] = iso(now_utc())
            await db.messes.update_one({"mess_id": DEFAULT_MESS_ID}, {"$set": patch})
            logger.info(f"[messes] patched default mess lat/lng → {patch}")


@app.on_event("startup")
async def _startup_seed_messes():
    try:
        await _seed_default_mess()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[messes] seed failed: {e}")


@api_router.get("/messes")
async def list_messes_public():
    """Public list of ACTIVE messes — used by signup mess-picker."""
    cursor = db.messes.find({"status": "active"}, {"_id": 0}).sort("name", 1)
    items = await cursor.to_list(200)
    return {"messes": items, "default_mess_id": DEFAULT_MESS_ID}


@api_router.get("/messes/nearby")
async def find_nearby_mess_v1(lat: float, lng: float):
    return await _find_nearby_impl(lat, lng)


async def _find_nearby_impl(lat: float, lng: float):
    cursor = db.messes.find(
        {"status": "active", "lat": {"$ne": None}, "lng": {"$ne": None}},
        {"_id": 0},
    )
    items = await cursor.to_list(200)
    for m in items:
        try:
            m["distance_km"] = round(_haversine_km(lat, lng, m["lat"], m["lng"]), 2)
        except Exception:  # noqa: BLE001
            m["distance_km"] = None
    items.sort(key=lambda m: (m.get("distance_km") is None, m.get("distance_km") or 0))
    return {"messes": items, "closest_mess_id": items[0]["mess_id"] if items else None}


@api_router.get("/messes/{slug}")
async def get_mess_by_slug(slug: str):
    doc = await db.messes.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Mess not found")
    return doc


@api_router.get("/admin/messes")
async def admin_list_messes(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    items = await db.messes.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"messes": items}


@api_router.post("/admin/messes")
async def admin_create_mess(payload: MessIn, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if await db.messes.find_one({"slug": payload.slug}):
        raise HTTPException(status_code=400, detail="Slug already in use")
    doc = {
        **payload.model_dump(),
        "mess_id": f"mess_{uuid.uuid4().hex[:10]}",
        "owner_user_id": None,
        "is_corporate": not payload.is_franchise,
        "status": "active",
        "currency": "INR",
        "created_at": iso(now_utc()),
        "updated_at": iso(now_utc()),
    }
    await db.messes.insert_one(doc)
    out = await db.messes.find_one({"mess_id": doc["mess_id"]}, {"_id": 0})
    return out


@api_router.put("/admin/messes/{mess_id}")
async def admin_update_mess(mess_id: str, payload: MessIn, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    existing = await db.messes.find_one({"mess_id": mess_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Mess not found")
    if payload.slug != existing.get("slug"):
        clash = await db.messes.find_one({"slug": payload.slug, "mess_id": {"$ne": mess_id}})
        if clash:
            raise HTTPException(status_code=400, detail="Slug already in use")
    updates = {**payload.model_dump(), "updated_at": iso(now_utc())}
    await db.messes.update_one({"mess_id": mess_id}, {"$set": updates})
    out = await db.messes.find_one({"mess_id": mess_id}, {"_id": 0})
    return out


class MessStatusIn(BaseModel):
    status: str


class KitchenRadiusIn(BaseModel):
    lat: float
    lng: float
    radius_km: Optional[float] = None
    address: Optional[str] = None


@api_router.patch("/franchise/me/kitchen")
async def franchise_update_kitchen(payload: KitchenRadiusIn, user: User = Depends(get_current_user)):
    """iter-94 #2: franchise owners pin their own kitchen lat/lng/radius/address.
    Auto-scoped to their own mess — they cannot edit another branch."""
    if user.role not in ("franchise_owner", "admin"):
        raise HTTPException(status_code=403, detail="Franchise portal only")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="Admins should use /admin/messes/{id} to edit any mess")
    if not (-90.0 <= payload.lat <= 90.0) or not (-180.0 <= payload.lng <= 180.0):
        raise HTTPException(status_code=400, detail="Invalid coordinates")
    m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
    if not m:
        raise HTTPException(status_code=403, detail="No mess assigned")
    update: dict = {"lat": payload.lat, "lng": payload.lng, "updated_at": iso(now_utc())}
    if payload.radius_km is not None:
        if payload.radius_km < 0 or payload.radius_km > 50:
            raise HTTPException(status_code=400, detail="radius_km must be 0–50")
        update["radius_km"] = payload.radius_km
    if payload.address is not None:
        update["address"] = payload.address.strip()
    await db.messes.update_one({"mess_id": m["mess_id"]}, {"$set": update})
    out = await db.messes.find_one({"mess_id": m["mess_id"]}, {"_id": 0})
    return {"ok": True, "mess": out}


@api_router.patch("/admin/messes/{mess_id}/status")
async def admin_set_mess_status(mess_id: str, payload: MessStatusIn, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if payload.status not in {"active", "pending_review", "inactive"}:
        raise HTTPException(status_code=400, detail="status must be active|pending_review|inactive")
    if mess_id == DEFAULT_MESS_ID and payload.status != "active":
        raise HTTPException(status_code=400, detail="Cannot deactivate the corporate mess")
    res = await db.messes.update_one({"mess_id": mess_id}, {"$set": {"status": payload.status, "updated_at": iso(now_utc())}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mess not found")
    return {"ok": True, "status": payload.status}


@api_router.post("/franchise/apply")
async def franchise_apply(payload: FranchiseApplyIn):
    """Public — partner kitchens submit a franchise application. Creates a
    Mess in `pending_review` status (not visible to subscribers until an
    admin promotes it to `active`).
    """
    # iter-76 #2: strict slug sanitization → [a-z0-9-] only.
    import re as _re
    base = _re.sub(r"[^a-z0-9]+", "-", payload.name.lower()).strip("-")[:50] or "partner"
    suffix = uuid.uuid4().hex[:4]
    slug = f"{base}-{suffix}"
    doc = {
        "mess_id": f"mess_{uuid.uuid4().hex[:10]}",
        "slug": slug,
        "name": payload.name,
        "tagline": "Franchise partner",
        "address": payload.address,
        "city": payload.city,
        "state": payload.state,
        "pincode": payload.pincode,
        "lat": None, "lng": None,
        "manager_name": payload.applicant_name,
        "manager_phone": payload.applicant_phone,
        "manager_email": payload.applicant_email or "",
        "owner_user_id": None,
        "is_franchise": True,
        "is_corporate": False,
        "status": "pending_review",
        "fssai_number": "",
        "capacity_lunch": 100,
        "capacity_dinner": 100,
        "currency": "INR",
        "notes": (payload.notes or "").strip(),
        "created_at": iso(now_utc()),
        "updated_at": iso(now_utc()),
    }
    await db.messes.insert_one(doc)
    out = await db.messes.find_one({"mess_id": doc["mess_id"]}, {"_id": 0})
    logger.info(f"[messes] new franchise application · {doc['slug']} · {payload.city}")
    return {"ok": True, "mess": out}


# -----------------------------------------------------------------------------
# iter-76 — per-mess utilities: nearby, user mess assignment, admin metrics.
# -----------------------------------------------------------------------------

import math as _math


def _haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    dlat = _math.radians(lat2 - lat1)
    dlng = _math.radians(lng2 - lng1)
    a = _math.sin(dlat / 2) ** 2 + _math.cos(_math.radians(lat1)) * _math.cos(_math.radians(lat2)) * _math.sin(dlng / 2) ** 2
    return 2 * R * _math.asin(_math.sqrt(a))


class MessAssignIn(BaseModel):
    mess_id: str


@api_router.get("/me/mess")
async def get_my_mess(user: User = Depends(get_current_user)):
    """Return the mess this user is assigned to. Falls back to the default
    corporate mess for legacy users created before iter-76.
    """
    profile = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "mess_id": 1}) or {}
    mess_id = profile.get("mess_id") or DEFAULT_MESS_ID
    mess = await db.messes.find_one({"mess_id": mess_id}, {"_id": 0})
    if not mess:
        # mess was deactivated → fall back to default
        mess = await db.messes.find_one({"mess_id": DEFAULT_MESS_ID}, {"_id": 0})
        if mess:
            await db.users.update_one({"user_id": user.user_id}, {"$set": {"mess_id": DEFAULT_MESS_ID}})
    return {"mess_id": mess_id, "mess": mess}


@api_router.post("/me/mess")
async def set_my_mess(payload: MessAssignIn, user: User = Depends(get_current_user)):
    target = await db.messes.find_one({"mess_id": payload.mess_id, "status": "active"}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=400, detail="Inactive or unknown mess")
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"mess_id": payload.mess_id, "mess_assigned_at": iso(now_utc())}},
    )
    return {"ok": True, "mess_id": payload.mess_id, "mess": target}


async def _mess_metrics(mess_id: str, days: int = 30):
    """Compute per-mess P&L + attendance metrics for the last N days."""
    since_dt = now_utc() - timedelta(days=days) if days else None
    since = iso(since_dt) if since_dt else None
    # Subscribers count — anyone with an active subscription on this mess
    sub_q = {"mess_id": mess_id, "status": "active"}
    subscribers = await db.subscriptions.count_documents(sub_q)
    # Total subscribers ever (incl. expired)
    subscribers_total = await db.subscriptions.count_documents({"mess_id": mess_id})
    # Daily check-ins last N days (attendance scans) + per-day series for sparkline
    scan_q = {"mess_id": mess_id}
    if since:
        scan_q["created_at"] = {"$gte": since}
    daily_checkins = await db.attendance_logs.count_documents(scan_q)
    # Build per-day buckets for sparkline
    checkins_per_day_series = []
    if since_dt:
        scan_cur = db.attendance_logs.find(scan_q, {"_id": 0, "created_at": 1}).limit(20000)
        scans = await scan_cur.to_list(20000)
        buckets = {(since_dt + timedelta(days=i)).strftime("%Y-%m-%d"): 0 for i in range(days)}
        for s in scans:
            d = str(s.get("created_at") or "")[:10]
            if d in buckets:
                buckets[d] += 1
        checkins_per_day_series = [buckets[k] for k in sorted(buckets.keys())]
    # Walk-in / kiosk orders total revenue (paid only)
    order_q = {"mess_id": mess_id, "status": {"$in": ["paid", "pending_collection"]}}
    if since:
        order_q["created_at"] = {"$gte": since}
    orders_cur = db.mess_menu_orders.find(order_q, {"_id": 0, "total": 1, "created_at": 1})
    orders = await orders_cur.to_list(20000)
    order_revenue = sum(int(o.get("total") or 0) for o in orders)
    order_count = len(orders)
    # iter-79 Batch C #8: per-day order revenue series for sparkline
    order_revenue_series = []
    if since_dt:
        revenue_buckets = {(since_dt + timedelta(days=i)).strftime("%Y-%m-%d"): 0 for i in range(days)}
        for o in orders:
            d = str(o.get("created_at") or "")[:10]
            if d in revenue_buckets:
                revenue_buckets[d] += int(o.get("total") or 0)
        order_revenue_series = [revenue_buckets[k] for k in sorted(revenue_buckets.keys())]
    # Active subscription monthly revenue (sum of `amount_paid` for active subs)
    sub_cur = db.subscriptions.find({"mess_id": mess_id, "status": "active"}, {"_id": 0, "amount_paid": 1})
    sub_docs = await sub_cur.to_list(20000)
    subscription_revenue = sum(int(s.get("amount_paid") or 0) for s in sub_docs)
    # iter-79 Batch C #8: per-day subscription revenue series — uses
    # `start_date` so each day reflects new subscriber inflow that day.
    subscription_revenue_series = []
    if since_dt:
        sub_in_window = db.subscriptions.find(
            {"mess_id": mess_id, "start_date": {"$gte": since}},
            {"_id": 0, "amount_paid": 1, "start_date": 1},
        )
        sub_in_window_docs = await sub_in_window.to_list(20000)
        sub_buckets = {(since_dt + timedelta(days=i)).strftime("%Y-%m-%d"): 0 for i in range(days)}
        for s in sub_in_window_docs:
            d = str(s.get("start_date") or "")[:10]
            if d in sub_buckets:
                sub_buckets[d] += int(s.get("amount_paid") or 0)
        subscription_revenue_series = [sub_buckets[k] for k in sorted(sub_buckets.keys())]
    # Total revenue per day = orders + subscriptions started that day.
    total_revenue_series = [
        (order_revenue_series[i] if i < len(order_revenue_series) else 0) +
        (subscription_revenue_series[i] if i < len(subscription_revenue_series) else 0)
        for i in range(max(len(order_revenue_series), len(subscription_revenue_series)))
    ]
    mess = await db.messes.find_one({"mess_id": mess_id}, {"_id": 0})
    capacity_lunch = (mess or {}).get("capacity_lunch", 0) or 0
    capacity_dinner = (mess or {}).get("capacity_dinner", 0) or 0
    daily_capacity = capacity_lunch + capacity_dinner
    # Utilization: assume daily_checkins / (daily_capacity * days)
    utilization = round(daily_checkins / (daily_capacity * days) * 100, 1) if (daily_capacity and days) else 0
    return {
        "mess_id": mess_id,
        "mess": mess,
        "window_days": days,
        "subscribers_active": subscribers,
        "subscribers_total": subscribers_total,
        "checkins_window": daily_checkins,
        "checkins_per_day_avg": round(daily_checkins / days, 1) if days else 0,
        "checkins_per_day_series": checkins_per_day_series,
        "order_count_window": order_count,
        "order_revenue_window": order_revenue,
        "order_revenue_series": order_revenue_series,
        "subscription_revenue_active": subscription_revenue,
        "subscription_revenue_series": subscription_revenue_series,
        "total_revenue_series": total_revenue_series,
        "capacity_daily": daily_capacity,
        "utilization_pct": utilization,
        "computed_at": iso(now_utc()),
    }


@api_router.get("/admin/messes/{mess_id}/metrics")
async def admin_mess_metrics(mess_id: str, days: int = 30, user: User = Depends(get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    days = max(1, min(int(days or 30), 365))
    return await _mess_metrics(mess_id, days)


@api_router.get("/franchise/me/metrics")
async def franchise_my_metrics(days: int = 30, user: User = Depends(get_current_user)):
    """Franchise-portal view — owner sees only THEIR mess (the one where
    mess.owner_user_id == user.user_id). Returns 403 if no mess owned.
    """
    if user.role not in ("franchise_owner", "admin"):
        raise HTTPException(status_code=403, detail="Franchise portal only")
    mess = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0})
    if not mess and user.role != "admin":
        raise HTTPException(status_code=403, detail="No mess assigned to this owner")
    target_id = (mess or {}).get("mess_id") or DEFAULT_MESS_ID
    days = max(1, min(int(days or 30), 365))
    return await _mess_metrics(target_id, days)


class MessAssignOwnerIn(BaseModel):
    owner_user_id: Optional[str] = None  # null = unassign
    owner_phone: Optional[str] = None    # iter-79: assign by phone instead of user_id


@api_router.patch("/admin/messes/{mess_id}/owner")
async def admin_assign_mess_owner(mess_id: str, payload: MessAssignOwnerIn, user: User = Depends(get_current_user)):
    """Iter-76 + 79: assign a franchise owner to a mess. Accepts either
    owner_user_id OR owner_phone (whichever the admin has handy). Promotes
    the target user to role=franchise_owner.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    mess = await db.messes.find_one({"mess_id": mess_id})
    if not mess:
        raise HTTPException(status_code=404, detail="Mess not found")
    # iter-79: resolve phone → user_id when admin types phone instead of user_id
    target_user_id = payload.owner_user_id
    if payload.owner_phone and not target_user_id:
        digits = "".join(c for c in (payload.owner_phone or "") if c.isdigit())
        ten = digits[-10:] if len(digits) >= 10 else digits
        if len(ten) != 10:
            raise HTTPException(status_code=400, detail="Phone must be 10 digits")
        candidates = []
        for q in (f"+91{ten}", f"91{ten}", ten):
            doc = await db.users.find_one({"phone": q})
            if doc:
                candidates.append(doc)
                break
        if not candidates:
            doc = await db.users.find_one({"phone": {"$regex": ten + "$"}})
            if doc:
                candidates.append(doc)
        if not candidates:
            raise HTTPException(status_code=404, detail=f"No user found with phone ending {ten}")
        target_user_id = candidates[0]["user_id"]
    if target_user_id:
        target = await db.users.find_one({"user_id": target_user_id})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.get("role") in ("subscriber", "rider", "delivery_boy"):
            await db.users.update_one({"user_id": target_user_id}, {"$set": {"role": "franchise_owner"}})
    await db.messes.update_one(
        {"mess_id": mess_id},
        {"$set": {"owner_user_id": target_user_id, "updated_at": iso(now_utc())}},
    )
    out = await db.messes.find_one({"mess_id": mess_id}, {"_id": 0})
    return {"ok": True, "mess": out, "promoted_user_id": target_user_id}


async def _backfill_mess_id_once():
    """One-time backfill: tag legacy docs (subscriptions, attendance_logs,
    mess_menu_orders, mess_menu) without a mess_id with the DEFAULT mess.
    Runs on startup; idempotent.
    """
    for coll in ("subscriptions", "attendance_logs", "mess_menu_orders", "mess_menu", "users"):
        res = await db[coll].update_many(
            {"mess_id": {"$exists": False}}, {"$set": {"mess_id": DEFAULT_MESS_ID}}
        )
        if res.modified_count:
            logger.info(f"[iter-76 backfill] {coll}: tagged {res.modified_count} docs with mess_id={DEFAULT_MESS_ID}")


@app.on_event("startup")
async def _startup_backfill_mess_ids():
    try:
        await _backfill_mess_id_once()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[iter-76] mess_id backfill skipped: {e}")


# -----------------------------------------------------------------------------
# Subscription read + pause/resume moved to routes/subscription.py (iter-47).
# -----------------------------------------------------------------------------


@api_router.get("/my/qr")
async def my_qr(user: User = Depends(get_current_user)):
    return {"qr_token": user.qr_token, "user_name": user.name}


@api_router.get("/my/attendance")
async def my_attendance(user: User = Depends(get_current_user)):
    recs = await db.attendance.find({"user_id": user.user_id}, {"_id": 0}).sort("checked_at", -1).to_list(100)
    return {"attendance": recs}


# ---------------------------
# Attendance
# ---------------------------
async def _mark_attendance(target_user: dict, meal_type: str, marked_by: str, method: str):
    sub = await get_active_subscription(target_user["user_id"])
    if not sub:
        raise HTTPException(status_code=400, detail="No active subscription")
    # Iter-51: enforce single-meal plan windows. A `meal_window` of "both"
    # (the default for every legacy sub) lets through any scan; "lunch" /
    # "dinner" plans reject the off-window scan with a clear message.
    window = (sub.get("meal_window") or "both").lower()
    if window in ("lunch", "dinner") and window != meal_type:
        raise HTTPException(
            status_code=403,
            detail=f"This subscription is {window}-only. Scan rejected for {meal_type}.",
        )
    today = today_str()
    existing = await db.attendance.find_one({
        "user_id": target_user["user_id"],
        "meal_type": meal_type,
        "date_str": today,
    }, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail=f"Already checked in for {meal_type} today")
    record = {
        "att_id": f"att_{uuid.uuid4().hex[:12]}",
        "user_id": target_user["user_id"],
        "user_name": target_user["name"],
        "sub_id": sub["sub_id"],
        "meal_type": meal_type,
        "checked_at": iso(now_utc()),
        "date_str": today,
        "marked_by": marked_by,
        "method": method,
    }
    await db.attendance.insert_one(record.copy())
    # NOTE: meals_used is tick-driven (2 meals per active day, decremented from balance after midnight).
    # Scans only record attendance — they don't double-deduct.
    return record


@api_router.post("/attendance/scan")
async def staff_scan(payload: StaffScanRequest, user: User = Depends(get_current_user)):
    if user.role not in ("staff", "admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Staff/Admin only")
    token = (payload.qr_token or "").strip()

    # iter-70: walk-in kiosk tokens (printed thermal receipt). Single-use.
    # Recognised by `kio:` prefix so the same scanner serves both subscriber
    # check-ins AND walk-in receipt check-ins.
    if token.startswith("kio:"):
        kio_token = token[4:]
        order = await db.mess_menu_orders.find_one({"kiosk_token": kio_token}, {"_id": 0})
        if not order:
            raise HTTPException(status_code=404, detail="Invalid kiosk token")
        if order.get("kiosk_consumed_at"):
            raise HTTPException(
                status_code=400,
                detail=f"Receipt already redeemed at {order['kiosk_consumed_at']}",
            )
        # Single-use: atomic flip to prevent double-redeem race
        upd = await db.mess_menu_orders.update_one(
            {"kiosk_token": kio_token, "kiosk_consumed_at": None},
            {"$set": {
                "kiosk_consumed_at": iso(now_utc()),
                "kiosk_consumed_by": user.user_id,
                "status": "served",
            }},
        )
        if upd.modified_count == 0:
            raise HTTPException(status_code=400, detail="Receipt already redeemed")
        return {
            "ok": True,
            "kiosk": True,
            "record": {
                "order_id": order["order_id"],
                "meal_type": order["meal_type"],
                "service": order["service"],
                "qty": order["qty"],
                "total": order["total"],
                "menu_text": order.get("menu_text", ""),
            },
            "subscriber_name": "Walk-in customer",
            "subscriber_phone": order.get("phone") or "—",
            "subscriber_user_id": None,
            "profile_photo_url": None,
            "plan_name": f"Kiosk · {order['service']}",
            "meals_left": 0,
            "meals_total": order["qty"],
            "wallet_balance": 0,
        }

    target = await db.users.find_one({"qr_token": token}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Invalid QR")
    record = await _mark_attendance(target, payload.meal_type, user.user_id, "counter_scan")
    sub = await get_active_subscription(target["user_id"])
    return {
        "ok": True,
        "record": record,
        "subscriber_name": target.get("name"),
        "subscriber_phone": target.get("phone"),
        "subscriber_user_id": target.get("user_id"),
        "profile_photo_url": target.get("profile_photo_url"),
        "plan_name": sub.get("plan_name") if sub else None,
        "meals_left": (sub["meals_total"] - sub["meals_used"]) if sub else 0,
        "meals_total": sub["meals_total"] if sub else 0,
        "wallet_balance": sub.get("wallet_balance") if sub else 0,
    }


# Rotating HMAC counter codes
def _current_bucket() -> int:
    return int(time.time()) // ROTATION_SECONDS


def make_counter_code(location: str, meal: str, bucket: int) -> str:
    payload = f"{location}.{meal}.{bucket}"
    sig = hmac.new(COUNTER_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{payload}.{sig}"


def verify_counter_code(code: str):
    parts = code.split(".")
    if len(parts) != 4:
        return None
    location, meal, bucket_str, sig = parts
    try:
        bucket = int(bucket_str)
    except Exception:
        return None
    expected = make_counter_code(location, meal, bucket).split(".")[-1]
    if not hmac.compare_digest(sig, expected):
        return None
    cur = _current_bucket()
    if bucket > cur + 1 or cur - bucket > GRACE_BUCKETS:
        return None
    if meal not in ("lunch", "dinner"):
        return None
    return {"location": location, "meal": meal, "bucket": bucket}


@api_router.post("/attendance/self-scan")
async def self_scan(payload: SelfScanRequest, user: User = Depends(get_current_user)):
    verified = verify_counter_code(payload.counter_code)
    if not verified:
        raise HTTPException(status_code=400, detail="Invalid or expired counter code")
    meal_type = verified["meal"]
    target = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    record = await _mark_attendance(target, meal_type, verified["location"], "self_scan")
    sub_after = await get_active_subscription(user.user_id)
    return {
        "ok": True,
        "record": record,
        "meal_type": meal_type,
        "meals_left": (sub_after["meals_total"] - sub_after["meals_used"]) if sub_after else 0,
        "meals_total": sub_after["meals_total"] if sub_after else 0,
        "wallet_balance": sub_after["wallet_balance"] if sub_after else 0,
    }


@api_router.get("/counter/qr")
async def counter_qr(meal: str = "lunch", location: str = "main", user: User = Depends(get_current_user)):
    if user.role not in ("staff", "admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Staff/Admin only")
    if meal not in ("lunch", "dinner"):
        raise HTTPException(status_code=400, detail="meal must be lunch or dinner")
    bucket = _current_bucket()
    return {"counter_code": make_counter_code(location, meal, bucket), "meal": meal, "location": location,
            "rotates_at": (bucket + 1) * ROTATION_SECONDS, "rotation_seconds": ROTATION_SECONDS}


@api_router.get("/counter/qr/public")
async def counter_qr_public(meal: str = "lunch", location: str = "main"):
    if meal not in ("lunch", "dinner"):
        raise HTTPException(status_code=400, detail="meal must be lunch or dinner")
    bucket = _current_bucket()
    return {"counter_code": make_counter_code(location, meal, bucket), "meal": meal, "location": location,
            "rotates_at": (bucket + 1) * ROTATION_SECONDS, "rotation_seconds": ROTATION_SECONDS}


@api_router.get("/stats/today")
async def stats_today():
    d = today_str()
    total = await db.attendance.count_documents({"date_str": d})
    lunch = await db.attendance.count_documents({"date_str": d, "meal_type": "lunch"})
    dinner = await db.attendance.count_documents({"date_str": d, "meal_type": "dinner"})
    return {"date": d, "total": total, "lunch": lunch, "dinner": dinner}


@api_router.get("/counter/poster")
async def counter_poster(request: Request, meal: str = "lunch", location: str = "main"):
    if meal not in ("lunch", "dinner"):
        raise HTTPException(status_code=400, detail="meal must be lunch or dinner")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    fwd_proto = request.headers.get("x-forwarded-proto", "https")
    base = f"{fwd_proto}://{fwd_host}" if fwd_host else ""
    kiosk_url = f"{base}/k/{location}?meal={meal}"
    qr = qrcode.QRCode(version=None, box_size=14, border=2)
    qr.add_data(kiosk_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#4b5c4a", back_color="white").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png", headers={"Content-Disposition": f'attachment; filename="efoodcare-{location}-{meal}.png"'})


# ---------------------------
# Menu
# ---------------------------
@api_router.get("/menu/today")
async def menu_today():
    d = today_str()
    m = await db.menus.find_one({"menu_date": d}, {"_id": 0})
    if not m:
        return {
            "menu_date": d,
            "lunch_items": ["Jeera Rice", "Dal Tadka", "Paneer Butter Masala", "Roti", "Salad"],
            "dinner_items": ["Veg Biryani", "Raita", "Mix Veg", "Phulka", "Gulab Jamun"],
        }
    return m


@api_router.post("/admin/menu")
async def set_menu(payload: MenuUpdateRequest, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.menus.update_one(
        {"menu_date": payload.menu_date},
        {"$set": {
            "menu_date": payload.menu_date,
            "lunch_items": payload.lunch_items,
            "dinner_items": payload.dinner_items,
            "updated_at": iso(now_utc()),
        }},
        upsert=True,
    )
    return {"ok": True}


# ---------------------------
# Admin
# ---------------------------
# /admin/stats, /admin/attendance/today, /admin/users, /admin/role → routes/admin.py


# ---------------------------
# Admin wallet / refund override
# ---------------------------
class WalletAdjustRequest(BaseModel):
    delta: float                     # positive = credit, negative = debit
    reason: str
    extend_days: Optional[int] = 0   # iter-99: signed — positive extends end_date, negative pulls it back (floors at start_date)
    # iter-98: meals can be adjusted BOTH ways now.
    #   meals_delta > 0  → add meals back (lowers meals_used; never below 0)
    #   meals_delta < 0  → deduct meals (raises meals_used; capped at meals_total)
    # restore_meals is kept as a backward-compat alias for meals_delta > 0.
    meals_delta: Optional[int] = 0
    restore_meals: Optional[int] = 0


@api_router.post("/admin/users/{target_user_id}/wallet-adjust")
async def admin_wallet_adjust(target_user_id: str, payload: WalletAdjustRequest, user: User = Depends(get_current_user)):
    """Admin manually credits or debits a user's wallet.
    - delta > 0  → credit (refund / goodwill / promo).
    - delta < 0  → debit  (correction / chargeback).
    - extend_days  → optionally pushes the active subscription end_date forward.
    - meals_delta  → positive adds meals back, negative deducts meals (e.g. user
      ate an extra meal for a friend and admin needs to count it).
    iter-92 #3: franchise_owner can adjust wallets of users in *their* branch only.
    iter-98:   meals_delta now supports BOTH directions; restore_meals kept as alias."""
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    # iter-98: unify meals_delta and the legacy restore_meals field.
    if abs(int(payload.extend_days or 0)) > 3650:
        raise HTTPException(status_code=400, detail="extend_days must be between −3650 and +3650")
    meals_change = int(payload.meals_delta or 0) + int(payload.restore_meals or 0)
    if abs(float(payload.delta)) < 0.005 and not payload.extend_days and not meals_change:
        raise HTTPException(status_code=400, detail="Provide a non-zero delta, extend_days, or meals_delta")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="reason is required for audit log")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "franchise_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned")
        if target.get("mess_id") != m["mess_id"]:
            raise HTTPException(status_code=403, detail="User not in your branch")

    sub = await db.subscriptions.find_one({"user_id": target_user_id, "status": "active"}, {"_id": 0})
    if not sub and (payload.delta or payload.extend_days or meals_change):
        # Wallet without an active sub — still allow user-level wallet adjust for goodwill credits
        pass

    delta = round(float(payload.delta), 2)
    audit = {
        "audit_id": f"adj_{uuid.uuid4().hex[:14]}",
        "ts": iso(now_utc()),
        "admin_user_id": user.user_id,
        "admin_email": user.email,
        "target_user_id": target_user_id,
        "target_email": target.get("email"),
        "delta": delta,
        "extend_days": int(payload.extend_days or 0),
        "meals_delta": meals_change,
        # Keep the old key in audit so existing UIs that read `restore_meals` still work.
        "restore_meals": max(0, meals_change),
        "reason": payload.reason.strip()[:500],
        "before": {
            "user_wallet": float(target.get("wallet_balance") or 0),
            "sub_wallet": float((sub or {}).get("wallet_balance") or 0),
            "end_date": (sub or {}).get("end_date"),
            "meals_used": (sub or {}).get("meals_used"),
            "meals_total": (sub or {}).get("meals_total"),
        },
    }

    new_user_wallet = max(0.0, round(float(target.get("wallet_balance") or 0) + delta, 2))
    await db.users.update_one({"user_id": target_user_id}, {"$set": {"wallet_balance": new_user_wallet}})

    sub_updates = {}
    if sub:
        if delta:
            sub_updates["wallet_balance"] = max(0.0, round(float(sub["wallet_balance"]) + delta, 2))
            # Adjusting wallet may revive the sub from the wallet=0 grace window
            if sub_updates["wallet_balance"] > 0 and sub.get("zero_wallet_grace_until"):
                sub_updates["zero_wallet_grace_until"] = None
        if payload.extend_days:
            # iter-99: signed extend_days — positive pushes the end_date
            # forward, negative pulls it back. We floor at sub.start_date so
            # admins can't accidentally close a sub before it began.
            old_end = parse_dt(sub["end_date"])
            start = parse_dt(sub["start_date"]) if sub.get("start_date") else old_end - timedelta(days=30)
            new_end = old_end + timedelta(days=int(payload.extend_days))
            if new_end < start:
                new_end = start
            sub_updates["end_date"] = iso(new_end)
        if meals_change:
            # Positive meals_delta = restore (lower meals_used); negative = deduct (raise meals_used).
            current_used = int(sub.get("meals_used", 0))
            current_total = int(sub.get("meals_total", 0))
            # New meals_used after applying the change. meals_used drops on restore,
            # rises on deduction, and is hard-clamped to [0, meals_total].
            proposed = current_used - meals_change
            new_used = max(0, min(current_total, proposed))
            sub_updates["meals_used"] = new_used
        if sub_updates:
            unset_ops = {}
            if sub_updates.get("zero_wallet_grace_until") is None and "zero_wallet_grace_until" in sub_updates:
                unset_ops["zero_wallet_grace_until"] = ""
                sub_updates.pop("zero_wallet_grace_until")
            ops = {"$set": sub_updates}
            if unset_ops:
                ops["$unset"] = unset_ops
            await db.subscriptions.update_one({"sub_id": sub["sub_id"]}, ops)

    await _log_wallet_txn(
        target_user_id, (sub or {}).get("sub_id") or "user-wallet",
        "credit" if delta >= 0 else "debit",
        abs(delta),
        sub_updates.get("wallet_balance", new_user_wallet),
        f"Admin override · {payload.reason.strip()[:200]} · by {user.email}",
    )
    audit["after"] = {
        "user_wallet": new_user_wallet,
        "sub_wallet": sub_updates.get("wallet_balance"),
        "end_date": sub_updates.get("end_date"),
        "meals_used": sub_updates.get("meals_used"),
    }
    await db.wallet_overrides.insert_one(audit.copy())
    audit.pop("_id", None)

    # iter-101: surface the adjustment to the user via an in-app notice they
    # see the next time they open the app. Pieced together from whatever the
    # admin actually changed.
    try:
        bits = []
        if delta > 0:
            bits.append(f"+₹{abs(delta):.0f} credited")
        elif delta < 0:
            bits.append(f"−₹{abs(delta):.0f} debited")
        if int(payload.extend_days or 0) > 0:
            bits.append(f"+{int(payload.extend_days)} day{'s' if abs(int(payload.extend_days))!=1 else ''}")
        elif int(payload.extend_days or 0) < 0:
            bits.append(f"{int(payload.extend_days)} day{'s' if abs(int(payload.extend_days))!=1 else ''}")
        if meals_change > 0:
            bits.append(f"+{meals_change} meal{'s' if meals_change!=1 else ''} restored")
        elif meals_change < 0:
            bits.append(f"{meals_change} meal{'s' if abs(meals_change)!=1 else ''} deducted")
        if bits:
            await _push_user_notice(
                target_user_id,
                kind="wallet_adjust",
                title="Account updated by admin",
                body=" · ".join(bits) + f" — Reason: {payload.reason.strip()[:200]}",
                meta={
                    "delta": delta,
                    "extend_days": int(payload.extend_days or 0),
                    "meals_delta": meals_change,
                    "new_wallet": new_user_wallet,
                },
            )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[NOTICE] push failed for user={target_user_id}: {e}")

    return {"ok": True, **audit}


@api_router.get("/admin/users/{target_user_id}/wallet-history")
async def admin_wallet_history(target_user_id: str, user: User = Depends(get_current_user)):
    # iter-92 #3: franchise_owner can read wallet history of their branch's users.
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if user.role == "franchise_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned")
        target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "mess_id": 1})
        if (target or {}).get("mess_id") != m["mess_id"]:
            raise HTTPException(status_code=403, detail="User not in your branch")
    txns = await db.wallet_transactions.find({"user_id": target_user_id}, {"_id": 0}).sort("ts", -1).to_list(200)
    overrides = await db.wallet_overrides.find({"target_user_id": target_user_id}, {"_id": 0}).sort("ts", -1).to_list(200)
    return {"transactions": txns, "overrides": overrides}


# ---------------------------------------------------------------------------
# iter-101: In-app notices written by admin actions (wallet-adjust, manual
# subscription assignment). Surfaced to the user the next time they open the
# dashboard so they know exactly what changed.
# ---------------------------------------------------------------------------
async def _push_user_notice(user_id: str, *, kind: str, title: str, body: str, meta: Optional[dict] = None) -> dict:
    notice = {
        "notice_id": f"ntc_{uuid.uuid4().hex[:14]}",
        "user_id": user_id,
        "kind": kind,
        "title": title,
        "body": body,
        "meta": meta or {},
        "ts": iso(now_utc()),
        "read_at": None,
    }
    await db.admin_user_notices.insert_one(notice.copy())
    notice.pop("_id", None)
    return notice


@api_router.get("/auth/notices")
async def list_my_notices(only_unread: bool = False, user: User = Depends(get_current_user)):
    """Return latest 20 admin notices for the current user, newest first."""
    q: dict = {"user_id": user.user_id}
    if only_unread:
        q["read_at"] = None
    rows = await db.admin_user_notices.find(q, {"_id": 0}).sort("ts", -1).to_list(20)
    unread = await db.admin_user_notices.count_documents({"user_id": user.user_id, "read_at": None})
    return {"notices": rows, "unread": unread}


@api_router.post("/auth/notices/ack")
async def ack_my_notices(payload: dict = Body(...), user: User = Depends(get_current_user)):
    """Mark notices as read. Pass `{notice_ids: ["ntc_..", ..]}` or `{all: true}`."""
    if payload.get("all"):
        res = await db.admin_user_notices.update_many(
            {"user_id": user.user_id, "read_at": None},
            {"$set": {"read_at": iso(now_utc())}},
        )
        return {"ok": True, "marked": res.modified_count}
    ids = payload.get("notice_ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="notice_ids or all=true required")
    res = await db.admin_user_notices.update_many(
        {"user_id": user.user_id, "notice_id": {"$in": ids}, "read_at": None},
        {"$set": {"read_at": iso(now_utc())}},
    )
    return {"ok": True, "marked": res.modified_count}


# ---------------------------------------------------------------------------
# iter-101: Admin manually assigns a subscription to a user (cash / offline
# customer who can't navigate the web app).
# ---------------------------------------------------------------------------
class AssignSubscriptionRequest(BaseModel):
    # Either pick an existing plan_id OR provide custom values. If plan_id is
    # provided we still let the admin override duration_days / meals / amount
    # so a non-standard ad-hoc plan can be created from a template.
    plan_id: Optional[str] = None
    name: Optional[str] = None              # required if no plan_id
    duration_days: Optional[int] = None     # required if no plan_id
    meals: Optional[int] = None             # required if no plan_id
    amount: Optional[float] = None          # required if no plan_id
    service_type: Optional[Literal["dining", "tiffin"]] = "dining"
    tiffin_size: Optional[Literal["full", "half"]] = "full"
    meal_window: Optional[Literal["both", "lunch", "dinner"]] = "both"
    start_date: Optional[str] = None        # ISO date (YYYY-MM-DD); defaults to today
    reason: str
    replace_active: bool = True             # cancel any existing active sub first


@api_router.post("/admin/users/{target_user_id}/assign-subscription")
async def admin_assign_subscription(
    target_user_id: str,
    payload: AssignSubscriptionRequest,
    user: User = Depends(get_current_user),
):
    """Admin (or franchise owner for their branch) manually onboards a user
    onto a subscription without going through Razorpay. Used for customers
    who pay cash to the manager and don't navigate the web app themselves.
    """
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="reason is required for audit log")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "franchise_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned")
        if target.get("mess_id") != m["mess_id"]:
            raise HTTPException(status_code=403, detail="User not in your branch")

    # Resolve plan source
    plan: dict
    if payload.plan_id:
        plan_doc = await db.plans.find_one({"plan_id": payload.plan_id}, {"_id": 0})
        if not plan_doc:
            raise HTTPException(status_code=404, detail="Plan not found")
        plan = {
            "plan_id": plan_doc["plan_id"],
            "name": payload.name or plan_doc["name"],
            "amount": float(payload.amount) if payload.amount is not None else float(plan_doc["amount"]),
            "currency": plan_doc.get("currency", "INR"),
            "duration_days": int(payload.duration_days) if payload.duration_days is not None else int(plan_doc["duration_days"]),
            "meals": int(payload.meals) if payload.meals is not None else int(plan_doc["meals"]),
            "service_type": payload.service_type or plan_doc.get("service_type") or "dining",
            "tiffin_size": payload.tiffin_size or plan_doc.get("tiffin_size") or "full",
            "meal_window": (payload.meal_window or plan_doc.get("meal_window") or "both").lower(),
            "category": plan_doc.get("category") or (payload.service_type or "dining"),
            "plan_type": plan_doc.get("plan_type") or "kiosk",
        }
    else:
        # Validate custom inputs
        if not payload.name or not payload.name.strip():
            raise HTTPException(status_code=400, detail="name is required for a custom plan")
        if not payload.duration_days or payload.duration_days < 1 or payload.duration_days > 365:
            raise HTTPException(status_code=400, detail="duration_days must be between 1 and 365")
        if payload.meals is None or payload.meals < 1 or payload.meals > 2000:
            raise HTTPException(status_code=400, detail="meals must be between 1 and 2000")
        if payload.amount is None or payload.amount < 0 or payload.amount > 1_000_000:
            raise HTTPException(status_code=400, detail="amount must be between 0 and 10,00,000")
        plan = {
            "plan_id": f"manual_{uuid.uuid4().hex[:8]}",
            "name": payload.name.strip(),
            "amount": float(payload.amount),
            "currency": "INR",
            "duration_days": int(payload.duration_days),
            "meals": int(payload.meals),
            "service_type": payload.service_type or "dining",
            "tiffin_size": payload.tiffin_size or "full",
            "meal_window": (payload.meal_window or "both").lower(),
            "category": payload.service_type or "dining",
            "plan_type": "manual",
        }

    # Cancel/expire existing active sub if requested
    existing = await db.subscriptions.find_one({"user_id": target_user_id, "status": "active"}, {"_id": 0})
    if existing:
        if not payload.replace_active:
            raise HTTPException(status_code=409, detail="User already has an active subscription. Set replace_active=true to override.")
        await db.subscriptions.update_one(
            {"sub_id": existing["sub_id"]},
            {"$set": {
                "status": "expired",
                "expired_reason": "admin_replaced",
                "expired_at": iso(now_utc()),
            }},
        )

    # Build the new subscription doc
    if payload.start_date:
        try:
            start = datetime.fromisoformat(payload.start_date).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date must be ISO format (YYYY-MM-DD)")
    else:
        start = now_utc()
    end = start + timedelta(days=plan["duration_days"])
    per_day = round(float(plan["amount"]) / max(1, plan["duration_days"]), 2)
    wallet_load = round(float(plan["amount"]), 2)

    sub = {
        "sub_id": f"sub_{uuid.uuid4().hex[:12]}",
        "user_id": target_user_id,
        "plan_id": plan["plan_id"],
        "plan_name": plan["name"],
        "amount_paid": wallet_load,
        "plan_amount": wallet_load,
        "pending_amount": 0.0,
        "partial_surcharge": 0.0,
        "is_partial": False,
        "payment_mode": "admin_manual",
        "currency": plan["currency"],
        "meals_total": plan["meals"],
        "meals_used": 0,
        "wallet_balance": wallet_load,
        "per_day_amount": per_day,
        "start_date": iso(start),
        "end_date": iso(end),
        "last_tick_date": start.strftime("%Y-%m-%d"),
        "paused_days": 0,
        "status": "active",
        "order_id": f"manual_{uuid.uuid4().hex[:10]}",
        "is_custom": payload.plan_id is None,
        "service_type": plan["service_type"],
        "plan_type": plan.get("plan_type") or "manual",
        "tiffin_size": plan.get("tiffin_size"),
        "user_paused": False,
        "user_pause_started_at": None,
        "meal_window": plan["meal_window"],
        "category": plan["category"],
        "assigned_by_admin": user.email or user.user_id,
        "admin_assign_reason": payload.reason.strip()[:500],
        "created_at": iso(start),
    }
    await db.subscriptions.insert_one(sub.copy())
    # Credit the user's wallet for the plan amount (mirrors the paid-flow)
    new_user_wallet = round(float(target.get("wallet_balance") or 0) + wallet_load, 2)
    await db.users.update_one({"user_id": target_user_id}, {"$set": {"wallet_balance": new_user_wallet}})
    await _log_wallet_txn(
        target_user_id, sub["sub_id"], "credit", wallet_load, new_user_wallet,
        f"Manual subscription assigned by admin ({plan['name']}) · {payload.reason.strip()[:200]} · by {user.email}",
    )

    # Audit log
    audit = {
        "audit_id": f"asg_{uuid.uuid4().hex[:14]}",
        "ts": iso(now_utc()),
        "admin_user_id": user.user_id,
        "admin_email": user.email,
        "target_user_id": target_user_id,
        "target_email": target.get("email"),
        "sub_id": sub["sub_id"],
        "plan_name": plan["name"],
        "amount": wallet_load,
        "duration_days": plan["duration_days"],
        "meals": plan["meals"],
        "service_type": plan["service_type"],
        "reason": payload.reason.strip()[:500],
        "replaced_sub_id": existing["sub_id"] if existing else None,
    }
    await db.wallet_overrides.insert_one({
        **audit,
        "delta": wallet_load,
        "extend_days": 0,
        "meals_delta": 0,
        "restore_meals": 0,
        "kind": "assign_subscription",
        "before": {"sub_id": existing["sub_id"] if existing else None},
        "after": {"sub_id": sub["sub_id"], "end_date": sub["end_date"], "meals_total": sub["meals_total"]},
    })

    # Notify the user in-app
    try:
        await _push_user_notice(
            target_user_id,
            kind="subscription_assigned",
            title=f"Your {plan['name']} plan is active",
            body=(
                f"Admin onboarded you onto {plan['name']} — {plan['meals']} meals over "
                f"{plan['duration_days']} days · ₹{wallet_load:.0f} credited. Reason: {payload.reason.strip()[:200]}"
            ),
            meta={
                "sub_id": sub["sub_id"],
                "plan_name": plan["name"],
                "amount": wallet_load,
                "meals": plan["meals"],
                "duration_days": plan["duration_days"],
                "end_date": sub["end_date"],
            },
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[NOTICE] subscription_assigned notice push failed for user={target_user_id}: {e}")

    return {"ok": True, "subscription": sub, "audit": audit, "user_wallet": new_user_wallet}


async def _purge_user(user_id: str) -> dict:
    """Delete a user and every record that points to them (sessions, subs, txns, attendance, deliveries).

    iter-101: hardened to swallow per-collection errors so a single failing
    cascade can never block the user's right-to-delete. Uses the actual
    collection names from this codebase (user_sessions / otp_codes), and
    cascades the additional collections written since the original purge
    (restaurant_orders, wallet_overrides, scan_logs, user notices, etc.).
    """
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        return {"deleted": False}
    phone = user.get("phone") or "__none__"

    targets = [
        ("user_sessions",        {"user_id": user_id}),
        ("subscriptions",        {"user_id": user_id}),
        ("wallet_transactions",  {"user_id": user_id}),
        ("wallet_overrides",     {"target_user_id": user_id}),
        ("attendance",           {"user_id": user_id}),
        ("payment_orders",       {"user_id": user_id}),
        ("daily_rosters",        {"user_id": user_id}),
        ("delivery_attempts",    {"user_id": user_id}),
        ("restaurant_orders",    {"user_id": user_id}),
        ("guest_carts",          {"user_id": user_id}),
        ("scan_logs",            {"user_id": user_id}),
        ("tiffin_reminders_sent",{"user_id": user_id}),
        ("expiry_reminders_sent",{"user_id": user_id}),
        ("rider_applications",   {"user_id": user_id}),
        ("rider_payouts",        {"user_id": user_id}),
        ("admin_user_notices",   {"user_id": user_id}),
        ("otp_codes",            {"phone": phone}),
    ]
    counts: dict = {}
    for coll_name, query in targets:
        try:
            res = await db[coll_name].delete_many(query)
            counts[coll_name] = res.deleted_count
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[USER PURGE] cascade {coll_name} failed for user={user_id}: {e}")
            counts[coll_name] = -1
    try:
        counts["users"] = (await db.users.delete_one({"user_id": user_id})).deleted_count
    except Exception as e:  # noqa: BLE001
        logger.error(f"[USER PURGE] users.delete_one failed for user={user_id}: {e}")
        counts["users"] = 0
    logger.info(f"[USER PURGE] user={user_id} email={user.get('email')} phone={user.get('phone')} → {counts}")
    return {"deleted": counts.get("users", 0) > 0, "counts": counts}


@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if user_id == user.user_id:
        raise HTTPException(status_code=400, detail="You can't delete your own account from the admin panel — use Profile → Delete account")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Block deleting other admins for safety; demote to subscriber first if needed
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete an admin. Demote them to subscriber/staff first.")
    res = await _purge_user(user_id)
    return {"ok": True, **res}


@api_router.post("/admin/users/bulk-delete")
async def admin_bulk_delete_users(payload: dict = Body(...), user: User = Depends(get_current_user)):
    """Iter-59 #4: bulk-delete up to 100 users in one call.

    Same safety rules as the single-delete endpoint:
      - admin role required
      - cannot delete self
      - cannot delete other admins
    Skipped users are returned in `skipped` with a reason so the UI can show them.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    ids = payload.get("user_ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="user_ids must be a non-empty list")
    if len(ids) > 100:
        raise HTTPException(status_code=400, detail="Cap is 100 users per call — split your selection")

    deleted, skipped = [], []
    for uid in ids:
        if not isinstance(uid, str) or not uid:
            skipped.append({"user_id": uid, "reason": "invalid id"})
            continue
        if uid == user.user_id:
            skipped.append({"user_id": uid, "reason": "self"})
            continue
        target = await db.users.find_one({"user_id": uid}, {"_id": 0})
        if not target:
            skipped.append({"user_id": uid, "reason": "not found"})
            continue
        if target.get("role") == "admin":
            skipped.append({"user_id": uid, "reason": "is admin"})
            continue
        try:
            await _purge_user(uid)
            deleted.append(uid)
        except Exception as e:  # noqa: BLE001
            skipped.append({"user_id": uid, "reason": f"error: {e}"})
    return {"ok": True, "deleted_count": len(deleted), "deleted": deleted, "skipped": skipped}


@api_router.delete("/auth/me")
async def delete_my_account(user: User = Depends(get_current_user)):
    """User-initiated account deletion."""
    if user.role == "admin":
        # Prevent the only admin from accidentally locking themselves out
        admin_count = await db.users.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="You're the only admin. Promote another user before deleting your account.")
    res = await _purge_user(user.user_id)
    return {"ok": True, **res}


@api_router.post("/admin/cron/run-tick")
async def admin_run_tick(user: User = Depends(get_current_user)):
    """Manually run subscription tick across all active subs. Useful for testing 3-day inactivity logic."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await run_subscription_tick()
    return {"ok": True, **result}


@api_router.post("/admin/cron/run-reminders")
async def admin_run_reminders(user: User = Depends(get_current_user)):
    """Manually trigger the empty-tiffin reminder scan. Reads slot windows from delivery_settings."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await run_empty_tiffin_reminders()
    return {"ok": True, **result, "stub_mode": _sms_stub_mode_status()}


@api_router.post("/admin/cron/run-expiry-reminders")
async def admin_run_expiry_reminders(user: User = Depends(get_current_user)):
    """Manually trigger the subscription-expiry reminder scan (SMS only)."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await run_expiry_reminders()
    return {"ok": True, **result, "sms_stub": _sms_stub_mode_status()}


def _sms_stub_mode_status() -> bool:
    try:
        from sms import is_stub_mode  # type: ignore
        return is_stub_mode()
    except Exception:
        return True


# ---------------------------
# Subscriber Dashboard CMS — admin-controlled text, visibility, order, colour overrides
# ---------------------------
DASHBOARD_DEFAULT_SECTIONS = [
    {"id": "greeting",        "label": "Greeting + heading",       "visible": True, "order": 0},
    {"id": "hero",            "label": "Pass / Tiffin hero card",  "visible": True, "order": 1},
    {"id": "tiffin_tracker",  "label": "Tiffin tracking widget",   "visible": True, "order": 2},
    {"id": "wallet",          "label": "Wallet card",              "visible": True, "order": 3},
    {"id": "today_status",    "label": "Today's check-in status",  "visible": True, "order": 4},
    {"id": "todays_menu",     "label": "Today's menu",             "visible": True, "order": 5},
    {"id": "history",         "label": "Recent check-ins",         "visible": True, "order": 6},
]
DASHBOARD_DEFAULT_TEXTS = {
    "greeting_overline":      "Hello,",
    "heading_eatin":          "Your e-Meal Pass",
    "heading_tiffin":         "Your tiffin delivery",
    "subtext":                "ghar se achha khana",
    "no_sub_title":           "You don't have an active plan",
    "no_sub_subtext":         "Pick a dining or tiffin plan to start eating ghar se achha khana.",
}
DASHBOARD_DEFAULT_COLORS = {
    "wallet_bg":      "",   # empty = use theme primary
    "wallet_fg":      "",   # empty = primary-foreground
    "hero_accent":    "",
    "section_card_bg":"",
}
DASHBOARD_DEFAULT_CONFIG = {
    "sections": DASHBOARD_DEFAULT_SECTIONS,
    "texts": DASHBOARD_DEFAULT_TEXTS,
    "colors": DASHBOARD_DEFAULT_COLORS,
}


async def _load_dashboard_config() -> dict:
    cfg = await db.dashboard_config.find_one({"_id": "active"}, {"_id": 0})
    if not cfg:
        await db.dashboard_config.insert_one({"_id": "active", **DASHBOARD_DEFAULT_CONFIG})
        return dict(DASHBOARD_DEFAULT_CONFIG)
    # Merge in any new defaults so admin sees newly-added sections/texts
    out = {
        "sections": cfg.get("sections") or DASHBOARD_DEFAULT_SECTIONS,
        "texts": {**DASHBOARD_DEFAULT_TEXTS, **(cfg.get("texts") or {})},
        "colors": {**DASHBOARD_DEFAULT_COLORS, **(cfg.get("colors") or {})},
    }
    # Ensure every default section exists (preserves admin's order/visibility for existing ones)
    have = {s["id"] for s in out["sections"]}
    next_order = max((s.get("order", 0) for s in out["sections"]), default=-1) + 1
    for d in DASHBOARD_DEFAULT_SECTIONS:
        if d["id"] not in have:
            out["sections"].append({**d, "order": next_order})
            next_order += 1
    out["sections"].sort(key=lambda s: s.get("order", 0))
    return out


class DashboardConfigPatch(BaseModel):
    sections: Optional[List[dict]] = None
    texts: Optional[dict] = None
    colors: Optional[dict] = None


@api_router.get("/dashboard/config")
async def get_dashboard_config():
    """Public — subscriber dashboard reads this to render text, ordering and colour overrides."""
    return await _load_dashboard_config()


@api_router.patch("/admin/dashboard/config")
async def patch_dashboard_config(payload: DashboardConfigPatch, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cur = await _load_dashboard_config()
    patch = {k: v for k, v in payload.dict(exclude_none=True).items()}
    if "sections" in patch:
        # Sanitize: keep id/label/visible/order only
        clean = []
        for i, s in enumerate(patch["sections"]):
            clean.append({
                "id": str(s.get("id", "")).strip(),
                "label": str(s.get("label", "")).strip()[:80],
                "visible": bool(s.get("visible", True)),
                "order": int(s.get("order", i)),
            })
        patch["sections"] = clean
    if "texts" in patch:
        patch["texts"] = {**(cur.get("texts") or {}), **{k: str(v)[:300] for k, v in patch["texts"].items()}}
    if "colors" in patch:
        patch["colors"] = {**(cur.get("colors") or {}), **{k: str(v)[:40] for k, v in patch["colors"].items()}}
    await db.dashboard_config.update_one({"_id": "active"}, {"$set": patch}, upsert=True)
    return await _load_dashboard_config()


@api_router.post("/admin/dashboard/config/reset")
async def reset_dashboard_config(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.dashboard_config.update_one({"_id": "active"}, {"$set": DASHBOARD_DEFAULT_CONFIG}, upsert=True)
    return await _load_dashboard_config()


# ---------------------------
# Raw material requirement calculator (admin)
# ---------------------------
# Defaults are per person per MONTH (30 days · 60 meals); halves for half-tiffin subscribers.
# A,B,C,D are quantity-based; vegetables (E) is rupee-based and has no quantity.
RAW_MATERIAL_DEFAULTS = [
    {"key": "toor_dal",   "label": "Toor dal",       "unit": "kg",  "qty_per_person_month": 2.1, "price_per_unit": 60.0,  "is_amount_based": False},
    {"key": "rice",       "label": "Rice",           "unit": "kg",  "qty_per_person_month": 2.5, "price_per_unit": 90.0,  "is_amount_based": False},
    {"key": "wheat",      "label": "Wheat",          "unit": "kg",  "qty_per_person_month": 8.0, "price_per_unit": 40.0,  "is_amount_based": False},
    {"key": "oil",        "label": "Oil",            "unit": "ltr", "qty_per_person_month": 1.8, "price_per_unit": 190.0, "is_amount_based": False},
    {"key": "vegetables", "label": "Vegetables",     "unit": "₹",   "qty_per_person_month": None, "price_per_unit": None, "is_amount_based": True, "amount_per_person_month": 400.0},
    {"key": "cylinder",   "label": "LPG Cylinder",   "unit": "₹",   "qty_per_person_month": None, "price_per_unit": None, "is_amount_based": True, "amount_per_person_month": 100.0},
]


async def _load_raw_materials(mess_id: Optional[str] = None) -> list[dict]:
    """iter-95: per-mess raw materials. mess_id=None → HQ-global doc {_id:"active"}.
    Per-mess docs are keyed by mess_id; missing mess docs fall back to the global
    defaults so first-time franchise owners see something useful immediately."""
    doc_id = mess_id or "active"
    doc = await db.raw_materials_config.find_one({"_id": doc_id}, {"_id": 0})
    if doc:
        items = doc.get("items") or RAW_MATERIAL_DEFAULTS
    elif mess_id:
        # First read for this branch — clone the global defaults so future edits don't
        # collide with HQ. We also seed the doc so caching works.
        items = list(RAW_MATERIAL_DEFAULTS)
        await db.raw_materials_config.insert_one({"_id": mess_id, "items": items})
    else:
        await db.raw_materials_config.insert_one({"_id": "active", "items": RAW_MATERIAL_DEFAULTS})
        return list(RAW_MATERIAL_DEFAULTS)
    # Merge in any newly-added defaults
    have = {i["key"] for i in items}
    for d in RAW_MATERIAL_DEFAULTS:
        if d["key"] not in have:
            items.append(d)
    return items


def _per_meal_factor(item: dict) -> dict:
    """Convert per-person-per-month → per-person-per-meal (1 meal = 1/60 of a month)."""
    out = {**item}
    if item.get("is_amount_based"):
        amt_month = float(item.get("amount_per_person_month") or 0)
        out["amount_per_person_meal"] = round(amt_month / 60.0, 4)
    else:
        qty_month = float(item.get("qty_per_person_month") or 0)
        price = float(item.get("price_per_unit") or 0)
        out["qty_per_person_meal"] = round(qty_month / 60.0, 6)
        out["amount_per_person_meal"] = round((qty_month * price) / 60.0, 4)
    return out


async def _count_active_persons(mess_id: Optional[str] = None) -> dict:
    """Persons-per-meal weighting: full tiffin / dining = 1.0; half tiffin = 0.5.
    Inactive (auto-paused or user-paused tiffin) subs don't count for today's cooking.
    iter-95: when mess_id is supplied, only count subs in that branch."""
    q: dict = {"status": "active"}
    if mess_id:
        q["mess_id"] = mess_id
    subs = await db.subscriptions.find(q, {"_id": 0}).to_list(20000)
    full = 0
    half = 0
    today = date.today()
    for s in subs:
        end_dt = parse_dt(s["end_date"])
        if end_dt.date() < today:
            continue
        # User-paused tiffin → not cooking for them today
        if s.get("user_paused") and s.get("service_type") == "tiffin":
            continue
        # Wallet=0 grace started → still cooking for now (only stop after grace expiry on tick)
        size = (s.get("tiffin_size") or "full") if s.get("service_type") == "tiffin" else "full"
        if size == "half":
            half += 1
        else:
            full += 1
    persons = full + (half * 0.5)
    return {"full": full, "half": half, "persons": round(persons, 2), "active_subs": full + half}


def _admin_or_staff(user: User):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin or staff only")


# iter-95: unified branch scoping for ALL operational endpoints.
# Returns the mess_id whose data should be served for the current request:
#   • franchise_owner → their assigned mess (cannot be overridden)
#   • admin / staff   → `as_mess_id` query param (None = HQ-global)
#   • other           → 403
async def effective_mess_id(user: User, as_mess_id: Optional[str] = None) -> Optional[str]:
    if user.role == "franchise_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned")
        return m["mess_id"]
    if user.role in ("admin", "staff"):
        if as_mess_id:
            # Verify the mess exists so admins don't accidentally filter into nothing.
            exists = await db.messes.find_one({"mess_id": as_mess_id}, {"_id": 0, "mess_id": 1})
            if not exists:
                raise HTTPException(status_code=404, detail=f"Unknown mess: {as_mess_id}")
            return as_mess_id
        return None  # HQ-global view
    raise HTTPException(status_code=403, detail="Not allowed")


async def _users_in_mess(mess_id: Optional[str]) -> Optional[list]:
    """Returns the list of user_ids belonging to a mess, or None for global scope.
    Used as a filter on payments / scans / orders that link to a user."""
    if not mess_id:
        return None
    ids: list = []
    async for u in db.users.find({"mess_id": mess_id}, {"_id": 0, "user_id": 1}):
        uid = u.get("user_id")
        if uid:
            ids.append(uid)
    return ids


@api_router.get("/admin/raw-materials")
async def get_raw_materials(user: User = Depends(get_current_user), fresh: bool = False, as_mess_id: Optional[str] = None):
    _admin_or_staff(user)
    mid = await effective_mess_id(user, as_mess_id)
    if fresh:
        _invalidate_raw_materials_cache(mid)
    return await _compute_raw_materials_cached(mid)


# Lightweight in-process memo — invalidated when admin edits items or resets defaults,
# or when the cached entry exceeds 60s. Cuts repeated mongo scans on the dashboard view.
# iter-95: cache is now keyed by mess_id ("__global__" for HQ) so franchises see independent values.
_RM_CACHE: dict = {}
_RM_TTL_SECONDS = 60


def _invalidate_raw_materials_cache(mess_id: Optional[str] = None):
    if mess_id is None:
        _RM_CACHE.clear()
    else:
        _RM_CACHE.pop(mess_id or "__global__", None)


async def _compute_raw_materials_cached(mess_id: Optional[str] = None) -> dict:
    import time as _t
    now_s = _t.monotonic()
    key = mess_id or "__global__"
    entry = _RM_CACHE.get(key)
    if entry is not None and (now_s - entry["ts"]) < _RM_TTL_SECONDS:
        return entry["value"]
    val = await _compute_raw_materials_fresh(mess_id)
    _RM_CACHE[key] = {"value": val, "ts": now_s}
    return val


async def _compute_raw_materials_fresh(mess_id: Optional[str] = None) -> dict:
    items = await _load_raw_materials(mess_id)
    counts = await _count_active_persons(mess_id)
    persons = float(counts["persons"])

    breakdown = []
    total_lunch_cost = 0.0
    total_dinner_cost = 0.0
    total_day_cost = 0.0
    low_stock_alerts: list[dict] = []
    now_dt = now_utc()
    for it in items:
        factored = _per_meal_factor(it)
        per_meal_amount = float(factored.get("amount_per_person_meal") or 0)
        meal_cost = round(per_meal_amount * persons, 2)
        if factored.get("is_amount_based"):
            row = {
                **factored,
                "lunch_qty": None, "dinner_qty": None, "day_qty": None,
                "lunch_cost": meal_cost, "dinner_cost": meal_cost,
                "day_cost": round(meal_cost * 2, 2),
            }
        else:
            per_meal_qty = float(factored.get("qty_per_person_meal") or 0)
            qty_meal = round(per_meal_qty * persons, 4)
            row = {
                **factored,
                "lunch_qty": qty_meal,
                "dinner_qty": qty_meal,
                "day_qty": round(qty_meal * 2, 4),
                "lunch_cost": meal_cost,
                "dinner_cost": meal_cost,
                "day_cost": round(meal_cost * 2, 2),
            }
        # Stock tracking — compute remaining after daily deduction since topup
        if not factored.get("is_amount_based"):
            stock_topup = float(it.get("current_stock") or 0)
            topup_at = it.get("last_stock_topup_at")
            day_qty = float(row.get("day_qty") or 0)
            days = 0
            if topup_at:
                try:
                    delta = now_dt - parse_dt(topup_at)
                    days = max(0, int(delta.total_seconds() // 86400))
                except Exception:
                    days = 0
            consumed = round(days * day_qty, 4)
            stock_remaining = max(0.0, round(stock_topup - consumed, 4))
            # Monthly need = qty_per_person_month * persons
            monthly_need = float(factored.get("qty_per_person_month") or 0) * persons
            threshold_pct = float(it.get("low_stock_threshold_pct") or 10.0)
            pct_remaining = (stock_remaining / monthly_need * 100.0) if monthly_need > 0 else None
            low_stock = (pct_remaining is not None and pct_remaining < threshold_pct)
            row["current_stock"] = stock_topup
            row["stock_topup_at"] = topup_at
            row["stock_consumed"] = consumed
            row["stock_remaining"] = stock_remaining
            row["monthly_need"] = round(monthly_need, 4)
            row["pct_remaining"] = round(pct_remaining, 1) if pct_remaining is not None else None
            row["low_stock_threshold_pct"] = threshold_pct
            row["low_stock"] = low_stock
            if low_stock:
                low_stock_alerts.append({
                    "key": it["key"], "label": it.get("label") or it["key"],
                    "stock_remaining": stock_remaining, "unit": it.get("unit") or "",
                    "pct_remaining": row["pct_remaining"], "monthly_need": round(monthly_need, 4),
                    "shortage": round(monthly_need - stock_remaining, 4),
                })
        total_lunch_cost += row["lunch_cost"]
        total_dinner_cost += row["dinner_cost"]
        total_day_cost += row["day_cost"]
        breakdown.append(row)

    # Auto-generate a PO when any item is low-stock — idempotent per UTC day so we
    # don't spam. Stored alongside admin-generated POs so admin can review.
    if low_stock_alerts:
        try:
            today_key = now_dt.date().isoformat()
            already = await db.purchase_orders.find_one({"po_number": f"AUTO-{today_key}"})
            if not already:
                po_doc = {
                    "po_number": f"AUTO-{today_key}",
                    "kind": "auto_low_stock",
                    "generated_at": iso(now_dt),
                    "generated_by": "system",
                    "items": [
                        {"label": a["label"], "qty": a["shortage"], "unit": a["unit"], "reason": f"low stock {a['pct_remaining']}%"}
                        for a in low_stock_alerts
                    ],
                    "notes": "Auto-generated · stock below 10% of monthly need",
                }
                await db.purchase_orders.insert_one(po_doc)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[RM] auto-PO failed · {e}")

    return {
        "items": items,
        "breakdown": breakdown,
        "counts": counts,
        "totals": {
            "lunch_cost": round(total_lunch_cost, 2),
            "dinner_cost": round(total_dinner_cost, 2),
            "day_cost": round(total_day_cost, 2),
        },
        "low_stock_alerts": low_stock_alerts,
        "scope": "branch" if mess_id else "global",
        "mess_id": mess_id,
        "computed_at": iso(now_utc()),
        "notes": [
            "Quantities: per person per month (toor dal, rice, wheat, oil). Vegetables track ₹ instead of kg.",
            "1 active subscriber = 1 person; half-tiffin subscriber = 0.5 person.",
            "Per-meal need = per-person-per-month ÷ 60. Lunch + dinner = 2 meals/day.",
            "Stock remaining = current_stock - (days_since_topup × day_qty). Below 10% of monthly need triggers low-stock alert + auto-PO.",
        ],
    }


class RawMaterialItem(BaseModel):
    key: str
    label: Optional[str] = None
    unit: Optional[str] = None
    qty_per_person_month: Optional[float] = None
    price_per_unit: Optional[float] = None
    amount_per_person_month: Optional[float] = None
    is_amount_based: Optional[bool] = None
    current_stock: Optional[float] = None
    last_stock_topup_at: Optional[str] = None
    low_stock_threshold_pct: Optional[float] = None


class RawMaterialPatch(BaseModel):
    items: List[RawMaterialItem]


class RawMaterialStockTopup(BaseModel):
    key: str
    qty: float = Field(ge=0)


@api_router.put("/admin/raw-materials")
async def update_raw_materials(payload: RawMaterialPatch, user: User = Depends(get_current_user), as_mess_id: Optional[str] = None):
    # Admin + staff can both edit/add rows. Staff frequently knows current market rates.
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin or staff only")
    mid = await effective_mess_id(user, as_mess_id)
    doc_id = mid or "active"
    items = [i.dict(exclude_none=True) for i in payload.items]
    if not items:
        raise HTTPException(status_code=400, detail="At least one item required")
    # Light validation — keep numbers non-negative
    for it in items:
        for k in ("qty_per_person_month", "price_per_unit", "amount_per_person_month", "current_stock"):
            if k in it and it[k] is not None and float(it[k]) < 0:
                raise HTTPException(status_code=400, detail=f"{k} cannot be negative")
    await db.raw_materials_config.update_one({"_id": doc_id}, {"$set": {"items": items, "updated_at": iso(now_utc())}}, upsert=True)
    _invalidate_raw_materials_cache(mid)
    return await get_raw_materials(user, as_mess_id=as_mess_id)


@api_router.post("/admin/raw-materials/stock-topup")
async def topup_raw_materials_stock(payload: RawMaterialStockTopup, user: User = Depends(get_current_user), as_mess_id: Optional[str] = None):
    """Admin/staff add a partial or full month's stock for a single item.
    Resets the consumption clock to now."""
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin or staff only")
    mid = await effective_mess_id(user, as_mess_id)
    doc_id = mid or "active"
    items = await _load_raw_materials(mid)
    found = False
    for it in items:
        if it["key"] == payload.key:
            # Each topup resets the clock — admin enters total fresh stock and
            # daily deduction starts from now.
            it["current_stock"] = round(payload.qty, 4)
            it["last_stock_topup_at"] = iso(now_utc())
            found = True
            break
    if not found:
        raise HTTPException(404, f"Item not found: {payload.key}")
    await db.raw_materials_config.update_one({"_id": doc_id}, {"$set": {"items": items, "updated_at": iso(now_utc())}}, upsert=True)
    _invalidate_raw_materials_cache(mid)
    return await get_raw_materials(user, as_mess_id=as_mess_id)


@api_router.post("/admin/raw-materials/reset")
async def reset_raw_materials(user: User = Depends(get_current_user), as_mess_id: Optional[str] = None):
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    mid = await effective_mess_id(user, as_mess_id)
    doc_id = mid or "active"
    await db.raw_materials_config.update_one({"_id": doc_id}, {"$set": {"items": RAW_MATERIAL_DEFAULTS, "updated_at": iso(now_utc())}}, upsert=True)
    _invalidate_raw_materials_cache(mid)
    return await get_raw_materials(user, as_mess_id=as_mess_id)


# ---------------------------
# Testimonials — public read, admin CRUD
# ---------------------------
TESTIMONIAL_DEFAULTS = [
    {"id": "t_default_1", "name": "Priya · Hinjawadi",  "role": "Tiffin subscriber",  "quote": "Ghar jaisa hi swaad — and I save 90 min daily I used to spend cooking. Worth every rupee.", "image_url": "", "rating": 5, "order": 0, "visible": True},
    {"id": "t_default_2", "name": "Rahul · Magarpatta", "role": "Dining member",      "quote": "QR pass at the gate is a game-changer. No queues, no card, just walk in and eat fresh.", "image_url": "", "rating": 5, "order": 1, "visible": True},
    {"id": "t_default_3", "name": "Anita · Aundh",      "role": "Half-tiffin · 30 days", "quote": "The half-tiffin option is perfect for my mom — exactly enough for one. Delivery boy is always polite.", "image_url": "", "rating": 5, "order": 2, "visible": True},
]


class Testimonial(BaseModel):
    id: Optional[str] = None
    name: str
    role: Optional[str] = ""
    quote: str
    image_url: Optional[str] = ""    # public URL OR data:image/... base64
    rating: Optional[int] = 5
    order: Optional[int] = 0
    visible: Optional[bool] = True


class TestimonialsPatch(BaseModel):
    items: List[Testimonial]


async def _load_testimonials() -> List[dict]:
    doc = await db.testimonials_config.find_one({"_id": "active"}, {"_id": 0})
    if not doc:
        await db.testimonials_config.insert_one({"_id": "active", "items": TESTIMONIAL_DEFAULTS})
        return list(TESTIMONIAL_DEFAULTS)
    items = doc.get("items") or TESTIMONIAL_DEFAULTS
    return sorted(items, key=lambda x: x.get("order", 0))


# -----------------------------------------------------------------------------
# Testimonials endpoints moved to routes/testimonials.py (Iter-46 refactor).
# -----------------------------------------------------------------------------


# ---------------------------
# Purchase order PDF — admin + staff
# ---------------------------
class POGenerateRequest(BaseModel):
    for_date: Optional[str] = None        # ISO yyyy-mm-dd; defaults to tomorrow
    supplier_name: Optional[str] = None
    notes: Optional[List[str]] = None


@api_router.post("/admin/purchase-orders/generate")
async def generate_purchase_order(payload: POGenerateRequest, user: User = Depends(get_current_user)):
    """Generate a PO PDF for tomorrow's procurement. Admin + staff. Stored under db.purchase_orders for audit + redownload."""
    from po_pdf import build_po_pdf  # local import — keeps reportlab off the hot path until needed

    _admin_or_staff(user)

    # Reuse the live raw-materials calc
    rm = await get_raw_materials(user)

    for_date = payload.for_date or (date.today() + timedelta(days=1)).isoformat()
    po_number = f"PO-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    generated_at = now_utc()
    generated_at_local = generated_at.astimezone(timezone(timedelta(hours=5, minutes=30))).strftime("%Y-%m-%d %H:%M IST")

    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    po_data = {
        "po_number": po_number,
        "for_date": for_date,
        "generated_at": iso(generated_at),
        "generated_at_local": generated_at_local,
        "generated_by_user_id": user.user_id,
        "generated_by_email": user_doc.get("email") or user.email,
        "generated_by_name": user_doc.get("name") or user.email,
        "mess_name": "efoodcare",
        "supplier_name": (payload.supplier_name or "").strip() or None,
        "counts": rm["counts"],
        "breakdown": rm["breakdown"],
        "totals": rm["totals"],
        "items_snapshot": rm["items"],
        "notes": payload.notes or rm.get("notes") or [],
    }

    pdf_bytes = build_po_pdf(po_data)

    # Persist for audit + later redownload (we reconstruct on demand to avoid binary in mongo)
    await db.purchase_orders.insert_one({
        **po_data,
        "size_bytes": len(pdf_bytes),
        "_audit_only": True,  # pdf is regenerated on download from same data
    })

    headers = {
        "Content-Disposition": f'attachment; filename="{po_number}.pdf"',
        "X-PO-Number": po_number,
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


@api_router.get("/admin/purchase-orders")
async def list_purchase_orders(user: User = Depends(get_current_user)):
    _admin_or_staff(user)
    docs = await db.purchase_orders.find({}, {"_id": 0, "items_snapshot": 0, "breakdown": 0}).sort("generated_at", -1).to_list(200)
    return {"purchase_orders": docs, "count": len(docs)}


@api_router.get("/admin/purchase-orders/{po_number}/download")
async def download_purchase_order(po_number: str, user: User = Depends(get_current_user)):
    """Re-generate the PDF for a stored PO from its snapshot (avoids binary blobs in mongo)."""
    from po_pdf import build_po_pdf
    _admin_or_staff(user)
    po = await db.purchase_orders.find_one({"po_number": po_number}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    pdf_bytes = build_po_pdf(po)
    headers = {"Content-Disposition": f'attachment; filename="{po_number}.pdf"'}
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


# ---------------------------
# Staff today's deliveries — read-only summary of tiffins to pack today
# ---------------------------
@api_router.get("/staff/today-deliveries")
async def staff_today_deliveries(user: User = Depends(get_current_user)):
    """Read-only view used by staff (and admin) to see today's tiffin packing list.
    Returns counts + per-customer rows separated by full / half tiffin and lunch / dinner."""
    _admin_or_staff(user)
    d = today_str()
    rosters = await db.daily_rosters.find({"date": d}, {"_id": 0, "otp": 0}).to_list(20000)
    user_ids = list({r["user_id"] for r in rosters})
    users = {u["user_id"]: u async for u in db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "address": 1, "pincode": 1, "tiffin_balance": 1})}

    rows = []
    for r in rosters:
        u = users.get(r["user_id"]) or {}
        rows.append({
            "roster_id": r["roster_id"],
            "user_id": r["user_id"],
            "name": u.get("name") or r.get("name") or "—",
            "phone": u.get("phone") or r.get("phone") or "",
            "address": u.get("address") or r.get("address") or "",
            "pincode": u.get("pincode") or r.get("pincode") or "",
            "meal_type": r["meal_type"],
            "tiffin_size": r.get("tiffin_size") or "full",
            "status": r["status"],
            "tiffin_balance": int(u.get("tiffin_balance") or 0),
        })

    def _bucket(meal: str, size: str):
        return [x for x in rows if x["meal_type"] == meal and x["tiffin_size"] == size]

    counts = {
        "lunch": {
            "full": len(_bucket("lunch", "full")),
            "half": len(_bucket("lunch", "half")),
            "delivered": sum(1 for x in rows if x["meal_type"] == "lunch" and x["status"] == "delivered"),
        },
        "dinner": {
            "full": len(_bucket("dinner", "full")),
            "half": len(_bucket("dinner", "half")),
            "delivered": sum(1 for x in rows if x["meal_type"] == "dinner" and x["status"] == "delivered"),
        },
        "total_lunch": sum(1 for x in rows if x["meal_type"] == "lunch"),
        "total_dinner": sum(1 for x in rows if x["meal_type"] == "dinner"),
        "outstanding_empties": sum(x["tiffin_balance"] for x in rows),
    }

    return {"date": d, "rows": rows, "counts": counts}


# ---------------------------
# Root
# ---------------------------
@api_router.get("/")
async def root():
    return {"message": "efoodcare API", "tagline": "ghar se achha khana"}


# Mount delivery sub-router under /api
from delivery import make_router as _make_delivery_router, make_customer_router as _make_customer_router, make_boy_router as _make_boy_router
api_router.include_router(_make_delivery_router(db))
api_router.include_router(_make_customer_router(db))
api_router.include_router(_make_boy_router(db))

# Mount feature-scoped routers (defined in /app/backend/routes/) — IMPORT LAST so
# they have full access to all server-level helpers and pydantic models.
from routes.auth import router as _auth_router
from routes.payments import router as _payments_router
from routes.restaurant import router as _restaurant_router
from routes.restaurant_orders import router as _restaurant_orders_router
from routes.admin import router as _admin_router
from routes.rider import router as _rider_router
from routes.whatsapp_admin import router as _wa_admin_router
from routes.app_cms import router as _app_cms_router
from routes.promotions import router as _promotions_router
from routes.auth_google import router as _auth_google_router
from routes.testimonials import router as _testimonials_router
from routes.plans import router as _plans_router
from routes.wallet import router as _wallet_router
from routes.subscription import router as _subscription_router
from routes.tiffin_prefs_admin import router as _tiffin_prefs_router
from routes.tiffin_stock import router as _tiffin_stock_router
from routes.subscription_payment import router as _sub_payment_router
from routes.cash_analytics import router as _cash_analytics_router
from routes.dashboard_styles import router as _dash_styles_router
from routes.bank_deposit import router as _bank_deposit_router
from routes.geo import router as _geo_router
from routes.kitchen_closeout import router as _kitchen_closeout_router
from routes.control_tower import router as _control_tower_router
from routes.mess_menu_cal import router as _mess_menu_cal_router
from routes.mess_menu_poster import router as _mess_menu_poster_router
from routes.mess_menu_push import router as _mess_menu_push_router, tick_daily_menu_push
from routes.cart_saver import router as _cart_saver_router
from routes.restaurant_hours import router as _restaurant_hours_router
from routes.branch_pnl import router as _branch_pnl_router
api_router.include_router(_auth_router)
api_router.include_router(_auth_google_router)
api_router.include_router(_payments_router)
api_router.include_router(_restaurant_router)
api_router.include_router(_restaurant_orders_router)
api_router.include_router(_admin_router)
api_router.include_router(_rider_router)
api_router.include_router(_wa_admin_router)
api_router.include_router(_app_cms_router)
api_router.include_router(_promotions_router)
api_router.include_router(_testimonials_router)
api_router.include_router(_plans_router)
api_router.include_router(_wallet_router)
api_router.include_router(_subscription_router)
api_router.include_router(_tiffin_prefs_router)
api_router.include_router(_tiffin_stock_router)
api_router.include_router(_sub_payment_router)
api_router.include_router(_cash_analytics_router)
api_router.include_router(_dash_styles_router)
api_router.include_router(_bank_deposit_router)
api_router.include_router(_geo_router)
api_router.include_router(_kitchen_closeout_router)
api_router.include_router(_control_tower_router)
api_router.include_router(_mess_menu_cal_router)
api_router.include_router(_mess_menu_poster_router)
api_router.include_router(_mess_menu_push_router)
api_router.include_router(_cart_saver_router)
api_router.include_router(_restaurant_hours_router)
api_router.include_router(_branch_pnl_router)

# NOTE: app.include_router(api_router) is called AT THE BOTTOM of this file
# (after iter-77 refund + wallet + franchise endpoints) so every @api_router
# decorator above + below this point is registered.

# Static "object storage" for admin-uploaded assets (menu images, etc).
# Routed under /api/uploads so the existing Kubernetes ingress rule
# (`/api/*` → backend) just works. Files live at /app/backend/uploads/.
_uploads_dir = Path(__file__).resolve().parent / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    from tasks import start_background_loops  # local import — keeps tasks.py free of server side-effects
    await seed_plans()
    await _ensure_theme_version()
    await _load_dashboard_config()  # pre-seed default config so first GET doesn't write during a public read
    start_background_loops(
        run_subscription_tick=run_subscription_tick,
        run_empty_tiffin_reminders=run_empty_tiffin_reminders,
        run_expiry_reminders=run_expiry_reminders,
        run_menu_push=tick_daily_menu_push,
    )
    logger.info(f"[STARTUP] empty-tiffin SMS stub_mode={_sms_stub_mode_status()} · expiry lead_days={EXPIRY_LEAD_DAYS}")
    # Razorpay key validation — non-blocking, just informational.
    try:
        rzp_status = await validate_razorpay_keys()
        emoji = "✅" if rzp_status["status"] == "live" else "⚠️"
        logger.info(f"[STARTUP] {emoji} Razorpay status={rzp_status['status']} · {rzp_status['detail']}")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[STARTUP] Razorpay status check failed: {e}")




# =====================================================================
# iter-77 #3 — User refund requests (wallet-only) + admin wallet edit.
# Once admin approves a refund or manually credits a wallet, the system
# checks if the new balance covers an active plan and auto-activates one.
# =====================================================================


class RefundRequestIn(BaseModel):
    order_id: str
    reason: str = Field(..., min_length=8, max_length=600)
    kind: str = Field(default="mess_menu_order", description="mess_menu_order | restaurant_order | subscription")


@api_router.post("/refunds/request")
async def user_request_refund(payload: RefundRequestIn, user: User = Depends(get_current_user)):
    """Subscribers raise a wallet-only refund. Stored as pending until an
    admin reviews via /admin/refunds. No payment-gateway refund here.
    """
    doc = {
        "refund_id": f"ref_{uuid.uuid4().hex[:12]}",
        "order_id": payload.order_id,
        "kind": payload.kind,
        "user_id": user.user_id,
        "reason": payload.reason.strip(),
        "status": "pending",
        "wallet_credit": 0,
        "created_at": iso(now_utc()),
        "decided_at": None,
        "decided_by": None,
        "admin_notes": "",
    }
    await db.refund_requests.insert_one(doc)
    return {"ok": True, "refund": {k: v for k, v in doc.items() if k != "_id"}}


@api_router.get("/admin/refunds")
async def admin_list_refunds(status: str = "pending", user: User = Depends(get_current_user)):
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    cur = db.refund_requests.find({"status": status} if status != "all" else {}, {"_id": 0}).sort("created_at", -1)
    items = await cur.to_list(500)
    return {"refunds": items}


class RefundDecisionIn(BaseModel):
    decision: str = Field(..., description="approve | decline")
    wallet_credit: int = Field(default=0, ge=0, le=100000)
    admin_notes: str = ""


@api_router.patch("/admin/refunds/{refund_id}")
async def admin_decide_refund(refund_id: str, payload: RefundDecisionIn, user: User = Depends(get_current_user)):
    # iter-92 #3: franchise_owner can approve/decline refunds for their branch.
    if user.role not in ("admin", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if payload.decision not in {"approve", "decline"}:
        raise HTTPException(status_code=400, detail="decision must be approve | decline")
    doc = await db.refund_requests.find_one({"refund_id": refund_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Refund not found")
    if user.role == "franchise_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned")
        u = await db.users.find_one({"user_id": doc.get("user_id")}, {"_id": 0, "mess_id": 1})
        if (u or {}).get("mess_id") != m["mess_id"]:
            raise HTTPException(status_code=403, detail="Refund not in your branch")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Already {doc.get('status')}")
    if payload.decision == "approve":
        credit = int(payload.wallet_credit or 0)
        if credit <= 0:
            raise HTTPException(status_code=400, detail="wallet_credit must be > 0 to approve")
        await db.users.update_one(
            {"user_id": doc["user_id"]},
            {"$inc": {"wallet_balance": credit}},
        )
        await db.wallet_ledger.insert_one({
            "user_id": doc["user_id"],
            "delta": credit,
            "balance_after": None,
            "source": f"refund:{refund_id}",
            "ref_order_id": doc.get("order_id"),
            "actor": user.user_id,
            "note": (payload.admin_notes or "Refund approved").strip(),
            "created_at": iso(now_utc()),
        })
        await db.refund_requests.update_one(
            {"refund_id": refund_id},
            {"$set": {
                "status": "approved", "wallet_credit": credit,
                "decided_at": iso(now_utc()), "decided_by": user.user_id,
                "admin_notes": (payload.admin_notes or "").strip(),
            }},
        )
    else:
        await db.refund_requests.update_one(
            {"refund_id": refund_id},
            {"$set": {
                "status": "declined", "decided_at": iso(now_utc()),
                "decided_by": user.user_id, "admin_notes": (payload.admin_notes or "").strip(),
            }},
        )
    fresh = await db.refund_requests.find_one({"refund_id": refund_id}, {"_id": 0})
    return {"ok": True, "refund": fresh}


class WalletAdjustIn(BaseModel):
    delta: int = Field(..., description="Positive or negative integer rupees")
    reason: str = Field(..., min_length=3, max_length=200)
    auto_activate: bool = Field(default=True, description="If new balance covers a plan, auto-activate")


@api_router.post("/admin/users/{user_id}/wallet/adjust")
async def admin_adjust_wallet(user_id: str, payload: WalletAdjustIn, actor: User = Depends(get_current_user)):
    """Admin manually credits/debits a user's wallet. When delta is
    positive and auto_activate=True, the system checks if the new balance
    covers an active mess plan and auto-creates a subscription on the
    user's behalf (use-case: subscriber drops cash at counter, admin adds
    it to the wallet, plan starts automatically).
    """
    if actor.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    target = await db.users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    current = int(target.get("wallet_balance") or 0)
    new_balance = current + int(payload.delta)
    if new_balance < 0:
        raise HTTPException(status_code=400, detail=f"Adjustment would make balance negative ({new_balance})")
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"wallet_balance": new_balance}},
    )
    await db.wallet_ledger.insert_one({
        "user_id": user_id,
        "delta": int(payload.delta),
        "balance_after": new_balance,
        "source": "admin_adjust",
        "actor": actor.user_id,
        "note": payload.reason.strip(),
        "created_at": iso(now_utc()),
    })
    # Auto-activate: if no active sub + balance covers cheapest plan, start one.
    activated_sub = None
    if payload.auto_activate and payload.delta > 0:
        has_active = await db.subscriptions.find_one({"user_id": user_id, "status": "active"})
        if not has_active:
            # Find cheapest active plan that this balance covers.
            cur = db.plans.find({"active": True}, {"_id": 0}).sort("price", 1)
            plans = await cur.to_list(50)
            best = next((p for p in plans if int(p.get("price") or 0) <= new_balance), None)
            if best:
                start = iso(now_utc())
                end = iso(now_utc() + timedelta(days=int(best.get("duration_days") or 30)))
                sub = {
                    "subscription_id": f"sub_{uuid.uuid4().hex[:12]}",
                    "user_id": user_id,
                    "mess_id": target.get("mess_id") or DEFAULT_MESS_ID,
                    "plan_id": best.get("plan_id"),
                    "plan_name": best.get("name"),
                    "amount_paid": int(best.get("price") or 0),
                    "duration_days": int(best.get("duration_days") or 30),
                    "service": best.get("service") or "tiffin",
                    "status": "active",
                    "source": "admin_wallet_auto",
                    "start_date": start,
                    "end_date": end,
                    "created_at": start,
                }
                await db.subscriptions.insert_one(sub)
                await db.users.update_one(
                    {"user_id": user_id},
                    {"$inc": {"wallet_balance": -int(best.get("price") or 0)}},
                )
                new_balance = new_balance - int(best.get("price") or 0)
                activated_sub = sub
                logger.info(f"[wallet-adjust] Auto-activated {best.get('name')} for {user_id} · new bal=₹{new_balance}")
    return {
        "ok": True, "user_id": user_id, "wallet_balance": new_balance,
        "delta": int(payload.delta), "auto_activated_subscription": activated_sub,
    }


# =====================================================================
# iter-77 #8 — Per-mess franchise dashboard section toggles.
# Admin chooses which metric cards a franchise owner sees.
# =====================================================================

FRANCHISE_SECTIONS = ["subscribers", "revenue_sub", "revenue_ord", "checkins", "capacity", "utilization"]

# iter-91: human-friendly labels for the metric sections — mirrored in the
# admin Pages modal so HQ can flip them on/off per branch.
FRANCHISE_SECTIONS_CATALOG = [
    {"key": "subscribers",  "label": "Active subscribers"},
    {"key": "revenue_sub",  "label": "Subscription revenue"},
    {"key": "revenue_ord",  "label": "Restaurant revenue"},
    {"key": "checkins",     "label": "QR check-ins"},
    {"key": "capacity",     "label": "Daily capacity"},
    {"key": "utilization",  "label": "Kitchen utilization"},
]

# iter-90: list of admin nav pages a franchise owner can be granted per-mess.
# Keep in sync with AdminLayout.jsx FRANCHISE_VIEW items.
FRANCHISE_PAGES = [
    {"key": "/admin",                       "label": "Dashboard"},
    {"key": "/admin/control-tower",         "label": "Control Tower"},
    {"key": "/admin/users",                 "label": "Users & Roles"},
    {"key": "/admin/restaurant-tracking",   "label": "Restaurant tracking"},
    {"key": "/admin/restaurant-takeaway",   "label": "Take-away tiffins"},
    {"key": "/admin/deliveries-today",      "label": "Today's deliveries"},
    {"key": "/admin/raw-materials",         "label": "Raw materials"},
    {"key": "/admin/tiffin-stock",          "label": "Tiffin stock"},
    {"key": "/admin/cash-collections",      "label": "Cash collections"},
    {"key": "/admin/cash-analytics",        "label": "Cash analytics"},
    {"key": "/admin/partial-payments",      "label": "Partial payments"},
    {"key": "/admin/pnl",                   "label": "Profit & loss"},
    {"key": "/admin/restaurant-orders",     "label": "Restaurant orders"},
    {"key": "/admin/restaurant-hours",      "label": "Restaurant hours / capacity"},
    {"key": "/admin/kitchen-radius",        "label": "My kitchen & radius"},
    {"key": "/admin/delivery",              "label": "Tiffin delivery"},
    {"key": "/admin/live",                  "label": "Live tracking"},
    {"key": "/admin/scanner",               "label": "QR Scanner"},
    {"key": "/admin/kiosk",                 "label": "Wall Kiosk"},
    {"key": "/admin/counter",               "label": "Counter QR"},
    {"key": "/admin/menu",                  "label": "Daily Menu"},
    {"key": "/admin/mess-menu",             "label": "Mess Menu Calendar"},
]
FRANCHISE_PAGE_KEYS = {p["key"] for p in FRANCHISE_PAGES}


class FranchiseSectionsIn(BaseModel):
    visible_sections: List[str]


class FranchisePagesIn(BaseModel):
    visible_pages: List[str]


@api_router.get("/admin/messes/{mess_id}/franchise-sections")
async def admin_get_franchise_sections(mess_id: str, user: User = Depends(get_current_user)):
    """iter-91: GET counterpart of the franchise-sections PATCH so the admin
    UI can prefill the metric checkboxes. Null in db ⇒ all sections visible."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    mess = await db.messes.find_one({"mess_id": mess_id}, {"_id": 0, "franchise_visible_sections": 1})
    if not mess:
        raise HTTPException(status_code=404, detail="Mess not found")
    sections = mess.get("franchise_visible_sections")
    if sections is None:
        sections = list(FRANCHISE_SECTIONS)
    return {"visible_sections": sections, "catalog": FRANCHISE_SECTIONS_CATALOG}


@api_router.patch("/admin/messes/{mess_id}/franchise-sections")
async def admin_set_franchise_sections(mess_id: str, payload: FranchiseSectionsIn, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    invalid = [s for s in payload.visible_sections if s not in FRANCHISE_SECTIONS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown sections: {invalid}. Allowed: {FRANCHISE_SECTIONS}")
    res = await db.messes.update_one(
        {"mess_id": mess_id},
        {"$set": {"franchise_visible_sections": payload.visible_sections, "updated_at": iso(now_utc())}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mess not found")
    return {"ok": True, "visible_sections": payload.visible_sections}


@api_router.get("/franchise/me/mess")
async def franchise_my_mess(user: User = Depends(get_current_user)):
    """iter-94 #1: returns the franchise owner's mess (city, name, lat/lng, radius)
    so the AdminLayout can render the branch-context pill and the
    Kitchen & Radius settings page can prefill."""
    if user.role not in ("franchise_owner", "admin"):
        raise HTTPException(status_code=403, detail="Franchise portal only")
    if user.role == "admin":
        return {"mess": None, "scope": "global"}
    mess = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0})
    if not mess:
        raise HTTPException(status_code=403, detail="No mess assigned")
    return {"mess": mess, "scope": "branch"}


@api_router.get("/franchise/me/visible-sections")
async def franchise_my_visible_sections(user: User = Depends(get_current_user)):
    if user.role not in ("franchise_owner", "admin"):
        raise HTTPException(status_code=403, detail="Franchise portal only")
    mess = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "franchise_visible_sections": 1})
    # Null in db ⇒ default to ALL sections. Empty list ⇒ admin explicitly hid everything.
    sections = (mess or {}).get("franchise_visible_sections")
    if sections is None:
        sections = list(FRANCHISE_SECTIONS)
    return {"visible_sections": sections}


# =====================================================================
# iter-90 — Per-mess franchise PAGE access toggles (admin nav filtering).
# Admin chooses which admin nav pages a franchise owner can see.
# =====================================================================

@api_router.get("/admin/franchise/pages-catalog")
async def admin_franchise_pages_catalog(user: User = Depends(get_current_user)):
    """Catalog of every page key + label that can be toggled per mess."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return {"pages": FRANCHISE_PAGES}


@api_router.get("/admin/messes/{mess_id}/franchise-pages")
async def admin_get_franchise_pages(mess_id: str, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    mess = await db.messes.find_one({"mess_id": mess_id}, {"_id": 0, "franchise_visible_pages": 1})
    if not mess:
        raise HTTPException(status_code=404, detail="Mess not found")
    pages = mess.get("franchise_visible_pages")
    # null/empty → return defaults so the UI can show every page checked initially.
    if pages is None:
        pages = [p["key"] for p in FRANCHISE_PAGES]
    return {"visible_pages": pages, "catalog": FRANCHISE_PAGES}


@api_router.patch("/admin/messes/{mess_id}/franchise-pages")
async def admin_set_franchise_pages(mess_id: str, payload: FranchisePagesIn, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    invalid = [p for p in payload.visible_pages if p not in FRANCHISE_PAGE_KEYS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown pages: {invalid}")
    res = await db.messes.update_one(
        {"mess_id": mess_id},
        {"$set": {"franchise_visible_pages": payload.visible_pages, "updated_at": iso(now_utc())}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mess not found")
    return {"ok": True, "visible_pages": payload.visible_pages}


@api_router.get("/franchise/me/visible-pages")
async def franchise_my_visible_pages(user: User = Depends(get_current_user)):
    """Franchise owner reads the page list they're allowed to see in the admin nav."""
    if user.role not in ("franchise_owner", "admin"):
        raise HTTPException(status_code=403, detail="Franchise portal only")
    if user.role == "admin":
        return {"visible_pages": [p["key"] for p in FRANCHISE_PAGES]}
    mess = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "franchise_visible_pages": 1})
    pages = (mess or {}).get("franchise_visible_pages")
    if pages is None:
        pages = [p["key"] for p in FRANCHISE_PAGES]
    return {"visible_pages": pages}


# Register all @api_router endpoints (including the iter-77 refund/wallet/
# franchise sections defined above) onto the FastAPI app.
app.include_router(api_router)


@app.on_event("shutdown")
async def shutdown_db_client():
    mongo_client.close()
