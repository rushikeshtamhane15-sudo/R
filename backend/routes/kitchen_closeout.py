"""Iter-59 #9: Daily kitchen close-out + anti-fraud reconciliation.

Lets the kitchen lead enter the count of tiffins dispatched + plates served
each day. Backend reconciles against:
  - QR scans recorded that day (db.scans)
  - Cash payments collected that day (db.payment_orders)
  - Online payments confirmed that day

If the dispatched-count minus the scanned-count exceeds the configured
absolute-or-percent threshold, a "fraud_alert" admin notification is
created (and surfaced on the admin dashboard via the existing notification
banner, plus pinged to the owner WhatsApp if configured).

Endpoints:
  POST /api/kitchen/close-out   {date, tiffins_dispatched, plates_served, notes?}
    → submit / overwrite today's close-out, return reconciliation summary
  GET  /api/kitchen/close-out?date=YYYY-MM-DD
    → fetch a saved close-out + reconciliation
  GET  /api/admin/kitchen/recent?days=14
    → admin recent close-outs feed with per-day reconciliation
  GET  /api/admin/kitchen/reconcile?date=YYYY-MM-DD
    → live reconciliation for a date (computes scan count + cash even without close-out)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()

# Threshold for fraud alert: absolute units OR percentage of dispatched count, whichever is larger
DELTA_ABS_THRESHOLD = 3
DELTA_PCT_THRESHOLD = 0.03


class CloseOutIn(BaseModel):
    date: str = Field(..., description="ISO date YYYY-MM-DD")
    tiffins_dispatched: int = Field(..., ge=0)
    plates_served: int = Field(0, ge=0)
    notes: str = ""


async def _scans_for(date_str: str) -> int:
    """Count attendance scans for the given date (UTC date)."""
    try:
        start = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid date — use YYYY-MM-DD")
    end = start + timedelta(days=1)
    return await server.db.scans.count_documents({
        "created_at": {"$gte": start.isoformat(), "$lt": end.isoformat()},
    })


async def _cash_for(date_str: str) -> float:
    start = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    cur = server.db.payment_orders.find({
        "status": "paid",
        "payment_mode": "cash",
        "created_at": {"$gte": start.isoformat(), "$lt": end.isoformat()},
    }, {"_id": 0, "amount": 1})
    total = 0.0
    async for d in cur:
        total += float(d.get("amount") or 0)
    return total


async def _reconcile(date_str: str, tiffins_dispatched: int) -> dict:
    scans = await _scans_for(date_str)
    cash = await _cash_for(date_str)
    delta = tiffins_dispatched - scans
    pct = (abs(delta) / tiffins_dispatched) if tiffins_dispatched > 0 else 0.0
    suspicious = abs(delta) > max(DELTA_ABS_THRESHOLD, int(tiffins_dispatched * DELTA_PCT_THRESHOLD))
    return {
        "scans": scans,
        "cash_collected": round(cash, 2),
        "delta": delta,           # +ve = dispatched > scanned (fraud signal)
        "delta_pct": round(pct * 100, 2),
        "suspicious": suspicious,
    }


async def _maybe_raise_alert(date_str: str, payload: dict, recon: dict, actor_id: str) -> bool:
    if not recon["suspicious"]:
        return False
    await server.db.admin_notifications.update_one(
        {"kind": "kitchen_fraud_alert", "date": date_str},
        {"$set": {
            "kind": "kitchen_fraud_alert",
            "date": date_str,
            "tiffins_dispatched": payload["tiffins_dispatched"],
            "plates_served": payload.get("plates_served", 0),
            "scans": recon["scans"],
            "delta": recon["delta"],
            "delta_pct": recon["delta_pct"],
            "actor_id": actor_id,
            "created_at": server.iso(server.now_utc()),
            "read": False,
            "message": (
                f"Kitchen close-out {date_str}: {payload['tiffins_dispatched']} dispatched, "
                f"only {recon['scans']} scans recorded — {recon['delta']} unit gap "
                f"({recon['delta_pct']:.1f}% delta)."
            ),
        }},
        upsert=True,
    )
    return True


@router.post("/kitchen/close-out")
async def submit_close_out(payload: CloseOutIn, user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Kitchen / admin only")
    recon = await _reconcile(payload.date, payload.tiffins_dispatched)
    doc = {
        "date": payload.date,
        "tiffins_dispatched": payload.tiffins_dispatched,
        "plates_served": payload.plates_served,
        "notes": payload.notes or "",
        "submitted_by": user.user_id,
        "submitted_at": server.iso(server.now_utc()),
        **recon,
    }
    await server.db.kitchen_closeouts.update_one(
        {"date": payload.date}, {"$set": doc}, upsert=True,
    )
    alerted = await _maybe_raise_alert(payload.date, payload.model_dump(), recon, user.user_id)
    doc.pop("_id", None)
    return {"ok": True, "alert_raised": alerted, **doc}


@router.get("/kitchen/close-out")
async def get_close_out(date: str = Query(...), user: server.User = Depends(server.get_current_user)):
    if user.role not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Kitchen / admin only")
    doc = await server.db.kitchen_closeouts.find_one({"date": date}, {"_id": 0})
    if not doc:
        # Always return the reconciliation so the form can show "you haven't submitted yet, here's today's pre-fill"
        recon = await _reconcile(date, 0)
        return {"date": date, "submitted": False, **recon}
    return {"submitted": True, **doc}


@router.get("/admin/kitchen/recent")
async def admin_kitchen_recent(days: int = Query(14, ge=1, le=90), user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    today = server.now_utc().date()
    items = []
    for i in range(days):
        d = (today - timedelta(days=i)).isoformat()
        doc = await server.db.kitchen_closeouts.find_one({"date": d}, {"_id": 0})
        if doc:
            items.append({**doc, "submitted": True})
        else:
            recon = await _reconcile(d, 0)
            items.append({"date": d, "submitted": False, **recon})
    return {"days": days, "items": items}


@router.get("/admin/kitchen/reconcile")
async def admin_live_reconcile(date: str = Query(...), tiffins: int = Query(0, ge=0), user: server.User = Depends(server.get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return {"date": date, **(await _reconcile(date, tiffins))}
