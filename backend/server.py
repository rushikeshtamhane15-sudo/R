from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Cookie, Depends
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, timedelta, date
import httpx
import hmac
import hashlib
import time
import io
import qrcode
from fastapi.responses import StreamingResponse

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionRequest,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------------------------
# Constants & config
# ---------------------------
ADMIN_EMAILS = {
    e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()
}

# Fixed plans (amounts in the backend only, never trust frontend)
PLANS = {
    "monthly_60": {
        "id": "monthly_60",
        "name": "Monthly Pass — 60 Meals",
        "description": "30-day access, 2 meals/day (Lunch + Dinner)",
        "amount": 149.00,
        "currency": "usd",
        "duration_days": 30,
        "meals": 60,
    },
    "weekly_14": {
        "id": "weekly_14",
        "name": "Weekly Pass — 14 Meals",
        "description": "7-day access, 2 meals/day",
        "amount": 39.00,
        "currency": "usd",
        "duration_days": 7,
        "meals": 14,
    },
}

MEAL_WINDOWS = {
    "lunch": (11, 15),   # 11:00 - 15:00
    "dinner": (18, 22),  # 18:00 - 22:00
}

# Rotating counter QR settings
COUNTER_SECRET = os.environ.get("COUNTER_SECRET", "messpass-counter-secret-2026")
ROTATION_SECONDS = 300  # rotate every 5 minutes
GRACE_BUCKETS = 2  # accept codes from current + last 2 buckets (= last 15 min)


def _current_bucket() -> int:
    return int(time.time()) // ROTATION_SECONDS


def make_counter_code(location: str, meal: str, bucket: int) -> str:
    payload = f"{location}.{meal}.{bucket}"
    sig = hmac.new(
        COUNTER_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()[:16]
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
    if bucket > cur or cur - bucket > GRACE_BUCKETS:
        return None
    if meal not in ("lunch", "dinner"):
        return None
    return {"location": location, "meal": meal, "bucket": bucket}


# ---------------------------
# Models
# ---------------------------
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: Literal["admin", "staff", "subscriber"] = "subscriber"
    qr_token: str
    created_at: datetime


class Plan(BaseModel):
    id: str
    name: str
    description: str
    amount: float
    currency: str
    duration_days: int
    meals: int


class Subscription(BaseModel):
    sub_id: str
    user_id: str
    plan_id: str
    plan_name: str
    meals_total: int
    meals_used: int
    start_date: datetime
    end_date: datetime
    status: str
    created_at: datetime


class AttendanceRecord(BaseModel):
    att_id: str
    user_id: str
    user_name: str
    sub_id: str
    meal_type: str
    checked_at: datetime
    marked_by: Optional[str] = None
    method: str


class MenuDay(BaseModel):
    menu_date: str
    lunch_items: List[str]
    dinner_items: List[str]


class CheckoutRequest(BaseModel):
    plan_id: str
    origin_url: str


class StaffScanRequest(BaseModel):
    qr_token: str
    meal_type: Literal["lunch", "dinner"]


class SelfScanRequest(BaseModel):
    counter_code: str
    meal_type: Literal["lunch", "dinner"]


class SetRoleRequest(BaseModel):
    email: str
    role: Literal["admin", "staff", "subscriber"]


class MenuUpdateRequest(BaseModel):
    menu_date: str
    lunch_items: List[str]
    dinner_items: List[str]


# ---------------------------
# Helpers
# ---------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def serialize_dt(d):
    if isinstance(d, datetime):
        return d.isoformat()
    return d


def doc_to_user(doc) -> User:
    return User(
        user_id=doc["user_id"],
        email=doc["email"],
        name=doc["name"],
        picture=doc.get("picture"),
        role=doc.get("role", "subscriber"),
        qr_token=doc["qr_token"],
        created_at=datetime.fromisoformat(doc["created_at"]) if isinstance(doc["created_at"], str) else doc["created_at"],
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

    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")

    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return doc_to_user(user)


async def require_role(user: User, roles: List[str]):
    if user.role not in roles:
        raise HTTPException(status_code=403, detail=f"Requires role: {roles}")


async def get_active_subscription(user_id: str) -> Optional[dict]:
    subs = await db.subscriptions.find(
        {"user_id": user_id, "status": "active"}, {"_id": 0}
    ).to_list(50)
    now = now_utc()
    for s in subs:
        end_date = s["end_date"]
        if isinstance(end_date, str):
            end_date = datetime.fromisoformat(end_date)
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)
        if end_date > now and s["meals_used"] < s["meals_total"]:
            return s
    return None


# ---------------------------
# Auth Routes
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

    email = data["email"].lower()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user = existing
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"name": data.get("name", user["name"]), "picture": data.get("picture")}},
        )
    else:
        role = "admin" if email in ADMIN_EMAILS else "subscriber"
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name", email),
            "picture": data.get("picture"),
            "role": role,
            "qr_token": f"qr_{uuid.uuid4().hex}",
            "created_at": now_utc().isoformat(),
        }
        await db.users.insert_one(user.copy())

    session_token = data["session_token"]
    expires_at = now_utc() + timedelta(days=7)
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user["user_id"],
        "expires_at": expires_at.isoformat(),
        "created_at": now_utc().isoformat(),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=7 * 24 * 60 * 60,
    )

    user_clean = {k: v for k, v in user.items() if k != "_id"}
    return {"user": user_clean, "session_token": session_token}


