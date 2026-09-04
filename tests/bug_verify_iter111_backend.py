#!/usr/bin/env python3
import json, os, requests, time
from pathlib import Path
from pymongo import MongoClient

ROOT = Path('/app')
# load minimal .env without external deps
env = {}
for line in (ROOT/'backend/.env').read_text().splitlines():
    if '=' in line and not line.strip().startswith('#'):
        k,v = line.split('=',1)
        env[k.strip()] = v.strip().strip('"').strip("'")
MONGO_URL = env.get('MONGO_URL','mongodb://localhost:27017')
DB_NAME = env.get('DB_NAME','test_database')
API = os.environ.get('API_BASE','https://dining-atomics.preview.emergentagent.com/api')
client = MongoClient(MONGO_URL)
db = client[DB_NAME]

result = {"api": API, "checks": []}

def add(name, ok, details=None):
    result['checks'].append({"name": name, "ok": bool(ok), "details": details or {}})
    print(f"{name}: {'PASS' if ok else 'FAIL'} {details or ''}")

# Preserve non-subscriber fields from current doc; this test intentionally validates subscriber self-heal.
orig = db.app_config.find_one({'_id':'bottom_nav'}) or {'_id':'bottom_nav'}
legacy_sub = [
    {'id':'orders','label':'Orders','icon':'Receipt','to':'/restaurant/orders','visible':True},
    {'id':'dashboard','label':'Dashboard','icon':'LayoutDashboard','to':'/dashboard','visible':True},
]
db.app_config.update_one({'_id':'bottom_nav'}, {'$set': {'subscriber': legacy_sub}}, upsert=True)
seeded = db.app_config.find_one({'_id':'bottom_nav'}, {'_id':0}) or {}
add('seed legacy bottom nav subscriber field', seeded.get('subscriber') == legacy_sub, {'subscriber': seeded.get('subscriber')})

r = requests.get(f'{API}/bottom-nav', timeout=20)
try:
    body = r.json()
except Exception:
    body = {'raw': r.text[:500]}
labels = [it.get('label') for it in body.get('subscriber', [])]
ids = [it.get('id') for it in body.get('subscriber', [])]
expected_labels = ['Restaurant','Dashboard','Scan','Subscribe','Account']
add('GET /api/bottom-nav returns fresh subscriber default after legacy seed', r.status_code == 200 and labels == expected_labels and ids == ['restaurant','dashboard','scan','subscribe','account'], {'status': r.status_code, 'labels': labels, 'ids': ids})

after = db.app_config.find_one({'_id':'bottom_nav'}, {'_id':0}) or {}
add('GET /api/bottom-nav unset persisted subscriber field', 'subscriber' not in after, {'app_config_keys': sorted(after.keys()), 'subscriber': after.get('subscriber')})

# Leave self-healed state in place (subscriber unset) but restore unrelated original fields if test overwrote none.
# If original doc had a non-legacy subscriber, do not restore it because this bug is specifically about auto-healing legacy subscriber layout on read.
Path('/app/test_reports/bug_verify_iter111_backend_result.json').write_text(json.dumps(result, indent=2))
if not all(c['ok'] for c in result['checks']):
    raise SystemExit(1)
