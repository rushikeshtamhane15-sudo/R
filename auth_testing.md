# Auth Testing Playbook — efoodtech (iter-145 Emergent Google Auth)

## Multi-tenant twist
This app is a multi-tenant SaaS. Every non-admin user carries a `mess_id`.
The Emergent Google Auth flow now honours this — a user MUST pick a mess
(via the Login page step 1) before hitting "Continue with Google", and
their `mess_id` is passed to `POST /api/auth/session` so the session
gets tagged to the right tenant.

The frontend (`AuthCallback.jsx`) reads
`localStorage["efoodtech.mess.picked"]` and forwards its `.mess_id` in
the body. Backend enforces:
1. If `mess_id` doesn't exist / isn't active → 400
2. If user already has a different `mess_id` → 403
3. Else tag it on first login only.

## Step 1 · Create test session directly in Mongo (bypass Emergent Auth for CI)

```
mongosh $MONGO_URL --eval "
use('$DB_NAME');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  role: 'subscriber',
  mess_id: 'efoodcare-amravati',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
"
```

## Step 2 · Backend endpoints

```
curl -X GET "$API/api/auth/me" -H "Authorization: Bearer $TOKEN"
curl -X GET "$API/api/plans" -H "Authorization: Bearer $TOKEN"

curl -X POST "$API/api/auth/session" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"$EMERGENT_SESSION_ID","mess_id":"efoodcare-yavatmal"}'
```

## Step 3 · Browser E2E
- Open `/login`, pick a mess (Amravati OR Yavatmal)
- Click **Continue with Google (Emergent)** → redirects to `auth.emergentagent.com`
- After Google consent, lands on `/dashboard#session_id=...`
- `AuthCallback` reads fragment + picked mess → POSTs `/api/auth/session` → cookie set → role-based redirect

## Success indicators
- ✅ `/api/auth/me` returns user WITH `mess_id`
- ✅ `/api/plans` returns ONLY that mess's plans
- ✅ Cross-mess Google sign-in on a returning user → 403
- ✅ Fresh Gmail account first-time picked mess → tagged and persists

## Failure indicators
- ❌ 401 on `/auth/me` after redirect → cookie not set (check `samesite=None`, `secure=True`)
- ❌ User sees plans from wrong mess → mess_id not being passed through
- ❌ Callback screen stuck spinning → `useLocation().hash` not reactive or `session_id` missing

## Test identities used
- Super admin: phone `9970705391` (from `ADMIN_PHONES` in backend/.env)
- Regular subscriber: any phone via OTP dev mode (backend echoes `dev_otp`)
- Google test accounts: use your own Google account (Emergent Auth doesn't need whitelisting)
