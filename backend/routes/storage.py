"""iter-183 · Emergent Object Storage integration.

Thin helper wrapping the `/objstore/api/v1/storage` proxy endpoints.
Session-scoped `storage_key` is minted once at startup (see server.py
`_startup_init_storage`) and reused for every `put_object` / `get_object`
call. On `403`/`404` we transparently re-mint with `init_storage(force=True)`
per the playbook.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional, Tuple

import requests

logger = logging.getLogger("efoodcare.storage")

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
APP_NAME = "efoodtech"  # bucket-prefix on every path

_storage_key: Optional[str] = None


def init_storage(force: bool = False) -> Optional[str]:
    """Mint (or return) the session storage_key. Never raises — logs and
    returns None on failure so the FastAPI startup handler is resilient."""
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    if not EMERGENT_KEY:
        logger.warning("[storage] EMERGENT_LLM_KEY missing — storage disabled")
        return None
    try:
        r = requests.post(
            f"{STORAGE_URL}/init",
            json={"emergent_key": EMERGENT_KEY},
            timeout=30,
        )
        r.raise_for_status()
        _storage_key = r.json().get("storage_key")
        logger.info(f"[storage] init ok · key_prefix={(_storage_key or '')[:6]}…")
        return _storage_key
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[storage] init failed: {e}")
        _storage_key = None
        return None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload bytes to `path`. Retries once on 403/404 by re-initialising."""
    for attempt in (0, 1):
        key = init_storage(force=(attempt == 1))
        if not key:
            raise RuntimeError("storage_unavailable")
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=180,
        )
        if r.status_code in (403, 404) and attempt == 0:
            logger.info(f"[storage] {r.status_code} on put — re-initialising")
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("storage_put_failed")


def get_object(path: str) -> Tuple[bytes, str]:
    """Fetch object bytes + content-type."""
    for attempt in (0, 1):
        key = init_storage(force=(attempt == 1))
        if not key:
            raise RuntimeError("storage_unavailable")
        r = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
        if r.status_code in (403, 404) and attempt == 0:
            continue
        r.raise_for_status()
        return r.content, r.headers.get("Content-Type", "application/octet-stream")
    raise RuntimeError("storage_get_failed")


MIME_MAP = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
    "pdf": "application/pdf", "mp4": "video/mp4", "webm": "video/webm",
    "mov": "video/quicktime", "csv": "text/csv", "txt": "text/plain",
    "json": "application/json",
}
