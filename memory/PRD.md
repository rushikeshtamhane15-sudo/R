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

### Iteration 18 (Feb 7, 2026) — Server.py refactor + Razorpay webhook event log
- **Auth + Payments routes extracted** to `/app/backend/routes/auth.py` (173 LOC) and `/app/backend/routes/payments.py` (236 LOC). server.py shrank from 2645 → 2297 lines (~13%) with zero behavioural change. Pattern: route modules `import server` (late-binding) and call `server.<helper>` — works because server.py imports the routers at the BOTTOM of its module body so all helpers/models are populated before route decorators run. New `/app/backend/routes/__init__.py` documents the contract.
- **Razorpay webhook signature verification logging** — every event posted to `/api/webhook/razorpay` is now persisted to `db.webhook_events` with: `{event_id, ts, event, signature_ok (T/F/None), signature_error, body_size, has_signature_header, order_id, payment_id, amount, processed, processing_error, ip}`. Three-state signature flag: `True`=verified, `False`=invalid (rejected, logged), `None`=no `RAZORPAY_WEBHOOK_SECRET` configured. Lazy cap at 500 rows (oldest pruned) so the collection never grows unbounded.
- **New admin endpoint** `GET /api/admin/payments/webhook-events?limit=N` — returns last N events + roll-up counts (`total`, `signature_ok`, `signature_failed`, `no_secret`).
- **Admin UI panel** on `/admin/plans` below the Razorpay status card: 4-tile stat row + last-20-events table with timestamp, event type, signature badge (green ✓ / red ✗ / amber ?), order id, processing status. "Refresh" button.
- **Tests**: 7 new in `test_iter14.py` (route relocation + webhook logging + admin listing); cumulative 22/22 green (iter12 + iter13 + iter14).

### Iteration 17 (Feb 7, 2026) — OTP rate-limit + Razorpay live key validator
- **Per-IP + per-phone rate limit on `/auth/send-otp`** (P1 — protects SMS bill from abuse loops). Tight defaults: 3/phone/10 min · 10/IP/hour · 50/IP/day. Cascade order is per-phone → per-IP-hour → per-IP-day. Returns HTTP 429 with `Retry-After` header (computed from the earliest hit in the window). Storage: new `db.rate_limit_hits` collection with TTL index on `expires_at` (Mongo auto-reaps stale rows). Generic implementation in `/app/backend/rate_limit.py` is reusable for any future endpoint. Client-IP extraction respects `CF-Connecting-IP` → `X-Forwarded-For` (first hop) → `X-Real-IP` → socket peer.
- **Razorpay live key validation** — `validate_razorpay_keys()` pings Razorpay via `client.order.all({count:1})` (auth-checked, read-only). Returns `{ok, status: live|mock|auth_failed|error, detail, key_id_masked}`. Wired into:
  - **Startup log line** with ✅/⚠️ emoji telling ops the live status of the keys
  - **Admin endpoint** `GET /api/admin/payments/razorpay-status`
  - **Admin UI**: tone-coded status card + "Re-test" button on `/admin/plans` (green=live, amber=mock/error, red=auth_failed, with masked key id)
- **Tests**: 5/5 new in `test_iter13.py`; cumulative 15/15 (iter12+iter13) green.

