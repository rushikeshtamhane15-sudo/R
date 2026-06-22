# eFoodCare — Mobile App API Contract

> Last updated: Feb 2026 · iter-119 (pass-scan mobile sync handshake)

This is the contract for the **pass-scan-mobile** app to talk to the same eFoodCare backend the web app uses. Both apps share **one MongoDB cluster** and **one set of `/api/*` endpoints**, so any user who logs in on either side sees the same wallet, subscription, attendance history, and tiffin state.

---

## 1. Base URL

```
PRODUCTION:  https://efoodcare.in/api
STAGING:     https://dining-pass-scan.preview.emergentagent.com/api
```

All endpoints below are prefixed with `/api`. CORS is wildcard-open (`allow_origins=*`), so the mobile app can call directly with no proxy.

---

## 2. Authentication

The backend supports **two auth modes** off the same `session_token` value — pick whichever your mobile framework handles best:

| Mode | Header / Mechanism | Use for |
|---|---|---|
| **Bearer** (recommended for mobile) | `Authorization: Bearer <session_token>` | React Native, Flutter, native iOS/Android |
| **Cookie** (default for web) | `Cookie: session_token=<...>` (HttpOnly, SameSite=None, Secure) | Web only |

`get_current_user` (backend/server.py) reads the cookie first, then falls back to the `Authorization` header — so a mobile app that stores `session_token` in **Keychain / EncryptedSharedPreferences** and sends it as `Bearer` works out of the box.

### 2.1 Sign-in flow (OTP)

```
POST /api/auth/send-otp
Body: { "phone": "9876543210" }
200:  { "ok": true, "expires_in": 600, "dev_otp": "...", "dev_mode": true }   # dev_otp only in dev
429:  { "detail": "Too many requests · OTP per phone (10 min) · try again in Ns" }

POST /api/auth/verify-otp
Body: { "phone": "9876543210", "otp": "123456", "name": "Optional Name" }
200:  {
        "user": { "user_id": "...", "name": "...", "phone": "...", "email": null,
                  "wallet_balance": 7420.0, "role": "subscriber", "mess_id": "...",
                  "qr_token": "qr_...", "created_at": "..." },
        "session_token": "sess_...."
      }
400:  { "detail": "Incorrect OTP" | "OTP expired" | "No OTP requested for this number" }
429:  { "detail": "Too many attempts" }
```

→ **Mobile app: persist `session_token` to secure storage, then send it as `Authorization: Bearer ...` on every subsequent request.**

Rate limits (per IP + per phone):
- `3 OTP / phone / 10 min`
- `10 OTP / IP / hour`
- `50 OTP / IP / day`

### 2.2 Logout

```
POST /api/auth/logout
Headers: Authorization: Bearer <token>
200:  { "ok": true }     # invalidates session in db.user_sessions
```

---

## 3. Endpoints the mobile app needs

All endpoints below require `Authorization: Bearer <session_token>` unless noted as public.

### 3.1 User profile

| Method | Path | Returns / Body |
|---|---|---|
| `GET`  | `/api/auth/me` | Full user object (see 2.1 shape) |
| `POST` | `/api/auth/profile` | Body: `{ name, phone, address, photo_url?, dob?, gender? }` — updates profile |
| `POST` | `/api/auth/location` | Body: `{ lat, lng }` — sets delivery pin + reverse-geocodes pincode |
| `GET`  | `/api/auth/prefs` | `{ sound: bool, voice: bool }` |
| `POST` | `/api/auth/prefs` | Body: `{ sound: bool, voice: bool }` |
| `DELETE` | `/api/auth/me` | Permanently deletes account + cascade (subs, attendance, deliveries, …) |

### 3.2 Subscription

| Method | Path | Returns |
|---|---|---|
| `GET`  | `/api/my/subscription`         | Current sub: `{ subscription: { sub_id, plan_id, start_date, end_date, meals_total, meals_used, service_type, status, user_paused, ... } }` or `null` |
| `POST` | `/api/my/subscription/pause`   | Pauses tiffin delivery (no body) |
| `POST` | `/api/my/subscription/resume`  | Resumes |

