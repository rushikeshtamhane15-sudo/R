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

### Iteration 22 (Feb 8, 2026) — Admin restaurant ops + WhatsApp outbox + rider promotion + login-aware cart
- **Admin Restaurant Orders** page (`/admin/restaurant-orders`) — kitchen-side ops view: every order with current status badge, customer name + tap-to-call, address, line items, action buttons gated by status (Mark preparing → Ready for pickup → admin hands off to rider). Reject button shows confirm prompt; status field accepts `preparing | ready_for_pickup | rejected`. Routes/admin sidebar nav added under Operations for both `admin` + `staff`.
- **Admin WhatsApp Outbox** (`/admin/whatsapp`) — last 50 WA events with status badge (Sent / Stub / Error), 4-tile counts, eye toggle to inline-render the branded HTML preview, **Resend** button per row (calls new `POST /api/admin/whatsapp/resend`). Stub-mode banner reminds admin to set `MSG91_WA_AUTH_KEY` to flip live.
- **"Promote to rider"** bike-icon button on every row of `/admin/users` — disabled for existing riders/admins. Wired to existing `POST /api/admin/rider/{user_id}/promote`. Role chooser also expanded from 3 → 5 options (subscriber/staff/admin/rider/delivery_boy).
- **Logged-in subscribers can now order from restaurant** — bottom nav for subscribers expanded to 5 tabs: Home · Dashboard · **Restaurant** · Wallet · Account.
- **Login-required hint on cart bar** — when a logged-out user has items in their cart, the sticky cart bar reads "Login required to checkout · Login & checkout" instead of just "Checkout".
- **New backend module** `routes/whatsapp_admin.py` with `GET /api/admin/whatsapp/outbox` and `POST /api/admin/whatsapp/resend`.

### Iteration 21 (Feb 8, 2026) — Rider mini-system + WhatsApp pipeline + admin refactor + real food images

**Major: full rider role for restaurant deliveries**
- New `rider` role (distinct from `delivery_boy`) with dedicated `/rider` dashboard.
- Order lifecycle pipeline: `created → paid → preparing → ready_for_pickup → out_for_delivery → delivered` (admin/staff transition first three; rider transitions the rest).
- **OTP-based delivery confirmation**: rider hits "I've arrived" → 4-digit OTP fires to customer via WhatsApp + SMS. Rider enters OTP → mark delivered + credit ₹50 to rider wallet.
- **Live location tracking**: 30s pings during `out_for_delivery` from `navigator.geolocation`; written to `db.users.current_lat/lng` and `db.restaurant_orders.rider_lat/lng` for snappy customer-side reads.
- **Customer tracking page** (`/restaurant/track/:orderId`): timeline of all 5 status steps, animated rider marker (pulsing red dot + bike SVG) on dark CARTO map, rider name + tap-to-call, ETA, full order summary, polls every 15s.
- **Earnings + wallet**: ₹50 flat per delivery. Today/month tallies on rider dashboard. Withdraw flow STUBBED for RazorpayX (debits wallet, queues `db.rider_payouts`).
- **Daily cash reconciliation OTP**: admin issues 6-digit OTP to rider's phone → rider enters OTP → all `payment_mode='cash' && cash_reconciled=False` orders flip to reconciled in one go. Pendency banner stays on rider dashboard until cleared.
- **Sound notification**: WebAudio-generated "ding" tone on rider dashboard whenever a new `ready_for_pickup` order arrives (mute toggle in header, persisted to localStorage).

**WhatsApp messaging pipeline** (`/app/backend/whatsapp.py`)
- Branded HTML preview (logo + "eFoodCare" + "ghar se accha khana" tagline + body + optional CTA) used for admin audit + persisted in `db.whatsapp_outbox` (capped at 1000 rows).
- 5 outbound templates wired: `registration`, `payment_success` (with Razorpay invoice URL), `expiry_reminder`, `restaurant_order` (with track URL), `delivery_otp`.
- **STUB MODE ACTIVE** — every send logs + persists but doesn't hit MSG91. Flip to live by setting `MSG91_WA_AUTH_KEY` + `MSG91_WA_INTEGRATED_NUMBER` + 5 template ID env vars.
- **Subscription expiry reminders** now follow user's spec: T-2 (2 days before) + T+1 (1 day after) — was `[3, 1, 0]`, now `[2, -1]`.

