import os, json, uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from pymongo import MongoClient
from dotenv import dotenv_values

ROOT = Path('/app')
backend_env = dotenv_values(ROOT / 'backend' / '.env')
frontend_env = dotenv_values(ROOT / 'frontend' / '.env')
MONGO_URL = backend_env.get('MONGO_URL', 'mongodb://localhost:27017').strip('"')
DB_NAME = backend_env.get('DB_NAME', 'test_database').strip('"')
BASE = (frontend_env.get('REACT_APP_BACKEND_URL') or 'http://localhost:8001').strip().rstrip('/')
API = BASE + '/api'
client = MongoClient(MONGO_URL)
db = client[DB_NAME]
now = datetime.now(timezone.utc)
iso = lambda d: d.isoformat()

RUN = 'iter108'

def issue_session(user_id, suffix):
    token = f'test_{RUN}_{suffix}_{uuid.uuid4().hex[:10]}'
    db.user_sessions.insert_one({
        'session_token': token,
        'user_id': user_id,
        'expires_at': iso(now + timedelta(days=7)),
        'created_at': iso(now),
        'test_run': RUN,
    })
    return token

# Ensure known dining subscriber is usable without altering prod-like data except session.
dining_user = db.users.find_one({'user_id': 'user_54f9acc2eb0a'}, {'_id': 0}) or db.users.find_one({'phone':'9333333333'}, {'_id':0})
if not dining_user:
    raise SystemExit('Missing required dining user user_54f9acc2eb0a / 9333333333')
dining_token = issue_session(dining_user['user_id'], 'dining')

# Temporary legacy active subscription missing last_tick_date for backfill proof.
legacy_user_id = f'user_{RUN}_legacy'
legacy_phone = '9555518108'
db.users.update_one({'user_id': legacy_user_id}, {'$set': {
    'user_id': legacy_user_id,
    'phone': legacy_phone,
    'name': 'Legacy Tester',
    'address': 'Test address Amravati 444607',
    'photo_url': 'https://example.com/photo.jpg',
    'role': 'subscriber',
    'qr_token': f'qr_{RUN}_legacy',
    'wallet_balance': 1400.0,
    'created_at': iso(now),
    'test_run': RUN,
}}, upsert=True)
legacy_sub_id = f'sub_{RUN}_legacy_missing_tick'
db.subscriptions.delete_many({'sub_id': legacy_sub_id})
legacy_start = now - timedelta(days=1)
db.subscriptions.insert_one({
    'sub_id': legacy_sub_id,
    'user_id': legacy_user_id,
    'plan_id': 'premium_60',
    'plan_name': 'Legacy Dining Missing Tick',
    'amount_paid': 1400.0,
    'plan_amount': 1400.0,
    'pending_amount': 0,
    'currency': 'INR',
    'meals_total': 30,
    'meals_used': 0,
    'wallet_balance': 1400.0,
    'per_day_amount': 50.0,
    'start_date': iso(legacy_start),
    'end_date': iso(now + timedelta(days=20)),
    # intentionally no last_tick_date
    'paused_days': 0,
    'status': 'active',
    'service_type': 'dining',
    'plan_type': 'kiosk',
    'category': 'dining',
    'user_paused': False,
    'created_at': iso(legacy_start),
    'test_run': RUN,
})
legacy_token = issue_session(legacy_user_id, 'legacy')

# Incomplete profile test user (missing address/photo) for AccountHub/gating.
incomplete_user_id = f'user_{RUN}_incomplete'
incomplete_phone = '9555518109'
db.users.update_one({'user_id': incomplete_user_id}, {'$set': {
    'user_id': incomplete_user_id,
    'phone': incomplete_phone,
    'name': 'Incomplete Tester',
    'address': '',
    'photo_url': '',
    'picture': None,
    'role': 'subscriber',
    'qr_token': f'qr_{RUN}_incomplete',
    'wallet_balance': 0.0,
    'created_at': iso(now),
    'test_run': RUN,
}}, upsert=True)
incomplete_token = issue_session(incomplete_user_id, 'incomplete')

