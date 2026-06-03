"""Iter-56 #4: Admin bank-account CMS + deposit-screenshot verification.

Flow:
  1. Admin saves their own bank account details (account_no, ifsc, holder,
     bank_name).
  2. When marking cash orders as deposited, admin must provide:
     - a UTR (typed manually)
     - a screenshot of the deposit (uploaded image, stored as data-URL)
  3. We OCR the screenshot via Gemini Vision to extract UTR + amount +
     account-last-4. If the OCR UTR matches manual UTR AND the extracted
     account-last-4 matches the admin bank's last 4 digits AND amount within
     ±₹2, we auto-approve. Otherwise the order goes to `deposit_review`
     status and admin must re-do.
  4. Optional notification banner once pending-deposit total exceeds ₹10000.

Endpoints exposed:
  GET  /api/admin/bank-account                — admin reads bank
  PUT  /api/admin/bank-account                — admin saves bank
  POST /api/admin/payments/upload-deposit-proof — multipart screenshot
  POST /api/admin/payments/verify-deposit     — submit UTR + screenshot URL
  GET  /api/admin/notifications/bank-deposit  — unread notification banner
  POST /api/admin/notifications/mark-read     — mark notification read
"""
from __future__ import annotations

import base64
import re
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()


# ---------------------------------------------------------------------------
# Bank account CMS
# ---------------------------------------------------------------------------
class BankAccountIn(BaseModel):
    holder_name: str = Field(..., min_length=2, max_length=120)
    account_no: str = Field(..., min_length=6, max_length=24)
    ifsc: str = Field(..., min_length=6, max_length=20)
    bank_name: str = Field(..., min_length=2, max_length=120)