### 3.3 Wallet

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/my/wallet`              | `{ wallet_balance, days_left, meals_left, daily_rate, ... }` |
| `GET` | `/api/my/wallet/transactions` | `[{ ts, amount, kind, note, ... }]` |
| `GET` | `/api/my/partial-balance`     | Carry-forward partial-month balance |

### 3.4 QR + attendance (**core mobile use-case**)

| Method | Path | Returns / Notes |
|---|---|---|
| `GET`  | `/api/my/qr` | `{ qr_token, qr_data_url }` — render `qr_data_url` as image, or generate locally from `qr_token` |
| `GET`  | `/api/counter/qr` | Active rotating counter code (5-min HMAC). Subscriber scans this to self-check-in. |
| `GET`  | `/api/counter/qr/public?location_id=...` | **PUBLIC** — used by the kiosk display, no auth needed |
| `POST` | `/api/attendance/self-scan` | Body: `{ counter_code, location_id?, lat?, lng? }` — subscriber side, marks themselves present using the counter code |
| `POST` | `/api/attendance/scan` | Body: `{ qr_token, meal_type? }` — staff side, scans subscriber's QR (staff role only) |
| `GET`  | `/api/my/attendance` | `{ attendance: [{ date_str, meal_type, ts, location_id }, ...] }` |

### 3.5 Today's menu

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/menu/today` | `{ lunch: { items: [...], service_time: "12-3pm" }, dinner: {...} }` |

### 3.6 Tiffin delivery (for tiffin subscribers)

| Method | Path | Returns |
|---|---|---|
| `GET`  | `/api/my/deliveries/pending`         | `{ pending: [{ roster_id, meal_type, tiffin_size, status, ... }], date }` — today's tiffins still on the way |
| `GET`  | `/api/my/deliveries/track`           | Live boy position + ETA: `{ tracking, boy_name, boy_phone, boy_position: {lat,lng,last_ping_at}, your_position, distance_m, eta_minutes, meal_type, status, dispatch: {lat,lng,radius_km}, tiffin_balance }` — returns `{tracking:false}` when no boy is en-route |
| `POST` | `/api/my/deliveries/{roster_id}/confirm` | Customer self-confirms tiffin received. Marks roster `delivered`, bumps `tiffin_balance`, decrements stock. |

### 3.7 Mess (branch) info

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/messes` | All active branches (PUBLIC) |
| `GET` | `/api/messes/nearby?lat=...&lng=...` | Nearest branches (PUBLIC) |
| `GET` | `/api/me/mess` | The current user's assigned mess |
| `POST`| `/api/me/mess` | Body: `{ mess_id }` — change assigned mess |

### 3.8 Notices (admin → subscriber announcements)

| Method | Path | Returns |
|---|---|---|
| `GET`  | `/api/auth/notices` | Active notices |
| `POST` | `/api/auth/notices/ack` | Body: `{ notice_id }` — mark read |

---

## 4. Error contract

All errors are FastAPI's standard shape:

```json
{ "detail": "Human-readable message" }
```

HTTP codes used:
- `400` — bad request / validation
- `401` — not authenticated / session expired
- `403` — wrong role (e.g. subscriber hitting staff-only scan)
- `404` — not found
- `409` — conflict (e.g. already checked in for this meal)
- `429` — rate-limited (read `Retry-After` header)
- `5xx` — backend error (log + retry with exponential backoff)

---

## 5. Mobile-side checklist

- [ ] Store `session_token` in **Keychain (iOS) / EncryptedSharedPreferences (Android)** — never in plain `AsyncStorage`.
- [ ] Send `Authorization: Bearer <session_token>` on every request.
- [ ] On `401`, clear stored token and route user back to OTP login.
- [ ] Honour `Retry-After` on `429` responses.
- [ ] If app is offline at scan time, queue the `/attendance/self-scan` POST and retry on reconnect (idempotent for same `counter_code` + same minute).
- [ ] For the live-tracking screen (`/my/deliveries/track`), poll every **10 seconds** while the screen is visible — drop to **30 s** when backgrounded.

---

## 6. What the mobile app does NOT need

- All `/admin/*` endpoints (admin web only)
- All `/rider/*` endpoints (rider web app only)
- All `/franchise/*` endpoints (franchise console only)
- `/api/payments/*` — Razorpay is web-only; if mobile wants in-app upgrade later, use Razorpay's native SDK and call `/api/payments/verify` to credit the wallet