@api_router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return user.model_dump()


@api_router.post("/auth/logout")
async def auth_logout(
    response: Response,
    request: Request,
    session_token: Optional[str] = Cookie(default=None),
):
    token = session_token
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ---------------------------
# Plans & Payments
# ---------------------------
@api_router.get("/plans")
async def get_plans():
    return {"plans": list(PLANS.values())}


@api_router.post("/checkout")
async def create_checkout(
    payload: CheckoutRequest,
    user: User = Depends(get_current_user),
):
    if payload.plan_id not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan")
    plan = PLANS[payload.plan_id]

    origin = payload.origin_url.rstrip("/")
    success_url = f"{origin}/payment/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/plans"

    stripe_checkout = StripeCheckout(
        api_key=os.environ["STRIPE_API_KEY"],
        webhook_url=f"{origin}/api/webhook/stripe",
    )

    req = CheckoutSessionRequest(
        amount=float(plan["amount"]),
        currency=plan["currency"],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "user_id": user.user_id,
            "plan_id": plan["id"],
            "source": "mess_subscription",
        },
    )
    session = await stripe_checkout.create_checkout_session(req)

    await db.payment_transactions.insert_one({
        "session_id": session.session_id,
        "user_id": user.user_id,
        "email": user.email,
        "plan_id": plan["id"],
        "amount": plan["amount"],
        "currency": plan["currency"],
        "payment_status": "pending",
        "status": "initiated",
        "metadata": {"plan_id": plan["id"], "user_id": user.user_id},
        "created_at": now_utc().isoformat(),
    })

    return {"url": session.url, "session_id": session.session_id}


@api_router.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, user: User = Depends(get_current_user)):
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    # If already finalized, return cached
    if tx["payment_status"] == "paid" and tx["status"] == "completed":
        return {"payment_status": "paid", "status": "completed"}

    # Poll Stripe
    stripe_checkout = StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url="")
    try:
        status = await stripe_checkout.get_checkout_status(session_id)
    except Exception as e:
        logging.warning(f"Stripe status fetch failed: {e}")
        return {
            "payment_status": tx.get("payment_status", "unknown"),
            "status": tx.get("status", "pending"),
            "amount_total": int(float(tx.get("amount", 0)) * 100),
            "currency": tx.get("currency", "usd"),
        }

    new_update = {
        "payment_status": status.payment_status,
        "status": status.status,
        "updated_at": now_utc().isoformat(),
    }
    await db.payment_transactions.update_one({"session_id": session_id}, {"$set": new_update})

    if status.payment_status == "paid" and tx["status"] != "completed":
        # Create subscription only once
        plan = PLANS.get(tx["plan_id"])
        if plan:
            start = now_utc()
            end = start + timedelta(days=plan["duration_days"])
            sub = {
                "sub_id": f"sub_{uuid.uuid4().hex[:12]}",
                "user_id": user.user_id,
                "plan_id": plan["id"],
                "plan_name": plan["name"],
                "meals_total": plan["meals"],
                "meals_used": 0,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "status": "active",
                "created_at": start.isoformat(),
            }
            await db.subscriptions.insert_one(sub.copy())
            await db.payment_transactions.update_one(
                {"session_id": session_id}, {"$set": {"status": "completed", "sub_id": sub["sub_id"]}}
            )

    return {
        "payment_status": status.payment_status,
        "status": status.status,
        "amount_total": status.amount_total,
        "currency": status.currency,
    }


