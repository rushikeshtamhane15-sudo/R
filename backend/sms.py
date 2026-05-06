"""MSG91 transactional SMS — DLT-compliant, async, stub-mode aware.

Env vars (all optional — when missing, runs in stub mode and logs only):
  - MSG91_AUTH_KEY      :: Auth key from https://control.msg91.com → Authkey
  - MSG91_SENDER_ID     :: Registered sender header (e.g. "EFOOD")
  - MSG91_FLOW_TIFFIN   :: MSG91 Flow/Template ID for the "empty tiffin reminder" template
  - MSG91_STUB_MODE     :: "true" forces stub mode even if creds are set (dev override)

DLT template (register on your DLT operator portal first, then map in MSG91):
  Hi {{name}}, please return your {{count}} empty tiffin{{plural}} when our boy arrives
  for your {{slot}} delivery (~{{eta}}). Helps us keep meals coming on time. - eFoodCare

Variables: name, count, plural ("" or "s"), slot ("lunch"/"dinner"), eta ("12:30 PM")
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("efoodcare.sms")

MSG91_API = "https://control.msg91.com/api/v5/flow"


def _truthy(v: Optional[str]) -> bool:
    return (v or "").strip().lower() in ("1", "true", "yes", "on")


def _is_configured() -> bool:
    return all([os.environ.get("MSG91_AUTH_KEY"), os.environ.get("MSG91_SENDER_ID"), os.environ.get("MSG91_FLOW_TIFFIN")])


def is_stub_mode() -> bool:
    return _truthy(os.environ.get("MSG91_STUB_MODE")) or not _is_configured()


async def send_tiffin_reminder(*, phone: str, name: str, count: int, slot: str, eta: str) -> dict:
    """Send the empty-tiffin reminder. Returns {ok, status, msg_id|error}.
    In stub mode: logs and returns {ok:True, status:'stub'}. Never raises."""
    payload_vars = {
        "name": (name or "")[:30],
        "count": str(count),
        "plural": "" if count == 1 else "s",
        "slot": slot,
        "eta": eta,
    }
    if is_stub_mode():
        logger.info(f"[SMS · STUB] tiffin-reminder → {phone} · {payload_vars}")
        return {"ok": True, "status": "stub", "vars": payload_vars}

    # Strip non-digits, ensure +91 prefix for Indian numbers
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) == 10:
        digits = "91" + digits

    body = {
        "flow_id": os.environ["MSG91_FLOW_TIFFIN"],
        "sender": os.environ["MSG91_SENDER_ID"],
        "recipients": [{"mobiles": digits, **payload_vars}],
    }
    headers = {"authkey": os.environ["MSG91_AUTH_KEY"], "content-type": "application/json", "accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(MSG91_API, json=body, headers=headers)
        if 200 <= r.status_code < 300:
            data = r.json() if r.content else {}
            logger.info(f"[SMS] tiffin-reminder → {phone} · msg={data.get('message')}")
            return {"ok": True, "status": "sent", "msg_id": data.get("message")}
        logger.warning(f"[SMS] failed {r.status_code} → {phone} · body={r.text[:200]}")
        return {"ok": False, "status": "failed", "error": f"HTTP {r.status_code}"}
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[SMS] exception → {phone}: {e}")
        return {"ok": False, "status": "failed", "error": str(e)}
