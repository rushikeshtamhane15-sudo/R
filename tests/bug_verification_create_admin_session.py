#!/usr/bin/env python3
"""Create a short-lived admin session token for focused Playwright UI testing."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pymongo import MongoClient


def read_env(path: str) -> dict[str, str]:
    out = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k] = v.strip().strip('"').strip("'")
    return out


env = read_env("/app/backend/.env")
db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
phone = env.get("ADMIN_PHONES", "9970705391").split(",")[0].strip() or "9970705391"
user = db.users.find_one({"phone": phone}, {"_id": 0})
if not user:
    raise SystemExit(f"No admin user found for phone {phone}")
if user.get("role") != "admin":
    db.users.update_one({"user_id": user["user_id"]}, {"$set": {"role": "admin"}})
token = f"sess_bugverif_{uuid.uuid4().hex}"
expires = datetime.now(timezone.utc) + timedelta(hours=2)
db.user_sessions.insert_one({
    "session_token": token,
    "user_id": user["user_id"],
    "expires_at": expires.isoformat(),
    "created_at": datetime.now(timezone.utc).isoformat(),
})
out = {"session_token": token, "user_id": user["user_id"], "phone": phone, "expires_at": expires.isoformat()}
Path("/app/test_reports/bug_verification_browser_session.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))