@router.get("/admin/bank-account")
async def get_bank(user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    doc = await server.db.bank_account.find_one({"_id": "active"}, {"_id": 0}) or {}
    return doc


@router.put("/admin/bank-account")
async def set_bank(payload: BankAccountIn, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = payload.model_dump()
    body["account_last4"] = body["account_no"][-4:]
    body["updated_at"] = server.iso(server.now_utc())
    await server.db.bank_account.update_one({"_id": "active"}, {"$set": body}, upsert=True)
    return {"ok": True, **body}


# ---------------------------------------------------------------------------
# Screenshot upload (returns data-URL)
# ---------------------------------------------------------------------------
@router.post("/admin/payments/upload-deposit-proof")
async def upload_deposit_proof(file: UploadFile = File(...), user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > 4 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Max 4 MB")
    try:
        from image_optim import optimize_to_webp_bytes
        opt = optimize_to_webp_bytes(data)
        mime = "image/webp"
    except Exception:
        opt = data
        mime = file.content_type or "image/jpeg"
    data_url = "data:" + mime + ";base64," + base64.b64encode(opt).decode("ascii")
    return {"url": data_url, "bytes": len(opt)}


# ---------------------------------------------------------------------------
# Verify deposit — OCR + match
# ---------------------------------------------------------------------------
class VerifyDepositIn(BaseModel):
    order_ids: list[str] = Field(min_items=1)
    utr: str = Field(..., min_length=8, max_length=24)
    screenshot_url: str = Field(..., min_length=20)  # the data-URL from upload


_UTR_RE = re.compile(r"\b([A-Z0-9]{8,22})\b")
_NUM_RE = re.compile(r"\b(\d{1,3}(?:[,\.\s]?\d{3})*(?:\.\d{1,2})?)\b")


async def _ocr_via_gemini(data_url: str) -> tuple[str, str]:
    """Returns (raw_text, error). Best-effort — empty raw_text means OCR
    failed (caller decides whether to allow)."""
    import os
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        return "", "OCR backend not configured"
    if not data_url.startswith("data:image"):
        return "", "screenshot must be a data-URL"
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore
        _, b64 = data_url.split(",", 1)
        sid = f"ocr-{uuid.uuid4().hex[:10]}"
        chat = (
            LlmChat(api_key=api_key, session_id=sid,
                    system_message="You are an OCR engine. Read every word and number from the image and reply with ONLY the raw text, no commentary, no markdown. Preserve digits exactly.")
            .with_model("gemini", "gemini-2.5-flash")
        )
        msg = UserMessage(text="OCR this bank-payment screenshot.", file_contents=[ImageContent(image_base64=b64)])
        text = await chat.send_message(msg)
        return (text or "").strip(), ""
    except Exception as e:  # noqa: BLE001
        return "", f"ocr error: {e}"


def _extract_utr(text: str) -> str:
    # Banks emit alphanumeric UTRs 12–22 chars. Pick the longest unique candidate.
    cands = _UTR_RE.findall(text.upper().replace("UTR", " ").replace("REF", " "))
    cands = [c for c in cands if any(ch.isdigit() for ch in c) and len(c) >= 10]
    cands.sort(key=len, reverse=True)
    return cands[0] if cands else ""


def _extract_amount(text: str) -> float:
    nums = []
    for m in _NUM_RE.findall(text):
        try:
            v = float(m.replace(",", "").replace(" ", ""))
            if 50 <= v <= 10_000_000:
                nums.append(v)
        except Exception:
            continue
    return max(nums) if nums else 0.0


def _has_account_last4(text: str, last4: str) -> bool:
    if not last4 or len(last4) < 4:
        return False
    return last4 in text


@router.post("/admin/payments/verify-deposit")
async def verify_deposit(payload: VerifyDepositIn, user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    bank = await server.db.bank_account.find_one({"_id": "active"}, {"_id": 0})
    if not bank or not bank.get("account_last4"):
        raise HTTPException(status_code=400, detail="Set your bank account in /admin/bank-account before verifying deposits")
    # Fetch the orders we're verifying
    orders = await server.db.payment_orders.find(
        {"order_id": {"$in": payload.order_ids}, "status": "paid", "payment_mode": "cash"},
        {"_id": 0},
    ).to_list(500)
    if not orders:
        raise HTTPException(status_code=404, detail="No matching cash orders")
    expected_total = round(sum(float(o.get("amount") or 0) for o in orders), 2)
    # OCR the screenshot
    text, err = await _ocr_via_gemini(payload.screenshot_url)
    if err and not text:
        # Hard-fail when no OCR text at all — admin must redo
        raise HTTPException(status_code=400, detail=f"Could not read the screenshot ({err}). Upload a clearer image.")
    extracted_utr = _extract_utr(text)
    extracted_amount = _extract_amount(text)
    match_utr = extracted_utr.upper() == payload.utr.strip().upper() if extracted_utr else False
    match_acct = _has_account_last4(text, bank["account_last4"])
    match_amt = abs(extracted_amount - expected_total) <= 2.0 if extracted_amount else False
    auto_ok = match_utr and match_acct and match_amt

    update = {
        "deposit_utr": payload.utr.strip(),
        "deposit_screenshot": payload.screenshot_url,
        "deposit_ocr_text": text[:2000],
        "deposit_ocr_utr": extracted_utr,
        "deposit_ocr_amount": extracted_amount,
        "deposit_match_utr": match_utr,
        "deposit_match_acct": match_acct,
        "deposit_match_amt": match_amt,
        "deposit_verified_at": server.iso(server.now_utc()),
        "deposit_verified_by": user.user_id,
    }
    if auto_ok:
        update["deposited_to_bank"] = True
        update["deposit_status"] = "approved"
        await server.db.payment_orders.update_many(
            {"order_id": {"$in": payload.order_ids}}, {"$set": update},
        )
        # Clear any pending-deposit-threshold notification
        await server.db.admin_notifications.update_many(
            {"kind": "pending_bank_deposit", "read": False}, {"$set": {"read": True, "read_at": server.iso(server.now_utc())}},
        )
        return {"ok": True, "auto_approved": True, "updated": len(payload.order_ids)}
    # Mismatch — mark for review
    update["deposit_status"] = "review"
    update["deposited_to_bank"] = False
    await server.db.payment_orders.update_many(
        {"order_id": {"$in": payload.order_ids}}, {"$set": update},
    )
    reasons = []
    if not match_utr: reasons.append(f"UTR mismatch (manual={payload.utr.upper()}, screenshot={extracted_utr or 'not found'})")
    if not match_acct: reasons.append(f"Account number ending {bank['account_last4']} not found in screenshot")
    if not match_amt: reasons.append(f"Amount mismatch (expected ₹{expected_total}, found ₹{extracted_amount or 'unreadable'})")
    return {
        "ok": False, "auto_approved": False,
        "status": "review",
        "reasons": reasons,
        "extracted_utr": extracted_utr,
        "extracted_amount": extracted_amount,
        "expected_total": expected_total,
        "message": "Deposit could not be auto-verified. Re-do with the correct UTR + a clearer screenshot.",
    }


# ---------------------------------------------------------------------------
# Notifications — fires when pending_bank_deposit > ₹10,000
# ---------------------------------------------------------------------------
PENDING_DEPOSIT_THRESHOLD = 10_000


@router.get("/admin/notifications/bank-deposit")
async def bank_deposit_notice(user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Admin/staff only")
    # Compute current pending total
    pend_pipe = [
        {"$match": {"status": "paid", "payment_mode": "cash", "deposited_to_bank": {"$ne": True}}},
        {"$group": {"_id": None, "pending": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]
    rows = await server.db.payment_orders.aggregate(pend_pipe).to_list(1)
    pending = float((rows[0] if rows else {}).get("pending") or 0)
    count = int((rows[0] if rows else {}).get("count") or 0)

    if pending > PENDING_DEPOSIT_THRESHOLD:
        # Upsert an unread notification doc so admin sees it on every page load until they read it.
        await server.db.admin_notifications.update_one(
            {"kind": "pending_bank_deposit"},
            {
                "$set": {"pending": pending, "count": count, "last_seen_total": pending, "active": True, "updated_at": server.iso(server.now_utc())},
                "$setOnInsert": {"read": False, "created_at": server.iso(server.now_utc())},
            },
            upsert=True,
        )
    notice = await server.db.admin_notifications.find_one(
        {"kind": "pending_bank_deposit", "read": False},
        {"_id": 0},
    )
    return {
        "show": bool(notice),
        "pending": pending,
        "count": count,
        "threshold": PENDING_DEPOSIT_THRESHOLD,
        "message": (
            f"⚠️ Cash collected but not deposited to bank has crossed ₹{int(pending)} "
            f"({count} orders). Reconcile soon to keep ledger clean."
        ) if notice else None,
    }


@router.post("/admin/notifications/mark-read")
async def mark_notice_read(kind: str = "pending_bank_deposit", user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await server.db.admin_notifications.update_many(
        {"kind": kind, "read": False},
        {"$set": {"read": True, "read_at": server.iso(server.now_utc())}},
    )
    return {"ok": True}
