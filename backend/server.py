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

OTP_DEV_MODE = os.environ.get("OTP_DEV_MODE", "true").lower() == "true"
if OTP_DEV_MODE:
    logger.warning("[MOCKED] OTP is in DEV MODE — generated OTP is returned in the send_otp response and logged; swap to MSG91/Twilio for production.")

COUNTER_SECRET = os.environ.get("COUNTER_SECRET", "efoodcare-counter-secret-2026")
ROTATION_SECONDS = 300
GRACE_BUCKETS = 2

DEFAULT_PLANS = [
    {"plan_id": "premium_60", "name": "Premium", "description": "Our best plan — 60 home-style meals", "amount": 2800.0, "currency": "INR", "duration_days": 30, "meals": 60, "active": True, "sort_order": 1},
    {"plan_id": "classic_60", "name": "Classic", "description": "Balanced thali — 60 meals", "amount": 2600.0, "currency": "INR", "duration_days": 30, "meals": 60, "active": True, "sort_order": 2},
    {"plan_id": "saver_60", "name": "Saver", "description": "Light & healthy — 60 meals", "amount": 1800.0, "currency": "INR", "duration_days": 30, "meals": 60, "active": True, "sort_order": 3},
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
    picture: Optional[str] = None
    role: Literal["admin", "staff", "subscriber"] = "subscriber"
    qr_token: str
    created_at: datetime


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


class SendOtpRequest(BaseModel):
    phone: str


class VerifyOtpRequest(BaseModel):
    phone: str
    otp: str
    name: Optional[str] = None


class CreateOrderRequest(BaseModel):
    plan_id: str


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
    email: str
    role: Literal["admin", "staff", "subscriber"]


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
        picture=doc.get("picture"),
        role=doc.get("role", "subscriber"),
        qr_token=doc["qr_token"],
        created_at=parse_dt(doc["created_at"]),
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
        if updates:
            await db.users.update_one({"user_id": existing["user_id"]}, {"$set": updates})
            existing.update(updates)
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
    return user_doc


# ---------------------------
# Emergent Google Auth
# ---------------------------
# REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
@api_router.post("/auth/session")
async def auth_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    async with httpx.AsyncClient() as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
            timeout=10,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session_id")
        data = r.json()
    user = await create_or_get_user(email=data["email"], phone=None, name=data.get("name", data["email"]), picture=data.get("picture"))
    # Use the provided session_token from Emergent as session
    token = data.get("session_token") or f"sess_{uuid.uuid4().hex}"
    expires_at = now_utc() + timedelta(days=7)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user["user_id"],
        "expires_at": iso(expires_at),
        "created_at": iso(now_utc()),
    })
    response.set_cookie(
        key="session_token", value=token, httponly=True, secure=True, samesite="none",
        path="/", max_age=7 * 24 * 60 * 60,
    )
    return {"user": {k: v for k, v in user.items() if k != "_id"}, "session_token": token}


# ---------------------------
# OTP Auth (DEV MOCKED)
# ---------------------------
@api_router.post("/auth/send-otp")
async def send_otp(payload: SendOtpRequest):
    phone = payload.phone.strip()
    if len(phone) < 6:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    otp = f"{random.randint(100000, 999999)}"
    expires_at = now_utc() + timedelta(minutes=10)
    await db.otp_codes.update_one(
        {"phone": phone},
        {"$set": {
            "phone": phone,
            "otp": otp,
            "expires_at": iso(expires_at),
            "attempts": 0,
            "created_at": iso(now_utc()),
        }},
        upsert=True,
    )
    logger.warning(f"[MOCKED OTP] Phone={phone} OTP={otp}")
    response: dict = {"ok": True, "expires_in": 600}
    if OTP_DEV_MODE:
        response["dev_otp"] = otp
        response["dev_mode"] = True
    return response