**Admin refactor (Phase 1)**
- `/admin/stats`, `/admin/attendance/today`, `/admin/users`, `/admin/role` extracted from server.py to `/app/backend/routes/admin.py`. Same late-binding pattern as previous extractions.

**Restaurant menu polish**
- Replaced `placehold.co` placeholder URLs with real curated Unsplash food photos in DEFAULT_MENU. One-shot migration in `_load_menu()` upgrades existing rows that still hold the old placeholders.

**Backend tests**: 22/22 still green (test_iter12 updated for new lead-day spec [2, -1]).

### Iteration 20 (Feb 7, 2026) — Restaurant ordering + UX upgrades
- **Restaurant ordering mini-app** (`/restaurant` public, `/restaurant/checkout` auth-gated, `/admin/restaurant` admin-only). Backend `/app/backend/routes/restaurant.py` (~340 LOC) handles menu CRUD + order creation/verification with same Razorpay account (tagged `notes.order_type='restaurant'` so admin dashboard can split flows). 15 default items seeded across 5 categories (Starters/Mains/Tiffin Specials/Beverages/Desserts). Frontend has separate localStorage cart (`efc_restaurant_cart_v1`) + sessionStorage buy-now (`efc_buynow_v1`) so the two flows can't pollute each other. Delivery: free over ₹400, ₹30 below. Server-computed totals so client can't smuggle a discount.
- **Splash screen** — held back to **2s** + **3D digital logo treatment** (multi-layer drop shadow, inner highlight, faint orbit ring, radial-red gradient bg). Removed sessionStorage skip — splash now appears on every cold app launch as the user requested.
- **Login form** — added dark-blue rounded-square `KeyRound` icon badge above the OTP form (with 3D shadow stack), tightened all vertical spacing for a more compact look.
- **Bottom nav for logged-out users** — now visible with 4 items (Home / Restaurant / Contact / Login). Logged-in subscribers keep their existing nav. Admin/staff/delivery-boy still hidden (they have the sidebar).
- **Raw materials** — Cylinder added to defaults (₹100/person/month, amount-based, /60 = per-meal cost). Admins AND staff can now PUT `/admin/raw-materials` (broadened from admin-only). New "Add item" button on `/admin/raw-materials` lets admin/staff add custom rows (label + ₹/person/month) using the same formula → auto-prices into lunch/dinner/day cost on save.
- **Tests**: 20/20 new backend tests in `test_iter15.py` green; frontend splash + bottom-nav + restaurant render/filter/cart/buy-now/auth-guards all verified by testing agent. **No regressions.**
- 🟡 **Deferred to next iteration** (per scope cap): admin route refactor (move `/admin/users`, `/admin/role`, attendance, stats into `routes/admin.py`).

### Iteration 19 (Feb 7, 2026) — Email channel removed
- **Email notifications fully removed** per product decision. Expiry reminders are now **SMS only** (T-3 / T-1 / T-0). The `db.expiry_reminders_sent` dedupe collection no longer carries `email_status`, and the admin trigger response no longer reports `email_stub` / `emails_sent`.
- Deleted `/app/backend/email_send.py` (Resend integration). Removed `RESEND_API_KEY` and `SENDER_EMAIL` from `/app/backend/.env`. No frontend changes were needed — email was a backend-only path.
- 22/22 tests still green (test_iter12 updated to assert email fields are absent, not present).

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

## Iteration 16 (Feb 7, 2026) — Customer Order History + Reorder + Login redirect fix
- **Customer-side Restaurant Order History** at `/restaurant/orders` (`RestaurantOrderHistory.jsx`) — newest-first, status-coloured chip per order, item summary (top 4 + "+ N more"), total, **Reorder** button, optional **Track** button for in-flight orders. Empty-state CTA back to menu. Backed by existing `GET /api/restaurant/orders`.
- **Reorder flow** — clicking Reorder pulls live menu, restocks the localStorage cart (`efc_restaurant_cart_v1`) with available items only (skipped items toast-warned), navigates to `/restaurant/checkout`. Same `RefreshCw` button also added to `OrderTrack.jsx` (`track-reorder-btn`) along with an "Order history" link.
- **BottomNav** — logged-in subscriber tabs are now `Restaurant · Orders · Dashboard · Account` (Tiffin moved out; Orders added).
- **Checkout success state** — added "My orders" CTA next to "Track" and "Continue browsing".
- **Login `?next=` redirect preservation (P0 fix)** — `RequireAuth` in `App.js` now forwards `location.pathname + location.search` via `?next=...`. `Login.jsx` reads `searchParams.get("next")` via a `computeNext()` helper used by both the already-logged-in bounce `useEffect` and `verifyOtp()`. Same `?next=` honoured on Google login redirect URL. **Verified 5/5 retest cases pass.**

