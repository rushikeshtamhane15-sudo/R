"""iter-136 · Direct Meta WhatsApp Cloud API sender for one-tap kiosk receipts.

Distinct from `whatsapp.py` (MSG91 proxy). Uses Meta's official Cloud API
directly so an admin who owns a WABA + approved utility template can send
transactional messages silently — no wa.me tab jump on the wall kiosk.

Env vars required for live mode (all in /app/backend/.env):
    WHATSAPP_ACCESS_TOKEN        System User permanent token (never expires)
    WHATSAPP_PHONE_NUMBER_ID     Meta App Dashboard → WhatsApp → API Setup
    WHATSAPP_API_VERSION         e.g. v23.0 (defaults to v23.0)
    WHATSAPP_TPL_RECEIPT         Approved template name for kiosk receipt
    WHATSAPP_TPL_LANG            Template language code (e.g. en_US, en, en_GB)

Missing any of the above → the sender enters STUB mode: logs the payload,
persists to db.whatsapp_outbox as `stub_mode=True`, returns ok=True to keep
the UI flow intact. Flip to live by pasting real values in .env + restart.

Template body expected shape (5 body params, staff must match at Meta):
    {{1}} = customer name (or "Guest")
    {{2}} = bill number (e.g. "7")
    {{3}} = meal · service (e.g. "Lunch · Dining")
    {{4}} = quantity (e.g. "2")
    {{5}} = total in ₹ (e.g. "240")
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx

logger = logging.getLogger("efoodcare.whatsapp_cloud")

_GRAPH_HOST = "https://graph.facebook.com"


def _cfg() -> dict:
    return {
        "token": os.environ.get("WHATSAPP_ACCESS_TOKEN", "").strip(),
        "phone_id": os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "").strip(),
        "version": os.environ.get("WHATSAPP_API_VERSION", "v23.0").strip() or "v23.0",
        "template": os.environ.get("WHATSAPP_TPL_RECEIPT", "").strip(),
        "lang": os.environ.get("WHATSAPP_TPL_LANG", "en_US").strip() or "en_US",
    }


def is_stub_mode() -> bool:
    c = _cfg()
    return not (c["token"] and c["phone_id"] and c["template"])


def _normalize_phone(phone: str) -> str:
    """E.164-ish for Meta Cloud API — digits-only, prepend 91 if 10-digit local."""
    p = "".join(ch for ch in (phone or "") if ch.isdigit())
    p = p.lstrip("0")
    if len(p) == 10:
        return f"91{p}"
    return p


async def _persist_outbox(db, *, phone: str, vars_: dict, status: str, response: dict | None = None, stub: bool = False) -> None:
    try:
        await db.whatsapp_outbox.insert_one({
            "phone": phone,
            "kind": "kiosk_receipt",
            "channel": "meta_cloud",
            "vars": vars_,
            "status": status,
            "stub_mode": stub,
            "ts": datetime.now(timezone.utc).isoformat(),
            "response": response,
        })
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[WA-CLOUD] outbox persist failed: {e}")


async def send_kiosk_receipt(
    db,
    *,
    phone: str,
    name: str,
    bill_no: str,
    meal_service: str,
    qty: str,
    total: str,
) -> dict:
    """Fire one utility template message. Returns {ok, status, message_id?, detail?}."""
    phone_n = _normalize_phone(phone)
    if not phone_n or len(phone_n) < 10:
        return {"ok": False, "status": "invalid_phone", "detail": "Phone must be at least 10 digits."}

    variables = {
        "1": name or "Guest",
        "2": str(bill_no or ""),
        "3": meal_service or "",
        "4": str(qty or ""),
        "5": str(total or ""),
    }

    c = _cfg()
    if is_stub_mode():
        logger.warning(
            f"[WA-CLOUD · STUB] would send kiosk_receipt to +{phone_n} · vars={variables}"
        )
        await _persist_outbox(db, phone=phone_n, vars_=variables, status="stub_mode", stub=True)
        return {"ok": True, "status": "stub_mode", "message_id": None, "detail": "WhatsApp Cloud API creds not configured — message logged only."}

    url = f"{_GRAPH_HOST}/{c['version']}/{c['phone_id']}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": phone_n,
        "type": "template",
        "template": {
            "name": c["template"],
            "language": {"code": c["lang"]},
            "components": [{
                "type": "body",
                "parameters": [{"type": "text", "text": variables[k]} for k in ("1", "2", "3", "4", "5")],
            }],
        },
    }
    headers = {
        "Authorization": f"Bearer {c['token']}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post(url, json=payload, headers=headers)
        try:
            data = r.json()
        except Exception:
            data = {"raw": r.text[:500]}
        message_id = None
        if isinstance(data, dict):
            msgs = data.get("messages") or []
            if msgs and isinstance(msgs[0], dict):
                message_id = msgs[0].get("id")
        ok = r.status_code < 300 and bool(message_id)
        status = "sent" if ok else "error"
        await _persist_outbox(db, phone=phone_n, vars_=variables, status=status, response={"http": r.status_code, "data": data})
        if not ok:
            err = ((data or {}).get("error") or {}) if isinstance(data, dict) else {}
            detail = err.get("message") or f"HTTP {r.status_code}"
            logger.warning(f"[WA-CLOUD] send failed: {detail} · body={payload}")
            return {"ok": False, "status": "error", "http": r.status_code, "detail": detail}
        return {"ok": True, "status": "sent", "message_id": message_id}
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[WA-CLOUD] transport error: {e}")
        await _persist_outbox(db, phone=phone_n, vars_=variables, status="error", response={"exception": str(e)[:400]})
        return {"ok": False, "status": "error", "detail": str(e)[:300]}
