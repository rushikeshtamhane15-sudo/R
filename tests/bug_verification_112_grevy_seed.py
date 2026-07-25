"""Temporarily set the tiffin sabji catalog label to 'Grevy Sabji'.

Usage:
  python bug_verification_112_grevy_seed.py apply
  python bug_verification_112_grevy_seed.py restore

The backup is stored in /app/test_reports/bug_verification_112_tiffin_catalog_backup.json.
"""
import json
import sys
from pathlib import Path

from pymongo import MongoClient


BACKUP = Path("/app/test_reports/bug_verification_112_tiffin_catalog_backup.json")


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
coll = db.tiffin_pref_catalog


def serial(doc):
    if not doc:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


def apply():
    original = coll.find_one({"_id": "active"})
    BACKUP.write_text(json.dumps(serial(original), ensure_ascii=False, indent=2))
    doc = serial(original) or {
        "items": [
            {"key": "rice", "label": "Rice", "emoji": "🍚", "active": True, "order": 0},
            {"key": "dal", "label": "Dal", "emoji": "🍲", "active": True, "order": 1},
            {"key": "chapati", "label": "Chapati", "emoji": "🫓", "active": True, "order": 2},
            {"key": "sabji", "label": "Sabji", "emoji": "🥬", "active": True, "order": 3},
        ]
    }
    for item in doc.get("items", []):
        if item.get("key") == "sabji":
            item["label"] = "Grevy Sabji"
    coll.update_one({"_id": "active"}, {"$set": doc}, upsert=True)
    print({"ok": True, "mode": "apply", "backup": str(BACKUP)})


def restore():
    if not BACKUP.exists():
        print({"ok": False, "mode": "restore", "error": "backup missing"})
        sys.exit(1)
    original = json.loads(BACKUP.read_text())
    if original is None:
        coll.delete_one({"_id": "active"})
    else:
        coll.replace_one({"_id": "active"}, {"_id": "active", **original}, upsert=True)
    print({"ok": True, "mode": "restore"})


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"apply", "restore"}:
        print("usage: apply|restore")
        sys.exit(2)
    {"apply": apply, "restore": restore}[sys.argv[1]]()