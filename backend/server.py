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
    # iter-138.l: monthly plans re-scoped 28d → 30d.
    # Rule (approved by product): keep amount the same, extend duration to 30
    # days and meals to 60 (exactly 2/day). Result: daily ₹93.33, per-meal
    # ₹46.67 for the flagship Premium plan; other plans scale proportionally.
    {"plan_id": "premium_60", "name": "Premium Dining", "description": "Eat at our hall · 60 home-style meals across 30 days · scan QR at counter", "amount": 2800.0, "currency": "INR", "duration_days": 30, "meals": 60, "active": True, "sort_order": 1, "plan_type": "kiosk", "service_type": "dining", "tiffin_size": None, "tiffins_per_day": 0},
    {"plan_id": "classic_60", "name": "Classic Full Tiffin", "description": "Full home-style tiffin — 5 chapati + sabzi/dal/rice, delivered twice daily · 30 days", "amount": 2600.0, "currency": "INR", "duration_days": 30, "meals": 60, "active": True, "sort_order": 2, "plan_type": "delivery", "service_type": "tiffin", "tiffin_size": "full", "tiffins_per_day": 2},
    {"plan_id": "saver_60", "name": "Classic Half Tiffin", "description": "Lighter portion tiffin — 3 chapati + sabzi/dal, delivered twice daily · 30 days", "amount": 1800.0, "currency": "INR", "duration_days": 30, "meals": 60, "active": True, "sort_order": 3, "plan_type": "delivery", "service_type": "tiffin", "tiffin_size": "half", "tiffins_per_day": 2},
]


# ---------------------------
# Helpers
# ---------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# eFoodCare operates in India (IST = UTC + 5:30). Subscription day-rollover,
# attendance date_str, and cron boundaries must reflect the SUBSCRIBER'S day,
# not the server's UTC day. Otherwise the daily wallet-tick doesn't fire until
# 05:30 IST — so a user opening the app at 1 AM IST sees "no deduction yet"
# even though the calendar day (in their eyes) has clearly rolled over.
IST_TZ = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    return datetime.now(IST_TZ)


def ist_today() -> date:
    return ist_now().date()


def today_str() -> str:
    # iter-126: IST-based day rollover (see IST_TZ note above).
    return ist_today().isoformat()


def iso(d: datetime) -> str:
    return d.isoformat()


def now_utc_iso() -> str:
    return now_utc().isoformat()


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
    role: Literal["admin", "staff", "subscriber", "delivery_boy", "rider", "mess_owner"] = "subscriber"
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
    mess_id: Optional[str] = None   # iter-143 · efoodtech: which mess this plan belongs to
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
    # iter-131.17: admin-editable bullet features under each plan card.
    # `features_override` — if set (non-empty string), replaces the default
    #   auto-generated bullets ("56 total meals", "Lunch + Dinner…" etc.)
    #   Each newline is one bullet.
    # `features_extra` — always appended to the bullets (auto or override)
    #   so admin can bolt on marketing lines like "100% pure veg" without
    #   rewriting the whole list.
    features_override: Optional[str] = None
    features_extra: Optional[List[str]] = None
    # iter-131.18: parallel structured bullet lists — each entry is
    #   {icon: 'leaf'|'clock'|..., text: '...'}. When set, these take
    #   precedence over the plain-text `features_override`/`features_extra`
    #   fields above. Kept in sync by the AdminPlans editor.
    features_override_v2: Optional[List[dict]] = None
    features_extra_v2: Optional[List[dict]] = None
    # iter-131.18: hero image URL (Zomato-style full-bleed card background).
    hero_image_url: Optional[str] = None


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
    mess_id: Optional[str] = None   # iter-143 · efoodtech: tag user with their mess on first login


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
    role: Literal["admin", "staff", "subscriber", "delivery_boy", "rider", "mess_owner"]


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
            doc = {**p, "mess_id": DEFAULT_MESS_ID, "created_at": iso(now_utc()), "updated_at": iso(now_utc())}
            await db.plans.insert_one(doc)
        else:
            # One-shot migration: ensure new delivery fields exist on existing rows
            patch = {k: v for k, v in p.items() if k in ("plan_type", "service_type", "tiffin_size", "tiffins_per_day", "name", "description") and existing.get(k) != v}
            # iter-143 · efoodtech: also backfill mess_id on legacy plans
            if not existing.get("mess_id"):
                patch["mess_id"] = DEFAULT_MESS_ID
            if patch:
                patch["updated_at"] = iso(now_utc())
                await db.plans.update_one({"plan_id": p["plan_id"]}, {"$set": patch})
                logger.info(f"[PLAN MIGRATION] {p['plan_id']} updated with {list(patch.keys())}")
    # iter-143 · efoodtech: backfill mess_id on ANY plan doc missing it (legacy)
    try:
        await db.plans.update_many(
            {"$or": [{"mess_id": {"$exists": False}}, {"mess_id": None}, {"mess_id": ""}]},
            {"$set": {"mess_id": DEFAULT_MESS_ID}},
        )
    except Exception:  # noqa: BLE001
        pass


# ---------------------------
# Auth helpers
# ---------------------------
def doc_to_user(doc) -> User:
    # iter-110: Google-OAuth users start with name=None (we deliberately don't
    # auto-fill from Google's payload to keep tiffin-slip names accurate). The
    # Pydantic model requires `name: str`, so unconditionally accessing
    # `doc["name"]` 500s for those users — and that 500 used to mask
    # `DELETE /auth/me` because get_current_user blew up first.
    # Falling back to email-local-part / phone / a placeholder keeps the auth
    # path alive; the user can still type a real name in /profile later.
    fallback_name = (
        (doc.get("email") or "").split("@")[0]
        or doc.get("phone")
        or "Member"
    )
    created_at_raw = doc.get("created_at")
    try:
        created_at = parse_dt(created_at_raw) if created_at_raw else now_utc()
    except Exception:  # noqa: BLE001
        created_at = now_utc()
    return User(
        user_id=doc["user_id"],
        email=doc.get("email"),
        phone=doc.get("phone"),
        name=doc.get("name") or fallback_name,
        address=doc.get("address"),
        photo_url=doc.get("photo_url"),
        picture=doc.get("picture"),
        role=doc.get("role", "subscriber"),
        qr_token=doc.get("qr_token", ""),
        created_at=created_at,
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
    # iter-102: lookup by email OR phone in a single $or query so a user who
    # first signed in via Google (email-only) and later via OTP (phone-only)
    # — or vice versa — resolves to the SAME `users` row instead of forking
    # into duplicates with split wallet / subscription / history.
    email_norm = email.lower() if email else None
    or_clauses = []
    if email_norm:
        or_clauses.append({"email": email_norm})
    if phone:
        or_clauses.append({"phone": phone})
    if not or_clauses:
        raise ValueError("create_or_get_user requires email or phone")
    existing = await db.users.find_one({"$or": or_clauses}, {"_id": 0}) if len(or_clauses) > 1 else await db.users.find_one(or_clauses[0], {"_id": 0})
    is_admin = (email and email.lower() in ADMIN_EMAILS) or (phone and phone in ADMIN_PHONES)
    if existing:
        updates = {}
        # iter-112: NEVER overwrite a user's real saved name. The login flows
        # (OTP / Google) pass a default placeholder name ("User 4744" /
        # email-local-part) which used to clobber the name the user typed
        # in /profile. From now on, we ONLY set `name` when the existing
        # field is empty. Real updates happen via POST /auth/profile, which
        # writes the DB row directly and bypasses this helper.
        if name and not (existing.get("name") or "").strip():
            updates["name"] = name
        if picture and existing.get("picture") != picture:
            updates["picture"] = picture
        # Heal missing identifiers — if the row was created phone-only and the
        # user is now logging in with an email (or vice versa), backfill the
        # missing identifier so future lookups for either find the same row.
        if email_norm and not existing.get("email"):
            updates["email"] = email_norm
        if phone and not existing.get("phone"):
            updates["phone"] = phone
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
                {"user_id": existing_uid} if existing_uid else (
                    {"_id": existing.get("_id")} if existing.get("_id") else {"phone": existing.get("phone"), "email": existing.get("email")}
                ),
                {"$set": updates},
            )
            existing.update(updates)
            existing["user_id"] = existing_uid
        return existing
    role = "admin" if is_admin else "subscriber"
    user_doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email_norm,
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


async def _resolve_razorpay_for_user(user_doc) -> tuple:
    """iter-143 · efoodtech: return (client, key_id, is_custom_per_mess).

    If the user's mess has custom Razorpay keys stored, use those so payment
    lands directly in that mess owner's Razorpay account. Otherwise fall back
    to the platform-wide keys.
    """
    mess_id = (user_doc or {}).get("mess_id") if user_doc else None
    if mess_id:
        try:
            m = await db.messes.find_one(
                {"mess_id": mess_id},
                {"_id": 0, "razorpay_key_id": 1, "razorpay_key_secret": 1},
            )
            if m and (m.get("razorpay_key_id") or "").strip() and (m.get("razorpay_key_secret") or "").strip():
                key_id = m["razorpay_key_id"].strip()
                key_secret = m["razorpay_key_secret"].strip()
                client = razorpay.Client(auth=(key_id, key_secret))
                return client, key_id, True
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[RZP MESS] custom key init failed for mess={mess_id} · {e}")
    return rzp_client, RZP_KEY_ID, False