@api_router.post("/auth/verify-otp")
async def verify_otp(payload: VerifyOtpRequest, response: Response):
    phone = payload.phone.strip()
    rec = await db.otp_codes.find_one({"phone": phone}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=400, detail="No OTP requested for this number")
    if parse_dt(rec["expires_at"]) < now_utc():
        raise HTTPException(status_code=400, detail="OTP expired")
    if rec.get("attempts", 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many attempts")
    if rec["otp"] != payload.otp.strip():
        await db.otp_codes.update_one({"phone": phone}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect OTP")
    await db.otp_codes.delete_one({"phone": phone})
    name = (payload.name or f"User {phone[-4:]}").strip()
    user = await create_or_get_user(email=None, phone=phone, name=name)
    token = await issue_session(user["user_id"], response)
    return {"user": {k: v for k, v in user.items() if k != "_id"}, "session_token": token}


@api_router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return user.model_dump()


@api_router.post("/auth/logout")
async def auth_logout(response: Response, request: Request, session_token: Optional[str] = Cookie(default=None)):
    token = session_token
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@api_router.post("/auth/profile")
async def update_profile(payload: ProfileUpdate, user: User = Depends(get_current_user)):
    if not payload.name.strip() or not payload.phone.strip() or not payload.address.strip():
        raise HTTPException(status_code=400, detail="Name, phone and address are required")
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"name": payload.name.strip(), "phone": payload.phone.strip(), "address": payload.address.strip()}},
    )
    updated = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return {"ok": True, "user": updated}


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
@api_router.post("/payments/order")
async def create_payment_order(payload: CreateOrderRequest, user: User = Depends(get_current_user)):
    # Enforce completed profile
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    missing = [f for f in ("name", "phone", "address") if not (user_doc.get(f) or "").strip()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Profile incomplete: missing {', '.join(missing)}")

    plan = await db.plans.find_one({"plan_id": payload.plan_id, "active": True}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid or inactive plan")

    amount_paise = int(round(plan["amount"] * 100))
    receipt = f"rcpt_{uuid.uuid4().hex[:16]}"
    if RZP_ENABLED:
        rzp_order = rzp_client.order.create({
            "amount": amount_paise,
            "currency": plan["currency"],
            "receipt": receipt,
            "payment_capture": 1,
            "notes": {"plan_id": plan["plan_id"], "user_id": user.user_id},
        })
        order_id = rzp_order["id"]
        mock = False
    else:
        # [MOCKED] Razorpay stub — generates a fake order that we can verify locally
        order_id = f"order_mock_{uuid.uuid4().hex[:14]}"
        mock = True

    await db.payment_orders.insert_one({
        "order_id": order_id,
        "receipt": receipt,
        "user_id": user.user_id,
        "plan_id": plan["plan_id"],
        "plan_name": plan["name"],
        "amount": plan["amount"],
        "amount_paise": amount_paise,
        "currency": plan["currency"],
        "status": "created",
        "mock": mock,
        "created_at": iso(now_utc()),
    })

    return {
        "order_id": order_id,
        "amount_paise": amount_paise,
        "currency": plan["currency"],
        "key_id": RZP_KEY_ID if RZP_ENABLED else "rzp_test_MOCK",
        "mock": mock,
        "plan_name": plan["name"],
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
    """Create subscription + credit wallet. Idempotent on order_id."""
    if order.get("status") == "paid":
        return
    user_id = order["user_id"]
    plan = await db.plans.find_one({"plan_id": order["plan_id"]}, {"_id": 0})
    if not plan:
        return
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
        "created_at": iso(start),
    }
    await db.subscriptions.insert_one(sub.copy())
    await db.users.update_one({"user_id": user_id}, {"$inc": {"wallet_balance": float(plan["amount"])}})
    await _log_wallet_txn(user_id, sub["sub_id"], "credit", float(plan["amount"]), float(plan["amount"]), f"{plan['name']} subscription")
    await db.payment_orders.update_one({"order_id": order["order_id"]}, {"$set": {"status": "paid", "sub_id": sub["sub_id"], "paid_at": iso(start)}})
    logger.info(f"[SUB ACTIVATED] user={user_id} plan={plan['plan_id']} amount={plan['amount']} per_day={per_day}")


@api_router.post("/payments/verify")
async def verify_payment(payload: VerifyPaymentRequest, user: User = Depends(get_current_user)):
    order = await db.payment_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if order.get("mock"):
        # [MOCKED] Razorpay stub — accept any signature in dev
        logger.warning(f"[MOCKED] Auto-verifying mock order {payload.order_id}")
    else:
        try:
            rzp_client.utility.verify_payment_signature({
                "razorpay_order_id": payload.order_id,
                "razorpay_payment_id": payload.razorpay_payment_id,
                "razorpay_signature": payload.razorpay_signature,
            })
        except Exception as e:
            logger.error(f"Signature verify failed: {e}")
            raise HTTPException(status_code=400, detail="Invalid payment signature")

    await _activate_subscription(order)
    fresh = await db.payment_orders.find_one({"order_id": payload.order_id}, {"_id": 0})
    return {"ok": True, "status": fresh["status"], "sub_id": fresh.get("sub_id")}


@api_router.post("/webhook/razorpay")
async def rzp_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
    if RZP_ENABLED and secret:
        try:
            rzp_client.utility.verify_webhook_signature(body.decode(), signature, secret)
        except Exception as e:
            logger.error(f"Webhook signature invalid: {e}")
            return {"received": False}
    try:
        data = await request.json()
    except Exception:
        return {"received": False}
    event = data.get("event", "")
    if event in ("payment.captured", "order.paid"):
        order_id = data.get("payload", {}).get("order", {}).get("entity", {}).get("id") or data.get("payload", {}).get("payment", {}).get("entity", {}).get("order_id")
        if order_id:
            order = await db.payment_orders.find_one({"order_id": order_id}, {"_id": 0})
            if order and order.get("status") != "paid":
                await _activate_subscription(order)
    return {"received": True}


# ---------------------------
# Subscription tick / catch-up with 3-day pause rule
# ---------------------------
INACTIVITY_THRESHOLD_DAYS = 3


async def catch_up_subscription(sub: dict) -> dict:
    """Apply per-day deductions + pause extension for days between last_tick and today."""
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
        # Determine inactivity: look at attendance in window [current - INACTIVITY_THRESHOLD, current)
        window_start = (current - timedelta(days=INACTIVITY_THRESHOLD_DAYS)).isoformat()
        window_end = current.isoformat()
        recent_scan = await db.attendance.find_one({
            "user_id": user_id,
            "date_str": {"$gte": window_start, "$lt": window_end},
        }, {"_id": 0})

        if recent_scan:
            new_balance = round(float(sub["wallet_balance"]) - per_day, 2)
            if new_balance < 0:
                new_balance = 0.0
            sub["wallet_balance"] = new_balance
            deducted_amount += per_day
            await _log_wallet_txn(user_id, sub["sub_id"], "debit", per_day, new_balance, f"Daily deduction · {current.isoformat()}")
        else:
            sub["paused_days"] = int(sub.get("paused_days", 0)) + 1
            sub["end_date"] = iso(parse_dt(sub["end_date"]) + timedelta(days=1))
            paused_added += 1
            await _log_wallet_txn(user_id, sub["sub_id"], "pause", 0.0, float(sub["wallet_balance"]), f"Auto-pause · {current.isoformat()} (no scan in last 3 days)")

        days_processed += 1

    sub["last_tick_date"] = today.isoformat()

    # Persist
    await db.subscriptions.update_one({"sub_id": sub["sub_id"]}, {"$set": {
        "wallet_balance": sub["wallet_balance"],
        "paused_days": sub["paused_days"],
        "end_date": sub["end_date"],
        "last_tick_date": sub["last_tick_date"],
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
        "foreground": "215 28% 17%",
        "card": "0 0% 100%",
        "card_foreground": "215 28% 17%",
        "primary": "142 45% 38%",
        "primary_foreground": "0 0% 100%",
        "secondary": "220 70% 50%",
        "secondary_foreground": "0 0% 100%",
        "accent": "142 30% 95%",
        "accent_foreground": "142 45% 38%",
        "destructive": "0 70% 50%",
        "destructive_foreground": "0 0% 100%",
        "muted": "215 20% 96%",
        "muted_foreground": "215 15% 45%",
        "border": "215 20% 90%",
        "input": "215 20% 90%",
        "ring": "142 45% 38%",
        "radius": "0.75rem",
    },
}


class ThemeUpdate(BaseModel):
    brand_name: Optional[str] = None
    brand_tagline: Optional[str] = None
    tokens: Optional[dict] = None


async def _load_theme():
    doc = await db.theme_settings.find_one({"_id": "active"}, {"_id": 0})
    if not doc:
        await db.theme_settings.insert_one({"_id": "active", **DEFAULT_THEME, "updated_at": iso(now_utc())})
        return DEFAULT_THEME
    return doc


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


@api_router.get("/my/subscription")
async def my_subscription(user: User = Depends(get_current_user)):
    sub = await get_active_subscription(user.user_id)
    if not sub:
        return {"active": False, "subscription": None}
    return {"active": True, "subscription": sub}


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
    await db.subscriptions.update_one({"sub_id": sub["sub_id"]}, {"$inc": {"meals_used": 1}})
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
@api_router.get("/admin/stats")
async def admin_stats(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    total_users = await db.users.count_documents({})
    total_subscribers = await db.users.count_documents({"role": "subscriber"})
    active_subs = await db.subscriptions.count_documents({"status": "active"})
    d = today_str()
    today_att = await db.attendance.count_documents({"date_str": d})
    paid = await db.payment_orders.find({"status": "paid"}, {"_id": 0}).to_list(10000)
    revenue = sum(float(p.get("amount", 0)) for p in paid)
    trend = []
    for i in range(6, -1, -1):
        day = (now_utc() - timedelta(days=i)).strftime("%Y-%m-%d")
        cnt = await db.attendance.count_documents({"date_str": day})
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


@api_router.get("/admin/attendance/today")
async def admin_today_attendance(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    d = today_str()
    recs = await db.attendance.find({"date_str": d}, {"_id": 0}).sort("checked_at", -1).to_list(500)
    return {"attendance": recs}


@api_router.get("/admin/users")
async def admin_users(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    users = await db.users.find({}, {"_id": 0}).to_list(1000)
    return {"users": users}


@api_router.post("/admin/role")
async def admin_set_role(payload: SetRoleRequest, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await db.users.update_one({"email": payload.email.lower()}, {"$set": {"role": payload.role}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


# ---------------------------
# Root
# ---------------------------
@api_router.get("/")
async def root():
    return {"message": "eFoodCare API", "tagline": "ghar se achha khana"}


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
    await seed_plans()


@app.on_event("shutdown")
async def shutdown_db_client():
    mongo_client.close()
