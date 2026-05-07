"""Per-key rate limiter backed by MongoDB.

Stores one document per request hit, expires automatically via a TTL index on
`expires_at`. Counts docs in the current window to decide allow/deny.

Why MongoDB (not Redis)?
  • The app already uses MongoDB — no new infra.
  • Low traffic OTP endpoint, not hot-path; ~3-5 ms cost is fine.
  • TTL index garbage-collects rows automatically (no cron sweep).

Usage:
    from rate_limit import check_and_record, RateLimitExceeded
    try:
        await check_and_record(db, key="ip:1.2.3.4", max_count=10, window_seconds=3600)
    except RateLimitExceeded as e:
        raise HTTPException(429, detail=str(e), headers={"Retry-After": str(e.retry_after)})
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("efoodcare.rate_limit")

_TTL_INDEX_ENSURED = False
COLLECTION = "rate_limit_hits"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _ensure_indexes(db) -> None:
    """Create TTL index on expires_at + lookup index on key. Idempotent."""
    global _TTL_INDEX_ENSURED
    if _TTL_INDEX_ENSURED:
        return
    try:
        # TTL — Mongo deletes docs ~60 s after expires_at passes.
        await db[COLLECTION].create_index("expires_at", expireAfterSeconds=0)
        await db[COLLECTION].create_index([("key", 1), ("ts", -1)])
        _TTL_INDEX_ENSURED = True
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[RATE LIMIT] index creation skipped: {e}")


class RateLimitExceeded(Exception):
    """Raised when the caller exceeds the limit. `retry_after` is in seconds."""

    def __init__(self, message: str, retry_after: int):
        super().__init__(message)
        self.retry_after = max(1, int(retry_after))


async def check_and_record(
    db,
    *,
    key: str,
    max_count: int,
    window_seconds: int,
    label: str = "",
) -> int:
    """Check that `key` has been hit fewer than `max_count` times in the past
    `window_seconds`, then record the current hit. Raises RateLimitExceeded
    on the (max_count + 1)th attempt within the window.

    Returns the count *after* recording the new hit (1-based).
    """
    await _ensure_indexes(db)
    now = _now()
    window_start = now - timedelta(seconds=window_seconds)

    # Count hits inside the current window.
    count = await db[COLLECTION].count_documents({"key": key, "ts": {"$gte": window_start}})
    if count >= max_count:
        # Find earliest hit in window → tells us when the limit will release.
        earliest = await db[COLLECTION].find_one(
            {"key": key, "ts": {"$gte": window_start}},
            sort=[("ts", 1)],
            projection={"_id": 0, "ts": 1},
        )
        retry_after = window_seconds
        if earliest and earliest.get("ts"):
            ts = earliest["ts"]
            # Mongo returns naive UTC datetimes — re-attach tz so we can subtract.
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            retry_after = max(1, int((ts + timedelta(seconds=window_seconds) - now).total_seconds()))
        raise RateLimitExceeded(
            f"Too many requests · {label or key} · try again in {retry_after}s",
            retry_after=retry_after,
        )

    # Record this hit. expires_at is when the doc becomes deletable (window end).
    await db[COLLECTION].insert_one({
        "key": key,
        "ts": now,
        "expires_at": now + timedelta(seconds=window_seconds),
    })
    return count + 1


def client_ip(request) -> str:
    """Best-effort client IP behind a reverse proxy / k8s ingress.

    Order of preference:
      1. CF-Connecting-IP (Cloudflare)
      2. X-Forwarded-For first hop (most ingresses set this)
      3. X-Real-IP
      4. request.client.host
    """
    headers = request.headers
    cf = headers.get("cf-connecting-ip") or headers.get("CF-Connecting-IP")
    if cf:
        return cf.strip()
    xff = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
    if xff:
        # First IP is the original client; rest are intermediaries.
        return xff.split(",")[0].strip()
    xreal = headers.get("x-real-ip") or headers.get("X-Real-IP")
    if xreal:
        return xreal.strip()
    return (request.client.host if request.client else "unknown") or "unknown"
