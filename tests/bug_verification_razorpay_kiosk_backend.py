#!/usr/bin/env python3
"""Focused backend verification for Admin Wall Kiosk Razorpay QR / bill / reprint bug.

This script uses the real preview API and live Razorpay QR create endpoint but does
not attempt or trigger any payment. It writes machine-readable evidence to
/app/test_reports/bug_verification_kiosk_backend_results.json.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from pymongo import MongoClient


BASE = os.environ.get("EFC_BASE_URL", "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
ADMIN_PHONE = os.environ.get("EFC_ADMIN_PHONE", "9970705391")
SUB_PHONE = os.environ.get("EFC_SUB_PHONE", "9123456789")
REPORT = Path("/app/test_reports/bug_verification_kiosk_backend_results.json")


def today_ist() -> str:
    ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    return ist.date().isoformat()


def read_env(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k] = v.strip().strip('"').strip("'")
    return out


def assert_true(cond: bool, msg: str, evidence: dict | None = None):
    if not cond:
        raise AssertionError(json.dumps({"assertion": msg, "evidence": evidence or {}}, default=str))


def login(phone: str) -> tuple[requests.Session, dict]:
    s = requests.Session()
    r = s.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=30)
    r.raise_for_status()
    otp = r.json().get("dev_otp")
    assert_true(bool(otp), f"OTP dev flow did not return dev_otp for {phone}", r.json())
    r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": f"Bug Verify {phone[-4:]}"}, timeout=30)
    r.raise_for_status()
    data = r.json()
    s.headers.update({"Authorization": f"Bearer {data['session_token']}"})
    return s, data


def main() -> int:
    day = today_ist()
    results: dict = {
        "base_url": BASE,
        "date_ist": day,
        "checks": [],
        "failures": [],
        "created_order_ids": [],
        "cleanup": "reset today's kiosk bill counter and deleted today's walk_in_kiosk orders before test",
    }
    try:
        # Reset only today's kiosk bill namespace so bill_no #1/#2 contract can be tested deterministically.
        env = read_env("/app/backend/.env")
        mongo = MongoClient(env["MONGO_URL"], serverSelectionTimeoutMS=5000)
        db = mongo[env["DB_NAME"]]
        delete_res = db.mess_menu_orders.delete_many({"kind": "walk_in_kiosk", "bill_date": day})
        db.daily_bill_counter.delete_one({"_id": f"bill:{day}"})
        results["deleted_existing_today_kiosk_orders"] = delete_res.deleted_count

        admin, admin_login = login(ADMIN_PHONE)
        results["admin_user"] = admin_login.get("user", {})
        assert_true(admin_login.get("user", {}).get("role") == "admin", "admin OTP login did not produce admin role", admin_login)
        results["checks"].append("admin OTP login works and role=admin")

        sub, sub_login = login(SUB_PHONE)
        results["subscriber_user"] = sub_login.get("user", {})
        assert_true(sub_login.get("user", {}).get("role") != "admin", "subscriber test login unexpectedly admin", sub_login)
        results["checks"].append("subscriber OTP login works and role is non-admin")

        menu_payload = {"date": day, "lunch": "Bug verification thali", "dinner": "Bug verification thali", "note": "bug-verification-kiosk"}
        r = admin.post(f"{API}/admin/mess-menu/upsert", json=menu_payload, timeout=30)
        assert_true(r.status_code == 200 and r.json().get("ok"), "menu upsert failed", {"status": r.status_code, "body": r.text})
        results["checks"].append("seeded today's mess menu")

        def place_online() -> dict:
            payload = {"service": "dining", "qty": 1, "date": day, "meal_type": "lunch", "payment_method": "online"}
            resp = admin.post(f"{API}/admin/kiosk/order", json=payload, timeout=60)
            assert_true(resp.status_code == 200, "POST /admin/kiosk/order failed", {"status": resp.status_code, "body": resp.text})
            body = resp.json()
            oid = body.get("order", {}).get("order_id")
            if oid:
                results["created_order_ids"].append(oid)
            return body

        order1 = place_online()
        order2 = place_online()
        for idx, body in enumerate([order1, order2], start=1):
            order = body.get("order") or {}
            img = body.get("razorpay_qr_image_url") or order.get("razorpay_qr_image_url")
            qrid = body.get("razorpay_qr_id") or order.get("razorpay_qr_id")
            short = body.get("razorpay_qr_short_url") or order.get("razorpay_qr_short_url")
            assert_true(bool(qrid and qrid.startswith("qr_")), f"order {idx} missing valid razorpay_qr_id", body)
            assert_true(bool(img and img.startswith("https://")), f"order {idx} missing HTTPS razorpay_qr_image_url", body)
            assert_true(bool(short and short.startswith("https://rzp.io/")), f"order {idx} missing valid razorpay_qr_short_url", body)
            assert_true(img != short, f"order {idx} image_url must not equal short_url", {"image": img, "short": short})
            assert_true(img != f"https://rzp.io/i/{qrid}", f"order {idx} appears to construct fake rzp.io/i/{{qr_id}} image URL", {"image": img, "qrid": qrid})
        results["order1"] = {
            "order_id": order1["order"]["order_id"],
            "bill_no": order1["order"].get("bill_no"),
            "razorpay_qr_id": order1.get("razorpay_qr_id"),
            "razorpay_qr_image_url": order1.get("razorpay_qr_image_url"),
            "razorpay_qr_short_url": order1.get("razorpay_qr_short_url"),
        }
        results["order2"] = {
            "order_id": order2["order"]["order_id"],
            "bill_no": order2["order"].get("bill_no"),
            "razorpay_qr_id": order2.get("razorpay_qr_id"),
            "razorpay_qr_image_url": order2.get("razorpay_qr_image_url"),
            "razorpay_qr_short_url": order2.get("razorpay_qr_short_url"),
        }
        assert_true(order1["order"].get("bill_no") == 1, "first fresh kiosk order did not receive bill_no=1", results["order1"])
        assert_true(order2["order"].get("bill_no") == 2, "second same-day kiosk order did not receive bill_no=2", results["order2"])
        results["checks"].append("Razorpay QR contract present and bill_no sequence #1/#2 works")

        confirm = admin.post(
            f"{API}/admin/kiosk/order/confirm-payment",
            json={"order_id": order2["order"]["order_id"], "online_paid": True, "cash_received": False},
            timeout=30,
        )
        assert_true(confirm.status_code == 200 and confirm.json().get("settled"), "confirm payment did not settle online order", {"status": confirm.status_code, "body": confirm.text})
        results["checks"].append("online order can be marked settled for receipt/reprint")

        today_resp = admin.get(f"{API}/admin/kiosk/orders/today?date={day}", timeout=30)
        assert_true(today_resp.status_code == 200, "orders/today failed", {"status": today_resp.status_code, "body": today_resp.text})
        today_body = today_resp.json()
        bills = [o.get("bill_no") for o in today_body.get("orders", [])]
        assert_true(today_body.get("ok") is True and today_body.get("date") == day and today_body.get("count") >= 2, "orders/today contract invalid", today_body)
        assert_true(bills == sorted(bills, reverse=True), "orders/today not sorted by bill_no desc", {"bills": bills})
        assert_true(2 in bills and 1 in bills, "orders/today missing created bill numbers", {"bills": bills})
        results["orders_today"] = {"count": today_body.get("count"), "bills": bills[:10]}
        results["checks"].append("orders/today contract and sorting works")

        rp = admin.get(f"{API}/admin/kiosk/reprint/2?date={day}", timeout=30)
        assert_true(rp.status_code == 200, "reprint bill #2 failed", {"status": rp.status_code, "body": rp.text})
        rp_body = rp.json()
        assert_true(rp_body.get("ok") is True and rp_body.get("order", {}).get("bill_no") == 2, "reprint returned wrong order", rp_body)
        assert_true(str(rp_body.get("qr_text", "")).startswith("kio:"), "reprint qr_text not kio:<token>", rp_body)
        assert_true(str(rp_body.get("qr_data_url", "")).startswith("data:image/png;base64,"), "reprint qr_data_url not data URI PNG", {"qr_data_url_prefix": str(rp_body.get("qr_data_url", ""))[:40]})
        results["reprint"] = {"bill_no": rp_body["order"].get("bill_no"), "qr_text_prefix": rp_body.get("qr_text", "")[:8], "qr_data_url_prefix": rp_body.get("qr_data_url", "")[:30]}
        results["checks"].append("reprint endpoint contract works for bill #2")

        missing = admin.get(f"{API}/admin/kiosk/reprint/9999?date={day}", timeout=30)
        assert_true(missing.status_code == 404, "missing bill did not return 404", {"status": missing.status_code, "body": missing.text})
        results["missing_bill_response"] = {"status": missing.status_code, "body": missing.json() if missing.text else None}
        results["checks"].append("missing bill returns 404")

        forb1 = sub.get(f"{API}/admin/kiosk/orders/today?date={day}", timeout=30)
        forb2 = sub.get(f"{API}/admin/kiosk/reprint/2?date={day}", timeout=30)
        assert_true(forb1.status_code == 403 and forb2.status_code == 403, "non-admin did not get 403", {"orders_today": forb1.status_code, "reprint": forb2.status_code, "body1": forb1.text, "body2": forb2.text})
        results["checks"].append("non-admin user receives 403 for reprint endpoints")

        results["ok"] = True
    except Exception as e:  # noqa: BLE001
        results["ok"] = False
        results["failures"].append(str(e))
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(results, indent=2, default=str))
    print(json.dumps(results, indent=2, default=str))
    return 0 if results.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())