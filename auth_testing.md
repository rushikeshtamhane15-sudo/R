# Auth Testing Playbook

## Step 1: Seed test user + session
```
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
var qrToken = 'qr_test_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test Subscriber',
  picture: null,
  role: 'subscriber',
  qr_token: qrToken,
  created_at: new Date().toISOString()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
  created_at: new Date().toISOString()
});
print('TOKEN=' + sessionToken);
print('USER=' + userId);
print('QR=' + qrToken);
"
```

## Step 2: Backend API testing
```
curl -H "Authorization: Bearer <TOKEN>" $REACT_APP_BACKEND_URL/api/auth/me
curl -H "Authorization: Bearer <TOKEN>" $REACT_APP_BACKEND_URL/api/plans
curl -H "Authorization: Bearer <TOKEN>" $REACT_APP_BACKEND_URL/api/my/qr
curl -H "Authorization: Bearer <TOKEN>" $REACT_APP_BACKEND_URL/api/my/subscription
curl -H "Authorization: Bearer <TOKEN>" $REACT_APP_BACKEND_URL/api/my/attendance
curl -H "Authorization: Bearer <TOKEN>" $REACT_APP_BACKEND_URL/api/menu/today
```

## Step 3: Promote to staff/admin (for role-gated tests)
Directly in Mongo: `db.users.updateOne({user_id: USER}, {$set: {role: 'admin'}})`
Or via API by an existing admin: `POST /api/admin/role {email, role}`

## Step 4: Seed active subscription for attendance tests
```
db.subscriptions.insertOne({
  sub_id: 'sub_test',
  user_id: USER,
  plan_id: 'monthly_60',
  plan_name: 'Monthly Pass',
  meals_total: 60,
  meals_used: 0,
  start_date: new Date().toISOString(),
  end_date: new Date(Date.now() + 30*24*60*60*1000).toISOString(),
  status: 'active',
  created_at: new Date().toISOString()
});
```

## Step 5: Attendance flow tests
- Staff scan: `POST /api/attendance/scan` with body `{qr_token, meal_type}`
- Self-scan (subscriber): first fetch counter code via `GET /api/counter/qr` (as staff/admin), then `POST /api/attendance/self-scan` with `{counter_code, meal_type}`
- Duplicate prevention: same (user, date, meal_type) returns 409

## Cleanup
```
db.users.deleteMany({email: /test\.user\./});
db.user_sessions.deleteMany({session_token: /test_session/});
db.subscriptions.deleteMany({sub_id: 'sub_test'});
db.attendance.deleteMany({user_id: /test-user/});
```
