#!/usr/bin/env python3
import json, sys
from pathlib import Path
from pymongo import MongoClient

ROOT=Path('/app')
env={}
for line in (ROOT/'backend/.env').read_text().splitlines():
    if '=' in line and not line.strip().startswith('#'):
        k,v=line.split('=',1); env[k.strip()]=v.strip().strip('"').strip("'")
db=MongoClient(env.get('MONGO_URL','mongodb://localhost:27017'))[env.get('DB_NAME','test_database')]
SNAP=Path('/app/test_reports/bug_verify_iter111_tiffin_snapshot.json')
PHONE='9333333333'

def clean(doc):
    if not doc: return None
    d=dict(doc); d.pop('_id', None); return d

cmd=sys.argv[1] if len(sys.argv)>1 else 'seed'
user=db.users.find_one({'phone': PHONE},{'_id':0})
if not user:
    raise SystemExit('target user missing')
if cmd=='seed':
    sub=db.subscriptions.find_one({'user_id': user['user_id'], 'status':'active'}, sort=[('created_at', -1)])
    if not sub:
        raise SystemExit('active subscription missing for target user')
    SNAP.write_text(json.dumps({'user': user, 'sub': clean(sub)}, indent=2, default=str))
    db.subscriptions.update_one({'sub_id': sub['sub_id']}, {'$set': {
        'service_type':'tiffin',
        'category':'tiffin',
        'tiffin_size':'full',
        'meal_window':'both',
        'plan_name': sub.get('plan_name') or 'Premium Tiffin',
        'status':'active',
        'meals_used': min(int(sub.get('meals_used', 0)), max(0, int(sub.get('meals_total', 1))-1)),
    }})
    # Keep no pending deliveries so PendingDeliveriesBanner info-state is tested.
    db.delivery_roster.update_many({'user_id': user['user_id'], 'status': {'$in':['scheduled','out']}}, {'$set': {'status':'cancelled_for_test'}})
    fresh=db.subscriptions.find_one({'sub_id': sub['sub_id']},{'_id':0})
    print(json.dumps({'seeded': True, 'user_id': user['user_id'], 'sub_id': sub['sub_id'], 'service_type': fresh.get('service_type')}, indent=2))
elif cmd=='restore':
    if not SNAP.exists():
        print(json.dumps({'restored': False, 'reason': 'snapshot missing'})); raise SystemExit(0)
    snap=json.loads(SNAP.read_text())['sub']
    sub_id=snap['sub_id']
    db.subscriptions.replace_one({'sub_id': sub_id}, snap, upsert=True)
    print(json.dumps({'restored': True, 'sub_id': sub_id, 'service_type': snap.get('service_type')}, indent=2))
else:
    raise SystemExit('usage: seed|restore')
