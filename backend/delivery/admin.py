"""Admin-facing delivery routes composer.

Historically this file was a single 490-line `make_router()` closure with a
cyclomatic complexity of ~100. It is now a thin composer that delegates to
four focused sub-modules:

- admin_settings       — settings + delivery-boy CRUD
- admin_roster         — daily roster generation + today summary
- admin_handoff        — handoff, mark-item, reconcile
- admin_diagnostics    — empties, geofence health, live map

Public surface (`make_router(db)`) is unchanged so `server.py` and
`delivery/__init__.py` continue to work without modification.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from . import admin_diagnostics, admin_handoff, admin_roster, admin_settings


def make_router(db) -> APIRouter:
    """Build and return the admin delivery API router.

    Imports `get_current_user` lazily via `server.py` to avoid circular imports.
    """
    from server import get_current_user, User  # type: ignore

    router = APIRouter(prefix="/admin/delivery", tags=["delivery"])

    async def admin_only(user: User = Depends(get_current_user)) -> User:
        if user.role not in ("admin", "mess_owner"):
            raise HTTPException(status_code=403, detail="Admin only")
        return user

    admin_settings.register(router, db, admin_only)
    admin_roster.register(router, db, admin_only)
    admin_handoff.register(router, db, admin_only)
    admin_diagnostics.register(router, db, admin_only)
    return router
