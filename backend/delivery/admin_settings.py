"""Admin delivery settings + delivery-boy CRUD."""
from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException

from .shared import (
    BoyCreate, BoyPatch, SettingsPatch,
    _load_settings_db, iso, now_utc,
)


def register(router: APIRouter, db, admin_only) -> None:
    @router.get("/settings")
    async def get_settings(_=Depends(admin_only)):
        return await _load_settings_db(db)

    @router.patch("/settings")
    async def patch_settings(payload: SettingsPatch = Body(...), _=Depends(admin_only)):
        cur = await _load_settings_db(db)
        patch = {k: v for k, v in payload.dict(exclude_none=True).items()}
        if "service_pincodes" in patch:
            patch["service_pincodes"] = [str(p).strip() for p in patch["service_pincodes"] if str(p).strip()]
        cur.update(patch)
        await db.delivery_settings.update_one({"_id": "active"}, {"$set": patch}, upsert=True)
        return cur

    @router.get("/boys")
    async def list_boys(_=Depends(admin_only)):
        boys = await db.delivery_boys.find({}, {"_id": 0}).sort("name", 1).to_list(500)
        return {"boys": boys}

    @router.post("/boys")
    async def create_boy(payload: BoyCreate = Body(...), _=Depends(admin_only)):
        # If a user with this phone already exists, reuse it; otherwise create one with role=delivery_boy
        existing_user = await db.users.find_one({"phone": payload.phone.strip()}, {"_id": 0})
        if existing_user:
            user_id = existing_user["user_id"]
            await db.users.update_one(
                {"user_id": user_id},
                {"$set": {"role": "delivery_boy", "name": payload.name.strip()}},
            )
        else:
            from server import _create_user_for_phone  # type: ignore
            new_user = await _create_user_for_phone(payload.phone.strip(), payload.name.strip(), role="delivery_boy")
            user_id = new_user["user_id"]
        boy = {
            "boy_id": f"dlv_{uuid4().hex[:10]}",
            "user_id": user_id,
            "name": payload.name.strip(),
            "phone": payload.phone.strip(),
            "assigned_pincodes": [str(p).strip() for p in payload.assigned_pincodes if str(p).strip()],
            "active": payload.active,
            "current_lat": None, "current_lng": None, "last_ping_at": None,
            "on_trip": False, "trip_handoff_id": None,
            "created_at": iso(now_utc()),
        }
        await db.delivery_boys.insert_one(boy.copy())
        return boy

    @router.patch("/boys/{boy_id}")
    async def patch_boy(boy_id: str, payload: BoyPatch = Body(...), _=Depends(admin_only)):
        patch = {k: v for k, v in payload.dict(exclude_none=True).items()}
        if "assigned_pincodes" in patch:
            patch["assigned_pincodes"] = [str(p).strip() for p in patch["assigned_pincodes"] if str(p).strip()]
        if not patch:
            raise HTTPException(status_code=400, detail="Nothing to update")
        r = await db.delivery_boys.update_one({"boy_id": boy_id}, {"$set": patch})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Boy not found")
        return await db.delivery_boys.find_one({"boy_id": boy_id}, {"_id": 0})

    @router.delete("/boys/{boy_id}")
    async def delete_boy(boy_id: str, _=Depends(admin_only)):
        await db.delivery_boys.delete_one({"boy_id": boy_id})
        return {"ok": True}
