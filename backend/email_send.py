"""Resend email integration — stub-mode aware.

Env vars (optional — stub mode otherwise):
  RESEND_API_KEY        :: Resend API key (re_xxx) from https://resend.com → API Keys
  SENDER_EMAIL          :: from-address (e.g. noreply@efoodcare.in or the default onboarding@resend.dev)
"""
from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger("efoodcare.email")


def _truthy(v):
    return (v or "").strip().lower() in ("1", "true", "yes", "on")


def is_stub_mode() -> bool:
    return _truthy(os.environ.get("RESEND_STUB_MODE")) or not os.environ.get("RESEND_API_KEY")


async def send_email(*, to: str, subject: str, html: str) -> dict:
    """Send a single transactional email. Returns {ok, status, id|error}.
    In stub mode: logs and returns {ok:True, status:'stub'}. Never raises."""
    if not to:
        return {"ok": False, "status": "no_recipient"}
    if is_stub_mode():
        logger.info(f"[EMAIL · STUB] → {to} · subject='{subject[:60]}'")
        return {"ok": True, "status": "stub"}
    try:
        import resend  # local import — only loaded when keys present
        resend.api_key = os.environ["RESEND_API_KEY"]
        params = {
            "from": os.environ.get("SENDER_EMAIL") or "onboarding@resend.dev",
            "to": [to],
            "subject": subject,
            "html": html,
        }
        # Resend SDK is sync — keep FastAPI event loop responsive.
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"[EMAIL] sent → {to} · id={result.get('id')}")
        return {"ok": True, "status": "sent", "id": result.get("id")}
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[EMAIL] failed → {to}: {e}")
        return {"ok": False, "status": "failed", "error": str(e)}


def expiry_email_html(*, name: str, days_left: int, plan_name: str, end_date: str, renew_url: str) -> str:
    """Inline-CSS HTML email — table-based for client compatibility."""
    headline = (
        "Your eFoodCare plan ends today" if days_left == 0
        else f"Your eFoodCare plan ends in {days_left} day{'s' if days_left != 1 else ''}"
    )
    sub = (
        "Renew now to keep meals coming without a single skip. ghar se achha khana."
        if days_left > 0
        else "Renew today so tomorrow's lunch and dinner aren't paused."
    )
    return f"""\
<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr><td style="background:#a02323;padding:18px 28px;color:#fff;font-weight:800;letter-spacing:2px;font-size:11px;">EFOODCARE · GHAR SE ACHHA KHANA</td></tr>
      <tr><td style="padding:28px;color:#0b1220;">
        <h1 style="margin:0 0 6px;font-size:22px;line-height:1.25;">{headline}</h1>
        <p style="margin:0 0 18px;color:#6b7280;font-size:14px;">{sub}</p>
        <p style="margin:0 0 14px;font-size:14px;">Hi {name or 'there'},</p>
        <p style="margin:0 0 14px;font-size:14px;">Your <b>{plan_name}</b> subscription ends on <b>{end_date}</b>. Renew in 10 seconds and your tiffin or e-meal pass keeps running without interruption.</p>
        <p style="margin:24px 0 0;text-align:center;">
          <a href="{renew_url}" style="display:inline-block;background:#a02323;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:700;font-size:14px;">Renew now</a>
        </p>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">If the button doesn't work, paste this into your browser:<br/><a href="{renew_url}" style="color:#a02323;">{renew_url}</a></p>
      </td></tr>
      <tr><td style="background:#0b1220;color:#9ca3af;padding:14px 28px;font-size:11px;">Auto-sent by eFoodCare. To stop expiry reminders, contact support — we'll opt you out within minutes.</td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""
