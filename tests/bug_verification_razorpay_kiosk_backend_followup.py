#!/usr/bin/env python3
"""Follow-up checks after the main kiosk backend script created test bills #1/#2."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

BASE = os.environ.get("EFC_BASE_URL", "https://dining-pass-scan.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
ADMIN_PHONE = os.environ.get("EFC_ADMIN_PHONE", "9970705391")
SUB_PHONE = os.environ.get("EFC_SUB_PHONE", "9123456789")
REPORT = Path("/app/test_reports/bug_verification_kiosk_backend_followup_results.json")


def today_ist() -> str:
    ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    return ist.date().isoformat()


def login(phone: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=30)
    r.raise_for_status()
    otp = r.json().get("dev_otp")
    r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp, "name": f"Bug Verify {phone[-4:]}"}, timeout=30)
    r.raise_for_status()
    s.headers.update({"Authorization": f"Bearer {r.json()['session_token']}"})
    return s


def check(results: dict, cond: bool, label: str, evidence=None):
    if cond:
        results["checks"].append(label)
    else:
        results["failures"].append({"check": label, "evidence": evidence})


def main() -> int:
    day = today_ist()
    results = {"base_url": BASE, "date_ist": day, "checks": [], "failures": []}
    try:
        admin = login(ADMIN_PHONE)
        sub = login(SUB_PHONE)

        today_resp = admin.get(f"{API}/admin/kiosk/orders/today?date={day}", timeout=30)
        today_body = today_resp.json() if today_resp.text else {}
        bills = [o.get("bill_no") for o in today_body.get("orders", [])]
        results["orders_today"] = today_body
        check(results, today_resp.status_code == 200 and today_body.get("ok") is True, "orders/today returns {ok,date,count,orders}", {"status": today_resp.status_code, "body": today_body})
        check(results, bills == sorted(bills, reverse=True), "orders/today sorted by bill_no desc", bills)
        check(results, 1 in bills and 2 in bills, "orders/today contains created bills #1 and #2", bills)

        order2 = next((o for o in today_body.get("orders", []) if o.get("bill_no") == 2), None)
        check(results, bool(order2), "bill #2 exists for confirm/reprint follow-up", today_body)
        if order2:
            confirm = admin.post(
                f"{API}/admin/kiosk/order/confirm-payment",
                json={"order_id": order2["order_id"], "online_paid": True, "cash_received": False},
                timeout=30,
            )
            cbody = confirm.json() if confirm.text else {}
            results["confirm_bill_2"] = {"status": confirm.status_code, "body": cbody}
            check(results, confirm.status_code == 200 and cbody.get("settled") is True and cbody.get("order", {}).get("bill_no") == 2, "confirm-payment settles bill #2 and preserves bill_no", cbody)

        rp = admin.get(f"{API}/admin/kiosk/reprint/2?date={day}", timeout=30)
        rp_body = rp.json() if rp.text else {}
        results["reprint_2"] = {"status": rp.status_code, "body_without_full_qr": {k: (v[:40] + "..." if k == "qr_data_url" and isinstance(v, str) else v) for k, v in rp_body.items()}}
        check(results, rp.status_code == 200 and rp_body.get("ok") is True and rp_body.get("order", {}).get("bill_no") == 2, "reprint returns correct bill #2 order", rp_body)
        check(results, str(rp_body.get("qr_text", "")).startswith("kio:"), "reprint qr_text starts kio:", rp_body)
        check(results, str(rp_body.get("qr_data_url", "")).startswith("data:image/png;base64,"), "reprint qr_data_url is data URI PNG", {"prefix": str(rp_body.get("qr_data_url", ""))[:40]})

        missing = admin.get(f"{API}/admin/kiosk/reprint/9999?date={day}", timeout=30)
        results["missing_bill"] = {"status": missing.status_code, "body": missing.json() if missing.text else None}
        check(results, missing.status_code == 404, "missing bill returns 404", results["missing_bill"])

        forb1 = sub.get(f"{API}/admin/kiosk/orders/today?date={day}", timeout=30)
        forb2 = sub.get(f"{API}/admin/kiosk/reprint/2?date={day}", timeout=30)
        results["forbidden"] = {"orders_today_status": forb1.status_code, "reprint_status": forb2.status_code}
        check(results, forb1.status_code == 403 and forb2.status_code == 403, "non-admin/non-staff receives 403", results["forbidden"])
    except Exception as e:  # noqa: BLE001
        results["failures"].append({"exception": str(e)})
    results["ok"] = not results["failures"]
    REPORT.write_text(json.dumps(results, indent=2, default=str))
    print(json.dumps(results, indent=2, default=str))
    return 0 if results["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())