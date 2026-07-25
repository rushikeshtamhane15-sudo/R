"""Focused backend checks for iteration 112 bug verification.

Checks:
1. Public GET /api/bottom-nav returns subscriber scan icon as QrCode.
2. Legacy persisted config with subscriber scan.icon == ScanLine self-heals by
   unsetting the subscriber override and returning the default QrCode nav.
"""
import json
import os
import sys
from pathlib import Path

import requests
from pymongo import MongoClient


APP = Path("/app")
BACKEND_ENV = APP / "backend" / ".env"
BACKEND_URL = "https://dining-pass-scan.preview.emergentagent.com"


def read_env(path: Path) -> dict:
    out = {}
    for raw in path.read_text().splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        k, v = raw.split("=", 1)
        out[k] = v.strip().strip('"').strip("'")
    return out


def assert_true(cond, message):
    if not cond:
        raise AssertionError(message)


def scan_icon(nav_payload):
    subscriber = nav_payload.get("subscriber") or []
    matches = [item for item in subscriber if item.get("id") == "scan"]
    assert_true(matches, "subscriber scan item missing")
    return matches[0].get("icon"), subscriber


def main():
    env = read_env(BACKEND_ENV)
    mongo_url = env.get("MONGO_URL") or os.environ.get("MONGO_URL")
    db_name = env.get("DB_NAME") or os.environ.get("DB_NAME")
    assert_true(mongo_url and db_name, "Missing Mongo env")

    db = MongoClient(mongo_url)[db_name]
    coll = db.app_config
    original = coll.find_one({"_id": "bottom_nav"})

    results = {}
    try:
        r = requests.get(f"{BACKEND_URL}/api/bottom-nav", timeout=15)
        assert_true(r.status_code == 200, f"GET /api/bottom-nav failed: {r.status_code} {r.text[:200]}")
        icon, subscriber = scan_icon(r.json())
        results["initial_scan_icon"] = icon
        assert_true(icon == "QrCode", f"initial subscriber scan icon expected QrCode, got {icon}")

        legacy_subscriber = [dict(item) for item in subscriber]
        for item in legacy_subscriber:
            if item.get("id") == "scan":
                item["icon"] = "ScanLine"

        legacy_doc = {"_id": "bottom_nav", "subscriber": legacy_subscriber}
        if original:
            for key, value in original.items():
                if key not in {"_id", "subscriber"}:
                    legacy_doc[key] = value
        coll.replace_one({"_id": "bottom_nav"}, legacy_doc, upsert=True)

        r2 = requests.get(f"{BACKEND_URL}/api/bottom-nav", timeout=15)
        assert_true(r2.status_code == 200, f"legacy GET /api/bottom-nav failed: {r2.status_code} {r2.text[:200]}")
        icon_after, _ = scan_icon(r2.json())
        results["after_legacy_api_scan_icon"] = icon_after
        assert_true(icon_after == "QrCode", f"legacy self-heal expected QrCode, got {icon_after}")

        healed_doc = coll.find_one({"_id": "bottom_nav"}, {"_id": 0}) or {}
        results["subscriber_key_present_after_self_heal"] = "subscriber" in healed_doc
        assert_true("subscriber" not in healed_doc, "legacy subscriber override was not unset from db")

    finally:
        if original:
            coll.replace_one({"_id": "bottom_nav"}, original, upsert=True)
        else:
            coll.delete_one({"_id": "bottom_nav"})

    print(json.dumps({"ok": True, "results": results}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        sys.exit(1)