"""Physical raw tiffin stock tracking.

Admin (or staff) can add stock manually; the count auto-decrements every time
a tiffin is marked delivered (issued) by a delivery boy / admin / customer
self-confirm. Movements are appended to `db.tiffin_stock_movements` for
audit. Singleton state lives at `db.tiffin_stock/_id=active`.

The `decrement_stock_db()` helper is exported so the delivery flow can call
it without circular imports.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()


# === Helpers (exported for use from delivery layer) ===========================
async def _load_state(db) -> dict:
    doc = await db.tiffin_stock.find_one({"_id": "active"}, {"_id": 0}) or {}
    return {
        "quantity": int(doc.get("quantity") or 0),
        "low_threshold": int(doc.get("low_threshold") or 20),
        "last_topup_at": doc.get("last_topup_at"),
        "last_topup_qty": int(doc.get("last_topup_qty") or 0),
    }


async def _log_movement(db, *, kind: str, delta: int, reason: str, source: str, user_id: Optional[str] = None, after: Optional[int] = None):
    await db.tiffin_stock_movements.insert_one({
        "ts": server.iso(server.now_utc()),
        "kind": kind,         # "topup" | "consume" | "adjust"
        "delta": int(delta),  # signed
        "after": int(after) if after is not None else None,
        "reason": reason[:200],
        "source": source,
        "user_id": user_id,
    })


async def decrement_stock_db(db, *, count: int = 1, reason: str = "Tiffin delivered", source: str = "delivery", user_id: Optional[str] = None) -> int:
    """Atomically subtract `count` tiffins from stock. Floors at 0 — never goes
    negative (so a forgotten top-up doesn't break delivery). Returns new total."""
    cnt = max(0, int(count))
    if cnt == 0:
        return (await _load_state(db))["quantity"]
    res = await db.tiffin_stock.find_one_and_update(
        {"_id": "active"},
        {"$inc": {"quantity": -cnt}},
        upsert=True,
        return_document=True,  # AFTER doc
        projection={"_id": 0},
    )
    after = max(0, int((res or {}).get("quantity") or 0))
    if (res or {}).get("quantity", 0) < 0:
        # Floor at 0 — over-consumption due to missing topup
        await db.tiffin_stock.update_one({"_id": "active"}, {"$set": {"quantity": 0}})
        after = 0
    await _log_movement(db, kind="consume", delta=-cnt, reason=reason, source=source, user_id=user_id, after=after)
    return after


# === Schemas =================================================================
class TopupIn(BaseModel):
    qty: int = Field(..., ge=1, le=10000)
    note: Optional[str] = None


class AdjustIn(BaseModel):
    delta: int = Field(..., description="Signed adjustment (positive or negative)")
    reason: str


# === Public-admin endpoints ===================================================
def _admin_or_staff(user):
    # iter-85: franchise owners get full operational control over their own
    # branch — tiffin stock is per-mess, so franchise can read & write here.
    if user.role not in ("admin", "staff", "franchise_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")


@router.get("/admin/tiffin-stock")
async def get_state(user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    st = await _load_state(server.db)
    # Active tiffin-subscribers for context (so admin knows expected daily demand)
    try:
        active_tiffin_subs = await server.db.subscriptions.count_documents({
            "status": "active",
            "$or": [{"service_type": "tiffin"}, {"category": "tiffin"}],
        })
    except Exception:
        active_tiffin_subs = 0
    st["active_tiffin_subs"] = active_tiffin_subs
    st["expected_daily_use"] = active_tiffin_subs * 2  # 2 meals/day
    st["low_stock"] = st["quantity"] <= st["low_threshold"]
    return st


@router.post("/admin/tiffin-stock/topup")
async def topup(payload: TopupIn, user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    qty = int(payload.qty)
    res = await server.db.tiffin_stock.find_one_and_update(
        {"_id": "active"},
        {
            "$inc": {"quantity": qty},
            "$set": {
                "last_topup_at": server.iso(server.now_utc()),
                "last_topup_qty": qty,
            },
        },
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    after = int((res or {}).get("quantity") or qty)
    await _log_movement(
        server.db,
        kind="topup", delta=qty,
        reason=(payload.note or "Stock added"),
        source=f"admin:{user.user_id}",
        user_id=user.user_id, after=after,
    )
    return {"ok": True, "quantity": after}


@router.post("/admin/tiffin-stock/adjust")
async def adjust(payload: AdjustIn, user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    delta = int(payload.delta)
    res = await server.db.tiffin_stock.find_one_and_update(
        {"_id": "active"},
        {"$inc": {"quantity": delta}},
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    after = max(0, int((res or {}).get("quantity") or 0))
    if (res or {}).get("quantity", 0) < 0:
        await server.db.tiffin_stock.update_one({"_id": "active"}, {"$set": {"quantity": 0}})
        after = 0
    await _log_movement(
        server.db,
        kind="adjust", delta=delta,
        reason=payload.reason or "Manual adjust",
        source=f"admin:{user.user_id}",
        user_id=user.user_id, after=after,
    )
    return {"ok": True, "quantity": after}


@router.get("/admin/tiffin-stock/history")
async def history(limit: int = 50, user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    limit = max(1, min(500, int(limit)))
    rows = await server.db.tiffin_stock_movements.find({}, {"_id": 0}).sort("ts", -1).to_list(limit)
    return {"rows": rows, "count": len(rows)}


@router.put("/admin/tiffin-stock/threshold")
async def set_threshold(threshold: int = Body(..., embed=True), user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    t = max(0, min(10000, int(threshold)))
    await server.db.tiffin_stock.update_one(
        {"_id": "active"}, {"$set": {"low_threshold": t}}, upsert=True,
    )
    return {"ok": True, "low_threshold": t}
