# eFoodCare — PRD

> *ghar se achha khana*

## Problem Statement
Build a tiffin / dining subscription app with:
- 30-day plans, 60 meals (lunch + dinner)
- QR-based attendance tracking (e-coupon style)
- Razorpay UPI payments
- Smart wallet: amount loads on subscribe, deducts daily, auto-pauses on 3+ inactive days
- OTP and Google authentication
- Admin-editable plans + analytics

## Roles
- Admin (manages plans, menu, users, views analytics)
- Staff (scans subscriber QR at counter)
- Subscriber (owns e-Meal Pass + wallet)

## Implemented (Feb 2026)

### Iteration 1 — Core MVP
- Backend API: Google auth, plans, Stripe checkout (later removed), staff/self scan, counter QR, admin stats/users/role/menu
- Frontend: Landing, Login, Dashboard, Plans, Counter, Self-Scan, Admin
- Earthy green + terracotta design (Cabinet Grotesk + Manrope)

### Iteration 2 — Counter QR upgrades
- Rotating HMAC counter codes (5-min, per meal slot)
- Public kiosk page `/k/:locationId` (no login, fullscreen, live clock + check-in counter)
- Downloadable PNG poster
- Confetti success on self-scan
- 35/35 backend tests pass

### Iteration 3 — eFoodCare rebrand + UPI + Wallet
- Brand: MessPass → **eFoodCare**, Meal Pass → **e-Meal Pass**, tagline *ghar se achha khana*
- Removed Stripe; **added Razorpay** (MOCKED until keys provided — frontend Razorpay Checkout.js wired and ready)
- Plans now in DB and **admin-CRUDable** at `/admin/plans` (Premium ₹2800, Classic ₹2600, Saver ₹1800; INR)
- **Smart Wallet**: amount auto-credited on subscribe, daily deduction, **3-day inactivity → auto-pause + auto-extend end_date**
- **OTP authentication** (dev-mock; OTP shown on screen + logged) + Google OAuth fallback
- **Mandatory profile** (name, phone, address) before checkout
- 23/23 backend tests pass

### Iteration 7 (Feb 5, 2026) — Custom Plans + Logo + Health Promise
- **Custom subscription plans** (any 1–90 days): `/api/payments/custom-order` and `/api/plans/custom/preview` — pay exactly **₹70 per meal** (₹140/day, 2 meals)
- Standard 30-day plans untouched (Premium/Classic/Saver)
- **Theme refreshed to dark-red brand identity** — `primary` token migrated to `0 65% 38%` via theme migration on startup
- **Logo redesign**: tight white-bordered rectangular badge over dark-red header background
- **Background scheduler** (`subscription_tick_loop`): hourly cron walks every active subscription → applies daily wallet deduction or auto-pauses & extends end-date when 3+ consecutive inactive days. Plus admin manual trigger `POST /api/admin/cron/run-tick`
- **"Our kitchen promise"** landing section: two-column distribution
  - 0% the bad stuff: ajinomoto, maida, artificial flavours, artificial colours, polished grains, refined/palm oil
  - 100% the good stuff: chakki atta, unpolished toor dal, premium aged rice, fresh vegetables, filter/cold-pressed oil, real ghar-style spices

## Mocked Integrations (clearly flagged)
- **MOCKED Razorpay**: enable real flow by setting `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in `/app/backend/.env`. Frontend automatically uses the real modal once keys are present.
- **MOCKED OTP delivery**: enable real SMS by integrating MSG91/Twilio at `/api/auth/send-otp` (one function swap). Set `OTP_DEV_MODE=false` to stop returning OTP in API response.

## Backlog
- P1: Per-IP rate limit on `/auth/send-otp` (SMS cost protection)
- P1: Admin menu editor UI (backend ready)
- P1: Admin wallet/subscription overrides (refunds, manual extensions)
- P2: Email/SMS reminder for unused daily meal
- P2: Referral credit system (+5 meals on each side)
- P2: Monthly report PDF export
- P2: Multi-mess support
- P2: pydantic gt=0 validators on admin plan upsert
- P2: Auto-expire subscription when wallet hits 0

## Test Credentials
See `/app/memory/test_credentials.md`.