async def _create_order_record(*, user, user_doc, plan_id, plan_name, amount, currency, duration_days, meals, custom, service_type=None, tiffin_size=None, plan_type=None):
    # Platform fee on top of plan amount — recovers payment-gateway cost
    base_amount = round(float(amount), 2)
    fee_pct = float(PLATFORM_FEE_PCT)
    platform_fee = round(base_amount * fee_pct / 100.0, 2)
    total_amount = round(base_amount + platform_fee, 2)
    amount_paise = int(round(total_amount * 100))
    receipt = f"rcpt_{uuid.uuid4().hex[:16]}"
    # iter-143 · efoodtech: resolve per-mess Razorpay keys so payments go to mess owner directly
    active_client, active_key_id, using_mess_keys = await _resolve_razorpay_for_user(user_doc)
    active_enabled = active_client is not None
    rzp_order = None
    if active_enabled:
        try:
            rzp_order = active_client.order.create({
                "amount": amount_paise, "currency": currency, "receipt": receipt,
                "payment_capture": 1,
                "notes": {
                    "plan_id": plan_id, "user_id": user.user_id, "custom": str(custom).lower(),
                    "base_amount": str(base_amount), "platform_fee": str(platform_fee),
                    "mess_id": (user_doc or {}).get("mess_id") or "",
                    "mess_keys": "1" if using_mess_keys else "0",
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
        "mess_id": (user_doc or {}).get("mess_id"),
        "razorpay_mode": "mess" if using_mess_keys else ("platform" if active_enabled else "mock"),
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
        "key_id": active_key_id if active_enabled else "rzp_test_MOCK",
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
    # iter-126: use IST day boundaries so cron ticks at 00:00 IST (not 05:30 IST
    # which was the effective time under UTC-based date.today()).
    today = ist_today()
    # iter-131.24: legacy/seed docs may miss `last_tick_date`. Backfill from
    # start_date (or today) instead of raising KeyError so /api/my/wallet works.
    if not sub.get("last_tick_date"):
        start = sub.get("start_date")
        if isinstance(start, str):
            try:
                sub["last_tick_date"] = date.fromisoformat(start[:10]).isoformat()
            except Exception:
                sub["last_tick_date"] = today.isoformat()
        elif hasattr(start, "isoformat"):
            sub["last_tick_date"] = start.isoformat() if hasattr(start, "year") else start.date().isoformat()
        else:
            sub["last_tick_date"] = today.isoformat()
        try:
            await db.subscriptions.update_one(
                {"sub_id": sub["sub_id"]},
                {"$set": {"last_tick_date": sub["last_tick_date"]}},
            )
        except Exception:
            pass
    last = date.fromisoformat(sub["last_tick_date"])
    # iter-140 — process only FINALIZED past days (yesterday and earlier).
    # Previously the loop advanced through `today` and deducted a full
    # per_day upfront at 00:00 IST — meaning a dining subscriber who then
    # scanned lunch/dinner during the day got charged AGAIN per meal.
    # `cutoff` is the last day this tick is allowed to account for.
    cutoff = today - timedelta(days=1)
    if last >= cutoff or sub["status"] != "active":
        return sub

    # iter-140.e — CONCURRENCY GUARD. When the frontend fires several
    # requests in parallel (`/my/subscriptions`, `/my/wallet`, `/my/qr`,
    # `/my/attendance` all call get_active_subscription), each invocation
    # would race into the tick loop and write its own copy of every
    # missed-meal debit row. Users saw 4× `Daily deduction · 2026-09-02`
    # rows at the same second. Atomically claim the tick window by moving
    # `last_tick_date` forward BEFORE we do any work. Losers of the race
    # see modified_count == 0 and bail out.
    claim = await db.subscriptions.update_one(
        {"sub_id": sub["sub_id"], "last_tick_date": sub["last_tick_date"]},
        {"$set": {"last_tick_date": cutoff.isoformat()}},
    )
    if claim.modified_count == 0:
        # Another concurrent request already advanced last_tick_date past
        # our anchor — return the freshest sub state so the caller keeps
        # working with correct numbers.
        fresh = await db.subscriptions.find_one({"sub_id": sub["sub_id"]}, {"_id": 0})
        return fresh or sub

    per_day = float(sub.get("per_day_amount", 0))
    per_meal = round(per_day / 2.0, 2)
    is_dining = (sub.get("service_type") or "").lower() == "dining"
    user_id = sub["user_id"]
    paused_added = 0
    deducted_amount = 0.0
    days_processed = 0
    # iter-140.e — snapshot meals_used at start so the tail persist can
    # $inc the DELTA (concurrent-safe) instead of $set-ing an absolute
    # value that might clobber a scan's meals_used update.
    sub_meals_used_at_start = int(sub.get("meals_used", 0))

    current = last
    while current < cutoff:
        current = current + timedelta(days=1)
        # iter-140 — DINING subs: reconcile MISSED meals only. Each meal
        # was either scan-deducted at kiosk (skip here) or missed
        # (deduct per_meal now). The old logic skipped the entire day if
        # ANY meal was scan-deducted which under-charged half-scanned days,
        # and it processed `today` at 00:00 IST which double-charged the
        # subsequent scans.
        if is_dining:
            scan_map = sub.get("scan_deducted_dates") or {}
            scanned_meals = list(scan_map.get(current.isoformat()) or [])
            missed_meals = [m for m in ("lunch", "dinner") if m not in scanned_meals]
            if not missed_meals:
                days_processed += 1
                continue
            # 3-day inactivity check — auto-pause on day 4+ of no-scan streak.
            last_scan_doc = await db.attendance.find_one(
                {"user_id": user_id, "date_str": {"$lt": current.isoformat()}},
                {"_id": 0, "date_str": 1},
                sort=[("date_str", -1)],
            )
            if last_scan_doc and last_scan_doc.get("date_str"):
                anchor = date.fromisoformat(last_scan_doc["date_str"][:10])
            else:
                _sd = sub.get("start_date", current.isoformat())
                if hasattr(_sd, "isoformat"):
                    _sd = _sd.isoformat()
                anchor = date.fromisoformat(str(_sd)[:10])
            days_since_anchor = (current - anchor).days
            is_inactive = days_since_anchor >= INACTIVITY_THRESHOLD_DAYS + 1
            _npb = sub.get("no_pause_before")
            if is_inactive and _npb:
                try:
                    npb_date = date.fromisoformat(str(_npb)[:10])
                    if current <= npb_date:
                        is_inactive = False
                except Exception:  # noqa: BLE001
                    pass
            if is_inactive:
                # Auto-pause: no debit, no meal consumption, end-date extends
                # by 1 (matches the pre-iter-140 per-day pause behaviour so
                # subscribers still get their day back on the calendar).
                sub["paused_days"] = int(sub.get("paused_days", 0)) + 1
                sub["end_date"] = iso(parse_dt(sub["end_date"]) + timedelta(days=1))
                paused_added += 1
                await _log_wallet_txn(user_id, sub["sub_id"], "pause", 0.0, float(sub["wallet_balance"]), f"Auto-pause · {current.isoformat()} ({days_since_anchor} days since last activity · day credited back)")
                days_processed += 1
                continue
            # Active-but-missed meal(s) — deduct per_meal for each.
            for _meal in missed_meals:
                new_balance = round(float(sub["wallet_balance"]) - per_meal, 2)
                if new_balance < 0:
                    new_balance = 0.0
                sub["wallet_balance"] = new_balance
                deducted_amount += per_meal
                new_used = min(int(sub.get("meals_total", 0)), int(sub.get("meals_used", 0)) + 1)
                sub["meals_used"] = new_used
                await _log_wallet_txn(
                    user_id, sub["sub_id"], "debit", per_meal, new_balance,
                    f"Daily deduction · {current.isoformat()} · {_meal} missed",
                )
            days_processed += 1
            continue

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
        # iter-104 #2: The criterion is "consecutive no-scan days, counting
        # from the user's last scan (or the sub start_date if they've never
        # scanned)". Days 1–3 of any skip streak still deduct normally
        # (treated as paid-for-but-not-eaten — the food was cooked for
        # them). From day 4 of consecutive no-show, we auto-pause: no
        # debit, no meal consumption, end-date extends by 1.
        last_scan_doc = await db.attendance.find_one(
            {"user_id": user_id, "date_str": {"$lt": current.isoformat()}},
            {"_id": 0, "date_str": 1},
            sort=[("date_str", -1)],
        )
        if last_scan_doc and last_scan_doc.get("date_str"):
            anchor = date.fromisoformat(last_scan_doc["date_str"][:10])
        else:
            # No scans ever — count from the sub's start_date so a brand-new
            # subscriber gets a 3-day no-show grace before pause kicks in.
            # iter-131.24: start_date may be a datetime (BSON Date) in legacy
            # docs — coerce to string before slicing.
            _sd = sub.get("start_date", current.isoformat())
            if hasattr(_sd, "isoformat"):
                _sd = _sd.isoformat()
            anchor = date.fromisoformat(str(_sd)[:10])
        days_since_anchor = (current - anchor).days
        is_inactive = (sub.get("service_type") != "tiffin") and (days_since_anchor >= INACTIVITY_THRESHOLD_DAYS + 1)

        # iter-138.s — admin-assigned back-dated subs stamp
        # `no_pause_before` with the creation date. Any tick date up to and
        # INCLUDING that boundary must NOT auto-pause: those days represent
        # the period the user was already eating (admin is just recording
        # it retroactively), so we deduct wallet for every one of them.
        # iter-138.t — was `<` (strict) which missed the assign-day itself:
        # 12 back-dated days → only 11 got deducted, meals_used stuck at 22
        # instead of 24 and meals_left showed 38 instead of the expected 36.
        _npb = sub.get("no_pause_before")
        if is_inactive and _npb:
            try:
                npb_date = date.fromisoformat(str(_npb)[:10])
                if current <= npb_date:
                    is_inactive = False
            except Exception:  # noqa: BLE001
                pass

        if not is_inactive:
            # Active day — deduct money + consume the day's 2 meals from balance.
            new_balance = round(float(sub["wallet_balance"]) - per_day, 2)
            if new_balance < 0:
                new_balance = 0.0
            sub["wallet_balance"] = new_balance
            deducted_amount += per_day
            # Bump meals_used by 2 (lunch + dinner) — capped at meals_total
            new_used = min(int(sub.get("meals_total", 0)), int(sub.get("meals_used", 0)) + MEALS_PER_DAY)
            sub["meals_used"] = new_used
            label = "no-scan day" if (sub.get("service_type") != "tiffin" and days_since_anchor > 0 and last_scan_doc) else "active"
            await _log_wallet_txn(user_id, sub["sub_id"], "debit", per_day, new_balance, f"Daily deduction · {current.isoformat()} · 2 meals · {label}")
        else:
            # Inactive day (4+ consecutive no-scan) — no debit, no meal consumption, end-date extends.
            sub["paused_days"] = int(sub.get("paused_days", 0)) + 1
            sub["end_date"] = iso(parse_dt(sub["end_date"]) + timedelta(days=1))
            paused_added += 1
            await _log_wallet_txn(user_id, sub["sub_id"], "pause", 0.0, float(sub["wallet_balance"]), f"Auto-pause · {current.isoformat()} ({days_since_anchor} days since last activity · day credited back)")

        days_processed += 1

    # iter-140.e — anchor is already at cutoff (set atomically at claim
    # time above); persist wallet/meals via $inc so any concurrent scan
    # that fired between the claim and this write isn't clobbered.
    persist_set = {
        "paused_days": sub["paused_days"],
        "end_date": sub["end_date"],
    }
    persist_ops = {"$set": persist_set}
    inc_ops = {}
    if deducted_amount > 0:
        inc_ops["wallet_balance"] = -round(deducted_amount, 2)
    meals_delta = int(sub.get("meals_used", 0)) - int(sub_meals_used_at_start)
    if meals_delta != 0:
        inc_ops["meals_used"] = meals_delta
    if inc_ops:
        persist_ops["$inc"] = inc_ops

    # Persist
    await db.subscriptions.update_one({"sub_id": sub["sub_id"]}, persist_ops)
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

            if user.get("phone"):
                await wa_send_expiry(
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
    "brand_name": "efoodtech",
    "brand_tagline": "User Management System",
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
THEME_VERSION = 4   # iter-146 · revert to efoodcare red on white (keep efoodtech brand name)


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
        logger.info(f"[THEME MIGRATION] Theme upgraded to version {THEME_VERSION} (efoodtech navy)")


@api_router.get("/theme")
async def get_theme():
    return await _load_theme()


@api_router.post("/admin/theme")
async def update_theme(payload: ThemeUpdate, user: User = Depends(get_current_user)):
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin or mess owner only")
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
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin or mess owner only")
    await db.theme_settings.update_one({"_id": "active"}, {"$set": {**DEFAULT_THEME, "updated_at": iso(now_utc())}}, upsert=True)
    return DEFAULT_THEME


# ---------------------------
# Site content (admin-editable pages & footer & landing)
# ---------------------------
DEFAULT_CONTENT = {
    "footer": {
        "copyright": "copyright © efoodtech · all rights reserved",
        "tagline": "User Management System",
        # iter-72 #1: full brand identity block — admin editable
        "brand_name": "efoodtech",
        "brand_tagline": "User Management System",
        "promise": "efoodtech is India's multi-tenant SaaS user management platform for messes across India — QR + face check-in, wallet, per-mess plans and payments.",
        "corporate_address": "shilangan Road, behind bhaktidham mandir, sai nagar, Amravati 444607, Maharashtra",
        "support_phone": "+91 91755 60211",
        "website": "https://efoodcare.in",
        "email": "hello@efoodcare.in",
    },
    # iter-157 · Pricing page defaults — super-admin editable via /admin/content/pricing.
    "pricing": {
        "one_time_fee": 4999,
        "monthly_per_user": 100,
        "grace_days": 7,
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
        # iter-148 · super-admin editable announcement bar shown between the
        # site header and the login form.
        "announcement_bar": "India's first Fully technologically advanced user management software for mess and restaurants",
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


async def _load_content(key: str, mess_id: Optional[str] = None):
    default = DEFAULT_CONTENT.get(key)
    # 1) mess-scoped
    if mess_id:
        mdoc = await db.site_content.find_one({"key": key, "mess_id": mess_id}, {"_id": 0})
        if mdoc:
            existing = mdoc.get("data", {}) or {}
            if isinstance(default, dict):
                return {**default, **existing}
            return existing
        # iter-170: STRICT tenant isolation — do NOT fall through to the
        # super-admin's global doc when a mess owner hasn't customised yet.
        # Return the pristine DEFAULT_CONTENT so tenants never inherit the
        # platform's live copy edits (footer/announcement/kiosk/etc.).
        if default is None:
            raise HTTPException(status_code=404, detail="Unknown content key")
        return default
    # 2) anonymous / global path — serve the super-admin's live doc (fallback
    # to defaults when it's never been touched).
    doc = await db.site_content.find_one({"key": key, "mess_id": {"$in": [None, "__global__"]}}, {"_id": 0}) \
        or await db.site_content.find_one({"key": key, "mess_id": {"$exists": False}}, {"_id": 0})
    if doc:
        existing = doc.get("data", {}) or {}
        if isinstance(default, dict):
            return {**default, **existing}
        return existing
    if default is None:
        raise HTTPException(status_code=404, detail="Unknown content key")
    await db.site_content.insert_one({"key": key, "mess_id": None, "data": default, "updated_at": iso(now_utc())})
    return default


class ContentUpdate(BaseModel):
    data: dict


async def _resolve_content_mess_id(user: "User") -> Optional[str]:
    """Return the mess_id whose content the caller should write to.
    - mess_owner: their own mess (via owner_user_id lookup, fall back to
      user.mess_id if the mess row's owner_user_id link ever drifts from
      seed-time — iter-168 fix).
    - admin actively impersonating: the impersonated mess.
    - admin not impersonating: None → writes global content.
    """
    if user.role == "mess_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        owned = (m or {}).get("mess_id")
        if owned:
            return owned
        # Fallback for legacy seed data where the mess_owner's user record has
        # `mess_id` set but the mess row's owner_user_id link is missing.
        return getattr(user, "mess_id", None) or None
    if user.role == "admin":
        s = await db.user_sessions.find_one(
            {"user_id": user.user_id, "impersonate_mess_id": {"$exists": True}},
            {"_id": 0, "impersonate_mess_id": 1},
        )
        return (s or {}).get("impersonate_mess_id")
    return None


@api_router.get("/content/{key}")
async def get_content(key: str, request: Request, mess_id: Optional[str] = None):
    # iter-158j/n: prefer explicit ?mess_id then x-mess-id header. For
    # authenticated users, fall back to their mess_id so a logged-in
    # subscriber sees their mess's footer/about/etc. Logged-out visitors
    # see the global default.
    if not mess_id:
        mess_id = request.headers.get("x-mess-id") or None
    if not mess_id:
        # Try to infer from session token cookie
        try:
            tok = request.cookies.get("session_token") or (request.headers.get("authorization") or "").replace("Bearer ", "").strip()
            if tok:
                sess = await db.user_sessions.find_one({"token": tok}, {"_id": 0, "user_id": 1})
                if sess:
                    u = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0, "mess_id": 1})
                    mess_id = (u or {}).get("mess_id") or None
        except Exception:  # noqa: BLE001
            pass
    return await _load_content(key, mess_id=mess_id)


@api_router.post("/admin/content/{key}")
async def update_content(key: str, payload: ContentUpdate, user: User = Depends(get_current_user)):
    # iter-158i: mess_owner AND impersonating super-admin can edit their
    # mess's version of any content page. Un-impersonated super-admins
    # write the global default that new messes inherit.
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin or mess owner only")
    if key not in DEFAULT_CONTENT:
        raise HTTPException(status_code=400, detail="Unknown content key")
    scope_mess_id = await _resolve_content_mess_id(user)
    current = await _load_content(key, mess_id=scope_mess_id)
    defaults = DEFAULT_CONTENT.get(key, {})
    incoming = dict(payload.data or {})
    for k, v in list(incoming.items()):
        if isinstance(v, str) and v.strip() == "" and k in defaults:
            kl = k.lower()
            if ("color" in kl) or kl.endswith("_bg") or kl.endswith("_fg") or kl.endswith("_size"):
                incoming.pop(k)
    merged = {**current, **incoming}
    await db.site_content.update_one(
        {"key": key, "mess_id": scope_mess_id},
        {"$set": {"key": key, "mess_id": scope_mess_id, "data": merged, "updated_at": iso(now_utc())}},
        upsert=True,
    )
    return merged


@api_router.post("/admin/content/{key}/reset")
async def reset_content(key: str, user: User = Depends(get_current_user)):
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin or mess owner only")
    if key not in DEFAULT_CONTENT:
        raise HTTPException(status_code=400, detail="Unknown content key")
    scope_mess_id = await _resolve_content_mess_id(user)
    await db.site_content.update_one(
        {"key": key, "mess_id": scope_mess_id},
        {"$set": {"key": key, "mess_id": scope_mess_id, "data": DEFAULT_CONTENT[key], "updated_at": iso(now_utc())}},
        upsert=True,
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
    # efoodtech multi-tenant SaaS fields (iter-143)
    owner_phone: Optional[str] = ""           # for mess-owner login
    owner_email: Optional[str] = ""
    logo_url: Optional[str] = ""              # mess-specific logo (data URL)
    hero_title: Optional[str] = ""            # per-mess marketing title
    hero_subtitle: Optional[str] = ""
    tag_chips: Optional[List[str]] = None     # e.g. ["0% Ajinomoto","0% Maida"]
    payment_note: Optional[str] = ""          # shown on checkout receipt
    # iter-144: super-admin can override the auto-generated mess_id at create time
    mess_id_custom: Optional[str] = None      # e.g. "MUMBAI-KHAR-42"; if omitted → auto-generate


class MessSettingsIn(BaseModel):
    """iter-143 · mess-owner-editable branding + copy for their own mess."""
    tagline: Optional[str] = None
    hero_title: Optional[str] = None
    hero_subtitle: Optional[str] = None
    tag_chips: Optional[List[str]] = None
    logo_url: Optional[str] = None
    payment_note: Optional[str] = None
    manager_name: Optional[str] = None
    manager_phone: Optional[str] = None
    manager_email: Optional[str] = None
    # iter-147: per-mess CMS overrides (footer, announcement, contact, kiosk voice, testimonials)
    footer_text: Optional[str] = None
    announcement_text: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    contact_address: Optional[str] = None
    contact_hours: Optional[str] = None
    kiosk_voice_name: Optional[str] = None      # e.g. "en-IN-NeerjaNeural"
    kiosk_voice_lang: Optional[str] = None       # e.g. "en-IN" | "hi-IN" | "mr-IN"
    testimonials: Optional[List[dict]] = None    # [{name, quote, role, photo_url}]
    # iter-157 · platform billing config (super-admin editable per mess).
    platform_charge_dining_per_user: Optional[float] = None    # ₹/user/month for dining
    platform_charge_tiffin_per_user: Optional[float] = None    # ₹/user/month for tiffin
    platform_wallet_balance: Optional[float] = None            # top-up balance
    platform_wallet_grace_days: Optional[int] = None            # override default 7


class MessRazorpayKeysIn(BaseModel):
    razorpay_key_id: str = Field(..., min_length=8, max_length=64)
    razorpay_key_secret: str = Field(..., min_length=8, max_length=128)


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


@app.on_event("startup")
async def _startup_migrate_plans_30d_to_28d():
    """iter-129 idempotent DB migration — monthly plans move from 30d → 28d.

    Runs at server boot, exactly once (guarded by a marker doc in `db.migrations`).
    Behaviour:
      • Every active plan whose `duration_days == 30` is switched to 28.
      • Its `meals` count is shrunk proportionally to preserve the 2/day
        invariant (60 → 56, 45 → 42, etc.). Snapped to nearest even int.
      • `amount` is NOT touched — that was the product decision (keep price,
        shorter window, higher daily rate).
      • Existing subscriptions are NEVER touched. Contracts honored.

    Marker: db.migrations.find_one({"key": "iter129_28day_plans"}).
    Safe to redeploy — re-runs are a no-op if marker exists.
    """
    try:
        marker = await db.migrations.find_one({"key": "iter129_28day_plans"})
        if marker:
            return   # already ran on this DB
        cursor = db.plans.find({"duration_days": 30}, {"plan_id": 1, "meals": 1, "duration_days": 1})
        touched = 0
        async for p in cursor:
            old_meals = int(p.get("meals") or 0)
            # snap to nearest even to preserve 2/day invariant, drop by 4 as floor
            new_meals = max(2, (old_meals * 28 // 30) // 2 * 2)
            if new_meals == old_meals:
                new_meals = max(2, old_meals - 4)
            await db.plans.update_one(
                {"_id": p["_id"]},
                {"$set": {
                    "duration_days": 28,
                    "meals": new_meals,
                    "_migrated_from_30d": True,
                    "_migrated_at": "iter-129-startup",
                }},
            )
            touched += 1
        await db.migrations.insert_one({
            "key": "iter129_28day_plans",
            "ran_at": now_utc().isoformat(),
            "plans_touched": touched,
            "note": "30d plans → 28d; meals snapped to 2/day invariant; existing subs untouched.",
        })
        if touched:
            logger.info(f"[migrations] iter129: migrated {touched} plans from 30d to 28d")
    except Exception as e:  # noqa: BLE001
        # Don't crash server boot — an admin can re-trigger via a manual admin
        # endpoint if this ever fails (unlikely for a simple update-many).
        logger.warning(f"[migrations] iter129 plan re-scope failed: {e}")


async def _migrate_plans_28day_to_30day():
    """iter-138.l — reverse the iter-129 shrink and put monthly plans back on
    a 30-day / 60-meal cadence.

    Rule (approved by product): keep amount the same, extend duration back
    to 30 days and meal count back to 60 (exactly 2/day). Daily rate drops
    from ₹100 to ₹93.33 for the flagship Premium plan.
      • Every active plan whose `duration_days == 28` is switched to 30.
      • Its `meals` count is grown proportionally to preserve the 2/day
        invariant — 56 → 60, 42 → 45 (rounded to even), etc.
      • Existing subscriptions are NEVER touched. Contracts honoured.

    Marker: db.migrations.find_one({"key": "iter138_30day_plans"}).
    Safe to redeploy — re-runs are a no-op if marker exists.
    """
    try:
        marker = await db.migrations.find_one({"key": "iter138_30day_plans"})
        if marker:
            return   # already ran on this DB
        cursor = db.plans.find({"duration_days": 28}, {"plan_id": 1, "meals": 1, "duration_days": 1})
        touched = 0
        async for p in cursor:
            old_meals = int(p.get("meals") or 0)
            # snap to nearest even number to preserve 2/day invariant; bump
            # by +4 as a sensible floor if the proportional bump lands on
            # the same number.
            new_meals = max(2, (old_meals * 30 // 28) // 2 * 2)
            if new_meals == old_meals:
                new_meals = old_meals + 4
            await db.plans.update_one(
                {"_id": p["_id"]},
                {"$set": {
                    "duration_days": 30,
                    "meals": new_meals,
                    "_migrated_from_28d": True,
                    "_migrated_at": "iter-138-startup",
                }, "$unset": {"_migrated_from_30d": ""}},
            )
            touched += 1
        # Also fix any residual descriptions that still say "28 days" or
        # "56 home-style meals". We only fix the two default text patterns.
        await db.plans.update_many(
            {"description": {"$regex": "28 days"}},
            [{"$set": {"description": {
                "$replaceAll": {"input": "$description", "find": "28 days", "replacement": "30 days"}
            }}}],
        )
        await db.plans.update_many(
            {"description": {"$regex": "56 home-style meals"}},
            [{"$set": {"description": {
                "$replaceAll": {"input": "$description", "find": "56 home-style meals", "replacement": "60 home-style meals"}
            }}}],
        )
        await db.migrations.insert_one({
            "key": "iter138_30day_plans",
            "ran_at": now_utc().isoformat(),
            "plans_touched": touched,
            "note": "28d plans → 30d; meals grown to 2/day invariant; existing subs untouched.",
        })
        if touched:
            logger.info(f"[migrations] iter138: migrated {touched} plans from 28d back to 30d")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[migrations] iter138 plan re-scope failed: {e}")


@app.on_event("startup")
async def _startup_migrate_plans_28d_to_30d():
    """iter-138.l startup hook — reverts monthly plans back to 30d/60m.

    Runs AFTER the iter-129 startup hook has fired (both are idempotent, so
    the ordering doesn't actually matter — the 28→30 migration only touches
    docs whose `duration_days == 28`, which the iter-129 marker guarantees).
    """
    await _migrate_plans_28day_to_30day()


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
    # iter-144 · efoodtech SaaS: super-admin may supply a custom Mess ID
    custom_id = (payload.mess_id_custom or "").strip().upper()
    if custom_id:
        if len(custom_id) < 3 or len(custom_id) > 40 or not all(c.isalnum() or c in "-_" for c in custom_id):
            raise HTTPException(status_code=400, detail="Custom Mess ID must be 3–40 chars: letters, numbers, '-' or '_' only.")
        if await db.messes.find_one({"mess_id": custom_id}):
            raise HTTPException(status_code=400, detail="Mess ID already exists — pick another.")
        mess_id = custom_id
    else:
        mess_id = f"MESS-{uuid.uuid4().hex[:4].upper()}"
        while await db.messes.find_one({"mess_id": mess_id}):
            mess_id = f"MESS-{uuid.uuid4().hex[:4].upper()}"
    body = payload.model_dump()
    body.pop("mess_id_custom", None)
    # iter-144: if owner_phone provided AND matches an existing user, auto-assign as mess_owner in one shot.
    promoted_owner_user_id: Optional[str] = None
    owner_phone_norm = "".join(c for c in (body.get("owner_phone") or "") if c.isdigit())
    if owner_phone_norm:
        candidates = [owner_phone_norm]
        if owner_phone_norm.startswith("91") and len(owner_phone_norm) == 12:
            candidates.append(owner_phone_norm[2:])
        elif len(owner_phone_norm) == 10:
            candidates.append("91" + owner_phone_norm)
        owner_doc = await db.users.find_one({"phone": {"$in": candidates}}, {"_id": 0, "user_id": 1})
        if owner_doc:
            promoted_owner_user_id = owner_doc["user_id"]
    doc = {
        **body,
        "mess_id": mess_id,
        "owner_user_id": promoted_owner_user_id,
        "is_corporate": not payload.is_franchise,
        "status": "active",
        "currency": "INR",
        "created_at": iso(now_utc()),
        "updated_at": iso(now_utc()),
    }
    await db.messes.insert_one(doc)
    # Promote the owner's role if we linked them
    if promoted_owner_user_id:
        await db.users.update_one(
            {"user_id": promoted_owner_user_id, "role": {"$ne": "admin"}},
            {"$set": {"role": "mess_owner", "mess_id": mess_id}},
        )
    out = await db.messes.find_one({"mess_id": mess_id}, {"_id": 0})
    return {**out, "promoted_owner_user_id": promoted_owner_user_id}


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
    if user.role not in ("mess_owner", "admin"):
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
    if user.role not in ("admin", "staff", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    days = max(1, min(int(days or 30), 365))
    return await _mess_metrics(mess_id, days)


@api_router.get("/franchise/me/metrics")
async def franchise_my_metrics(days: int = 30, user: User = Depends(get_current_user)):
    """Franchise-portal view — owner sees only THEIR mess (the one where
    mess.owner_user_id == user.user_id). Returns 403 if no mess owned.
    """
    if user.role not in ("mess_owner", "admin"):
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
    the target user to role=mess_owner.
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
            await db.users.update_one({"user_id": target_user_id}, {"$set": {"role": "mess_owner"}})
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
# iter-131.16: per-user delivery-time preferences
# Users pick a lunch window (e.g. 10:00 → 10:30) and dinner window so the
# staff console, delivery-boy route, and admin dashboard can plan around it.
# ---------------------------
@api_router.get("/my/delivery-prefs")
async def get_my_delivery_prefs(user: User = Depends(get_current_user)):
    u = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "delivery_prefs": 1})
    prefs = (u or {}).get("delivery_prefs") or {}
    return {
        "lunch": prefs.get("lunch") or None,
        "dinner": prefs.get("dinner") or None,
        "is_set": bool(prefs.get("lunch") and prefs.get("dinner")),
    }


@api_router.put("/my/delivery-prefs")
async def put_my_delivery_prefs(payload: dict = Body(...), user: User = Depends(get_current_user)):
    """Body: {lunch: {start, end}, dinner: {start, end}} — both required, HH:MM 24h."""
    from delivery.shared import validate_delivery_window
    lunch = payload.get("lunch") or {}
    dinner = payload.get("dinner") or {}
    ls, le = validate_delivery_window(lunch.get("start"), lunch.get("end"))
    ds, de = validate_delivery_window(dinner.get("start"), dinner.get("end"))
    prefs = {
        "lunch": {"start": ls, "end": le},
        "dinner": {"start": ds, "end": de},
        "updated_at": now_utc_iso(),
    }
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"delivery_prefs": prefs}})
    # Splash today's planned/ready rosters so a same-day window change is
    # reflected on the staff/boy screens without waiting for the next day.
    await db.daily_rosters.update_many(
        {"user_id": user.user_id, "date": today_str(), "meal_type": "lunch", "status": {"$in": ["planned", "ready"]}},
        {"$set": {"pref_start": ls, "pref_end": le}},
    )
    await db.daily_rosters.update_many(
        {"user_id": user.user_id, "date": today_str(), "meal_type": "dinner", "status": {"$in": ["planned", "ready"]}},
        {"$set": {"pref_start": ds, "pref_end": de}},
    )
    return {"ok": True, "prefs": prefs}


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
    # iter-131.29: strict IST time-slot enforcement. Lunch 12:00-15:00, Dinner
    # 19:00-22:00. Overrides via admin_config.meal_slots (future admin UI).
    slot_cfg = (await db.admin_config.find_one({"_id": "meal_slots"}, {"_id": 0})) or {}
    _lunch = slot_cfg.get("lunch") or {"start": "12:00", "end": "15:00"}
    _dinner = slot_cfg.get("dinner") or {"start": "19:00", "end": "22:00"}
    slots = {"lunch": _lunch, "dinner": _dinner}
    def _hm(s):
        try:
            h, m = s.split(":"); return int(h)*60 + int(m)
        except Exception:
            return None
    now_ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    now_min = now_ist.hour*60 + now_ist.minute
    win = slots.get(meal_type)
    if win:
        start_m, end_m = _hm(win["start"]), _hm(win["end"])
        if start_m is not None and end_m is not None and not (start_m <= now_min <= end_m):
            raise HTTPException(
                status_code=403,
                detail=f"{meal_type.capitalize()} scans are open {win['start']}–{win['end']} IST only. Please come back during the slot."
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
    # iter-131.29: DINING subs deduct wallet + 1 meal on every scan. We also
    # track which (date, meal) were scan-deducted so `catch_up_subscription`
    # can skip those days and avoid double-charging. Tiffin subs keep the
    # legacy tick-based deduction (they don't scan — food is delivered).
    if (sub.get("service_type") or "").lower() == "dining":
        per_day = float(sub.get("per_day_amount") or 0)
        per_meal = round(per_day / 2.0, 2)
        old_bal = float(sub.get("wallet_balance") or 0)
        new_bal = round(max(0.0, old_bal - per_meal), 2)
        new_meals_used = min(int(sub.get("meals_total") or 0), int(sub.get("meals_used") or 0) + 1)
        scan_map = sub.get("scan_deducted_dates") or {}
        day_meals = list(scan_map.get(today) or [])
        if meal_type not in day_meals:
            day_meals.append(meal_type)
        scan_map[today] = day_meals
        await db.subscriptions.update_one(
            {"sub_id": sub["sub_id"]},
            {"$set": {
                "wallet_balance": new_bal,
                "meals_used": new_meals_used,
                "scan_deducted_dates": scan_map,
                # iter-140 — do NOT advance last_tick_date here. The
                # midnight tick reads `scan_deducted_dates[today]` to
                # decide which meals were already scan-deducted, and
                # ONLY charges the missed ones per-meal. Advancing the
                # anchor to today caused the previous under-charging bug
                # on half-scanned days AND blocked the auto-pause
                # bookkeeping from running for tomorrow's tick.
            }},
        )
        # iter-140 — keep users.wallet_balance in sync with the sub doc so
        # /api/my/wallet + admin wallet views reflect the debit. The tick
        # path uses $inc on the same field; both stores must move together.
        actual_debit = round(old_bal - new_bal, 2)
        if actual_debit > 0:
            await db.users.update_one(
                {"user_id": target_user["user_id"]},
                {"$inc": {"wallet_balance": -actual_debit}},
            )
        await _log_wallet_txn(
            target_user["user_id"], sub["sub_id"], "debit",
            per_meal, new_bal,
            f"Scan · {meal_type} · {today}",
        )
    # iter-140 NOTE: Tiffin subs are tick-driven (2 meals per active day,
    # decremented after midnight). Dining subs deduct per-meal on the scan
    # above and let the midnight tick charge any meal that was missed
    # (see catch_up_subscription).
    return record


@api_router.post("/attendance/scan")
async def staff_scan(payload: StaffScanRequest, user: User = Depends(get_current_user)):
    if user.role not in ("staff", "admin", "mess_owner"):
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



# ---- iter-138 · Face check-in on the wall kiosk -----------------------------
# Face-api.js in the browser computes a 128-dim float embedding per selfie.
# We store the user's canonical embedding when they enroll from Profile,
# then the wall kiosk periodically sends a live embedding for the closest
# match. Distances are Euclidean; a threshold of 0.6 is the community-
# accepted "same person" boundary for face-api.js's descriptor model.

class FaceEnrollIn(BaseModel):
    embedding: List[float] = Field(..., description="128-dim face descriptor from face-api.js")


class FaceCheckinIn(BaseModel):
    embedding: List[float] = Field(..., description="Live 128-dim descriptor")
    meal_type: Optional[str] = Field(default=None, description="Optional override; defaults to the currently-open IST slot")


def _euclidean(a: List[float], b: List[float]) -> float:
    n = min(len(a), len(b))
    return sum((float(a[i]) - float(b[i])) ** 2 for i in range(n)) ** 0.5


def _current_meal_slot_ist(slot_cfg: dict) -> Optional[str]:
    """Return the currently-open meal slot per IST + admin config windows."""
    def _hm(s):
        try:
            h, m = s.split(":"); return int(h) * 60 + int(m)
        except Exception:
            return None
    now_ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    now_min = now_ist.hour * 60 + now_ist.minute
    for meal, default in (("lunch", {"start": "12:00", "end": "15:00"}),
                          ("dinner", {"start": "19:00", "end": "22:00"})):
        win = (slot_cfg or {}).get(meal) or default
        s = _hm(win.get("start")); e = _hm(win.get("end"))
        if s is not None and e is not None and s <= now_min <= e:
            return meal
    return None


@api_router.post("/users/me/face-embedding")
async def set_face_embedding(payload: FaceEnrollIn, user: User = Depends(get_current_user)):
    """Store the user's canonical face descriptor. Idempotent overwrite."""
    if len(payload.embedding) not in (128, 512):
        raise HTTPException(status_code=400, detail="Embedding must be 128 floats (face-api.js) or 512 (deep model)")
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "face_embedding": [float(x) for x in payload.embedding],
            "face_embedding_dim": len(payload.embedding),
            "face_embedding_updated_at": iso(now_utc()),
        }},
    )
    return {"ok": True, "dim": len(payload.embedding)}


@api_router.delete("/users/me/face-embedding")
async def clear_face_embedding(user: User = Depends(get_current_user)):
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$unset": {"face_embedding": "", "face_embedding_dim": "", "face_embedding_updated_at": ""}},
    )
    return {"ok": True}


@api_router.get("/users/me/face-embedding")
async def get_face_embedding_status(user: User = Depends(get_current_user)):
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "face_embedding_dim": 1, "face_embedding_updated_at": 1})
    return {
        "enrolled": bool((doc or {}).get("face_embedding_dim")),
        "updated_at": (doc or {}).get("face_embedding_updated_at"),
    }


