"""eFoodCare tiffin delivery package.

Originally a single 980-line `delivery.py`. Split into focused submodules
(shared, admin, boy, customer) for readability — public import surface
is preserved so existing `from delivery import make_router, ...` works.
"""
from .admin import make_router
from .boy import make_boy_router
from .customer import make_customer_router
# Re-export commonly used helpers for any external code that imported them
# from the old monolithic module.
from .shared import (
    DEFAULT_SETTINGS, MEALS,
    SettingsPatch, CollectEmpty, BoyCreate, BoyPatch, HandoffCreate,
    MarkItem, LocationPing, DispatchStart,
    _load_settings_db, _record_empty_collection_db, _slot_open_now,
    extract_pincode, gen_otp, haversine_m, iso, now_utc, parse_dt,
    today_local,
)

__all__ = [
    "make_router", "make_boy_router", "make_customer_router",
    "DEFAULT_SETTINGS", "MEALS",
    "SettingsPatch", "CollectEmpty", "BoyCreate", "BoyPatch", "HandoffCreate",
    "MarkItem", "LocationPing", "DispatchStart",
    "_load_settings_db", "_record_empty_collection_db", "_slot_open_now",
    "extract_pincode", "gen_otp", "haversine_m", "iso", "now_utc",
    "parse_dt", "today_local",
]