# Tiffin profile user + active tiffin subscription for dashboard layout proof.
tiffin_user_id = f'user_{RUN}_tiffin'
tiffin_phone = '9555518110'
db.users.update_one({'user_id': tiffin_user_id}, {'$set': {
    'user_id': tiffin_user_id,
    'phone': tiffin_phone,
    'name': 'Tiffin Tester',
    'address': 'Tiffin address Amravati 444607',
    'photo_url': 'https://example.com/tiffin-photo.jpg',
    'role': 'subscriber',
    'qr_token': f'qr_{RUN}_tiffin',
    'wallet_balance': 2600.0,
    'created_at': iso(now),
    'test_run': RUN,
}}, upsert=True)
tiffin_sub_id = f'sub_{RUN}_tiffin'
db.subscriptions.delete_many({'sub_id': tiffin_sub_id})
db.subscriptions.insert_one({
    'sub_id': tiffin_sub_id,
    'user_id': tiffin_user_id,
    'plan_id': 'classic_60',
    'plan_name': 'Classic Full Tiffin',
    'amount_paid': 2600.0,
    'plan_amount': 2600.0,
    'pending_amount': 0,
    'currency': 'INR',
    'meals_total': 56,
    'meals_used': 0,
    'wallet_balance': 2600.0,
    'per_day_amount': 92.86,
    'start_date': iso(now),
    'end_date': iso(now + timedelta(days=28)),
    'last_tick_date': (now + timedelta(hours=5, minutes=30)).date().isoformat(),
    'paused_days': 0,
    'status': 'active',
    'service_type': 'tiffin',
    'plan_type': 'delivery',
    'category': 'tiffin',
    'tiffin_size': 'full',
    'tiffins_per_day': 2,
    'user_paused': False,
    'created_at': iso(now),
    'test_run': RUN,
})
tiffin_token = issue_session(tiffin_user_id, 'tiffin')

# API checks
results = {'base': BASE, 'tokens': {'dining': dining_token, 'legacy': legacy_token, 'incomplete': incomplete_token, 'tiffin': tiffin_token}, 'users': {'dining': dining_user['user_id'], 'legacy': legacy_user_id, 'incomplete': incomplete_user_id, 'tiffin': tiffin_user_id}, 'checks': []}

def check(name, method, path, token=None, **kwargs):
    headers = kwargs.pop('headers', {})
    if token:
        headers['Authorization'] = f'Bearer {token}'
    r = requests.request(method, API + path, headers=headers, timeout=20, **kwargs)
    ok = 200 <= r.status_code < 300
    try: body = r.json()
    except Exception: body = r.text[:500]
    results['checks'].append({'name': name, 'status': r.status_code, 'ok': ok, 'body_excerpt': body if isinstance(body, dict) else str(body)[:500]})
    return r, body

r, body = check('dining /my/wallet returns 200', 'GET', '/my/wallet', dining_token)
if r.status_code == 200:
    sub = body.get('subscription') or {}
    results['dining_wallet'] = {'wallet_balance': body.get('wallet_balance'), 'sub_id': sub.get('sub_id'), 'last_tick_date': sub.get('last_tick_date')}

r, body = check('legacy missing last_tick /my/wallet returns 200', 'GET', '/my/wallet', legacy_token)
legacy_after = db.subscriptions.find_one({'sub_id': legacy_sub_id}, {'_id': 0, 'last_tick_date': 1, 'start_date': 1})
results['legacy_backfill'] = legacy_after

r, body = check('wallet transactions returns 200', 'GET', '/my/wallet/transactions', dining_token)
results['dining_txn_count'] = len(body.get('transactions', [])) if isinstance(body, dict) else None

r, body = check('bottom nav runtime config', 'GET', '/bottom-nav')
results['subscriber_bottom_nav'] = body.get('subscriber') if isinstance(body, dict) else None

r, body = check('plans available', 'GET', '/plans')
results['first_plan_id'] = (body.get('plans') or [{}])[0].get('plan_id') if isinstance(body, dict) else None

out_path = ROOT / 'test_reports' / 'bug_verification_108_setup_api_results.json'
out_path.write_text(json.dumps(results, indent=2, default=str))
print(json.dumps(results, indent=2, default=str))