### Iteration 16 (Feb 6, 2026) — Tasks refactor + branded splash screen
- **Cron loops extracted** — `subscription_tick_loop`, `reminder_loop`, `expiry_reminder_loop` removed from `server.py` (~50 LOC), replaced by a single `start_background_loops(...)` call from new `/app/backend/tasks.py`. Generic `_periodic(name, fn, interval, initial_delay)` runner with per-iteration exception logging — one failed run never kills the scheduler. All three intervals (`TICK_INTERVAL_SECONDS`, `REMINDER_INTERVAL_SECONDS`, `EXPIRY_SCAN_INTERVAL_SECONDS`) live in `tasks.py`. No circular-import risk: `run_*` functions are passed in by `server.py` startup hook. 10/10 iter12 tests still green.
- **Branded splash screen** (`/app/frontend/src/components/SplashScreen.jsx`) — full-viewport red overlay (`#a02323`) on first paint, mounted at the App root above the router. Smaller logo (96 px, down from header's 36-44 px scaled larger), then `eFoodCare` wordmark and `ghar se accha khana` tagline — both white. `efc-pop` (logo) + `efc-rise` (text) entrance animations, 1.1s hold + 350ms fade-out, sessionStorage flag prevents re-flash on hot reload / route change.
- **PWA install splash matches brand**: `manifest.webmanifest` `background_color` updated `#ffffff` → `#a02323` so the OS-rendered splash is also red instead of jarring white.

### Iteration 15 (Feb 6, 2026) — Editable Testimonials + Subscription expiry reminders
- **Admin Testimonials Editor** (`/admin/testimonials`) — full CRUD: add/edit/remove/reorder, per-row visibility toggle, 1-5 star rating, photo via file upload (base64 data URL, capped ~1.4 MB) OR pasted URL, sticky save bar. Fronts the existing `db.testimonials_config` collection. Sidebar nav added under Content & design. Public landing renders only `visible:true` testimonials; admin sees all.
- **Subscription expiry reminders launched** — `expiry_reminder_loop` now started on startup (interval 1h, lead_days `[3, 1, 0]`). Walks all active subs, fires SMS via MSG91 (`send_expiry_reminder`) and Email via Resend (`send_email` + `expiry_email_html`), with branded HTML. Idempotent via compound key in `db.expiry_reminders_sent` (sub_id + days_left + sent_date). Both channels currently in **STUB mode** until `MSG91_AUTH_KEY` / `RESEND_API_KEY` are set in `.env`.
- **Manual trigger**: `POST /api/admin/cron/run-expiry-reminders` returns counts + `email_stub` + `sms_stub` flags for ops verification.
- **Bug fix**: pre-existing missing `TestimonialsSection` import in `/app/frontend/src/pages/Landing.jsx` (caused runtime ReferenceError) — now imported correctly.
- **Tele-calling explicitly skipped** per user instruction; remains in backlog.
- 10/10 new backend tests pass (`test_iter12.py`); E2E frontend smoke green.

### Iteration 14 (Feb 6, 2026) — PWA + Razorpay graceful fallback + RM cache
- **PWA install prompt** — `/app/frontend/public/manifest.webmanifest` + `service-worker.js` (network-first navigations, cache-first static assets, never caches `/api/*`). Tasteful bottom-right install pill (`PWAInstallPrompt.jsx`) listens for `beforeinstallprompt`, surfaces after 8 s delay, honors a 14-day dismissal window. Auto-hides on iOS standalone or already-installed Chrome PWA. App is installable on Chrome desktop, Edge, and Android Chrome.
- **Razorpay graceful fallback** — when live key auth fails (`razorpay.errors.BadRequestError: Authentication failed`), backend falls back to mock-mode automatically, logs a warning, and frontend Checkout auto-verifies the mock order. Real keys keep working when valid; dev/preview never breaks.
- **`/admin/raw-materials` cached 60 s** in process. Cache invalidates on rate edit (`PUT`) or reset (`POST`). Tests can bypass via `?fresh=1`. Cuts repeated mongo scans on the dashboard view.
### Iteration 13 (Feb 6, 2026) — ESLint guard + responsive admin layout
- **ESLint flat config** (`/app/frontend/eslint.config.mjs`) with `no-undef` + `react/jsx-no-undef` enabled — catches missing imports (lucide icons, helpers) at build time so they never reach the browser as runtime errors. Same bug class that crashed Raw Materials twice (Wallet, FileDown). New `yarn lint` script. 0 errors across the codebase today.
- **Mobile + tablet admin layout** — AdminLayout now collapses into a left-side drawer (`Sheet`) on screens below `lg` (1024 px). Sticky mini-header on small screens shows current page label + hamburger trigger. Desktop layout (sticky 260 px sidebar) preserved untouched. Drawer auto-closes on navigation. Heading sizes step down on mobile (`text-2xl sm:text-3xl md:text-4xl`).
- 64/64 backend tests still green; no API changes.

### Iteration 12 (Feb 6, 2026) — Purchase Order PDF + Staff workspace
- **Generate PO PDF** — `/admin/raw-materials` has a "Generate PO PDF" button that calls `POST /api/admin/purchase-orders/generate` (admin + staff). Backend uses `reportlab` (`/app/backend/po_pdf.py`) to render a branded A4 PDF with item-by-item quantities, lunch/dinner/day costs, supplier name, generated-by signature line, and notes. PO is stored in `db.purchase_orders` for audit; `GET /admin/purchase-orders` lists them, `GET /admin/purchase-orders/{po_number}/download` re-generates from snapshot.
- **Staff workspace** — staff role now has access to `/admin` with a filtered sidebar showing only:
  - **Today's deliveries** (`/admin/deliveries-today`) — read-only packing list with lunch/dinner tabs, full/half/all filters, search by name/phone/pincode, outstanding-empties chip, status pill per row.
  - **Raw materials** (read + generate PO; cannot edit rates).
  - **QR Scanner / Counter QR** (existing staff scope).
- **Backend access control**: `_admin_or_staff()` helper guards new staff endpoints. `PUT /admin/raw-materials` and `/reset` remain admin-only (rate edits stay with admin).
- **New endpoint**: `GET /api/staff/today-deliveries` returns `{date, rows, counts:{lunch:{full,half,delivered}, dinner:{full,half,delivered}, total_lunch, total_dinner, outstanding_empties}}`.
- **Staff post-login redirect**: staff land on `/admin/deliveries-today` (not subscriber dashboard).
- 11/11 new backend tests (test_iter11.py); 64/64 cumulative iter7-11 pass.
- **Admin wallet/refund overrides** — `POST /api/admin/users/{id}/wallet-adjust` with `{delta, reason, extend_days, restore_meals}` — admin can refund (positive delta), debit (negative, clamps at 0), extend the active sub end-date, or restore consumed meals. Audit-logged in `db.wallet_overrides`. Fronted by a new modal in `/admin/users` with recent-overrides list. `GET /admin/users/{id}/wallet-history` returns transactions + overrides.
- **Half-tiffin custom pricing** — `MEAL_PRICE_HALF_INR = 50` for `tiffin_size="half"` (₹100/day); full tiffin & dining stay ₹70/meal (₹140/day). `/plans/custom/preview` now accepts `service_type` + `tiffin_size` query params.
- **Tick model** — each active day-pass bumps `meals_used` by 2 (consumes the day's meal allocation) AND deducts the wallet. Inactive (3+ no-scan) days neither bump meals nor deduct money — they just extend `end_date` by 1 day. Scan-based `meals_used` increment removed (now solely tick-driven so attendance and meal accounting are decoupled).
- **Admin Raw Materials page** (`/admin/raw-materials`) — live-calculates daily procurement need from active subs:
  - Persons weighting: dining + full tiffin = 1, half tiffin = 0.5
  - Per-meal need = monthly per-person ÷ 60 (1 month = 60 meals)
  - Default rates: toor dal 2.1 kg @ ₹60/kg, rice 2.5 kg @ ₹90/kg, wheat 8 kg @ ₹40/kg, oil 1.8 L @ ₹190/L, vegetables ₹400/month
  - Lunch + dinner shown separately, with totals for each + day total
  - Admin can edit qty / price / amount per item, save, or reset to defaults
- 14/14 new backend tests (test_iter10.py); 53/53 cumulative iter7-10 pass.

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
