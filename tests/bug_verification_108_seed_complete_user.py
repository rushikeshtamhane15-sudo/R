from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import dotenv_values
import uuid, json
be=dotenv_values('/app/backend/.env')
db=MongoClient(be['MONGO_URL'].strip('"'))[be['DB_NAME'].strip('"')]
now=datetime.now(timezone.utc)
uid='user_iter108_complete'
db.users.update_one({'user_id':uid},{'$set':{'user_id':uid,'phone':'9555518111','name':'Complete Tester','address':'Complete address Amravati 444607','photo_url':'https://example.com/photo.jpg','role':'subscriber','qr_token':'qr_iter108_complete','wallet_balance':777,'created_at':now.isoformat(),'test_run':'iter108'}},upsert=True)
sub='sub_iter108_complete_dining'
db.subscriptions.delete_many({'sub_id':sub})
db.subscriptions.insert_one({'sub_id':sub,'user_id':uid,'plan_id':'premium_60','plan_name':'Premium Dining','amount_paid':2800,'plan_amount':2800,'pending_amount':0,'currency':'INR','meals_total':56,'meals_used':0,'wallet_balance':777,'per_day_amount':100,'start_date':now.isoformat(),'end_date':(now+timedelta(days=10)).isoformat(),'last_tick_date':(now+timedelta(hours=5,minutes=30)).date().isoformat(),'paused_days':0,'status':'active','service_type':'dining','plan_type':'kiosk','category':'dining','user_paused':False,'created_at':now.isoformat(),'test_run':'iter108'})
token='test_iter108_complete_'+uuid.uuid4().hex[:10]
db.user_sessions.insert_one({'session_token':token,'user_id':uid,'expires_at':(now+timedelta(days=7)).isoformat(),'created_at':now.isoformat(),'test_run':'iter108'})
print(json.dumps({'token':token,'user_id':uid,'sub_id':sub}))
