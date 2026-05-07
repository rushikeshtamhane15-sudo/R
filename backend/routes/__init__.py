# routes — feature-scoped APIRouter modules.
#
# Each module here defines a thin `router = APIRouter()` and registers its
# handlers on it. Shared application state (db, logger, helpers, pydantic
# models) stays in `server.py` and is accessed via `import server` — late
# binding so module import order is safe.
#
# server.py imports these routers at the BOTTOM of its module body and calls
# `api_router.include_router(...)` to mount them under `/api`.