@api_router.get("/admin/users/face-enroll-list")
async def admin_face_enroll_list(
    only_missing: bool = True,
    user: User = Depends(get_current_user),
):
    """iter-138.a — batch face-enrollment helper. Returns every subscriber
    profile that has a `profile_photo_url` so the admin browser tool can
    load each image, compute a face descriptor via face-api.js, and POST it
    back — reusing the existing 86 selfies instead of asking each user to
    re-do a scan from their phone.

    `only_missing=true` (default) filters out users who already have an
    embedding so re-runs don't waste bandwidth.
    """
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    q: dict = {"profile_photo_url": {"$exists": True, "$ne": None}}
    if only_missing:
        q["face_embedding"] = {"$exists": False}
    cur = db.users.find(q, {"_id": 0, "user_id": 1, "name": 1, "profile_photo_url": 1})
    users_out = [u async for u in cur]
    return {"ok": True, "count": len(users_out), "users": users_out}


class AdminSetFaceEmbeddingIn(BaseModel):
    embedding: List[float] = Field(..., description="128-dim descriptor computed by the admin browser tool")


@api_router.post("/admin/users/{target_user_id}/face-embedding")
async def admin_set_face_embedding(
    target_user_id: str,
    payload: AdminSetFaceEmbeddingIn,
    user: User = Depends(get_current_user),
):
    """iter-138.a — admin writes a face embedding on behalf of another user
    (during the batch tool run). Same shape as the self-serve endpoint but
    scoped to admin/mess_owner and tagged so we know it came from the
    batch tool (helpful for later re-enroll prompts).
    """
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if len(payload.embedding) not in (128, 512):
        raise HTTPException(status_code=400, detail="Bad embedding shape")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one(
        {"user_id": target_user_id},
        {"$set": {
            "face_embedding": [float(x) for x in payload.embedding],
            "face_embedding_dim": len(payload.embedding),
            "face_embedding_updated_at": iso(now_utc()),
            "face_embedding_source": "batch_selfie",
        }},
    )
    return {"ok": True, "user_id": target_user_id, "dim": len(payload.embedding)}


