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

### Iteration 8 (Feb 6, 2026) — Delivery Boy Live Tracking
- **Delivery boy role** with dedicated `/boy` dashboard — start dispatch, see route-ordered stops, mark delivered with GPS geofence verification
- **Live position pings** — boy's phone sends GPS every 15s via `POST /api/boy/location` while on trip
- **Admin Live Map** (`/admin/live`) — real-time map of all delivery boys + customer pins, auto-refreshing every 10s, with per-boy route polylines
- **Customer Track page** (`/track`) — tiffin subscribers see their delivery boy's live position + ETA (haversine over speed) + 'I got my tiffin' confirm
- **Auto-reconciliation** — `/boy/dispatch/end` auto-closes the trip's handoff so admin doesn't have to manually reconcile every trip
- Built on `react-leaflet` + free OpenStreetMap tiles (no API key needed)
- 13/13 backend tests pass for new endpoints (test_iter7.py)

### Iteration 9 (Feb 6, 2026) — Slot lock + tiffin accounting + dashboard CMS + map polish
- **Slot-wise dispatch lock** — admin sets `lunch_dispatch_open/close` and `dinner_dispatch_open/close` (IST). Wrong-slot tap on `/boy` now disables tab + shows "Lunch dispatch opens at 08:00" reason. Backend hard-enforces.
- **Auto pincode** — when customer pins delivery location, server reverse-geocodes via free Nominatim and stores `user.pincode`. Drives delivery-boy zone routing automatically.
- **Empty-tiffin (utensil) ledger** — every delivered tiffin increments `user.tiffin_balance`; collection events decrement. New `/boy/empty/collect` + `/admin/delivery/empty/collect` + `/admin/delivery/empties` + `/boy/empties`. Boy dashboard surfaces a Recycle banner with red badges per outstanding customer; admin gets a dedicated **Empty Tiffins** tab with "Estimated loss" total.
- **Polished maps** — CartoDB Voyager tiles, animated boy marker (pulsing ring + bobbing scooter), kitchen dispatch pin with chef-bento icon, dashed 15 km service-zone circle, `maxBounds` lock so admin/customer maps stay tight to dispatch radius.
- **Admin: dispatch coordinates** — settings panel now has lat/lng/radius_km fields + "Use this device's GPS" button.
- **Admin: Subscriber Dashboard CMS** (`/admin/dashboard-editor`) — option **C** scope: edit text content (greeting/headings/tagline/no-plan card), toggle each of 7 sections visible/hidden, drag up/down to reorder, override 4 card colours (wallet bg/fg, hero accent, side-card tint). `db.dashboard_config{_id:"active"}` + GET/PATCH/RESET endpoints. Subscriber dashboard reads on mount and applies.
- 19/19 backend tests pass (test_iter8.py); admin/boy/customer flows smoke-tested.

### Iteration 10 (Feb 6, 2026) — SMS reminders, auto-expire, geocode hardening
- **MSG91 SMS empty-tiffin reminders** — `/app/backend/sms.py` (DLT-compliant). Background `reminder_loop()` every 5 min scans for users with `tiffin_balance > 0` + active tiffin sub, fires SMS in the `(slot_open − reminder_lead_minutes, slot_open)` window. Idempotent via `db.tiffin_reminders_sent`. Toggle + lead-time editable in Admin → Delivery → Settings. **STUB MODE** is default until MSG91 keys are pasted into `.env` — calls log "[SMS · STUB] tiffin-reminder → 9XXXX · {…}".
- **Auto-expire on wallet=0 with 1-day grace** — `run_subscription_tick()` flags subs at zero wallet with `zero_wallet_grace_until = now + 24h`. On the next tick after that, the sub is set `status="expired"` with `expired_reason="wallet_zero"`. Topping up the wallet before grace elapses clears the flag automatically.
- **Geocode cache (24h)** — `db.geocode_cache` keyed by `lat,lng` rounded to 3 decimals (~100 m); cuts Nominatim load.
- **Geocode status field** — `/auth/location` now returns `geocode_status: "ok" | "cached" | "no_pincode" | "rate_limited" | "error" | "invalid"` so the UI can prompt re-pin if needed.
- **Pre-seed dashboard config** on startup — first GET no longer triggers a DB write during a public read.
- **Admin manual triggers**: `POST /api/admin/cron/run-reminders` (and existing `/run-tick`) for instant testing.
- 7/7 new backend tests (test_iter9.py); 39/39 cumulative iter7+8+9 pass.

#### Required env vars (optional — stub mode otherwise)
```
MSG91_AUTH_KEY=
MSG91_SENDER_ID=
MSG91_FLOW_TIFFIN=
MSG91_STUB_MODE=true
```

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