@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("Stripe-Signature", "")
    stripe_checkout = StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url="")
    try:
        event = await stripe_checkout.handle_webhook(body, signature)
    except Exception as e:
        logging.error(f"Webhook error: {e}")
        return {"received": False}

    if event.payment_status == "paid" and event.session_id:
        tx = await db.payment_transactions.find_one({"session_id": event.session_id}, {"_id": 0})
        if tx and tx["status"] != "completed":
            plan = PLANS.get(tx["plan_id"])
            if plan:
                start = now_utc()
                end = start + timedelta(days=plan["duration_days"])
                sub = {
                    "sub_id": f"sub_{uuid.uuid4().hex[:12]}",
                    "user_id": tx["user_id"],
                    "plan_id": plan["id"],
                    "plan_name": plan["name"],
                    "meals_total": plan["meals"],
                    "meals_used": 0,
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "status": "active",
                    "created_at": start.isoformat(),
                }
                await db.subscriptions.insert_one(sub.copy())
                await db.payment_transactions.update_one(
                    {"session_id": event.session_id},
                    {"$set": {"status": "completed", "payment_status": "paid", "sub_id": sub["sub_id"]}},
                )
    return {"received": True}


# ---------------------------
# Subscriber: QR + subscription + attendance
# ---------------------------
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
    records = await db.attendance.find(
        {"user_id": user.user_id}, {"_id": 0}
    ).sort("checked_at", -1).to_list(100)
    return {"attendance": records}


def current_meal_type() -> Optional[str]:
    h = now_utc().hour
    # adjust for local time? keep UTC-agnostic but accept any meal in dev
    for meal, (start, end) in MEAL_WINDOWS.items():
        if start <= h < end:
            return meal
    return None


async def _mark_attendance(target_user: dict, meal_type: str, marked_by: str, method: str):
    # Get active subscription
    sub = await get_active_subscription(target_user["user_id"])
    if not sub:
        raise HTTPException(status_code=400, detail="No active subscription")

    # Check duplicate for today + meal_type
    today_str = now_utc().strftime("%Y-%m-%d")
    existing = await db.attendance.find_one({
        "user_id": target_user["user_id"],
        "meal_type": meal_type,
        "date_str": today_str,
    }, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail=f"Already checked in for {meal_type} today")

    record = {
        "att_id": f"att_{uuid.uuid4().hex[:12]}",
        "user_id": target_user["user_id"],
        "user_name": target_user["name"],
        "sub_id": sub["sub_id"],
        "meal_type": meal_type,
        "checked_at": now_utc().isoformat(),
        "date_str": today_str,
        "marked_by": marked_by,
        "method": method,
    }
    await db.attendance.insert_one(record.copy())
    await db.subscriptions.update_one(
        {"sub_id": sub["sub_id"]}, {"$inc": {"meals_used": 1}}
    )
    return record


@api_router.post("/attendance/scan")
async def staff_scan(
    payload: StaffScanRequest,
    user: User = Depends(get_current_user),
):
    if user.role not in ("staff", "admin"):
        raise HTTPException(status_code=403, detail="Staff/Admin only")
    target = await db.users.find_one({"qr_token": payload.qr_token}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Invalid QR")
    record = await _mark_attendance(target, payload.meal_type, user.user_id, "counter_scan")
    return {"ok": True, "record": record, "subscriber_name": target["name"]}


@api_router.post("/attendance/self-scan")
async def self_scan(
    payload: SelfScanRequest,
    user: User = Depends(get_current_user),
):
    verified = verify_counter_code(payload.counter_code)
    if not verified:
        raise HTTPException(status_code=400, detail="Invalid or expired counter code")
    # Use the meal from the verified code (server-trusted), not the client
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
    }


