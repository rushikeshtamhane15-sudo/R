"""WhatsApp messaging — branded efoodcare templates.

In production wires through MSG91 WhatsApp Business API. Without
`MSG91_WA_AUTH_KEY` configured, runs in STUB MODE — every send is logged + a
row inserted into `db.whatsapp_outbox` so admin can see what would have been
sent. Flip to live mode by pasting `MSG91_WA_AUTH_KEY` and the four template
IDs (registration, payment_success, expiry_reminder, restaurant_order)
in /app/backend/.env.

Branded HTML preview (used by admin dashboard "Show preview"):
    efoodcare logo · brand wordmark · "ghar se accha khana" tagline · message body.

NOTE: WhatsApp Business API doesn't render HTML — it uses pre-approved
template strings with placeholder variables. The HTML preview is only for
the admin/audit panel; the actual outbound message uses the template body
text approved at MSG91 dashboard.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger("efoodcare.whatsapp")

LOGO_URL = "https://customer-assets.emergentagent.com/job_dining-pass-scan/artifacts/uzs344m6_9a705f5a-b3a0-4286-b51d-b9bd6f55b7bb_20260504_011957_0000.png"
BRAND = "efoodcare"
TAGLINE = "ghar se accha khana"

# Template names approved at MSG91 dashboard (when going live, paste here from .env)
TEMPLATE_REGISTRATION   = os.environ.get("MSG91_WA_TPL_REGISTRATION",   "")
TEMPLATE_PAYMENT_SUCCESS = os.environ.get("MSG91_WA_TPL_PAYMENT",       "")
TEMPLATE_EXPIRY          = os.environ.get("MSG91_WA_TPL_EXPIRY",        "")
TEMPLATE_ORDER           = os.environ.get("MSG91_WA_TPL_RESTAURANT",    "")
TEMPLATE_DELIVERY        = os.environ.get("MSG91_WA_TPL_DELIVERY",      "")


def is_stub_mode() -> bool:
    return not os.environ.get("MSG91_WA_AUTH_KEY", "")


def _normalize_phone(phone: str) -> str:
    p = (phone or "").strip().replace(" ", "").replace("-", "")
    if p.startswith("+"):
        return p[1:]
    if len(p) == 10:
        return f"91{p}"
    return p


def _branded_preview(title: str, body: str, cta_label: Optional[str] = None, cta_url: Optional[str] = None) -> str:
    cta_html = ""
    if cta_label and cta_url:
        cta_html = (
            f'<p style="margin-top:14px"><a href="{cta_url}" '
            f'style="display:inline-block;background:#a02323;color:#fff;text-decoration:none;'
            f'padding:10px 18px;border-radius:9999px;font-weight:700">{cta_label}</a></p>'
        )
    return f"""<div style="font-family:system-ui,sans-serif;max-width:520px;border-radius:16px;overflow:hidden;border:1px solid #eee">
  <div style="background:#a02323;color:#fff;padding:20px 22px;display:flex;align-items:center;gap:12px">
    <img src="{LOGO_URL}" alt="{BRAND}" width="36" height="36" style="border-radius:8px;background:rgba(255,255,255,0.1);padding:3px"/>
    <div>
      <p style="margin:0;font-weight:800;font-size:17px;letter-spacing:-0.01em">{BRAND}</p>
      <p style="margin:0;font-style:italic;font-size:11px;opacity:0.85">{TAGLINE}</p>
    </div>
  </div>
  <div style="padding:20px 22px;background:#fff;color:#111">
    <p style="margin:0 0 6px;font-weight:700;font-size:15px">{title}</p>
    <p style="margin:0;font-size:14px;line-height:1.55;color:#444">{body}</p>
    {cta_html}
    <p style="margin:14px 0 0;font-size:11px;color:#888">— {BRAND}, {TAGLINE}</p>
  </div>
