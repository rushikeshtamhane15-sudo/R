from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Cookie, Depends
from fastapi.responses import StreamingResponse
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
    role: Literal["admin", "staff", "subscriber", "delivery_boy", "rider"] = "subscriber"
    qr_token: str
    created_at: datetime
    lat: Optional[float] = None
    lng: Optional[float] = None
    wallet_balance: Optional[float] = 0.0


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
    role: Literal["admin", "staff", "subscriber", "delivery_boy", "rider"]


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
        qr_token=doc["qr_token"],
        created_at=parse_dt(doc["created_at"]),
        lat=doc.get("lat"),
        lng=doc.get("lng"),
        wallet_balance=float(doc.get("wallet_balance") or 0),
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
                headers={"User-Agent": "eFoodCare/1.0 (delivery-routing)"},
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
@api_router.get("/plans")
async def get_plans():
    await seed_plans()
    plans = await db.plans.find({"active": True}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return {"plans": plans}


@api_router.get("/admin/plans")
async def admin_list_plans(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    plans = await db.plans.find({}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return {"plans": plans}


@api_router.post("/admin/plans")
async def admin_upsert_plan(payload: PlanUpsert, user: User = Depends(get_current_user)):
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
        "updated_at": iso(now_utc()),
    }
    existing = await db.plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if existing:
        await db.plans.update_one({"plan_id": plan_id}, {"$set": doc})
    else:
        doc["created_at"] = iso(now_utc())
        await db.plans.insert_one(doc.copy())
    return {"ok": True, "plan": await db.plans.find_one({"plan_id": plan_id}, {"_id": 0})}


@api_router.delete("/admin/plans/{plan_id}")
async def admin_delete_plan(plan_id: str, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await db.plans.delete_one({"plan_id": plan_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"ok": True}


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
    user_id = order["user_id"]

    # Build plan-shape from either DB plan or the order itself (custom flow).
    # Use base_amount so the wallet loads the actual plan value, not the platform fee.
    plan_amount = float(order.get("base_amount") or order["amount"])
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
    per_day = round(float(plan["amount"]) / max(1, plan["duration_days"]), 2)
    sub = {
        "sub_id": f"sub_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "plan_id": plan["plan_id"],
        "plan_name": plan["name"],
        "amount_paid": float(plan["amount"]),
        "currency": plan["currency"],
        "meals_total": plan["meals"],
        "meals_used": 0,
        "wallet_balance": float(plan["amount"]),
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
        "created_at": iso(start),
    }
    await db.subscriptions.insert_one(sub.copy())
    await db.users.update_one({"user_id": user_id}, {"$inc": {"wallet_balance": float(plan["amount"])}})
    await _log_wallet_txn(user_id, sub["sub_id"], "credit", float(plan["amount"]), float(plan["amount"]), f"{plan['name']} subscription")
    # Record the platform fee as a separate informational entry (does not affect wallet balance)
    fee_amt = float(order.get("platform_fee") or 0)
    if fee_amt > 0:
        await _log_wallet_txn(user_id, sub["sub_id"], "fee", fee_amt, float(plan["amount"]), f"Platform fee ({order.get('platform_fee_pct', 2)}%)")
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
                if not grace_until_iso:
                    # Start the 24h grace window
                    grace_until = now_utc() + timedelta(hours=24)
                    await db.subscriptions.update_one(
                        {"sub_id": s["sub_id"]},
                        {"$set": {"zero_wallet_grace_until": iso(grace_until)}},
                    )
                    grace_started += 1
                    logger.info(f"[TICK] sub={s['sub_id']} wallet=0 → grace until {grace_until.isoformat()}")
                else:
                    if parse_dt(grace_until_iso) <= now_utc():
                        await db.subscriptions.update_one(
                            {"sub_id": s["sub_id"]},
                            {"$set": {"status": "expired", "expired_at": iso(now_utc()), "expired_reason": "wallet_zero"}},
                        )
                        expired += 1
                        logger.info(f"[TICK] sub={s['sub_id']} EXPIRED · wallet=0 + grace elapsed")
                        continue
            else:
                # Wallet recovered (refund/topup) — clear any grace flag
                if fresh and fresh.get("zero_wallet_grace_until"):
                    await db.subscriptions.update_one(
                        {"sub_id": s["sub_id"]},
                        {"$unset": {"zero_wallet_grace_until": ""}},
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
    return {"sms_sent": sent_sms, "skipped": skipped, "failed": failed}


# ---------------------------
# Wallet + subscription views
# ---------------------------
@api_router.get("/my/wallet")
async def my_wallet(user: User = Depends(get_current_user)):
    sub = await get_active_subscription(user.user_id)
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return {
        "wallet_balance": round(float(user_doc.get("wallet_balance", 0)), 2),
        "subscription": sub,
        "per_day_amount": sub["per_day_amount"] if sub else 0,
        "paused_days": sub.get("paused_days", 0) if sub else 0,
        "inactivity_threshold_days": INACTIVITY_THRESHOLD_DAYS,
    }


@api_router.get("/my/wallet/transactions")
async def my_wallet_transactions(user: User = Depends(get_current_user)):
    # ensure tick is up to date
    await get_active_subscription(user.user_id)
    txns = await db.wallet_transactions.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"transactions": txns}


# ---------------------------
# Theme settings (admin-editable design tokens)
# ---------------------------
DEFAULT_THEME = {
    "brand_name": "eFoodCare",
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
    "privacy": {
        "title": "Privacy Policy",
        "last_updated": "",
        "body": "Add your privacy policy here via Admin → Content → Privacy.\n\nInclude how you collect, use, and protect user data, cookies, and third-party sharing disclosures.",
    },
    "refund": {
        "title": "Refund Policy",
        "last_updated": "",
        "body": "Add your refund policy here via Admin → Content → Refund.\n\nMention eligibility, the refund window, how to request a refund, and processing time.",
    },
    "contact": {
        "title": "Contact Us",
        "intro": "We'd love to hear from you. Reach out any time.",
        "company": "eFoodCare",
        "address": "Your full address line · City · State · PIN",
        "phone": "+91 99707 05391",
        "email": "hello@efoodcare.in",
        "hours": "Mon–Sun · 10 AM – 10 PM",
        "map_embed_src": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d60304.49!2d73.75!3d18.55!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2sPune!5e0!3m2!1sen!2sin!4v1700000000000",
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
    merged = {**current, **payload.data}
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


@api_router.get("/my/subscription")
async def my_subscription(user: User = Depends(get_current_user)):
    sub = await get_active_subscription(user.user_id)
    if not sub:
        return {"active": False, "subscription": None}
    return {"active": True, "subscription": sub}


@api_router.post("/my/subscription/pause")
async def pause_my_subscription(user: User = Depends(get_current_user)):
    """Tiffin subscriber pauses delivery — they'll be skipped in roster generation.
    Wallet keeps deducting; once continuous pause exceeds 7 days, end-date auto-extends."""
    sub = await get_active_subscription(user.user_id)
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription")
    if sub.get("service_type") != "tiffin":
        raise HTTPException(status_code=400, detail="Only tiffin subscriptions can be paused — eat-in pass auto-pauses on 3+ skipped scans.")
    if sub.get("user_paused"):
        return {"ok": True, "already": True, "subscription": sub}
    await db.subscriptions.update_one(
        {"sub_id": sub["sub_id"]},
        {"$set": {"user_paused": True, "user_pause_started_at": iso(now_utc())}},
    )
    fresh = await db.subscriptions.find_one({"sub_id": sub["sub_id"]}, {"_id": 0})
    return {"ok": True, "subscription": fresh}


@api_router.post("/my/subscription/resume")
async def resume_my_subscription(user: User = Depends(get_current_user)):
    sub = await get_active_subscription(user.user_id)
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription")
    if not sub.get("user_paused"):
        return {"ok": True, "already": True, "subscription": sub}
    await db.subscriptions.update_one(
        {"sub_id": sub["sub_id"]},
        {"$set": {"user_paused": False, "user_pause_started_at": None}},
    )
    fresh = await db.subscriptions.find_one({"sub_id": sub["sub_id"]}, {"_id": 0})
    return {"ok": True, "subscription": fresh}


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
    if user.role not in ("staff", "admin"):
        raise HTTPException(status_code=403, detail="Staff/Admin only")
    target = await db.users.find_one({"qr_token": payload.qr_token}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Invalid QR")
    record = await _mark_attendance(target, payload.meal_type, user.user_id, "counter_scan")
    return {"ok": True, "record": record, "subscriber_name": target["name"]}


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
    if user.role not in ("staff", "admin"):
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
    extend_days: Optional[int] = 0   # also extend end_date by this many days
    restore_meals: Optional[int] = 0 # also bump meals_total by this many (or unbump meals_used)


@api_router.post("/admin/users/{target_user_id}/wallet-adjust")
async def admin_wallet_adjust(target_user_id: str, payload: WalletAdjustRequest, user: User = Depends(get_current_user)):
    """Admin manually credits or debits a user's wallet.
    - delta > 0  → credit (refund / goodwill / promo).
    - delta < 0  → debit  (correction / chargeback).
    - extend_days  → optionally pushes the active subscription end_date forward.
    - restore_meals→ optionally adds meals back (lowers meals_used; never below 0)."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if abs(float(payload.delta)) < 0.005 and not payload.extend_days and not payload.restore_meals:
        raise HTTPException(status_code=400, detail="Provide a non-zero delta, extend_days, or restore_meals")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="reason is required for audit log")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    sub = await db.subscriptions.find_one({"user_id": target_user_id, "status": "active"}, {"_id": 0})
    if not sub and (payload.delta or payload.extend_days or payload.restore_meals):
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
        "restore_meals": int(payload.restore_meals or 0),
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
            new_end = parse_dt(sub["end_date"]) + timedelta(days=int(payload.extend_days))
            sub_updates["end_date"] = iso(new_end)
        if payload.restore_meals:
            new_used = max(0, int(sub.get("meals_used", 0)) - int(payload.restore_meals))
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
    return {"ok": True, **audit}


@api_router.get("/admin/users/{target_user_id}/wallet-history")
async def admin_wallet_history(target_user_id: str, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    txns = await db.wallet_transactions.find({"user_id": target_user_id}, {"_id": 0}).sort("ts", -1).to_list(200)
    overrides = await db.wallet_overrides.find({"target_user_id": target_user_id}, {"_id": 0}).sort("ts", -1).to_list(200)
    return {"transactions": txns, "overrides": overrides}


async def _purge_user(user_id: str) -> dict:
    """Delete a user and every record that points to them (sessions, subs, txns, attendance, deliveries)."""
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        return {"deleted": False}
    counts = {
        "sessions": (await db.sessions.delete_many({"user_id": user_id})).deleted_count,
        "subscriptions": (await db.subscriptions.delete_many({"user_id": user_id})).deleted_count,
        "wallet_transactions": (await db.wallet_transactions.delete_many({"user_id": user_id})).deleted_count,
        "attendance": (await db.attendance.delete_many({"user_id": user_id})).deleted_count,
        "payment_orders": (await db.payment_orders.delete_many({"user_id": user_id})).deleted_count,
        "daily_rosters": (await db.daily_rosters.delete_many({"user_id": user_id})).deleted_count,
        "delivery_attempts": (await db.delivery_attempts.delete_many({"user_id": user_id})).deleted_count,
        "otps": (await db.otps.delete_many({"phone": user.get("phone") or "__none__"})).deleted_count,
        "users": (await db.users.delete_one({"user_id": user_id})).deleted_count,
    }
    logger.info(f"[USER PURGE] user={user_id} email={user.get('email')} phone={user.get('phone')} → {counts}")
    return {"deleted": True, "counts": counts}


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


async def _load_raw_materials() -> list[dict]:
    doc = await db.raw_materials_config.find_one({"_id": "active"}, {"_id": 0})
    if not doc:
        await db.raw_materials_config.insert_one({"_id": "active", "items": RAW_MATERIAL_DEFAULTS})
        return list(RAW_MATERIAL_DEFAULTS)
    items = doc.get("items") or RAW_MATERIAL_DEFAULTS
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


async def _count_active_persons() -> dict:
    """Persons-per-meal weighting: full tiffin / dining = 1.0; half tiffin = 0.5.
    Inactive (auto-paused or user-paused tiffin) subs don't count for today's cooking."""
    subs = await db.subscriptions.find({"status": "active"}, {"_id": 0}).to_list(20000)
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
    if user.role not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Admin or staff only")


@api_router.get("/admin/raw-materials")
async def get_raw_materials(user: User = Depends(get_current_user), fresh: bool = False):
    _admin_or_staff(user)
    if fresh:
        _invalidate_raw_materials_cache()
    return await _compute_raw_materials_cached()


# Lightweight in-process memo — invalidated when admin edits items or resets defaults,
# or when the cached entry exceeds 60s. Cuts repeated mongo scans on the dashboard view.
_RM_CACHE: dict = {"value": None, "ts": 0.0}
_RM_TTL_SECONDS = 60


def _invalidate_raw_materials_cache():
    _RM_CACHE["value"] = None
    _RM_CACHE["ts"] = 0.0


async def _compute_raw_materials_cached() -> dict:
    import time as _t
    now_s = _t.monotonic()
    if _RM_CACHE["value"] is not None and (now_s - _RM_CACHE["ts"]) < _RM_TTL_SECONDS:
        return _RM_CACHE["value"]
    val = await _compute_raw_materials_fresh()
    _RM_CACHE["value"] = val
    _RM_CACHE["ts"] = now_s
    return val


async def _compute_raw_materials_fresh() -> dict:
    items = await _load_raw_materials()
    counts = await _count_active_persons()
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
async def update_raw_materials(payload: RawMaterialPatch, user: User = Depends(get_current_user)):
    # Admin + staff can both edit/add rows. Staff frequently knows current market rates.
    if user.role not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Admin or staff only")
    items = [i.dict(exclude_none=True) for i in payload.items]
    if not items:
        raise HTTPException(status_code=400, detail="At least one item required")
    # Light validation — keep numbers non-negative
    for it in items:
        for k in ("qty_per_person_month", "price_per_unit", "amount_per_person_month", "current_stock"):
            if k in it and it[k] is not None and float(it[k]) < 0:
                raise HTTPException(status_code=400, detail=f"{k} cannot be negative")
    await db.raw_materials_config.update_one({"_id": "active"}, {"$set": {"items": items, "updated_at": iso(now_utc())}}, upsert=True)
    _invalidate_raw_materials_cache()
    return await get_raw_materials(user)


@api_router.post("/admin/raw-materials/stock-topup")
async def topup_raw_materials_stock(payload: RawMaterialStockTopup, user: User = Depends(get_current_user)):
    """Admin/staff add a partial or full month's stock for a single item.
    Resets the consumption clock to now."""
    if user.role not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Admin or staff only")
    items = await _load_raw_materials()
    found = False
    for it in items:
        if it["key"] == payload.key:
            existing = float(it.get("current_stock") or 0)
            it["current_stock"] = round(existing + payload.qty, 4) if it.get("last_stock_topup_at") else round(payload.qty, 4)
            # Each topup resets the clock — daily deduction starts from now
            it["current_stock"] = round(payload.qty, 4)  # admin enters total fresh stock
            it["last_stock_topup_at"] = iso(now_utc())
            found = True
            break
    if not found:
        raise HTTPException(404, f"Item not found: {payload.key}")
    await db.raw_materials_config.update_one({"_id": "active"}, {"$set": {"items": items, "updated_at": iso(now_utc())}}, upsert=True)
    _invalidate_raw_materials_cache()
    return await get_raw_materials(user)


@api_router.post("/admin/raw-materials/reset")
async def reset_raw_materials(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.raw_materials_config.update_one({"_id": "active"}, {"$set": {"items": RAW_MATERIAL_DEFAULTS, "updated_at": iso(now_utc())}}, upsert=True)
    _invalidate_raw_materials_cache()
    return await get_raw_materials(user)


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


@api_router.get("/testimonials")
async def get_testimonials():
    """Public — landing page renders these. Returns only visible testimonials."""
    items = await _load_testimonials()
    return {"items": [t for t in items if t.get("visible") is not False]}


@api_router.get("/admin/testimonials")
async def admin_get_testimonials(user: User = Depends(get_current_user)):
    """Admin sees ALL (incl. hidden) testimonials."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return {"items": await _load_testimonials()}


@api_router.put("/admin/testimonials")
async def admin_set_testimonials(payload: TestimonialsPatch, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cleaned = []
    for i, t in enumerate(payload.items):
        # Allow data-URL images up to ~1.5 MB; URL paste is small
        img = t.image_url or ""
        if len(img) > 2_000_000:
            raise HTTPException(status_code=400, detail=f"Testimonial #{i+1} image is too large (max ~1.5 MB)")
        cleaned.append({
            "id": t.id or f"t_{uuid.uuid4().hex[:10]}",
            "name": (t.name or "").strip()[:80] or "Anonymous",
            "role": (t.role or "").strip()[:80],
            "quote": (t.quote or "").strip()[:600],
            "image_url": img.strip()[:2_000_000],
            "rating": max(1, min(5, int(t.rating) if t.rating is not None else 5)),
            "order": int(t.order if t.order is not None else i),
            "visible": bool(t.visible if t.visible is not None else True),
        })
    await db.testimonials_config.update_one({"_id": "active"}, {"$set": {"items": cleaned, "updated_at": iso(now_utc())}}, upsert=True)
    return {"items": await _load_testimonials()}


@api_router.post("/admin/testimonials/reset")
async def admin_reset_testimonials(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.testimonials_config.update_one({"_id": "active"}, {"$set": {"items": TESTIMONIAL_DEFAULTS, "updated_at": iso(now_utc())}}, upsert=True)
    return {"items": await _load_testimonials()}


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
        "mess_name": "eFoodCare",
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
    return {"message": "eFoodCare API", "tagline": "ghar se achha khana"}


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
from routes.admin import router as _admin_router
from routes.rider import router as _rider_router
from routes.whatsapp_admin import router as _wa_admin_router
from routes.app_cms import router as _app_cms_router
api_router.include_router(_auth_router)
api_router.include_router(_payments_router)
api_router.include_router(_restaurant_router)
api_router.include_router(_admin_router)
api_router.include_router(_rider_router)
api_router.include_router(_wa_admin_router)
api_router.include_router(_app_cms_router)

app.include_router(api_router)

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
    )
    logger.info(f"[STARTUP] empty-tiffin SMS stub_mode={_sms_stub_mode_status()} · expiry lead_days={EXPIRY_LEAD_DAYS}")
    # Razorpay key validation — non-blocking, just informational.
    try:
        rzp_status = await validate_razorpay_keys()
        emoji = "✅" if rzp_status["status"] == "live" else "⚠️"
        logger.info(f"[STARTUP] {emoji} Razorpay status={rzp_status['status']} · {rzp_status['detail']}")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[STARTUP] Razorpay status check failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    mongo_client.close()