# Counter QR: staff/admin fetches a rotating code for subscribers to self-scan
@api_router.get("/counter/qr")
async def counter_qr(
    meal: str = "lunch",
    location: str = "main",
    user: User = Depends(get_current_user),
):
    if user.role not in ("staff", "admin"):
        raise HTTPException(status_code=403, detail="Staff/Admin only")
    if meal not in ("lunch", "dinner"):
        raise HTTPException(status_code=400, detail="meal must be lunch or dinner")
    bucket = _current_bucket()
    code = make_counter_code(location, meal, bucket)
    next_rotation = (bucket + 1) * ROTATION_SECONDS
    return {
        "counter_code": code,
        "meal": meal,
        "location": location,
        "rotates_at": next_rotation,
        "rotation_seconds": ROTATION_SECONDS,
    }


# Public counter QR endpoint — used by the kiosk display (no login required)
@api_router.get("/counter/qr/public")
async def counter_qr_public(meal: str = "lunch", location: str = "main"):
    if meal not in ("lunch", "dinner"):
        raise HTTPException(status_code=400, detail="meal must be lunch or dinner")
    bucket = _current_bucket()
    code = make_counter_code(location, meal, bucket)
    next_rotation = (bucket + 1) * ROTATION_SECONDS
    return {
        "counter_code": code,
        "meal": meal,
        "location": location,
        "rotates_at": next_rotation,
        "rotation_seconds": ROTATION_SECONDS,
    }


# Live public stats for kiosk display
@api_router.get("/stats/today")
async def stats_today():
    today_str = now_utc().strftime("%Y-%m-%d")
    total = await db.attendance.count_documents({"date_str": today_str})
    lunch = await db.attendance.count_documents({"date_str": today_str, "meal_type": "lunch"})
    dinner = await db.attendance.count_documents({"date_str": today_str, "meal_type": "dinner"})
    return {"date": today_str, "total": total, "lunch": lunch, "dinner": dinner}


# Downloadable poster (PNG) with the current counter QR + branding
@api_router.get("/counter/poster")
async def counter_poster(meal: str = "lunch", location: str = "main"):
    if meal not in ("lunch", "dinner"):
        raise HTTPException(status_code=400, detail="meal must be lunch or dinner")
    # Embed kiosk URL so the QR points to the public kiosk page rather than
    # a single rotating code (poster needs to remain valid)
    # The QR encodes a JSON payload pointing to the kiosk URL; subscribers
    # land on the kiosk page which auto-fetches a fresh rotating code.
    kiosk_url = f"/k/{location}?meal={meal}"
    qr = qrcode.QRCode(version=None, box_size=14, border=2)
    qr.add_data(kiosk_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#4b5c4a", back_color="white").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="messpass-{location}-{meal}.png"'},
    )


# ---------------------------
# Menu
# ---------------------------
@api_router.get("/menu/today")
async def menu_today():
    today_str = now_utc().strftime("%Y-%m-%d")
    m = await db.menus.find_one({"menu_date": today_str}, {"_id": 0})
    if not m:
        return {
            "menu_date": today_str,
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
            "updated_at": now_utc().isoformat(),
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
    today_str = now_utc().strftime("%Y-%m-%d")
    today_attendance = await db.attendance.count_documents({"date_str": today_str})

    paid_txs = await db.payment_transactions.find(
        {"payment_status": "paid"}, {"_id": 0}
    ).to_list(10000)
    revenue = sum(float(t.get("amount", 0)) for t in paid_txs)

    # Last 7 days attendance
    trend = []
    for i in range(6, -1, -1):
        d = (now_utc() - timedelta(days=i)).strftime("%Y-%m-%d")
        cnt = await db.attendance.count_documents({"date_str": d})
        trend.append({"date": d, "count": cnt})

    return {
        "total_users": total_users,
        "total_subscribers": total_subscribers,
        "active_subscriptions": active_subs,
        "today_attendance": today_attendance,
        "revenue": round(revenue, 2),
        "attendance_trend": trend,
    }


@api_router.get("/admin/attendance/today")
async def admin_today_attendance(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    today_str = now_utc().strftime("%Y-%m-%d")
    records = await db.attendance.find(
        {"date_str": today_str}, {"_id": 0}
    ).sort("checked_at", -1).to_list(500)
    return {"attendance": records}


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
    result = await db.users.update_one(
        {"email": payload.email.lower()},
        {"$set": {"role": payload.role}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


# ---------------------------
# Root
# ---------------------------
@api_router.get("/")
async def root():
    return {"message": "Mess Subscription API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