# ---- iter-138.h · Kiosk heartbeat + health tile -----------------------------
class KioskHeartbeatIn(BaseModel):
    camera_ok: bool = False
    voice_on: bool = False
    ua: Optional[str] = None
    note: Optional[str] = None


@api_router.post("/admin/kiosk/heartbeat")
async def kiosk_heartbeat(payload: KioskHeartbeatIn, user: User = Depends(get_current_user)):
    """Wall kiosk pings this every ~30s with its live camera + voice state
    so the admin dashboard can flag "camera lost" without walking to the
    display."""
    if user.role not in ("admin", "staff", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    await db.kiosk_heartbeats.update_one(
        {"admin_user_id": user.user_id},
        {"$set": {
            "admin_user_id": user.user_id,
            "camera_ok": bool(payload.camera_ok),
            "voice_on": bool(payload.voice_on),
            "ua": (payload.ua or "")[:200],
            "note": (payload.note or "")[:200],
            "ts": iso(now_utc()),
        }},
        upsert=True,
    )
    return {"ok": True}


@api_router.get("/admin/kiosk/health")
async def kiosk_health(user: User = Depends(get_current_user)):
    if user.role not in ("admin", "staff", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    hb_docs = await db.kiosk_heartbeats.find({}, {"_id": 0}).sort("ts", -1).limit(10).to_list(10)
    # Last face check-in for the "N min ago" fresh-scan indicator.
    last_att = await db.attendance.find_one({"marked_by": "kiosk_face"}, {"_id": 0}, sort=[("checked_at", -1)])
    return {
        "ok": True,
        "kiosks": hb_docs,
        "last_face_checkin_at": (last_att or {}).get("checked_at"),
        "last_face_checkin_user_id": (last_att or {}).get("user_id"),
    }


@api_router.post("/kiosk/face-checkin")
async def kiosk_face_checkin(payload: FaceCheckinIn, user: User = Depends(get_current_user)):
    """Live wall-kiosk face match → attendance.
    Only admin/staff/mess_owner may call this (the wall kiosk runs
    under such a session). Compares payload.embedding against every
    subscriber's stored embedding, picks the closest match under threshold
    0.6, and records an attendance row exactly like a QR scan would.
    """
    if user.role not in ("staff", "admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Kiosk-only endpoint")
    if len(payload.embedding) not in (128, 512):
        raise HTTPException(status_code=400, detail="Bad embedding shape")

    # Determine meal slot
    slot_cfg = (await db.admin_config.find_one({"_id": "meal_slots"}, {"_id": 0})) or {}
    meal_type = (payload.meal_type or _current_meal_slot_ist(slot_cfg) or "").lower()
    if meal_type not in ("lunch", "dinner"):
        raise HTTPException(status_code=400, detail="No active meal slot right now")

    # Load enrolled subscribers. Filter to those with an embedding of the
    # SAME dimensionality (128 vs 512) so we compare apples to apples.
    live_dim = len(payload.embedding)
    cur = db.users.find(
        {"face_embedding_dim": live_dim, "face_embedding": {"$exists": True}},
        {"_id": 0, "user_id": 1, "name": 1, "face_embedding": 1, "profile_photo_url": 1},
    )
    best = None  # (distance, user_doc)
    async for u in cur:
        emb = u.get("face_embedding") or []
        if len(emb) != live_dim:
            continue
        d = _euclidean(payload.embedding, emb)
        if best is None or d < best[0]:
            best = (d, u)

    if best is None:
        raise HTTPException(status_code=404, detail="No enrolled subscribers found")
    distance, matched = best
    # face-api.js community threshold ≈ 0.6. Auto-check-in only ≤ 0.5 to keep
    # false positives low; borderline 0.5-0.6 rejects with a hint so the
    # customer can retry.
    STRICT = 0.50
    LOOSE = 0.60
    if distance > LOOSE:
        raise HTTPException(status_code=404, detail=f"Face not recognised (distance {distance:.2f})")
    if distance > STRICT:
        return {
            "ok": False,
            "reason": "borderline",
            "distance": round(distance, 3),
            "candidate": {"user_id": matched["user_id"], "name": matched.get("name"), "profile_photo_url": matched.get("profile_photo_url")},
        }

    # Strong match — record attendance.
    try:
        record = await _mark_attendance(matched, meal_type, user.user_id, "kiosk_face")
    except HTTPException as e:
        # Bubble up domain errors (already checked in, off-window, etc.)
        return {
            "ok": False,
            "reason": "attendance_blocked",
            "detail": e.detail,
            "distance": round(distance, 3),
            "candidate": {"user_id": matched["user_id"], "name": matched.get("name"), "profile_photo_url": matched.get("profile_photo_url")},
        }

    # iter-138.d — continual re-enrollment. On a very-close match (< 0.35)
    # we blend the fresh live descriptor into the stored one via a small
    # EWMA (α = 0.15) so the vector slowly tracks natural changes — beard
    # growth, glasses, hairstyle, aging — without ever asking the user to
    # re-enroll. α is small so a one-off harsh-lit frame can't corrupt the
    # canonical embedding.
    if distance < 0.35:
        try:
            stored = matched.get("face_embedding") or []
            live = payload.embedding
            if len(stored) == len(live):
                alpha = 0.15
                blended = [round((1 - alpha) * float(stored[i]) + alpha * float(live[i]), 6) for i in range(len(stored))]
                await db.users.update_one(
                    {"user_id": matched["user_id"]},
                    {"$set": {
                        "face_embedding": blended,
                        "face_embedding_dim": len(blended),
                        "face_embedding_updated_at": iso(now_utc()),
                        "face_embedding_source": "kiosk_ewma",
                    }},
                )
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[face-checkin] EWMA update failed for {matched.get('user_id')}: {e}")

    sub_after = await get_active_subscription(matched["user_id"])
    return {
        "ok": True,
        "record": record,
        "meal_type": meal_type,
        "distance": round(distance, 3),
        "subscriber_name": matched.get("name"),
        "subscriber_user_id": matched.get("user_id"),
        "profile_photo_url": matched.get("profile_photo_url"),
        "meals_left": (sub_after["meals_total"] - sub_after["meals_used"]) if sub_after else 0,
    }



@api_router.get("/counter/qr")
async def counter_qr(meal: str = "lunch", location: str = "main", user: User = Depends(get_current_user)):
    if user.role not in ("staff", "admin", "mess_owner"):
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
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin or mess owner only")
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


@api_router.post("/admin/reconcile-backdated-drift")
async def admin_reconcile_backdated_drift(user: User = Depends(get_current_user)):
    """iter-138.u — one-tap batch reconciler for every user whose active
    subscription was manually assigned back-dated BEFORE iter-138.t landed.

    Rule (matches the per-user "Prefill drift fix" button):
      • Only touch subs that have `no_pause_before` set (this flag was only
        stamped on manual back-dated assignments).
      • Only touch subs that haven't already been reconciled (guarded by
        `no_pause_before_reconciled: True` marker).
      • Subtract 2 from `meals_left`, add 2 to `meals_used`, subtract ₹100
        from both `wallet_balance` fields (user + sub) — exactly what
        would have been deducted on the assign-day if the strict `<`
        comparison hadn't skipped it.
      • Never take meals_left below 0 or wallet below 0.
      • Record an audit ledger entry per user so the admin sees which
        accounts got auto-adjusted.

    Returns { touched: int, skipped: int, users: [{user_id, name, before, after}] }.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    cursor = db.subscriptions.find(
        {
            "status": "active",
            "no_pause_before": {"$exists": True, "$ne": None},
            "no_pause_before_reconciled": {"$ne": True},
        },
        {"_id": 0},
    )
    touched = 0
    skipped = 0
    changed: list = []
    async for sub in cursor:
        uid = sub.get("user_id")
        if not uid:
            skipped += 1
            continue
        u = await db.users.find_one({"user_id": uid}, {"_id": 0, "user_id": 1, "name": 1, "wallet_balance": 1})
        if not u:
            skipped += 1
            continue
        # Bring meals_used up by 2 (never above meals_total), meals_left down
        # by 2 (never below 0), wallet down by ₹100 (never below 0).
        meals_total = int(sub.get("meals_total") or 0)
        meals_used_before = int(sub.get("meals_used") or 0)
        meals_left_before = max(0, meals_total - meals_used_before)
        delta_meals = min(2, meals_left_before)  # don't overshoot
        meals_used_after = min(meals_total, meals_used_before + delta_meals)
        sub_wallet_before = float(sub.get("wallet_balance") or 0.0)
        user_wallet_before = float(u.get("wallet_balance") or 0.0)
        # Per-meal rate → prefer sub.per_meal_price, fallback to ₹50 (Premium 60).
        per_meal = float(sub.get("per_meal_price") or 50.0)
        delta_rupees = min(delta_meals * per_meal, sub_wallet_before, user_wallet_before)
        sub_wallet_after = round(max(0.0, sub_wallet_before - delta_rupees), 2)
        user_wallet_after = round(max(0.0, user_wallet_before - delta_rupees), 2)

        await db.subscriptions.update_one(
            {"user_id": uid, "status": "active"},
            {
                "$set": {
                    "meals_used": meals_used_after,
                    "wallet_balance": sub_wallet_after,
                    "no_pause_before_reconciled": True,
                    "no_pause_before_reconciled_at": now_utc().isoformat(),
                    "no_pause_before_reconciled_by": user.email or user.user_id,
                },
            },
        )
        await db.users.update_one({"user_id": uid}, {"$set": {"wallet_balance": user_wallet_after}})
        await db.wallet_transactions.insert_one({
            "user_id": uid,
            "delta": -delta_rupees,
            "reason": f"iter-138.u auto-reconcile back-dated drift · -{delta_meals} meals",
            "actor_user_id": user.user_id,
            "created_at": now_utc().isoformat(),
            "kind": "admin_override",
            "meals_delta": -delta_meals,
        })
        changed.append({
            "user_id": uid,
            "name": u.get("name") or "",
            "before": {"meals_left": meals_left_before, "wallet": sub_wallet_before},
            "after": {"meals_left": max(0, meals_total - meals_used_after), "wallet": sub_wallet_after},
        })
        touched += 1
    return {"ok": True, "touched": touched, "skipped": skipped, "users": changed}


@api_router.post("/admin/backfill-joining-entries")
async def admin_backfill_joining_entries(user: User = Depends(get_current_user), dry_run: bool = False):
    """iter-140.h — inserts a `Joining · <plan> · started <start_date>`
    credit row for every ACTIVE sub whose ledger doesn't already have one.
    Idempotent: keyed by `kind='joining_credit'` + `sub_id`. Safe to run
    any number of times."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    added = 0
    skipped = 0
    async for sub in db.subscriptions.find({"status": "active"}, {"_id": 0}):
        sid = sub.get("sub_id")
        if not sid:
            continue
        existing = await db.wallet_transactions.find_one(
            {"sub_id": sid, "kind": "joining_credit"},
            {"_id": 0, "txn_id": 1},
        )
        if existing:
            skipped += 1
            continue
        start_str = str(sub.get("start_date") or "")[:10]
        if not start_str:
            skipped += 1
            continue
        plan_amount = float(sub.get("plan_amount") or sub.get("amount_paid") or (float(sub.get("per_day_amount") or 0) * 30))
        plan_name = sub.get("plan_name") or "30-day plan"
        service_type = (sub.get("service_type") or "dining")
        if dry_run:
            added += 1
            continue
        await db.wallet_transactions.insert_one({
            "txn_id": f"wtxn_{uuid.uuid4().hex[:12]}",
            "user_id": sub.get("user_id"),
            "sub_id": sid,
            "type": "credit",
            "amount": round(plan_amount, 2),
            "balance_after": round(plan_amount, 2),
            "reason": f"Joining · {plan_name} · started {start_str}",
            "created_at": f"{start_str}T00:00:00+05:30",
            "kind": "joining_credit",
            "service_type": service_type,
            "start_date": start_str,
            "actor_user_id": user.user_id,
        })
        added += 1
    return {"ok": True, "dry_run": dry_run, "added": added, "already_present": skipped}


@api_router.post("/admin/factory-reset")
async def admin_factory_reset(
    user: User = Depends(get_current_user),
    confirm: str = "",
    dry_run: bool = False,
):
    """iter-140.g — one-tap "wipe everything and reseed" tool.

    User asked for a hard restart because the ledger accumulated so many
    duplicate + partial-refund rows that subscribers are confused. This
    endpoint:
      1. Deletes every `wallet_transactions` row (all ledger history).
      2. For every *active* subscription, resets it to a fresh 30-day
         state — wallet = plan_amount, meals_used = 0, paused = 0,
         status = active, end_date = start_date + 30 days, no scan map.
      3. Deducts the correct BACKLOG for calendar days already elapsed
         since `start_date` (per_day × days_elapsed for wallet,
         2 × days_elapsed for meals_used). `last_tick_date` moves to
         `today - 1` so the midnight tick won't touch these days again.
      4. Syncs `users.wallet_balance` to the sum of that user's sub
         wallets (single source of truth).
      5. Writes ONE audit row per user so admins can see who was reseeded.

    Guardrail: requires `confirm=YES-DELETE-ALL` because it is
    IRREVERSIBLE. Use `dry_run=true` to preview the impact.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if not dry_run and confirm != "YES-DELETE-ALL":
        raise HTTPException(status_code=400, detail="Missing confirm=YES-DELETE-ALL — refusing to run destructive reset")

    today_ist = ist_today()
    cutoff = today_ist - timedelta(days=1)
    active_subs_cur = db.subscriptions.find({"status": "active"}, {"_id": 0})
    users_touched: list = []
    total_deducted = 0.0
    total_txns_deleted = 0

    async for sub in active_subs_cur:
        try:
            sd = date.fromisoformat(str(sub.get("start_date"))[:10])
        except Exception:  # noqa: BLE001
            continue
        # Days elapsed on the calendar since start_date, capped at 30.
        days_elapsed_raw = (today_ist - sd).days
        days_elapsed = max(0, min(30, days_elapsed_raw))
        per_day = float(sub.get("per_day_amount") or 0)
        plan_amount = round(float(sub.get("plan_amount") or sub.get("amount_paid") or (per_day * 30)), 2)
        # iter-140.g — spec says every reseed lands on a clean 30-day/60-meal
        # frame. Previously we carried meals_total over which meant an
        # admin-extended plan kept its +10 meals while its wallet was reset
        # to plan_amount → wallet/meals invariant broken.
        meals_total = 60
        # Fresh 30-day frame regardless of the sub's original end_date so
        # reseeding correctly restores exactly 30 days of runway.
        new_end = sd + timedelta(days=30)
        # Charge for days already lived on the calendar.
        deducted = round(per_day * days_elapsed, 2)
        meals_used_after = min(meals_total, days_elapsed * MEALS_PER_DAY)
        new_wallet = round(plan_amount - deducted, 2)
        new_wallet = max(0.0, new_wallet)
        # If we've passed 30 days already, mark expired.
        new_status = "active" if days_elapsed_raw < 30 else "expired"

        users_touched.append({
            "user_id": sub["user_id"],
            "sub_id": sub["sub_id"],
            "start_date": sd.isoformat(),
            "days_elapsed": days_elapsed,
            "plan_amount": plan_amount,
            "wallet_after": new_wallet,
            "meals_used_after": meals_used_after,
            "meals_total": meals_total,
            "status": new_status,
            "end_date": new_end.isoformat(),
        })
        total_deducted += deducted

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "would_reset_users": len(users_touched),
            "would_delete_txns": await db.wallet_transactions.count_documents({}),
            "total_deducted_after_reset": round(total_deducted, 2),
            "sample": users_touched[:5],
        }

    # ---------- APPLY ----------
    # 1. Nuke ledger.
    del_res = await db.wallet_transactions.delete_many({})
    total_txns_deleted = del_res.deleted_count

    # 2. Rewrite each active sub + sync user wallet.
    user_wallet_totals: dict = {}
    for row in users_touched:
        await db.subscriptions.update_one(
            {"sub_id": row["sub_id"]},
            {"$set": {
                "wallet_balance": row["wallet_after"],
                "meals_used": row["meals_used_after"],
                "meals_total": row["meals_total"],
                "paused_days": 0,
                "status": row["status"],
                "end_date": row["end_date"],
                "last_tick_date": cutoff.isoformat(),
                "scan_deducted_dates": {},
                "user_paused": False,
                "zero_wallet_grace_until": None,
                "no_pause_before": None,
            }},
        )
        user_wallet_totals[row["user_id"]] = user_wallet_totals.get(row["user_id"], 0.0) + row["wallet_after"]

    # 3. Users of role='subscriber' with no active sub go to 0 (their
    # residuals from expired plans are no longer honoured — spec).
    # Admins/staff/franchise wallets are untouched.
    async for u in db.users.find(
        {"role": {"$in": ["subscriber", None]}},
        {"_id": 0, "user_id": 1},
    ):
        uid = u["user_id"]
        new_bal = round(user_wallet_totals.get(uid, 0.0), 2)
        await db.users.update_one({"user_id": uid}, {"$set": {"wallet_balance": new_bal}})

    # 4. Two audit rows per reseeded sub:
    #    (a) A `Joining` credit row so the subscriber can see their start
    #        date + plan amount on their wallet timeline. This is what the
    #        admin asked for — a clear "you joined on <date> with ₹X".
    #    (b) A `factory_reset` adjustment row so admins can trace what
    #        happened. `type='adjustment'` + `amount=0` preserves ledger-sum
    #        integrity; opening balance is stored in `balance_after`.
    for row in users_touched:
        sub_doc = await db.subscriptions.find_one(
            {"sub_id": row["sub_id"]},
            {"_id": 0, "plan_name": 1, "service_type": 1},
        )
        plan_name = (sub_doc or {}).get("plan_name") or "30-day plan"
        service_type = (sub_doc or {}).get("service_type") or "dining"
        joining_ts = f"{row['start_date']}T00:00:00+05:30"
        await db.wallet_transactions.insert_one({
            "txn_id": f"wtxn_{uuid.uuid4().hex[:12]}",
            "user_id": row["user_id"],
            "sub_id": row["sub_id"],
            "type": "credit",
            "amount": row["plan_amount"],
            "balance_after": row["plan_amount"],
            "reason": f"Joining · {plan_name} · started {row['start_date']}",
            "created_at": joining_ts,
            "kind": "joining_credit",
            "service_type": service_type,
            "start_date": row["start_date"],
        })
        await db.wallet_transactions.insert_one({
            "txn_id": f"wtxn_{uuid.uuid4().hex[:12]}",
            "user_id": row["user_id"],
            "sub_id": row["sub_id"],
            "type": "adjustment",
            "amount": 0.0,
            "balance_after": row["wallet_after"],
            "reason": f"System reset · reseeded 30-day plan · {row['days_elapsed']} day(s) consumed since {row['start_date']}",
            "created_at": now_utc_iso(),
            "kind": "factory_reset",
            "opening_balance": row["wallet_after"],
            "days_elapsed": row["days_elapsed"],
            "actor_user_id": user.user_id,
        })

    return {
        "ok": True,
        "reset_users": len(users_touched),
        "txns_deleted": total_txns_deleted,
        "total_deducted": round(total_deducted, 2),
        "sample": users_touched[:20],
    }


@api_router.post("/admin/reconcile-double-deduct")
async def admin_reconcile_double_deduct(user: User = Depends(get_current_user), dry_run: bool = False):
    """iter-140.a — one-tap refund tool for the pre-iter-140 double-deduction
    bug on DINING subscriptions.

    The old midnight tick did TWO wrong things:
      (a) On any PAST day with scans, it still charged a full per_day even
          though per-meal scans had already deducted. Over-charge that day =
          scan_charged (extra on top of the correct per_day).
      (b) On the current calendar day (today/future), it fired at 00:00 IST
          and charged a full per_day + 2 meals BEFORE the user had eaten.
          Over-charge that day = the tick's full per_day.

    Correct behaviour under iter-140:
      • past finalized day → total charge = per_day, meals_used += 2
      • today / future     → total charge = scan_charged, meals_used += scan_count

    For each `(user_id, sub_id, date)` we compute over_charge + over_meals,
    subtract what we already refunded, and apply the DELTA. Idempotent on
    re-run and self-healing (an under-refunded row from an earlier run gets
    topped up on the next run).

    Query param `dry_run=true` returns the diff without mutating.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    from collections import defaultdict
    today = ist_today().isoformat()

    # Aggregate every debit row we might be refunding, keyed by (uid, sid, day).
    #   day_charged      — sum of ALL debit amounts touching that date
    #   day_meals_added  — sum of meals each of those rows incremented
    #   scan_count       — # of `Scan · X · <day>` rows (needed for today/future maths)
    #   per_meal_hint    — best guess of that sub's per_meal
    #   already_*        — how much we've refunded so far (for delta idempotency)
    day_charged: dict = defaultdict(float)
    day_meals_added: dict = defaultdict(int)
    scan_count: dict = defaultdict(int)
    per_meal_hint: dict = {}
    already_refund: dict = defaultdict(float)
    already_meals: dict = defaultdict(int)

    async for txn in db.wallet_transactions.find(
        {},
        {"_id": 0, "user_id": 1, "sub_id": 1, "reason": 1, "amount": 1, "type": 1, "kind": 1, "refund_date": 1, "meals_delta": 1},
    ):
        uid = txn.get("user_id")
        sid = txn.get("sub_id")
        if not uid or not sid:
            continue
        reason = txn.get("reason") or ""
        # ---------- Existing refunds (idempotency delta tracking) ----------
        if txn.get("kind") == "double_deduct_refund":
            day = txn.get("refund_date")
            if day:
                already_refund[(uid, sid, day)] += float(txn.get("amount") or 0)
                already_meals[(uid, sid, day)] += int(txn.get("meals_delta") or 0)
            continue
        # ---------- Debits we might be refunding ----------
        if txn.get("type") != "debit":
            continue
        amt = float(txn.get("amount") or 0)
        day = None
        meals_added = 0
        is_scan = False
        if reason.startswith("Scan · "):
            # Scan · <meal> · <date>
            parts = reason.split(" · ")
            if len(parts) >= 3:
                day = parts[2].strip()
                meals_added = 1
                is_scan = True
                per_meal_hint.setdefault((uid, sid, day), amt)
        elif reason.startswith("Daily deduction · "):
            # Legacy pre-iter-140: "Daily deduction · <d> · 2 meals · active"
            # iter-140.a:          "Daily deduction · <d> · lunch missed"
            # iter-140.a:          "Daily deduction · <d> · dinner missed"
            parts = reason.split(" · ")
            if len(parts) >= 2:
                day = parts[1].strip()
                if "2 meals" in reason:
                    meals_added = 2
                elif "missed" in reason:
                    meals_added = 1
                    # iter-140 rows carry per_meal in `amount`
                    per_meal_hint.setdefault((uid, sid, day), amt)
                else:
                    meals_added = 0  # unknown format — count charge but skip meals
        if not day:
            continue
        key = (uid, sid, day)
        day_charged[key] += amt
        day_meals_added[key] += meals_added
        if is_scan:
            scan_count[key] += 1

    candidates: list = []
    for key, buggy_charge in day_charged.items():
        uid, sid, day = key
        buggy_meals = day_meals_added.get(key, 0)
        n_scans = scan_count.get(key, 0)
        per_meal = per_meal_hint.get(key)
        if not per_meal or per_meal <= 0:
            # Fall back: assume 2-meal days at half the day's total charge.
            per_meal = round(buggy_charge / max(1, buggy_meals), 2) if buggy_meals else 0
        if per_meal <= 0:
            continue
        is_future_or_today = (day >= today)
        if is_future_or_today:
            # Correct = only the scans that actually happened.
            correct_charge = round(n_scans * per_meal, 2)
            correct_meals = n_scans
        else:
            # PAST finalized day. Correct = exactly 2 meals of charge
            # regardless of scan/miss split (business rule: skip days 1-3
            # of a no-scan streak still charge normally).
            correct_charge = round(2 * per_meal, 2)
            correct_meals = 2
        over_charge = round(max(0.0, buggy_charge - correct_charge), 2)
        over_meals = max(0, buggy_meals - correct_meals)
        if over_charge <= 0 and over_meals <= 0:
            continue
        # Idempotency: delta over what we already refunded for this day.
        prev_amt = already_refund.get(key, 0.0)
        prev_meals = already_meals.get(key, 0)
        delta_charge = round(max(0.0, over_charge - prev_amt), 2)
        delta_meals = max(0, over_meals - prev_meals)
        if delta_charge <= 0 and delta_meals <= 0:
            continue
        candidates.append({
            "user_id": uid, "sub_id": sid, "day": day,
            "scans": n_scans, "per_meal": round(per_meal, 2),
            "buggy_charge": round(buggy_charge, 2),
            "correct_charge": correct_charge,
            "over_charge": round(over_charge, 2),
            "over_meals": over_meals,
            "already_refunded": round(prev_amt, 2),
            "already_meals_restored": prev_meals,
            "refund": delta_charge,
            "meals_restore": delta_meals,
            "future": is_future_or_today,
        })

    if dry_run:
        return {
            "ok": True, "dry_run": True,
            "candidates": candidates,
            "total": round(sum(c["refund"] for c in candidates), 2),
            "total_meals": sum(c["meals_restore"] for c in candidates),
        }

    # Apply refunds — grouped per (user, sub) so we do one Mongo write per user.
    from collections import defaultdict as _dd
    grouped: dict = _dd(list)
    for c in candidates:
        grouped[(c["user_id"], c["sub_id"])].append(c)

    touched = 0
    total_refund = 0.0
    users_touched: list = []
    for (uid, sid), rows in grouped.items():
        per_user_refund = round(sum(r["refund"] for r in rows), 2)
        if per_user_refund <= 0 and sum(r["meals_restore"] for r in rows) <= 0:
            continue
        u = await db.users.find_one({"user_id": uid}, {"_id": 0, "user_id": 1, "name": 1, "wallet_balance": 1})
        s = await db.subscriptions.find_one({"sub_id": sid}, {"_id": 0, "sub_id": 1, "wallet_balance": 1, "meals_used": 1, "meals_total": 1})
        if not u or not s:
            continue
        user_bal_before = float(u.get("wallet_balance") or 0.0)
        sub_bal_before = float(s.get("wallet_balance") or 0.0)
        # iter-140.f — credit BOTH user AND sub wallet. Every debit format
        # we refund here (concurrency-duplicate ticks, legacy full-day ticks,
        # today/future early ticks) touched both docs. The only legacy case
        # that touched sub-only was the pre-iter-140.a scan drift; in that
        # rare case admins can still use wallet-adjust to trim residual drift.
        sub_bal_after = round(sub_bal_before + per_user_refund, 2)
        user_bal_after = round(user_bal_before + per_user_refund, 2)
        meals_restore_total = sum(r["meals_restore"] for r in rows)
        meals_restore_total = min(meals_restore_total, int(s.get("meals_used") or 0))
        meals_used_after = max(0, int(s.get("meals_used") or 0) - meals_restore_total)

        await db.subscriptions.update_one({"sub_id": sid}, {"$set": {"wallet_balance": sub_bal_after, "meals_used": meals_used_after}})
        if per_user_refund > 0:
            await db.users.update_one({"user_id": uid}, {"$set": {"wallet_balance": user_bal_after}})

        # Ledger row per (day, delta). Write the OWED meals_delta so
        # re-runs don't keep re-listing days where we've done everything we
        # can (meals_used floor at 0 means "no more restoration possible").
        # If a sub later accrues more meals_used via legitimate deductions,
        # those aren't retroactively "double-charged" and shouldn't be
        # restored.
        for r in rows:
            await db.wallet_transactions.insert_one({
                "txn_id": f"wtxn_{uuid.uuid4().hex[:12]}",
                "user_id": uid,
                "sub_id": sid,
                "type": "credit",
                "amount": round(r["refund"], 2),
                "balance_after": user_bal_after,
                "reason": (
                    f"iter-140 refund · early-tick · {r['day']} · +{r['meals_restore']} meal(s)"
                    if r["future"]
                    else f"iter-140 refund · double-deduct · {r['day']} · +{r['meals_restore']} meal(s)"
                ),
                "created_at": now_utc_iso(),
                "kind": "double_deduct_refund",
                "refund_date": r["day"],
                "meals_delta": r["meals_restore"],
                "actor_user_id": user.user_id,
            })
        users_touched.append({
            "user_id": uid,
            "name": u.get("name") or "",
            "sub_id": sid,
            "days": [r["day"] for r in rows],
            "refund": per_user_refund,
            "meals_restored": meals_restore_total,
            "before": {"wallet": user_bal_before, "sub_wallet": sub_bal_before, "meals_used": int(s.get("meals_used") or 0)},
            "after": {"wallet": user_bal_after, "sub_wallet": sub_bal_after, "meals_used": meals_used_after},
        })
        touched += 1
        total_refund += per_user_refund

    return {
        "ok": True,
        "touched": touched,
        "total_refund": round(total_refund, 2),
        "users": users_touched,
    }


@api_router.post("/admin/users/{target_user_id}/wallet-adjust")
async def admin_wallet_adjust(target_user_id: str, payload: WalletAdjustRequest, user: User = Depends(get_current_user)):
    """Admin manually credits or debits a user's wallet.
    - delta > 0  → credit (refund / goodwill / promo).
    - delta < 0  → debit  (correction / chargeback).
    - extend_days  → optionally pushes the active subscription end_date forward.
    - meals_delta  → positive adds meals back, negative deducts meals (e.g. user
      ate an extra meal for a friend and admin needs to count it).
    iter-92 #3: mess_owner can adjust wallets of users in *their* branch only.
    iter-98:   meals_delta now supports BOTH directions; restore_meals kept as alias."""
    if user.role not in ("admin", "mess_owner"):
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
    # iter-106: Block wallet adjustment if the user's profile is incomplete.
    _require_complete_profile(target, "adjusting their wallet")
    if user.role == "mess_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned")
        if target.get("mess_id") != m["mess_id"]:
            raise HTTPException(status_code=403, detail="User not in your branch")

    sub = await db.subscriptions.find_one({"user_id": target_user_id, "status": "active"}, {"_id": 0})
    if not sub and (payload.delta or payload.extend_days or meals_change):
        # Wallet without an active sub — still allow user-level wallet adjust for goodwill credits
        pass

    # iter-104 #1: When the admin only specifies a wallet delta (no explicit
    # extend_days or meals_delta), derive the day/meal change automatically
    # from the active sub's per_day_amount. The intent is: if the admin
    # debits ₹93 at ₹93/day → 1 day + 2 meals leave too; if they credit ₹186
    # → 2 days + 4 meals come back. Admins still have the explicit fields if
    # they want a wallet-only adjustment.
    #
    # iter-105 #1: in auto-derive mode the wallet delta is also SNAPPED to
    # `derived_days * per_day` so the invariant `wallet ≈ meals_left * per_meal`
    # stays true after the operation. Any remainder (e.g. admin typed −₹300 at
    # ₹93/day → 3 days = ₹279) is logged in the audit but not applied to the
    # wallet. Eliminates the historical drift that left wallet ahead of meals.
    auto_derived = {"days": 0, "meals": 0, "snapped_delta": 0.0, "residue": 0.0}
    explicit_extend = int(payload.extend_days or 0)
    if (
        sub
        and abs(float(payload.delta)) >= 0.005
        and explicit_extend == 0
        and meals_change == 0
        and float(sub.get("per_day_amount") or 0) > 0
    ):
        per_day = float(sub["per_day_amount"])
        derived_days = int(round(float(payload.delta) / per_day))
        if derived_days != 0:
            # iter-140.g — DO NOT snap the wallet delta anymore. Admins want
            # the exact rupee amount they typed in the wallet AND the derived
            # meal + day bump (per_day rounded). Previously we snapped to the
            # nearest per-day multiple which left a rupee residue and made
            # audit trails confusing ("added ₹465 but wallet shows ₹466.65").
            explicit_extend = derived_days
            meals_change = derived_days * MEALS_PER_DAY
            auto_derived = {
                "days": derived_days,
                "meals": meals_change,
                # iter-140.g — no snapping. Report the exact typed amount as
                # `applied_delta` and the (worth-of-days − amount) gap in
                # `residue_paisa` so audit reports can see the small
                # under/over-funding admin implicitly accepted.
                "applied_delta": float(payload.delta),
                "residue_paisa": round(derived_days * per_day - float(payload.delta), 2),
            }

    delta = round(float(payload.delta), 2)
    audit = {
        "audit_id": f"adj_{uuid.uuid4().hex[:14]}",
        "ts": iso(now_utc()),
        "admin_user_id": user.user_id,
        "admin_email": user.email,
        "target_user_id": target_user_id,
        "target_email": target.get("email"),
        "delta": delta,
        "extend_days": int(explicit_extend or 0),
        "meals_delta": meals_change,
        # Keep the old key in audit so existing UIs that read `restore_meals` still work.
        "restore_meals": max(0, meals_change),
        # iter-104 #1: surface whether the day/meal change came from the
        # admin directly or was derived from the wallet delta.
        "auto_derived": auto_derived,
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
        if explicit_extend:
            # iter-99: signed extend_days — positive pushes the end_date
            # forward, negative pulls it back. We floor at sub.start_date so
            # admins can't accidentally close a sub before it began.
            # iter-104 #1: `explicit_extend` already incorporates any value
            # derived from a wallet-only adjustment.
            old_end = parse_dt(sub["end_date"])
            start = parse_dt(sub["start_date"]) if sub.get("start_date") else old_end - timedelta(days=30)
            new_end = old_end + timedelta(days=int(explicit_extend))
            if new_end < start:
                new_end = start
            sub_updates["end_date"] = iso(new_end)
        if meals_change:
            # iter-140.g — signed meals_delta. Positive extends the plan by
            # bumping meals_total; negative shrinks the plan by decrementing
            # meals_total (symmetric — a +465 then -465 round-trip lands
            # meals_total exactly back at 60). Hard-floored so meals_total
            # never dips below meals_used.
            current_used = int(sub.get("meals_used", 0))
            current_total = int(sub.get("meals_total", 0))
            new_total = max(current_used, current_total + meals_change)
            sub_updates["meals_total"] = new_total
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
        if int(explicit_extend or 0) > 0:
            bits.append(f"+{int(explicit_extend)} day{'s' if abs(int(explicit_extend))!=1 else ''}")
        elif int(explicit_extend or 0) < 0:
            bits.append(f"{int(explicit_extend)} day{'s' if abs(int(explicit_extend))!=1 else ''}")
        if meals_change > 0:
            bits.append(f"+{meals_change} meal{'s' if meals_change!=1 else ''} restored")
        elif meals_change < 0:
            bits.append(f"{meals_change} meal{'s' if abs(meals_change)!=1 else ''} deducted")
        if auto_derived.get("days"):
            bits.append("auto-balanced")
        if bits:
            await _push_user_notice(
                target_user_id,
                kind="wallet_adjust",
                title="Account updated by admin",
                body=" · ".join(bits) + f" — Reason: {payload.reason.strip()[:200]}",
                meta={
                    "delta": delta,
                    "extend_days": int(explicit_extend or 0),
                    "meals_delta": meals_change,
                    "new_wallet": new_user_wallet,
                    "auto_derived": auto_derived,
                },
            )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[NOTICE] push failed for user={target_user_id}: {e}")

    return {"ok": True, **audit}


@api_router.get("/admin/users/{target_user_id}/wallet-history")
async def admin_wallet_history(target_user_id: str, user: User = Depends(get_current_user)):
    # iter-92 #3: mess_owner can read wallet history of their branch's users.
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if user.role == "mess_owner":
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
# iter-106: Require a complete profile before admin can manually adjust a
# user's wallet or assign a subscription on their behalf. Forces walk-in
# customers (or anyone an admin onboards) to give us the basics first.
# ---------------------------------------------------------------------------
PROFILE_REQUIRED_FIELDS = ("name", "phone", "address")


def _missing_profile_fields(user_doc: dict) -> list:
    out = []
    for f in PROFILE_REQUIRED_FIELDS:
        v = user_doc.get(f)
        if v is None or (isinstance(v, str) and not v.strip()):
            out.append(f)
    return out


def _require_complete_profile(user_doc: dict, action: str) -> None:
    missing = _missing_profile_fields(user_doc)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                f"User's profile is missing: {', '.join(missing)}. "
                f"Ask them to complete their profile (Account → Profile) before {action}. "
                f"Required: {', '.join(PROFILE_REQUIRED_FIELDS)}."
            ),
        )