## Iteration 17 (Feb 8, 2026) — Cancel/Refund + Reorder banner + ChefHat + Horizontal categories + Responsive grid
- **Customer order cancel + wallet refund** — `POST /api/restaurant/orders/{id}/cancel` (auth-gated, owner-only). Allowed only while `status='paid'` (kitchen hasn't started). Auto-credits the full order total back to `users.wallet_balance`, writes a `wallet_transactions` `credit` entry tagged "Restaurant order cancellation refund", flips order status to `cancelled` with `refund_amount` + `refund_mode='wallet'`. Idempotent — second call returns 400. **Cancel** buttons added on `/restaurant/orders` (per-card) and `/restaurant/track/:id` with `window.confirm` prompt + `checkAuth()` post-refund so the header wallet pill refreshes immediately.
- **"Reorder in 1 tap" banner** on `/restaurant` — pulls the most recent delivered order for the logged-in user, shows item summary + total, single CTA restocks cart against the live menu and bounces to `/restaurant/checkout`. Dismissible per-session (`sessionStorage efc_reorder_dismissed_v1`).
- **Horizontal categories chip rail** — replaced the vertical 88/140-px sticky left rail with a horizontally-scrollable sticky chip strip (`.no-scrollbar` utility added in `index.css`). Items grid is now responsive: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
- **ChefHat icon swap** — Restaurant header, BottomNav (`Restaurant` tab), and AdminLayout sidebar `Restaurant menu` row now use lucide `ChefHat` instead of `UtensilsCrossed`.
- **Mobile + PC polish** — verified at 390×844 (mobile) and 1440×900 (desktop). Backend 12/12 pytest pass; frontend full-flow validated.

## Iteration 21 (Feb 9, 2026) — TrackMap3D + Rider Dashboard fix + Live tracking pill
- **TrackMap3D component** (`/app/frontend/src/components/TrackMap3D.jsx`) — adaptive renderer:
  - **Desktop (≥768px)**: MapLibre GL JS at 60° pitch, smooth `easeOutCubic` interpolation between rider pings, glowing pulse around the bike marker, dark CartoCDN raster tiles, navigation control with pitch indicator. Camera follows rider via `easeTo`.
  - **Mobile (<768px)**: react-leaflet for battery + bundle savings, same visual language (dark theme + pulsing rider).
  - Status badge `Live · 3D` (desktop) / `Live · smooth` (mobile) at top-right.
- **OrderTrack.jsx** — replaced inline Leaflet map with `<TrackMap3D>`. Shows customer pin too when `customer_lat/lng` are available.
- **Backend** — `/api/restaurant/orders/{id}/track` now returns `customer_lat/customer_lng` (with fallback to `users.lat/users.lng` from saved profile).
- **Active-track pill** on `/restaurant` home — emerald-themed CTA appears for logged-in users with an in-flight order, deep-links to `/restaurant/track/<order_id>`.
- **Rider Dashboard rendering fix** — `useAuth().refresh` was undefined (real key is `checkAuth`); silent error swallow on `/rider/me` 403 left page stuck on Loading forever. Added `loadErr` state with proper error UI + Retry button (`data-testid='rider-error'`).
- **OTP delivery confirmation** (already wired backend) — verified rider flow: pickup → arrived (server fires WA delivery_otp, returns dev_otp in dev mode) → deliver (rider enters OTP, server verifies, marks delivered, credits ₹50 to rider wallet).

## Iteration 22 (Feb 9, 2026) — 8-feature batch (multi-order + sounds + wallet + rider apply + 3D buildings + rename + admin tools)

### Features delivered
- **Multi-order tracking switcher** on `/restaurant/track/:orderId` — appears when user has ≥2 in-flight orders. Horizontal pills (data-testid `track-multi-switcher` + `switch-<orderId>`) deep-link between concurrent orders.
- **Auto-save profile from checkout** — first-time customer details (name/phone/address) typed at restaurant checkout are saved to `users` profile. Subsequent checkouts pre-fill from profile.
- **Sound + voice notifications** — new `lib/notify.js` module (Web Audio + `speechSynthesis`). Wired:
  - Admin `/admin/restaurant-orders` — auto-poll every 12s, plays alarm + says "N new restaurant orders" on new paid orders. Sound toggle (`orders-sound-toggle`) persists via localStorage.
  - Rider `/rider` — alertWithVoice replaces basic ding for new ready_for_pickup orders.
  - Customer `/restaurant/track/:id` — alertWithVoice("Your rider is on the way…") fires when status flips to `out_for_delivery`.
- **Wallet on checkout** — `/restaurant/checkout` now shows `checkout-wallet` panel for users with `wallet_balance > 0`. Toggle (`apply-wallet-toggle`) flips backend `apply_wallet` flag. Bill summary breaks out wallet credit. Pay button text adapts ("Pay ₹X" / "Place order" if fully covered). Backend `/restaurant/order` returns `{wallet_used, payable}`. Wallet debit is logged to `wallet_transactions` on `/restaurant/verify` success.
- **Self-service rider application** — new `/become-a-rider` page with full form (name, phone, licence, bike #, bank a/c last-4, city). Backend POST `/api/rider/apply` creates a `rider_applications` doc (status=pending). New admin page `/admin/rider-applications` lists pending/approved/rejected with one-click approve (auto-promotes to rider) or reject. Header hamburger surfaces "Become a rider" link for non-rider users.
- **3D buildings on TrackMap3D** — desktop map switched to OpenFreeMap "liberty" vector tiles + adds a `fill-extrusion` layer with zoom-interpolated extrusion height (renders building masses on tilt). Badge text now reads "Live · 3D Buildings".
- **Tiffin → Subscription rename** + **BottomNav grid-cols-4 equal spacing** for visual polish.
- **Admin role assign by phone** — `/admin/role` accepts `phone` OR `email` (or both, matched by `$or`). UI updated with phone field + helper copy.

### Bug fixes during this iteration
- `User` Pydantic model + `doc_to_user` were dropping `wallet_balance` from `/auth/me` payload — added field + populated from doc. This was silently breaking the checkout wallet toggle (always rendered `walletBalance=0`).

## Iteration 23 (Feb 9, 2026) — Sound unlock + Location picker + BottomNav fix + Combined live map

### Features delivered
- **Sound auto-unlock** (`lib/notify.js`) — added `unlockAudio()` that resumes the suspended `AudioContext` and warms `speechSynthesis` via a silent utterance. Called from the first user-gesture click on Admin/Rider sound toggles. Browsers gate audio behind a user gesture; this fixes the "silent" admin-orders/rider-pickup alerts the user reported.
- **Location-pin picker on checkout** — new `components/LocationPicker.jsx` (Leaflet + draggable pin + geolocation auto-detect with Pune fallback). Wired into `/restaurant/checkout`. Backend `CreateRestaurantOrder` now accepts `customer_lat/customer_lng`; saves to order doc and auto-promotes to `users.lat/lng` on first checkout. `/restaurant/orders/{id}/track` already returns `customer_lat/lng` so TrackMap3D shows the customer pin too. Rider sees customer pin via the same endpoint.
- **BottomNav overlap fix** — Restaurant cart-bar bumped to `bottom-20 z-40` (above BottomNav at `bottom-0 z-30`). Page padding now `pb-40 md:pb-32` so content isn't covered by either bar.
- **Admin login redirect** — already routes admin → `/admin` via `Login.jsx` `computeNext()`. Verified.
- **Admin combined live map** (`/admin/live`) — single screen now shows tiffin delivery boys (green), restaurant riders (red pulse, `🛵`), tiffin customer pins, and restaurant order pins (`🍽️`). New backend endpoint `GET /api/admin/live/restaurant` returns `{orders, riders}`. Stats grid: Tiffin boys · Restaurant riders · Restaurant orders · Tiffin pending.
- **Restaurant CMS** — deferred per user (B=a). Will scope separately when ready.

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
