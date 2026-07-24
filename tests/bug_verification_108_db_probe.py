import json
from pathlib import Path
from pymongo import MongoClient
from dotenv import dotenv_values
be=dotenv_values('/app/backend/.env')
db=MongoClient(be['MONGO_URL'].strip('"'))[be['DB_NAME'].strip('"')]
for q in [{'user_id':'user_54f9acc2eb0a'}, {'user_id':'user_iter108_incomplete'}, {'user_id':'user_iter108_tiffin'}]:
    u=db.users.find_one(q, {'_id':0,'user_id':1,'phone':1,'name':1,'address':1,'photo_url':1,'picture':1,'wallet_balance':1})
    print(json.dumps(u, indent=2, default=str))
