"""Clear OTP rate-limit rows for the focused test subscriber only.

This is test setup for bug verification, not product code. It avoids a false
negative when the shared preview environment has already requested dev OTPs.
"""
from pathlib import Path
from pymongo import MongoClient


def read_env(path: Path) -> dict:
    out = {}
    for raw in path.read_text().splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        k, v = raw.split("=", 1)
        out[k] = v.strip().strip('"').strip("'")
    return out


env = read_env(Path("/app/backend/.env"))
db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
result = db.rate_limit_hits.delete_many({"key": "otp:phone:9333333333"})
print({"deleted": result.deleted_count, "key": "otp:phone:9333333333"})