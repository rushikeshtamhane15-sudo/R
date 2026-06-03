"""MSG91 transactional SMS — DLT-compliant, async, stub-mode aware.

Env vars (all optional — when missing, runs in stub mode and logs only):
  - MSG91_AUTH_KEY      :: Auth key from https://control.msg91.com → Authkey
  - MSG91_SENDER_ID     :: Registered sender header (e.g. "EFOOD")
  - MSG91_FLOW_TIFFIN   :: MSG91 Flow/Template ID for the "empty tiffin reminder" template
  - MSG91_STUB_MODE     :: "true" forces stub mode even if creds are set (dev override)

DLT template (register on your DLT operator portal first, then map in MSG91):
  Hi {{name}}, please return your {{count}} empty tiffin{{plural}} when our boy arrives
  for your {{slot}} delivery (~{{eta}}). Helps us keep meals coming on time. - efoodcare

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
    return await _send_via_msg91(phone, payload_vars, flow_env="MSG91_FLOW_TIFFIN", label="tiffin-reminder")


async def send_expiry_reminder(*, phone: str, name: str, days_left: int, plan_name: str, end_date: str) -> dict:
    """Subscription expiry reminder — fires 3d / 1d / 0d before end_date."""
    payload_vars = {
        "name": (name or "")[:30],
        "days": str(days_left),
        "plan": (plan_name or "Your plan")[:30],
        "end": end_date,
    }
    return await _send_via_msg91(phone, payload_vars, flow_env="MSG91_FLOW_EXPIRY", label="expiry-reminder")


async def send_in_grace_warning(*, phone: str, name: str, pending_amount: float, plan_name: str = "tiffin plan") -> dict:
    """Iter-57: final-warning SMS when a sub enters 24h grace with pending dues.

    Re-uses the expiry-reminder MSG91 flow because operators limit DLT
    template registrations. Body slot text re-purposed to convey grace state.
    """
    amt = int(round(pending_amount))
    payload_vars = {
        "name": (name or "")[:30],
        "days": "in-grace",
        "plan": (plan_name or "tiffin plan")[:30],
        "end": f"clear-Rs-{amt}-in-24h",
    }
    return await _send_via_msg91(phone, payload_vars, flow_env="MSG91_FLOW_EXPIRY", label="in-grace-warning")




async def _send_via_msg91(phone: str, payload_vars: dict, *, flow_env: str, label: str) -> dict:
    if is_stub_mode() or not os.environ.get(flow_env):
        logger.info(f"[SMS · STUB] {label} → {phone} · {payload_vars}")
        return {"ok": True, "status": "stub", "vars": payload_vars}
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) == 10:
        digits = "91" + digits
    body = {
        "flow_id": os.environ[flow_env],
        "sender": os.environ["MSG91_SENDER_ID"],
        "recipients": [{"mobiles": digits, **payload_vars}],
    }
    headers = {"authkey": os.environ["MSG91_AUTH_KEY"], "content-type": "application/json", "accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(MSG91_API, json=body, headers=headers)
        if 200 <= r.status_code < 300:
            data = r.json() if r.content else {}
            logger.info(f"[SMS] {label} → {phone} · msg={data.get('message')}")
            return {"ok": True, "status": "sent", "msg_id": data.get("message")}
        logger.warning(f"[SMS] {label} failed {r.status_code} → {phone} · body={r.text[:200]}")
        return {"ok": False, "status": "failed", "error": f"HTTP {r.status_code}"}
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[SMS] {label} exception → {phone}: {e}")
        return {"ok": False, "status": "failed", "error": str(e)}
