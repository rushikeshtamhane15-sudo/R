"""Physical raw tiffin stock tracking — iter-86 #1: per-mess scoping.

Each branch maintains its own stock counter at
`db.tiffin_stock/_id="active:{mess_id}"`. Legacy singleton `_id="active"` is
still read as a global fallback so older data is not lost on the first run.

Admin (or staff or mess_owner) can adjust their own branch's stock; HQ
admin can pass `?mess_id=` to operate on any branch.

`decrement_stock_db()` accepts an optional `mess_id` so the delivery flow
can pass the order's branch id when marking a tiffin delivered.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from shared import server

router = APIRouter()

LEGACY_KEY = "active"


def _stock_id(mess_id: Optional[str]) -> str:
    """Compute the singleton _id for a mess. None → legacy global key."""
    if not mess_id:
        return LEGACY_KEY
    return f"active:{mess_id}"


async def _resolve_mess_for_user(user) -> Optional[str]:
    """Franchise_owner is pinned to their own mess; admin/staff use global by default
    (HQ can override with ?mess_id=)."""
    if user.role != "mess_owner":
        return None
    doc = await server.db.messes.find_one({"owner_user_id": user.user_id}, {"_id": 0, "mess_id": 1})
    return (doc or {}).get("mess_id")


# === Helpers (exported for use from delivery layer) ===========================
async def _load_state(db, mess_id: Optional[str] = None) -> dict:
    doc = await db.tiffin_stock.find_one({"_id": _stock_id(mess_id)}, {"_id": 0}) or {}
    return {
        "quantity": int(doc.get("quantity") or 0),
        "low_threshold": int(doc.get("low_threshold") or 20),
        "last_topup_at": doc.get("last_topup_at"),
        "last_topup_qty": int(doc.get("last_topup_qty") or 0),
        "mess_id": mess_id,
    }


async def _log_movement(db, *, kind: str, delta: int, reason: str, source: str, user_id: Optional[str] = None, after: Optional[int] = None, mess_id: Optional[str] = None):
    await db.tiffin_stock_movements.insert_one({
        "ts": server.iso(server.now_utc()),
        "kind": kind,         # "topup" | "consume" | "adjust"
        "delta": int(delta),  # signed
        "after": int(after) if after is not None else None,
        "reason": reason[:200],
        "source": source,
        "user_id": user_id,
        "mess_id": mess_id,
    })


async def decrement_stock_db(db, *, count: int = 1, reason: str = "Tiffin delivered", source: str = "delivery", user_id: Optional[str] = None, mess_id: Optional[str] = None) -> int:
    """Atomically subtract `count` tiffins from the branch's stock. Floors at 0 — never
    goes negative (so a forgotten top-up doesn't break delivery). Returns new total."""
    cnt = max(0, int(count))
    if cnt == 0:
        return (await _load_state(db, mess_id))["quantity"]
    sid = _stock_id(mess_id)
    res = await db.tiffin_stock.find_one_and_update(
        {"_id": sid},
        {"$inc": {"quantity": -cnt}},
        upsert=True,
        return_document=True,  # AFTER doc
        projection={"_id": 0},
    )
    after = max(0, int((res or {}).get("quantity") or 0))
    if (res or {}).get("quantity", 0) < 0:
        # Floor at 0 — over-consumption due to missing topup
        await db.tiffin_stock.update_one({"_id": sid}, {"$set": {"quantity": 0}})
        after = 0
    await _log_movement(db, kind="consume", delta=-cnt, reason=reason, source=source, user_id=user_id, after=after, mess_id=mess_id)
    return after


async def increment_stock_db(db, *, count: int = 1, reason: str = "Tiffin returned", source: str = "takeaway_collected", user_id: Optional[str] = None, mess_id: Optional[str] = None) -> int:
    """Atomically add `count` tiffins back to the branch's stock. Used when the
    customer returns a take-away steel tiffin (admin taps Mark collected).
    Returns new total. iter-131.30."""
    cnt = max(0, int(count))
    if cnt == 0:
        return (await _load_state(db, mess_id))["quantity"]
    sid = _stock_id(mess_id)
    res = await db.tiffin_stock.find_one_and_update(
        {"_id": sid},
        {"$inc": {"quantity": cnt}},
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    after = int((res or {}).get("quantity") or cnt)
    await _log_movement(db, kind="return", delta=cnt, reason=reason, source=source, user_id=user_id, after=after, mess_id=mess_id)
    return after


# === Schemas =================================================================
class TopupIn(BaseModel):
    qty: int = Field(..., ge=1, le=10000)
    note: Optional[str] = None


class AdjustIn(BaseModel):
    delta: int = Field(..., description="Signed adjustment (positive or negative)")
    reason: str


class BrokenIn(BaseModel):
    """iter-134.e — mark tiffins as broken / lost. Positive `count` = new
    write-offs to add to the broken ledger. `reason` becomes the audit trail."""
    count: int = Field(..., gt=0, description="How many tiffins to mark broken/lost")
    reason: str = Field(default="Broken/lost")


# === Public-admin endpoints ===================================================
def _admin_or_staff(user):
    # iter-85: franchise owners get full operational control over their own
    # branch — tiffin stock is per-mess, so franchise can read & write here.
    if user.role not in ("admin", "staff", "mess_owner"):
        raise HTTPException(status_code=403, detail="Admin/staff only")


async def _resolve_target_mess(user, mess_id_param: Optional[str]) -> Optional[str]:
    """Determine which branch's stock the caller is touching:
    - mess_owner → always their own mess (ignore the query param).
    - admin/staff → respect the ?mess_id= param (or None = legacy global).
    """
    if user.role == "mess_owner":
        return await _resolve_mess_for_user(user)
    return mess_id_param


@router.get("/admin/tiffin-stock")
async def get_state(mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    target = await _resolve_target_mess(user, mess_id)
    st = await _load_state(server.db, target)
    # Active tiffin-subscribers for context — scoped to branch when target set.
    try:
        q: dict = {
            "status": "active",
            "$or": [{"service_type": "tiffin"}, {"category": "tiffin"}],
        }
        if target:
            q["mess_id"] = target
        active_tiffin_subs = await server.db.subscriptions.count_documents(q)
    except Exception:
        active_tiffin_subs = 0
    # iter-131.32: engaged = takeaway steel tiffins currently OUT with customers
    # (delivered but not yet returned/collected). Sourced from the
    # `restaurant_tiffin_pendency` collection where `collected` is falsy.
    engaged = 0
    try:
        eq: dict = {"$or": [{"collected": False}, {"collected": {"$exists": False}}]}
        if target:
            # branch-scope engaged tiffins via users-in-mess helper
            user_ids = await server._users_in_mess(target)
            if user_ids is not None:
                eq["user_id"] = {"$in": user_ids}
        cursor = server.db.restaurant_tiffin_pendency.find(eq, {"_id": 0, "tiffin_count": 1})
        async for row in cursor:
            engaged += int(row.get("tiffin_count") or 0)
    except Exception:
        engaged = 0
    st["active_tiffin_subs"] = active_tiffin_subs
    st["expected_daily_use"] = active_tiffin_subs * 2  # 2 meals/day
    # iter-137.b — engaged, per user's re-explained mental model:
    #   engaged = tiffins currently OUT (with subs on delivery + takeaway pending
    #             + any awaiting empty-return collection). Auto-derived so we
    #             never drift from the physical inventory.
    #
    # We keep the old takeaway-only counter as `takeaway_pending` so the tile
    # can show a sub-line breakdown (on-delivery vs takeaway).
    takeaway_pending = engaged  # (already computed above from restaurant_tiffin_pendency)
    st["takeaway_pending"] = takeaway_pending
    # iter-134.d: `lifetime_purchases` = sum of ALL top-up movements ever for
    # this branch. Represents the "total raw tiffins purchased over the branch
    # lifetime". Fallback: quantity + engaged if the movements log is missing.
    lifetime_purchases = 0
    try:
        mq: dict = {"kind": "topup"}
        if target:
            mq["mess_id"] = target
        else:
            mq["$or"] = [{"mess_id": None}, {"mess_id": {"$exists": False}}]
        cursor = server.db.tiffin_stock_movements.find(mq, {"_id": 0, "delta": 1})
        async for row in cursor:
            lifetime_purchases += int(row.get("delta") or 0)
    except Exception:
        lifetime_purchases = 0
    # iter-134.e: broken/lost ledger — sum of all `broken` movements.
    broken_total = 0
    try:
        bq: dict = {"kind": "broken"}
        if target:
            bq["mess_id"] = target
        else:
            bq["$or"] = [{"mess_id": None}, {"mess_id": {"$exists": False}}]
        cursor = server.db.tiffin_stock_movements.find(bq, {"_id": 0, "delta": 1})
        async for row in cursor:
            broken_total += abs(int(row.get("delta") or 0))
    except Exception:
        broken_total = 0
    # iter-137.b (fix) — Raw is a PURE bookkeeping figure: what we've ever
    # bought minus what we've written off. It does NOT get inflated to hide
    # in-flight drift; if pendency > 0 but in-hand hasn't been decremented,
    # the reconciliation footer flags it as drift so the admin can adjust.
    st["lifetime_purchases"] = lifetime_purchases
    st["broken_total"] = broken_total
    # iter-137.b — user's four-tile mental model:
    #   raw_tiffins   = total physical inventory currently owned
    #                 = lifetime_purchases − broken_total
    #   in_hand       = kitchen count (stored `quantity`)
    #   engaged       = raw − in_hand  (subs on delivery + takeaway pending)
    #   shortage      = max(0, next_slot_required − in_hand)
    raw_tiffins = max(0, int(st["lifetime_purchases"]) - int(broken_total))
    st["raw_tiffins"] = raw_tiffins
    st["engaged"] = max(0, raw_tiffins - int(st["quantity"]))
    st["on_delivery"] = max(0, st["engaged"] - int(takeaway_pending))
    # Compute the NEXT meal slot in IST + how many tiffin subs need a tiffin
    # then, so the shortage tile is auto-derived.
    try:
        from datetime import datetime as _dt, timezone as _tz, timedelta as _td
        ist_now = _dt.now(_tz(_td(hours=5, minutes=30)))
        ist_min = ist_now.hour * 60 + ist_now.minute
        # Read active meal-slot windows (same doc kiosk uses)
        slot_cfg = await server.db.app_config.find_one({"key": "meal_slots_v1"}, {"_id": 0}) or {}
        def _min(t, dflt):
            try:
                h, m = [int(x) for x in str(t).split(":")]
                return h * 60 + m
            except Exception:
                return dflt
        lunch_s = _min((slot_cfg.get("lunch") or {}).get("start"), 12 * 60)
        dinner_s = _min((slot_cfg.get("dinner") or {}).get("start"), 19 * 60)
        # Next slot = the earliest window whose start_time > now (IST).
        # Late-night → tomorrow's lunch.
        if ist_min < lunch_s:
            next_slot = "lunch"
        elif ist_min < dinner_s:
            next_slot = "dinner"
        else:
            next_slot = "lunch"
    except Exception:
        next_slot = "lunch"
    # Count of active tiffin subs whose meal_window includes the next slot.
    try:
        nq: dict = {
            "status": "active",
            "$or": [{"service_type": "tiffin"}, {"category": "tiffin"}],
            "meal_window": {"$in": [next_slot, "both", None]},
        }
        if target:
            nq["mess_id"] = target
        next_slot_required = await server.db.subscriptions.count_documents(nq)
    except Exception:
        # Fallback — every active tiffin sub gets one tiffin per slot
        next_slot_required = int(active_tiffin_subs)
    st["next_slot"] = next_slot
    st["next_slot_required"] = int(next_slot_required)
    st["shortage_for_next_run"] = max(0, int(next_slot_required) - int(st["quantity"]))
    # Reconciliation: expected in-hand = lifetime − engaged − broken.
    st["expected_in_hand"] = max(0, int(st["lifetime_purchases"]) - int(st["engaged"]) - int(broken_total))
    st["total_with_engaged"] = int(st["quantity"]) + int(st["engaged"])  # legacy field, keep for backwards compat
    st["low_stock"] = st["quantity"] <= st["low_threshold"]
    return st


@router.post("/admin/tiffin-stock/topup")
async def topup(payload: TopupIn, mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    target = await _resolve_target_mess(user, mess_id)
    qty = int(payload.qty)
    res = await server.db.tiffin_stock.find_one_and_update(
        {"_id": _stock_id(target)},
        {
            "$inc": {"quantity": qty},
            "$set": {
                "last_topup_at": server.iso(server.now_utc()),
                "last_topup_qty": qty,
                "mess_id": target,
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
        user_id=user.user_id, after=after, mess_id=target,
    )
    return {"ok": True, "quantity": after, "mess_id": target}


@router.post("/admin/tiffin-stock/adjust")
async def adjust(payload: AdjustIn, mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    target = await _resolve_target_mess(user, mess_id)
    delta = int(payload.delta)
    sid = _stock_id(target)
    res = await server.db.tiffin_stock.find_one_and_update(
        {"_id": sid},
        {"$inc": {"quantity": delta}, "$set": {"mess_id": target}},
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    after = max(0, int((res or {}).get("quantity") or 0))
    if (res or {}).get("quantity", 0) < 0:
        await server.db.tiffin_stock.update_one({"_id": sid}, {"$set": {"quantity": 0}})
        after = 0
    await _log_movement(
        server.db,
        kind="adjust", delta=delta,
        reason=payload.reason or "Manual adjust",
        source=f"admin:{user.user_id}",
        user_id=user.user_id, after=after, mess_id=target,
    )
    return {"ok": True, "quantity": after, "mess_id": target}


@router.post("/admin/tiffin-stock/reset")
async def reset_state(mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    """iter-134.l — DANGER: full reset of the tiffin-stock ledger for the
    current branch. Zeros quantity, clears the low-threshold override, and
    logs an audit trail movement so the reset itself is discoverable. Does
    NOT delete `restaurant_tiffin_pendency` rows — engaged tiffins remain
    accounted for and can be reconciled manually."""
    _admin_or_staff(user)
    target = await _resolve_target_mess(user, mess_id)
    sid = _stock_id(target)
    await server.db.tiffin_stock.update_one(
        {"_id": sid},
        {"$set": {"quantity": 0, "low_threshold": 20, "last_topup_qty": 0, "last_topup_at": None, "mess_id": target}},
        upsert=True,
    )
    await server.db.tiffin_stock_movements.delete_many({"mess_id": target} if target else {"$or": [{"mess_id": None}, {"mess_id": {"$exists": False}}]})
    await _log_movement(
        server.db,
        kind="reset", delta=0,
        reason="Admin data reset",
        source=f"admin:{user.user_id}",
        user_id=user.user_id, after=0, mess_id=target,
    )
    return {"ok": True, "quantity": 0, "mess_id": target}


@router.post("/admin/tiffin-stock/broken")
async def mark_broken(payload: BrokenIn, mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    """iter-134.e — record broken/lost tiffins. Decrements the in-hand
    quantity (never below zero) and logs a `broken` movement so the
    reconciliation math (`lifetime − engaged − broken == in_hand`) holds."""
    _admin_or_staff(user)
    target = await _resolve_target_mess(user, mess_id)
    cnt = int(payload.count)
    sid = _stock_id(target)
    res = await server.db.tiffin_stock.find_one_and_update(
        {"_id": sid},
        {"$inc": {"quantity": -cnt}, "$set": {"mess_id": target}},
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    after = max(0, int((res or {}).get("quantity") or 0))
    if (res or {}).get("quantity", 0) < 0:
        await server.db.tiffin_stock.update_one({"_id": sid}, {"$set": {"quantity": 0}})
        after = 0
    await _log_movement(
        server.db,
        kind="broken", delta=-cnt,
        reason=payload.reason or "Broken/lost",
        source=f"admin:{user.user_id}",
        user_id=user.user_id, after=after, mess_id=target,
    )
    return {"ok": True, "quantity": after, "broken_added": cnt, "mess_id": target}


@router.get("/admin/tiffin-stock/history")
async def history(limit: int = 50, mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    target = await _resolve_target_mess(user, mess_id)
    limit = max(1, min(500, int(limit)))
    q: dict = {}
    if target:
        q["mess_id"] = target
    rows = await server.db.tiffin_stock_movements.find(q, {"_id": 0}).sort("ts", -1).to_list(limit)
    return {"rows": rows, "count": len(rows), "mess_id": target}


@router.put("/admin/tiffin-stock/threshold")
async def set_threshold(threshold: int = Body(..., embed=True), mess_id: Optional[str] = None, user: server.User = Depends(server.get_current_user)):
    _admin_or_staff(user)
    target = await _resolve_target_mess(user, mess_id)
    t = max(0, min(10000, int(threshold)))
    await server.db.tiffin_stock.update_one(
        {"_id": _stock_id(target)}, {"$set": {"low_threshold": t, "mess_id": target}}, upsert=True,
    )
    return {"ok": True, "low_threshold": t, "mess_id": target}


class CollectEmptiesIn(BaseModel):
    """iter-137.b — log empty tiffins collected during / after a delivery run.
    Positive `count` = number of empties returned to the kitchen. Increments
    in-hand and drops the engaged count automatically (engaged = raw − in_hand).
    """
    count: int = Field(..., gt=0, description="How many empty tiffins came back to kitchen")
    slot: Optional[str] = Field(default=None, description="Optional 'lunch'|'dinner' label for audit")
    note: Optional[str] = None


@router.post("/admin/tiffin-stock/collect-empties")
async def collect_empties(
    payload: CollectEmptiesIn,
    mess_id: Optional[str] = None,
    user: server.User = Depends(server.get_current_user),
):
    _admin_or_staff(user)
    target = await _resolve_target_mess(user, mess_id)
    cnt = int(payload.count)
    slot_label = (payload.slot or "").strip().lower()
    slot_prefix = f"{slot_label.capitalize()} · " if slot_label in {"lunch", "dinner"} else ""
    reason = payload.note.strip() if payload.note else f"{slot_prefix}Empty tiffins collected"
    after = await increment_stock_db(
        server.db,
        count=cnt,
        reason=reason,
        source=f"admin:{user.user_id}",
        user_id=user.user_id,
        mess_id=target,
    )
    return {"ok": True, "quantity": after, "collected": cnt, "mess_id": target}