@api_router.get("/admin/users/{target_user_id}/profile-status")
async def admin_user_profile_status(target_user_id: str, user: User = Depends(get_current_user)):
    """Lightweight check the admin UI can call to disable buttons / show a hint."""
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    missing = _missing_profile_fields(target)
    return {
        "complete": not missing,
        "missing": missing,
        "required": list(PROFILE_REQUIRED_FIELDS),
    }



#     wallet_balance ≈ meals_left × per_meal_price
# holds again. Surfaces historical drift caused by pre-iter-104 admin
# overrides (when wallet could be debited without touching meals).
# ---------------------------------------------------------------------------
class ReconcileSubRequest(BaseModel):
    # Which side is the truth? "wallet" means we recompute meals_left from
    # wallet/per_meal (used when admin charged cash and trusts the wallet).
    # "meals" means we recompute wallet from meals_left × per_meal (used
    # when admin trusts the meal counter and wants to restore the wallet).
    source_of_truth: Literal["wallet", "meals"] = "meals"
    reason: str


@api_router.post("/admin/users/{target_user_id}/reconcile-subscription")
async def admin_reconcile_subscription(
    target_user_id: str,
    payload: ReconcileSubRequest,
    user: User = Depends(get_current_user),
):
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="Reason is required for audit log")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # iter-106: Block reconcile if the user's profile is incomplete — admin
    # shouldn't be touching their numbers until we have basic contact info.
    _require_complete_profile(target, "reconciling their subscription")
    if user.role == "mess_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned")
        if target.get("mess_id") != m["mess_id"]:
            raise HTTPException(status_code=403, detail="User not in your branch")

    sub = await db.subscriptions.find_one({"user_id": target_user_id, "status": "active"}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription to reconcile")

    per_day = float(sub.get("per_day_amount") or 0)
    if per_day <= 0:
        raise HTTPException(status_code=400, detail="Subscription has no per_day_amount — cannot reconcile")
    per_meal = round(per_day / MEALS_PER_DAY, 2)

    meals_total = int(sub.get("meals_total") or 0)
    meals_used_before = int(sub.get("meals_used") or 0)
    meals_left_before = max(0, meals_total - meals_used_before)
    wallet_before = round(float(sub.get("wallet_balance") or 0), 2)
    user_wallet_before = round(float(target.get("wallet_balance") or 0), 2)

    if payload.source_of_truth == "meals":
        # Trust meal counter; recompute wallet = meals_left × per_meal.
        new_wallet = round(meals_left_before * per_meal, 2)
        wallet_delta = round(new_wallet - wallet_before, 2)
        meals_used_after = meals_used_before
        meals_left_after = meals_left_before
    else:
        # Trust wallet; recompute meals_left = wallet // per_meal.
        meals_left_after = int(round(wallet_before / per_meal)) if per_meal > 0 else meals_left_before
        meals_left_after = max(0, min(meals_total, meals_left_after))
        meals_used_after = max(0, meals_total - meals_left_after)
        new_wallet = wallet_before
        wallet_delta = 0.0

    # Apply on the sub
    sub_updates = {"wallet_balance": new_wallet, "meals_used": meals_used_after}
    await db.subscriptions.update_one({"sub_id": sub["sub_id"]}, {"$set": sub_updates})

    # Mirror the wallet shift onto the user-level wallet so the dashboard
    # numbers (which read from users.wallet_balance) stay in sync.
    new_user_wallet = round(user_wallet_before + wallet_delta, 2)
    await db.users.update_one({"user_id": target_user_id}, {"$set": {"wallet_balance": new_user_wallet}})

    if wallet_delta != 0:
        await _log_wallet_txn(
            target_user_id, sub["sub_id"],
            "credit" if wallet_delta > 0 else "debit",
            abs(wallet_delta), new_user_wallet,
            f"Reconcile ({payload.source_of_truth}-truth) · {payload.reason.strip()[:200]} · by {user.email}",
        )

    audit = {
        "audit_id": f"rec_{uuid.uuid4().hex[:14]}",
        "ts": iso(now_utc()),
        "admin_user_id": user.user_id,
        "admin_email": user.email,
        "target_user_id": target_user_id,
        "target_email": target.get("email"),
        "kind": "reconcile_subscription",
        "source_of_truth": payload.source_of_truth,
        "reason": payload.reason.strip()[:500],
        "before": {
            "wallet_balance": wallet_before,
            "meals_used": meals_used_before,
            "meals_left": meals_left_before,
            "user_wallet": user_wallet_before,
        },
        "after": {
            "wallet_balance": new_wallet,
            "meals_used": meals_used_after,
            "meals_left": max(0, meals_total - meals_used_after),
            "user_wallet": new_user_wallet,
        },
        "delta": wallet_delta,
    }
    await db.wallet_overrides.insert_one(audit.copy())
    audit.pop("_id", None)

    try:
        await _push_user_notice(
            target_user_id,
            kind="wallet_adjust",
            title="Your subscription was reconciled",
            body=(
                f"Admin re-synced your wallet and meal counter. "
                f"Wallet ₹{wallet_before:.0f} → ₹{new_wallet:.0f}, "
                f"meals left {meals_left_before} → {max(0, meals_total - meals_used_after)}. "
                f"Reason: {payload.reason.strip()[:200]}"
            ),
            meta={"audit_id": audit["audit_id"], "source_of_truth": payload.source_of_truth},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[NOTICE] reconcile notice push failed for user={target_user_id}: {e}")

    return {"ok": True, "audit": audit, "user_wallet": new_user_wallet}


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
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="reason is required for audit log")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # iter-106: Block manual subscription assignment if the user's profile
    # is incomplete — get their basics on file before we onboard them.
    _require_complete_profile(target, "assigning a subscription")
    if user.role == "mess_owner":
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

    # Cancel/expire existing active sub if requested.
    # iter-131.12: dual-subscription support — a user MAY hold two active subs
    # simultaneously as long as their `service_type` differs (e.g. one tiffin
    # plan + one dining plan). Only clash on same-type existing subs.
    new_service = (payload.service_type or plan.get("service_type") or plan.get("category") or "").lower() or None
    existing = None
    if new_service:
        existing = await db.subscriptions.find_one(
            {"user_id": target_user_id, "status": "active", "service_type": new_service}, {"_id": 0},
        )
    if not existing:
        # fall back to the legacy check for docs that pre-date service_type field
        existing_any = await db.subscriptions.find_one({"user_id": target_user_id, "status": "active"}, {"_id": 0})
        if existing_any and not existing_any.get("service_type"):
            existing = existing_any
    if existing:
        if not payload.replace_active:
            raise HTTPException(status_code=409, detail="User already has an active subscription of this type. Set replace_active=true to override.")
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
        # iter-138.s — when admin manually assigns a back-dated subscription
        # (start_date is in the past, e.g. user has been eating since 3 Aug
        # but admin only records it on 15 Aug), the daily-tick auto-pause
        # logic must NOT kick in for those back-dated days. Otherwise every
        # day the user "didn't scan" (because there was no sub yet!) gets
        # credited as a paused day and the sub extends beyond its natural
        # end_date. We stamp `no_pause_before` with the creation date (IST):
        # the tick treats any date < this as "active" (deduct wallet, no
        # auto-pause). Set to None for present/future starts so normal
        # auto-pause remains active from day 1.
        "no_pause_before": (
            iso(now_utc())
            if (start.date() < now_utc().date())
            else None
        ),
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


# ---------------------------------------------------------------------------
# iter-102: Detect and merge duplicate user accounts.
#
# Before iter-102, `create_or_get_user` looked up by email OR phone but not
# both — so a single human who signed in once with Google (email-only) and
# again with phone OTP (phone-only) ended up with two `users` rows. Admin
# wallet adjustments would land on one row while the user's session resolved
# to the other → the user saw ₹0 while admin saw the topped-up balance.
#
# These endpoints let an admin clean up the historical mess by detecting
# duplicates and merging one row into another (moving every referencing
# document via `user_id` and summing wallet balances).
# ---------------------------------------------------------------------------

# Every collection that stores a `user_id` reference and must be rewritten
# during a merge. `field` is the column we update. Add new collections here
# the moment they start writing user_id refs.
USER_ID_REFS: list[tuple[str, str]] = [
    ("user_sessions", "user_id"),
    ("subscriptions", "user_id"),
    ("wallet_transactions", "user_id"),
    ("wallet_overrides", "target_user_id"),
    ("attendance", "user_id"),
    ("payment_orders", "user_id"),
    ("daily_rosters", "user_id"),
    ("delivery_attempts", "user_id"),
    ("restaurant_orders", "user_id"),
    ("guest_carts", "user_id"),
    ("scan_logs", "user_id"),
    ("tiffin_reminders_sent", "user_id"),
    ("expiry_reminders_sent", "user_id"),
    ("rider_applications", "user_id"),
    ("rider_payouts", "user_id"),
    ("admin_user_notices", "user_id"),
]


@api_router.get("/admin/users/duplicates")
async def admin_list_duplicate_users(user: User = Depends(get_current_user)):
    """Find user docs that share an email or phone with another doc.

    Returns clusters grouped by the shared identifier. Each cluster includes
    every duplicate user along with their wallet/sub counts so the admin can
    decide which to keep as the primary.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    pipeline_email = [
        {"$match": {"email": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$email", "ids": {"$addToSet": "$user_id"}, "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
    ]
    pipeline_phone = [
        {"$match": {"phone": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$phone", "ids": {"$addToSet": "$user_id"}, "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
    ]
    by_email = await db.users.aggregate(pipeline_email).to_list(500)
    by_phone = await db.users.aggregate(pipeline_phone).to_list(500)

    clusters: list[dict] = []
    seen_uid_pairs: set[frozenset] = set()
    for kind, rows in [("email", by_email), ("phone", by_phone)]:
        for row in rows:
            key = frozenset(row["ids"])
            if key in seen_uid_pairs:
                continue
            seen_uid_pairs.add(key)
            users = await db.users.find(
                {"user_id": {"$in": list(row["ids"])}},
                {"_id": 0, "user_id": 1, "email": 1, "phone": 1, "name": 1,
                 "role": 1, "wallet_balance": 1, "created_at": 1},
            ).to_list(50)
            # Enrich with counts so the admin can choose the "richest" as primary
            for u in users:
                u["subs"] = await db.subscriptions.count_documents({"user_id": u["user_id"]})
                u["txns"] = await db.wallet_transactions.count_documents({"user_id": u["user_id"]})
                u["overrides"] = await db.wallet_overrides.count_documents({"target_user_id": u["user_id"]})
                u["attendance"] = await db.attendance.count_documents({"user_id": u["user_id"]})
            users.sort(key=lambda x: (-(x.get("overrides") or 0), -(x.get("subs") or 0), -(x.get("wallet_balance") or 0)))
            clusters.append({"shared_by": kind, "shared_value": row["_id"], "users": users})
    return {"clusters": clusters, "count": len(clusters)}


class MergeUsersRequest(BaseModel):
    duplicate_user_id: str
    reason: str


@api_router.post("/admin/users/{primary_user_id}/merge")
async def admin_merge_users(
    primary_user_id: str,
    payload: MergeUsersRequest,
    user: User = Depends(get_current_user),
):
    """Merge `duplicate_user_id` INTO `primary_user_id`.

    Every collection that references the duplicate's user_id is rewritten to
    point at the primary. Wallet balance is summed. Missing identifiers
    (email/phone/address/photo) on the primary are backfilled from the
    duplicate. The duplicate row itself is then deleted.
    """
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    dup_id = payload.duplicate_user_id
    if dup_id == primary_user_id:
        raise HTTPException(status_code=400, detail="Cannot merge a user into itself")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="Reason is required for audit log")

    primary = await db.users.find_one({"user_id": primary_user_id}, {"_id": 0})
    duplicate = await db.users.find_one({"user_id": dup_id}, {"_id": 0})
    if not primary or not duplicate:
        raise HTTPException(status_code=404, detail="One or both users not found")
    if primary.get("role") in ("admin",) and duplicate.get("role") not in ("admin", "subscriber"):
        # Keep this guard conservative — we don't want a non-admin role
        # (rider, staff, mess_owner) silently absorbed into an admin row.
        raise HTTPException(status_code=400, detail=f"Refusing to merge a `{duplicate.get('role')}` into an admin")

    # Move every reference
    rewrites: dict = {}
    for coll_name, field in USER_ID_REFS:
        try:
            res = await db[coll_name].update_many({field: dup_id}, {"$set": {field: primary_user_id}})
            rewrites[coll_name] = res.modified_count
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[USER MERGE] rewrite {coll_name}.{field} failed dup={dup_id} primary={primary_user_id}: {e}")
            rewrites[coll_name] = -1

    # Sum wallets + backfill missing identifiers on primary
    new_wallet = round(float(primary.get("wallet_balance") or 0) + float(duplicate.get("wallet_balance") or 0), 2)
    user_updates: dict = {"wallet_balance": new_wallet}
    for field in ("email", "phone", "address", "photo_url", "picture", "lat", "lng", "mess_id"):
        if not primary.get(field) and duplicate.get(field):
            user_updates[field] = duplicate.get(field)
    await db.users.update_one({"user_id": primary_user_id}, {"$set": user_updates})

    # Delete the duplicate row (don't touch its data — every reference now
    # points at primary, so deleting the row is safe).
    await db.users.delete_one({"user_id": dup_id})

    # Audit + notice
    audit = {
        "audit_id": f"mrg_{uuid.uuid4().hex[:14]}",
        "ts": iso(now_utc()),
        "admin_user_id": user.user_id,
        "admin_email": user.email,
        "primary_user_id": primary_user_id,
        "duplicate_user_id": dup_id,
        "duplicate_email": duplicate.get("email"),
        "duplicate_phone": duplicate.get("phone"),
        "new_wallet": new_wallet,
        "backfilled_fields": [k for k in user_updates if k != "wallet_balance"],
        "rewrites": rewrites,
        "reason": payload.reason.strip()[:500],
        "kind": "merge_users",
    }
    await db.wallet_overrides.insert_one(audit.copy())
    audit.pop("_id", None)
    try:
        await _push_user_notice(
            primary_user_id,
            kind="account_merged",
            title="Duplicate account merged",
            body=(
                f"An admin merged a duplicate {('email' if duplicate.get('email') else 'phone')} record "
                f"into your account. Your wallet now shows ₹{new_wallet:.0f} (sum of both balances), and "
                f"all past subscriptions / transactions are now on this account."
            ),
            meta={"primary": primary_user_id, "merged_from": dup_id, "new_wallet": new_wallet},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[NOTICE] merge notice push failed for primary={primary_user_id}: {e}")
    logger.info(f"[USER MERGE] dup={dup_id} → primary={primary_user_id} wallet=₹{new_wallet} by={user.email} rewrites={rewrites}")
    return {"ok": True, "audit": audit}


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
    """User-initiated account deletion.

    iter-107: split into a fast foreground step (kill sessions + delete the
    users row so the user is *logically* gone immediately, and Cloudflare
    can't time out on a slow 16-collection cascade) and a background purge
    that mops up the references. Returns 200 in well under a second even
    for users with years of attendance / transaction history.
    """
    if user.role == "admin":
        # Prevent the only admin from accidentally locking themselves out
        admin_count = await db.users.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="You're the only admin. Promote another user before deleting your account.")

    user_id = user.user_id
    phone = user.phone or "__none__"
    foreground_counts = {}
    try:
        # 1) Drop ALL sessions for this user so the auth token used by THIS
        # request is invalidated immediately. Any in-flight calls 401 from here on.
        foreground_counts["user_sessions"] = (await db.user_sessions.delete_many({"user_id": user_id})).deleted_count
        # 2) Delete the user row itself. This is the only step that affects
        # whether the user can still log in / be looked up.
        foreground_counts["users"] = (await db.users.delete_one({"user_id": user_id})).deleted_count
    except Exception as e:  # noqa: BLE001
        logger.error(f"[USER DELETE] foreground step failed for user={user_id}: {e}")
        # If we couldn't drop the user row, fall back to the full synchronous
        # purge so the response is at least diagnosable.
        res = await _purge_user(user_id)
        return {"ok": True, "mode": "sync_fallback", **res}

    # 3) Cascade the rest in the background — by the time this finishes, the
    # user is already gone from the auth path so even a slow cascade is fine.
    asyncio.create_task(_purge_user_references_bg(user_id, phone))

    logger.info(f"[USER DELETE] foreground done for user={user_id} email={user.email} (cascade scheduled)")
    return {"ok": True, "mode": "async_cascade", "deleted": foreground_counts.get("users", 0) > 0, "counts": foreground_counts}


async def _purge_user_references_bg(user_id: str, phone: str) -> None:
    """iter-107: background cleanup of every collection that may reference
    the user. Runs after `delete_my_account` has already returned 200 to the
    client — its only job is to keep the DB tidy."""
    try:
        targets = [
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
        counts = {}
        for coll_name, query in targets:
            try:
                res = await db[coll_name].delete_many(query)
                counts[coll_name] = res.deleted_count
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[USER DELETE BG] cascade {coll_name} failed for user={user_id}: {e}")
                counts[coll_name] = -1
        logger.info(f"[USER DELETE BG] user={user_id} cascade done → {counts}")
    except Exception as e:  # noqa: BLE001
        logger.error(f"[USER DELETE BG] unhandled error for user={user_id}: {e}")


@api_router.post("/admin/cron/run-tick")
async def admin_run_tick(user: User = Depends(get_current_user)):
    """Manually run subscription tick across all active subs. Useful for testing 3-day inactivity logic."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await run_subscription_tick()
    return {"ok": True, **result}


# ---------------------------------------------------------------------------
# iter-107 #2: Surface subscriptions that are about to expire so admin can
# call those users and nudge them to renew. Lives on the Admin Dashboard.
# ---------------------------------------------------------------------------
@api_router.get("/admin/expiring-subscriptions")
async def admin_expiring_subscriptions(
    within_days: int = 3,
    user: User = Depends(get_current_user),
):
    """Return active subs whose `end_date` is within the next `within_days`
    days (default 3). Includes the user's name + phone so admin can dial
    them directly. Franchise owners are scoped to their branch.
    """
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    within_days = max(0, min(int(within_days or 3), 30))
    cutoff = iso(now_utc() + timedelta(days=within_days))

    sub_query: dict = {
        "status": "active",
        "end_date": {"$lte": cutoff},
    }
    # Branch-scope for franchise owners
    user_ids_in_branch = None
    if user.role == "mess_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            return {"subscriptions": [], "count": 0, "within_days": within_days}
        users_in_branch = await db.users.find(
            {"mess_id": m["mess_id"]}, {"_id": 0, "user_id": 1},
        ).to_list(10000)
        user_ids_in_branch = [u["user_id"] for u in users_in_branch]
        sub_query["user_id"] = {"$in": user_ids_in_branch}

    subs = await db.subscriptions.find(sub_query, {"_id": 0}).sort("end_date", 1).to_list(500)
    if not subs:
        return {"subscriptions": [], "count": 0, "within_days": within_days}

    # Hydrate with user contact info in one round-trip
    sub_user_ids = list({s["user_id"] for s in subs})
    users = await db.users.find(
        {"user_id": {"$in": sub_user_ids}},
        {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "email": 1, "address": 1, "mess_id": 1},
    ).to_list(1000)
    by_uid = {u["user_id"]: u for u in users}

    now = now_utc()
    out = []
    for s in subs:
        u = by_uid.get(s["user_id"]) or {}
        end = parse_dt(s["end_date"])
        days_left = max(0, (end.date() - now.date()).days)
        out.append({
            "sub_id": s["sub_id"],
            "user_id": s["user_id"],
            "name": u.get("name") or "—",
            "phone": u.get("phone"),
            "email": u.get("email"),
            "address": u.get("address"),
            "mess_id": u.get("mess_id"),
            "plan_id": s.get("plan_id"),
            "plan_name": s.get("plan_name") or s.get("plan_id"),
            "end_date": s["end_date"],
            "days_left": days_left,
            "wallet_balance": float(s.get("wallet_balance") or 0),
            "meals_left": max(0, int(s.get("meals_total") or 0) - int(s.get("meals_used") or 0)),
            "service_type": s.get("service_type") or "dining",
        })
    return {"subscriptions": out, "count": len(out), "within_days": within_days}


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


# ---------------------------
# iter-138.p — WhatsApp holiday broadcast (one-tap wa.me deep-link)
# ---------------------------
@api_router.get("/admin/broadcast/audience")
async def admin_broadcast_audience(
    category: str = "all",
    user: User = Depends(get_current_user),
):
    """Return the phone-book of currently-active subscribers so the admin
    can pick who receives a WhatsApp holiday broadcast.

    Query:
      category = "all" | "tiffin" | "dining" | "both"

    Response rows:
      { user_id, name, phone, categories: ["tiffin"|"dining"], plan_name, end_date }

    Franchise owners are scoped to their branch. Users without a phone
    number are skipped since wa.me requires one.
    """
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")

    sub_query: dict = {"status": "active"}
    if user.role == "mess_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            return {"users": [], "count": 0}
        users_in_branch = await db.users.find({"mess_id": m["mess_id"]}, {"_id": 0, "user_id": 1}).to_list(10000)
        sub_query["user_id"] = {"$in": [u["user_id"] for u in users_in_branch]}

    subs = await db.subscriptions.find(sub_query, {"_id": 0}).to_list(5000)
    if not subs:
        return {"users": [], "count": 0}

    # Group service_type per user (a user can have BOTH a tiffin and a dining sub).
    cats_by_uid: dict = {}
    plan_by_uid: dict = {}
    end_by_uid: dict = {}
    for s in subs:
        uid = s.get("user_id")
        if not uid:
            continue
        st = (s.get("service_type") or "dining").lower()
        if st not in ("tiffin", "dining"):
            st = "dining"
        cats_by_uid.setdefault(uid, set()).add(st)
        plan_by_uid[uid] = s.get("plan_name") or s.get("plan_id") or ""
        end_by_uid[uid] = s.get("end_date") or ""

    uids = list(cats_by_uid.keys())
    users_docs = await db.users.find(
        {"user_id": {"$in": uids}},
        {"_id": 0, "user_id": 1, "name": 1, "phone": 1},
    ).to_list(5000)

    out = []
    cat_lower = (category or "all").lower()
    for u in users_docs:
        phone = str(u.get("phone") or "").strip()
        if not phone:
            continue
        cats = sorted(cats_by_uid.get(u["user_id"], set()))
        if cat_lower == "tiffin" and "tiffin" not in cats:
            continue
        if cat_lower == "dining" and "dining" not in cats:
            continue
        if cat_lower == "both" and not ("tiffin" in cats and "dining" in cats):
            continue
        out.append({
            "user_id": u["user_id"],
            "name": u.get("name") or "Guest",
            "phone": phone,
            "categories": cats,
            "plan_name": plan_by_uid.get(u["user_id"], ""),
            "end_date": end_by_uid.get(u["user_id"], ""),
        })
    out.sort(key=lambda r: (r["name"] or "").lower())
    return {"users": out, "count": len(out)}


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
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin or mess owner only")
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
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin or mess owner only")
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
    today = ist_today()   # iter-126: IST-aware day boundary
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
    if user.role not in ("admin", "staff", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin or staff only")


# iter-95: unified branch scoping for ALL operational endpoints.
# Returns the mess_id whose data should be served for the current request:
#   • mess_owner → their assigned mess (cannot be overridden)
#   • admin / staff   → `as_mess_id` query param (None = HQ-global)
#   • other           → 403
async def effective_mess_id(user: User, as_mess_id: Optional[str] = None) -> Optional[str]:
    if user.role == "mess_owner":
        m = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        if not m:
            raise HTTPException(status_code=403, detail="No mess assigned")
        return m["mess_id"]
    if user.role in ("admin", "staff"):
        if as_mess_id:
            exists = await db.messes.find_one({"mess_id": as_mess_id}, {"_id": 0, "mess_id": 1})
            if not exists:
                raise HTTPException(status_code=404, detail=f"Unknown mess: {as_mess_id}")
            return as_mess_id
        # iter-158o: for admin, honor active impersonation session so scoped
        # writes/reads target the impersonated mess (was returning None →
        # global scope, breaking manual takeaway pendency + list scoping).
        if user.role == "admin":
            s = await db.user_sessions.find_one(
                {"user_id": user.user_id, "impersonate_mess_id": {"$exists": True}},
                {"_id": 0, "impersonate_mess_id": 1},
            )
            if s and s.get("impersonate_mess_id"):
                return s["impersonate_mess_id"]
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
    if user.role not in ("admin", "staff", "mess_owner"):
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
    if user.role not in ("admin", "staff", "mess_owner"):
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
    if user.role not in ("admin", "mess_owner"):
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
            "pref_start": r.get("pref_start"),
            "pref_end": r.get("pref_end"),
            "delivered_late": bool(r.get("delivered_late")),
            "delivered_late_by": int(r.get("delivered_late_by") or 0),
        })

    def _bucket(meal: str, size: str):
        return [x for x in rows if x["meal_type"] == meal and x["tiffin_size"] == size]

    counts = {
        "lunch": {
            "full": len(_bucket("lunch", "full")),
            "half": len(_bucket("lunch", "half")),
            "delivered": sum(1 for x in rows if x["meal_type"] == "lunch" and x["status"] == "delivered"),
            "delivered_late": sum(1 for x in rows if x["meal_type"] == "lunch" and x.get("delivered_late")),
            "no_pref": sum(1 for x in rows if x["meal_type"] == "lunch" and not x.get("pref_start")),
        },
        "dinner": {
            "full": len(_bucket("dinner", "full")),
            "half": len(_bucket("dinner", "half")),
            "delivered": sum(1 for x in rows if x["meal_type"] == "dinner" and x["status"] == "delivered"),
            "delivered_late": sum(1 for x in rows if x["meal_type"] == "dinner" and x.get("delivered_late")),
            "no_pref": sum(1 for x in rows if x["meal_type"] == "dinner" and not x.get("pref_start")),
        },
        "total_lunch": sum(1 for x in rows if x["meal_type"] == "lunch"),
        "total_dinner": sum(1 for x in rows if x["meal_type"] == "dinner"),
        "outstanding_empties": sum(x["tiffin_balance"] for x in rows),
    }

    return {"date": d, "rows": rows, "counts": counts}


# ---------------------------
# Staff dispatch console — /staff/dispatch route + fastest-route map
# iter-131.15: standalone dispatch UI for staff (also usable by admin/mess_owner).
# Wraps the delivery sub-router's roster+ready flows behind an admin-or-staff gate.
# ---------------------------
@api_router.get("/staff/dispatch/today")
async def staff_dispatch_today(user: User = Depends(get_current_user)):
    """Today's dispatch console — ready stats, kitchen coords, stop list with GPS pins."""
    from delivery.shared import _load_settings_db, MEALS
    from delivery.admin_roster import generate_roster_for_date
    _admin_or_staff(user)
    d = today_str()
    cnt = await db.daily_rosters.count_documents({"date": d})
    if cnt == 0:
        await generate_roster_for_date(db, d)
    items = await db.daily_rosters.find({"date": d}, {"_id": 0, "otp": 0}).to_list(20000)
    user_ids = list({i["user_id"] for i in items})
    users = {u["user_id"]: u async for u in db.users.find(
        {"user_id": {"$in": user_ids}},
        {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "address": 1, "pincode": 1, "lat": 1, "lng": 1, "tiffin_balance": 1},
    )}
    for it in items:
        u = users.get(it["user_id"]) or {}
        it["customer_lat"] = u.get("lat")
        it["customer_lng"] = u.get("lng")
        it["tiffin_balance"] = int(u.get("tiffin_balance") or 0)
    settings = await _load_settings_db(db)
    boys = await db.delivery_boys.find({"active": {"$ne": False}}, {"_id": 0}).to_list(500)

    def _stats(meal: str) -> dict:
        meal_items = [i for i in items if i["meal_type"] == meal]
        ready = sum(1 for i in meal_items if i["status"] in ("ready", "out", "delivered"))
        out_or_delivered = sum(1 for i in meal_items if i["status"] in ("out", "delivered"))
        return {
            "total": len(meal_items),
            "ready": ready,
            "pending": max(0, len(meal_items) - ready),
            "out_or_delivered": out_or_delivered,
        }

    return {
        "date": d,
        "items": items,
        "ready_stats": {m: _stats(m) for m in MEALS},
        "late_stats": {
            "delivered_late_lunch": sum(1 for i in items if i["meal_type"] == "lunch" and i.get("delivered_late")),
            "delivered_late_dinner": sum(1 for i in items if i["meal_type"] == "dinner" and i.get("delivered_late")),
            "no_pref_lunch": sum(1 for i in items if i["meal_type"] == "lunch" and not i.get("pref_start")),
            "no_pref_dinner": sum(1 for i in items if i["meal_type"] == "dinner" and not i.get("pref_start")),
        },
        "dispatch": {
            "lat": settings.get("dispatch_lat"),
            "lng": settings.get("dispatch_lng"),
            "radius_km": settings.get("dispatch_radius_km") or 15,
        },
        "boys": boys,
    }


@api_router.post("/staff/dispatch/batch-ready")
async def staff_dispatch_batch_ready(payload: dict = Body(...), user: User = Depends(get_current_user)):
    """Flip every planned tiffin for a meal → ready. Staff-safe entry to the admin batch-ready."""
    from delivery.shared import MEALS
    _admin_or_staff(user)
    d = str(payload.get("date") or today_str())
    meal = str(payload.get("meal_type") or "").lower()
    if meal not in MEALS:
        raise HTTPException(status_code=400, detail="meal_type must be lunch|dinner")
    r = await db.daily_rosters.update_many(
        {"date": d, "meal_type": meal, "status": {"$in": ["planned"]}},
        {"$set": {
            "status": "ready",
            "ready_by": user.user_id,
            "ready_at": now_utc_iso(),
        }},
    )
    return {"date": d, "meal_type": meal, "marked": r.modified_count}


@api_router.post("/staff/dispatch/roster/{roster_id}/ready")
async def staff_dispatch_toggle_ready(
    roster_id: str,
    payload: dict | None = Body(default=None),
    user: User = Depends(get_current_user),
):
    """Toggle a single tiffin's ready state — kitchen staff can flip items one at a time."""
    _admin_or_staff(user)
    want_ready = True if payload is None else bool((payload or {}).get("ready", True))
    item = await db.daily_rosters.find_one({"roster_id": roster_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Roster item not found")
    if item["status"] not in ("planned", "ready"):
        raise HTTPException(status_code=400, detail=f"Cannot toggle ready on item with status={item['status']}")
    new_status = "ready" if want_ready else "planned"
    upd = {"status": new_status}
    if want_ready:
        upd["ready_by"] = user.user_id
        upd["ready_at"] = now_utc_iso()
    else:
        upd["ready_by"] = None
        upd["ready_at"] = None
    await db.daily_rosters.update_one({"roster_id": roster_id}, {"$set": upd})
    return {"roster_id": roster_id, **upd}


# iter-131.15: friendly alias for /boy/location so the mobile PWA can post
# GPS pings to a memorable `/api/delivery-boy/ping` endpoint. Delegates to
# the existing boy router logic (validates coords + updates delivery_boys).
class _DeliveryBoyPing(BaseModel):
    lat: float
    lng: float
    accuracy: float | None = None


@api_router.post("/delivery-boy/ping")
async def delivery_boy_ping(payload: _DeliveryBoyPing = Body(...), user: User = Depends(get_current_user)):
    """Alias for /api/boy/location — used by delivery-boy PWA to post live GPS every 30 s."""
    boy = await db.delivery_boys.find_one({"user_id": user.user_id}, {"_id": 0})
    if not boy:
        raise HTTPException(status_code=403, detail="Not registered as a delivery boy")
    if not (-90 <= payload.lat <= 90) or not (-180 <= payload.lng <= 180):
        raise HTTPException(status_code=400, detail="Invalid GPS coordinates")
    await db.delivery_boys.update_one(
        {"boy_id": boy["boy_id"]},
        {"$set": {
            "current_lat": float(payload.lat),
            "current_lng": float(payload.lng),
            "current_accuracy": float(payload.accuracy or 0),
            "last_ping_at": now_utc_iso(),
        }},
    )
    return {"ok": True, "boy_id": boy["boy_id"]}


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
from routes.branding import router as _branding_router
from routes.auth_google import router as _auth_google_router
from routes.testimonials import router as _testimonials_router
from routes.plans import router as _plans_router
from routes.mess_owner import router as _mess_owner_router
from routes.kiosk_cms import router as _kiosk_cms_router
from routes.subscription_tabs import router as _subscription_tabs_router
from routes.active_tiffin_details import router as _active_tiffin_router
from routes.mess_reviews import router as _mess_reviews_router
from routes.impersonate_billing import router as _imp_bill_router
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
api_router.include_router(_branding_router)
api_router.include_router(_testimonials_router)
api_router.include_router(_plans_router)
api_router.include_router(_mess_owner_router)
api_router.include_router(_kiosk_cms_router)
api_router.include_router(_subscription_tabs_router)
api_router.include_router(_active_tiffin_router)
api_router.include_router(_mess_reviews_router)
api_router.include_router(_imp_bill_router)
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
    # iter-158d — one-shot idempotent role rename: franchise_owner → mess_owner.
    # eFoodTech has no franchise concept; every mess is independently owned.
    try:
        r = await db.users.update_many({"role": "franchise_owner"}, {"$set": {"role": "mess_owner"}})
        if r.modified_count:
            logger.info(f"[ROLE MIGRATION] renamed {r.modified_count} users: franchise_owner → mess_owner")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[ROLE MIGRATION] failed: {e}")
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
    # iter-140.k — auto-backfill joining_credit ledger rows for any active
    # sub still missing one. Runs on every boot (idempotent). Users don't
    # have to open their wallet page to trigger the lazy backfill anymore.
    try:
        added = 0
        async for sub in db.subscriptions.find(
            {"status": "active"},
            {"_id": 0, "sub_id": 1, "user_id": 1, "start_date": 1,
             "plan_amount": 1, "amount_paid": 1, "per_day_amount": 1,
             "plan_name": 1, "service_type": 1},
        ):
            sid = sub.get("sub_id"); uid = sub.get("user_id")
            if not sid or not uid:
                continue
            already = await db.wallet_transactions.find_one(
                {"sub_id": sid, "kind": "joining_credit"}, {"_id": 0, "txn_id": 1},
            )
            if already:
                continue
            start_str = str(sub.get("start_date") or "")[:10]
            if not start_str:
                continue
            plan_amount = float(
                sub.get("plan_amount") or sub.get("amount_paid")
                or (float(sub.get("per_day_amount") or 0) * 30)
            )
            plan_name = sub.get("plan_name") or "30-day plan"
            service_type = sub.get("service_type") or "dining"
            await db.wallet_transactions.insert_one({
                "txn_id": f"wtxn_{uuid.uuid4().hex[:12]}",
                "user_id": uid, "sub_id": sid,
                "type": "credit", "amount": round(plan_amount, 2),
                "balance_after": round(plan_amount, 2),
                "reason": f"Joining · {plan_name} · started {start_str}",
                "created_at": f"{start_str}T00:00:00+05:30",
                "kind": "joining_credit",
                "service_type": service_type, "start_date": start_str,
            })
            added += 1
        if added > 0:
            logger.info(f"[STARTUP] joining-credit backfill · added {added} row(s)")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[STARTUP] joining-credit backfill failed: {e}")




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
    if user.role not in ("admin", "staff", "mess_owner"):
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
    # iter-92 #3: mess_owner can approve/decline refunds for their branch.
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    if payload.decision not in {"approve", "decline"}:
        raise HTTPException(status_code=400, detail="decision must be approve | decline")
    doc = await db.refund_requests.find_one({"refund_id": refund_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Refund not found")
    if user.role == "mess_owner":
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
# iter-158e: expanded catalog — mess owner now gets full admin rights over
# THEIR OWN mess (content, design, ops), gated per-mess by this whitelist.
FRANCHISE_PAGES = [
    # --- Overview ---
    {"key": "/admin",                       "label": "Dashboard"},
    {"key": "/admin/control-tower",         "label": "Control Tower"},
    {"key": "/admin/plans",                 "label": "Plans"},
    {"key": "/admin/users",                 "label": "Users & Roles"},
    {"key": "/admin/rider-applications",    "label": "Rider applications"},
    {"key": "/admin/restaurant-tracking",   "label": "Restaurant tracking"},
    {"key": "/admin/restaurant-takeaway",   "label": "Take-away tiffins"},
    {"key": "/admin/restaurant-theme",      "label": "Restaurant page editor"},
    {"key": "/admin/branding",              "label": "Brand logo"},
    # --- Operations ---
    {"key": "/admin/deliveries-today",      "label": "Today's deliveries"},
    {"key": "/admin/raw-materials",         "label": "Raw materials"},
    {"key": "/admin/tiffin-stock",          "label": "Tiffin stock"},
    {"key": "/admin/cash-collections",      "label": "Cash collections"},
    {"key": "/admin/cash-analytics",        "label": "Cash analytics"},
    {"key": "/admin/partial-payments",      "label": "Partial payments"},
    {"key": "/admin/kitchen-radius",        "label": "My kitchen & radius"},
    {"key": "/admin/pnl",                   "label": "Profit & loss"},
    {"key": "/admin/restaurant",            "label": "Restaurant menu"},
    {"key": "/admin/restaurant-orders",     "label": "Restaurant orders"},
    {"key": "/admin/restaurant-hours",      "label": "Restaurant hours / capacity"},
    {"key": "/admin/meal-slots",            "label": "Meal slot windows"},
    {"key": "/admin/wallet-topup",          "label": "Manual wallet top-up"},
    {"key": "/admin/whatsapp",              "label": "WhatsApp outbox"},
    {"key": "/admin/broadcast",             "label": "WhatsApp broadcast"},
    {"key": "/admin/delivery",              "label": "Tiffin delivery"},
    {"key": "/admin/live",                  "label": "Live tracking"},
    {"key": "/admin/scanner",               "label": "QR Scanner"},
    {"key": "/admin/kiosk",                 "label": "Wall Kiosk"},
    {"key": "/admin/voice-settings",        "label": "Kiosk voice"},
    {"key": "/admin/kiosk-cms",             "label": "Kiosk copy & voice"},
    {"key": "/admin/face-enroll",           "label": "Face enrol batch"},
    {"key": "/admin/counter",               "label": "Counter QR"},
    {"key": "/admin/menu",                  "label": "Daily Menu"},
    {"key": "/admin/mess-menu",             "label": "Mess Menu Calendar"},
    # --- Content & design ---
    {"key": "/admin/landing",               "label": "Home page"},
    {"key": "/admin/dashboard-editor",      "label": "Subscriber dashboard"},
    {"key": "/admin/bottom-nav",            "label": "Bottom nav & sound"},
    {"key": "/admin/my-bottom-nav",         "label": "My subscriber tabs"},
    {"key": "/admin/header-menu",           "label": "Hamburger menu"},
    {"key": "/admin/testimonials",          "label": "Testimonials"},
    {"key": "/admin/tiffin-preferences",    "label": "Tiffin food preferences"},
    {"key": "/admin/content/announcement",  "label": "Announcement bar"},
    {"key": "/admin/content/login",         "label": "Login page"},
    {"key": "/admin/content/about",         "label": "About us page"},
    {"key": "/admin/content/privacy",       "label": "Privacy Policy"},
    {"key": "/admin/content/refund",        "label": "Refund Policy"},
    {"key": "/admin/content/contact",       "label": "Contact Us"},
    {"key": "/admin/content/footer",        "label": "Footer"},
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
    if user.role not in ("mess_owner", "admin"):
        raise HTTPException(status_code=403, detail="Franchise portal only")
    if user.role == "admin":
        return {"mess": None, "scope": "global"}
    mess = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0})
    if not mess:
        raise HTTPException(status_code=403, detail="No mess assigned")
    return {"mess": mess, "scope": "branch"}


@api_router.get("/franchise/me/visible-sections")
async def franchise_my_visible_sections(user: User = Depends(get_current_user)):
    if user.role not in ("mess_owner", "admin"):
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

# iter-158i: subscriber bottom-nav slot catalog (per-mess toggle). Super-admin
# picks which of these appear in the subscriber bottom-nav for each mess.
BOTTOM_NAV_SLOT_KEYS = ["home", "nearby", "dashboard", "scan", "restaurant", "orders", "subscribe", "profile", "contact"]
BOTTOM_NAV_SLOTS = [
    {"key": "home",       "label": "Home"},
    {"key": "nearby",     "label": "Nearby messes"},
    {"key": "dashboard",  "label": "Dashboard"},
    {"key": "scan",       "label": "Scan & eat"},
    {"key": "restaurant", "label": "Restaurant menu"},
    {"key": "orders",     "label": "My orders"},
    {"key": "subscribe",  "label": "Subscribe"},
    {"key": "profile",    "label": "Profile"},
    {"key": "contact",    "label": "Contact"},
]


class BottomNavSlotsIn(BaseModel):
    slots: List[str] = Field(default_factory=list)


@api_router.get("/admin/bottom-nav/slot-catalog")
async def bottom_nav_slot_catalog(user: User = Depends(get_current_user)):
    # iter-168: mess owners may read the slot catalog to build their own
    # per-mess subscriber-tab editor.
    if user.role not in ("admin", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin only")
    return {"slots": BOTTOM_NAV_SLOTS}


@api_router.get("/admin/messes/{mess_id}/bottom-nav-slots")
async def admin_get_bottom_nav_slots(mess_id: str, user: User = Depends(get_current_user)):
    # iter-168: mess owners may read their own mess's slot whitelist. Accept
    # EITHER of two links: (a) their user.mess_id, (b) messes.owner_user_id
    # → their user_id. Seed-time drift left some rows with only one of these
    # set, so we honor both.
    if user.role == "mess_owner":
        owned = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        owned_mid = (owned or {}).get("mess_id")
        if mess_id not in {user.mess_id, owned_mid}:
            raise HTTPException(status_code=403, detail="Not your mess")
    elif user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    mess = await db.messes.find_one(
        {"mess_id": mess_id}, {"_id": 0, "mess_id": 1, "bottom_nav_slots": 1}
    )
    if mess is None:
        raise HTTPException(status_code=404, detail="Mess not found")
    slots = mess.get("bottom_nav_slots")
    if slots is None:
        slots = [s["key"] for s in BOTTOM_NAV_SLOTS]
    return {"slots": slots, "catalog": BOTTOM_NAV_SLOTS}


@api_router.patch("/admin/messes/{mess_id}/bottom-nav-slots")
async def admin_set_bottom_nav_slots(mess_id: str, payload: BottomNavSlotsIn, user: User = Depends(get_current_user)):
    # iter-168: mess owners may PATCH their own mess's whitelist. Accepts
    # either user.mess_id or the mess where owner_user_id=user.user_id (see
    # admin_get_bottom_nav_slots for rationale).
    if user.role == "mess_owner":
        owned = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
        owned_mid = (owned or {}).get("mess_id")
        if mess_id not in {user.mess_id, owned_mid}:
            raise HTTPException(status_code=403, detail="Not your mess")
    elif user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    invalid = [s for s in payload.slots if s not in BOTTOM_NAV_SLOT_KEYS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown slots: {invalid}")
    res = await db.messes.update_one(
        {"mess_id": mess_id},
        {"$set": {"bottom_nav_slots": payload.slots, "updated_at": iso(now_utc())}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mess not found")
    return {"ok": True, "slots": payload.slots}


@api_router.get("/franchise/me/bottom-nav-slots")
async def franchise_my_bottom_nav_slots(user: User = Depends(get_current_user)):
    """Public-ish: subscriber's mess bottom-nav slot list. Falls back to full catalog."""
    target_mess_id = None
    if user.role == "admin":
        s = await db.user_sessions.find_one(
            {"user_id": user.user_id, "impersonate_mess_id": {"$exists": True}},
            {"_id": 0, "impersonate_mess_id": 1},
        )
        target_mess_id = (s or {}).get("impersonate_mess_id")
    else:
        target_mess_id = user.mess_id
    if not target_mess_id:
        return {"slots": [s["key"] for s in BOTTOM_NAV_SLOTS]}
    mess = await db.messes.find_one({"mess_id": target_mess_id}, {"_id": 0, "bottom_nav_slots": 1})
    slots = (mess or {}).get("bottom_nav_slots")
    if slots is None:
        slots = [s["key"] for s in BOTTOM_NAV_SLOTS]
    return {"slots": slots}


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
    # iter-158i: use projection {mess_id:1, franchise_visible_pages:1} so we
    # can distinguish "doc missing" (None) from "doc present but field never
    # set" (returns {} → falsy). Previously `if not mess` mis-flagged legacy
    # messes as 404.
    mess = await db.messes.find_one(
        {"mess_id": mess_id}, {"_id": 0, "mess_id": 1, "franchise_visible_pages": 1}
    )
    if mess is None:
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
    """Franchise/mess owner reads the page list they're allowed to see in
    the admin nav. iter-158g: when a super-admin is impersonating a mess,
    return THAT mess's whitelist (so the sidebar reflects what the owner
    would see). Only unimpersonated super-admins get the full catalog."""
    if user.role not in ("mess_owner", "admin"):
        raise HTTPException(status_code=403, detail="Franchise portal only")
    target_mess_id = None
    if user.role == "admin":
        s = await db.user_sessions.find_one(
            {"user_id": user.user_id, "impersonate_mess_id": {"$exists": True}},
            {"_id": 0, "impersonate_mess_id": 1},
        )
        if s and s.get("impersonate_mess_id"):
            target_mess_id = s["impersonate_mess_id"]
        else:
            return {"visible_pages": [p["key"] for p in FRANCHISE_PAGES]}
    if not target_mess_id:  # role == mess_owner
        mess = await db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1, "franchise_visible_pages": 1})
    else:
        mess = await db.messes.find_one({"mess_id": target_mess_id}, {"_id": 0, "franchise_visible_pages": 1})
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