</div>"""


# ---------------------------------------------------------------------------
# Outbox (so admin can audit messages even in stub mode)
# ---------------------------------------------------------------------------
async def _persist_outbox(db, *, phone: str, kind: str, vars_: dict, status: str, response: dict | None = None) -> None:
    try:
        await db.whatsapp_outbox.insert_one({
            "phone": phone,
            "kind": kind,
            "vars": vars_,
            "status": status,
            "stub_mode": is_stub_mode(),
            "ts": datetime.now(timezone.utc).isoformat(),
            "response": response,
        })
        if (await db.whatsapp_outbox.estimated_document_count()) > 1000:
            cutoff = await db.whatsapp_outbox.find({}, {"_id": 1}).sort("ts", -1).skip(1000).limit(1).to_list(1)
            if cutoff:
                await db.whatsapp_outbox.delete_many({"_id": {"$lte": cutoff[0]["_id"]}})
    except Exception as e:
        logger.warning(f"[WA] outbox persist failed: {e}")


# ---------------------------------------------------------------------------
# Low-level send via MSG91
# ---------------------------------------------------------------------------
async def _send_via_msg91(*, phone: str, template_name: str, components: list[dict]) -> dict:
    """https://msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk"""
    auth = os.environ.get("MSG91_WA_AUTH_KEY", "")
    if not auth:
        return {"ok": False, "status": "stub_mode", "detail": "MSG91_WA_AUTH_KEY not configured"}
    if not template_name:
        return {"ok": False, "status": "stub_mode", "detail": "Template name not configured"}
    payload = {
        "integrated_number": os.environ.get("MSG91_WA_INTEGRATED_NUMBER", ""),
        "content_type": "template",
        "payload": {
            "messaging_product": "whatsapp",
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": "en", "policy": "deterministic"},
                "namespace": os.environ.get("MSG91_WA_NAMESPACE", ""),
                "to_and_components": [{
                    "to": [phone],
                    "components": {f"body_{i+1}": {"type": "text", "value": v} for i, v in enumerate(components)},
                }],
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post(
                "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
                headers={"authkey": auth, "Content-Type": "application/json"},
                json=payload,
            )
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text[:500]}
            return {"ok": r.status_code < 300, "status": "live", "http": r.status_code, "response": data}
    except Exception as e:
        logger.exception(f"[WA] MSG91 call failed: {e}")
        return {"ok": False, "status": "error", "detail": str(e)[:300]}


# ---------------------------------------------------------------------------
# High-level senders (one per template). Each:
#   1. Renders the branded HTML preview (for admin audit)
#   2. Sends via MSG91 if configured, else logs + persists to outbox
# ---------------------------------------------------------------------------
async def send_registration(db, *, phone: str, name: str) -> dict:
    """Welcome message for new users."""
    phone_n = _normalize_phone(phone)
    title = f"Welcome to {BRAND}, {name}!"
    body = (f"Thanks for signing up. {BRAND} brings you {TAGLINE.lower()} — "
            f"home-style tiffin, dining and now restaurant ordering, all under one app. "
            f"Subscribe to a plan and your daily meals are sorted.")
    preview = _branded_preview(title, body, cta_label="Browse plans", cta_url="/plans")
    res = await _send_via_msg91(
        phone=phone_n, template_name=TEMPLATE_REGISTRATION,
        components=[name, BRAND],
    ) if not is_stub_mode() else {"ok": False, "status": "stub_mode"}
    await _persist_outbox(db, phone=phone_n, kind="registration",
                          vars_={"name": name, "preview_html": preview}, status=res.get("status", "stub_mode"), response=res)
    if is_stub_mode():
        logger.info(f"[WA STUB] registration → {phone_n} ({name})")
    return res


async def send_payment_success(db, *, phone: str, name: str, amount: float, plan_name: str, invoice_url: Optional[str] = None) -> dict:
    phone_n = _normalize_phone(phone)
    title = f"Payment received — ₹{int(amount)}"
    body = (f"Hi {name}, we've received ₹{int(amount):,} for your <b>{plan_name}</b> subscription. "
            f"Your wallet is loaded and meal scanning is live from your next visit.")
    preview = _branded_preview(title, body, cta_label="View receipt" if invoice_url else None, cta_url=invoice_url)
    res = await _send_via_msg91(
        phone=phone_n, template_name=TEMPLATE_PAYMENT_SUCCESS,
        components=[name, f"{int(amount)}", plan_name, invoice_url or ""],
    ) if not is_stub_mode() else {"ok": False, "status": "stub_mode"}
    await _persist_outbox(db, phone=phone_n, kind="payment_success",
                          vars_={"name": name, "amount": amount, "plan_name": plan_name, "invoice_url": invoice_url, "preview_html": preview},
                          status=res.get("status", "stub_mode"), response=res)
    if is_stub_mode():
        logger.info(f"[WA STUB] payment_success → {phone_n} ₹{amount}")
    return res


async def send_expiry_reminder(db, *, phone: str, name: str, days_left: int, plan_name: str, end_date: str) -> dict:
    """Sent at T-2 days BEFORE end_date and T+1 day AFTER end_date (per user spec)."""
    phone_n = _normalize_phone(phone)
    if days_left == -1:
        title = f"Your plan ended yesterday, {name}"
        body = (f"Your <b>{plan_name}</b> ended on {end_date}. Renew today to skip the gap "
                f"and keep your daily {TAGLINE.lower()} flowing.")
    elif days_left == 2:
        title = "Your plan ends in 2 days"
        body = (f"Hi {name}, your <b>{plan_name}</b> ends on {end_date}. "
                f"Renew now and we'll extend without missing a meal.")
    else:
        title = "Your plan ends today"
        body = (f"Hi {name}, today is the last day of your <b>{plan_name}</b>. Renew now to continue.")
    preview = _branded_preview(title, body, cta_label="Renew now", cta_url="/plans")
    res = await _send_via_msg91(
        phone=phone_n, template_name=TEMPLATE_EXPIRY,
        components=[name, plan_name, end_date, str(days_left)],
    ) if not is_stub_mode() else {"ok": False, "status": "stub_mode"}
    await _persist_outbox(db, phone=phone_n, kind="expiry_reminder",
                          vars_={"name": name, "plan_name": plan_name, "end_date": end_date, "days_left": days_left, "preview_html": preview},
                          status=res.get("status", "stub_mode"), response=res)
    if is_stub_mode():
        logger.info(f"[WA STUB] expiry_reminder days_left={days_left} → {phone_n}")
    return res


async def send_restaurant_order_confirmation(db, *, phone: str, name: str, order_id: str, total: float, eta_minutes: int = 40) -> dict:
    phone_n = _normalize_phone(phone)
    title = f"Order confirmed · ₹{int(total)}"
    body = (f"Thanks {name}! Order <b>{order_id}</b> is confirmed for ₹{int(total):,}. "
            f"Your food will arrive in ~{eta_minutes} minutes. Track your rider live in the app.")
    preview = _branded_preview(title, body, cta_label="Track order", cta_url=f"/restaurant/track/{order_id}")
    res = await _send_via_msg91(
        phone=phone_n, template_name=TEMPLATE_ORDER,
        components=[name, order_id, str(int(total)), str(eta_minutes)],
    ) if not is_stub_mode() else {"ok": False, "status": "stub_mode"}
    await _persist_outbox(db, phone=phone_n, kind="restaurant_order",
                          vars_={"name": name, "order_id": order_id, "total": total, "eta_minutes": eta_minutes, "preview_html": preview},
                          status=res.get("status", "stub_mode"), response=res)
    if is_stub_mode():
        logger.info(f"[WA STUB] restaurant_order → {phone_n} ({order_id} ₹{total})")
    return res


async def send_delivery_otp(db, *, phone: str, name: str, otp: str, order_id: str) -> dict:
    """OTP sent to customer when rider hits 'I've arrived'. Customer reads it out → rider enters → order is closed."""
    phone_n = _normalize_phone(phone)
    title = "Your delivery OTP"
    body = (f"Hi {name}, your rider has arrived with order <b>{order_id}</b>. "
            f"Share this OTP with the rider to confirm delivery: <b style='font-size:20px;letter-spacing:3px'>{otp}</b>")
    preview = _branded_preview(title, body)
    res = await _send_via_msg91(
        phone=phone_n, template_name=TEMPLATE_DELIVERY,
        components=[name, order_id, otp],
    ) if not is_stub_mode() else {"ok": False, "status": "stub_mode"}
    await _persist_outbox(db, phone=phone_n, kind="delivery_otp",
                          vars_={"name": name, "order_id": order_id, "otp": otp, "preview_html": preview},
                          status=res.get("status", "stub_mode"), response=res)
    if is_stub_mode():
        logger.warning(f"[WA STUB] delivery_otp {order_id} → {phone_n} OTP={otp}")
    return res



async def send_in_grace_warning(db, *, phone: str, name: str, pending_amount: float, plan_name: str = "tiffin plan") -> dict:
    """Iter-57: final-warning push when a sub enters 24h grace with money owed.

    Re-uses the EXPIRY template because operator portals limit how many DLT
    templates we register; the body string is rewritten client-side so the
    user sees the in-grace copy.
    """
    phone_n = _normalize_phone(phone)
    amt = int(round(pending_amount))
    title = f"Your tiffin is paused, {name}"
    body = (
        f"Heads-up — your <b>{plan_name}</b> just paused because your wallet hit zero "
        f"and there's still <b>₹{amt:,}</b> pending. Clear it within 24 hours to resume "
        f"meals automatically. After that the plan will expire."
    )
    preview = _branded_preview(title, body, cta_label=f"Clear ₹{amt:,}", cta_url="/wallet")
    # Reuse expiry template (closest semantic) — components match the 4-slot shape MSG91 expects.
    res = await _send_via_msg91(
        phone=phone_n, template_name=TEMPLATE_EXPIRY,
        components=[name, plan_name, f"₹{amt}", "grace"],
    ) if not is_stub_mode() else {"ok": False, "status": "stub_mode"}
    await _persist_outbox(
        db, phone=phone_n, kind="in_grace_warning",
        vars_={"name": name, "plan_name": plan_name, "pending_amount": amt, "preview_html": preview},
        status=res.get("status", "stub_mode"), response=res,
    )
    if is_stub_mode():
        logger.warning(f"[WA STUB] in_grace_warning ₹{amt} → {phone_n} ({name})")
    return res
