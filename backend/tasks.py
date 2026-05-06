"""Background scheduler — extracted from server.py for clarity.

Three async daemons run for the lifetime of the FastAPI process:
  * subscription_tick      — hourly  (TICK_INTERVAL_SECONDS)
  * empty-tiffin reminder  — 5 min   (REMINDER_INTERVAL_SECONDS)
  * expiry reminder        — hourly  (EXPIRY_SCAN_INTERVAL_SECONDS)

Each `run_*` function is owned by server.py — this module is purely orchestration
(periodic loop, exception logging, configurable interval). Keeps the daemons
independent of database/model imports → no circular-import risk.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Awaitable, Callable, List

logger = logging.getLogger("efoodcare")

TICK_INTERVAL_SECONDS = int(os.environ.get("TICK_INTERVAL_SECONDS", "3600"))
REMINDER_INTERVAL_SECONDS = int(os.environ.get("REMINDER_INTERVAL_SECONDS", "300"))
EXPIRY_SCAN_INTERVAL_SECONDS = int(os.environ.get("EXPIRY_SCAN_INTERVAL_SECONDS", "3600"))

# Stagger first runs so they don't collide on cold start.
_INITIAL_DELAY_TICK = 15
_INITIAL_DELAY_REMINDER = 20
_INITIAL_DELAY_EXPIRY = 40

AsyncFn = Callable[[], Awaitable[object]]


async def _periodic(name: str, fn: AsyncFn, interval_s: int, initial_delay_s: int) -> None:
    """Run `fn()` forever, every `interval_s` seconds. Swallows + logs all exceptions
    so a single failed iteration never kills the scheduler."""
    await asyncio.sleep(initial_delay_s)
    while True:
        try:
            await fn()
        except Exception as e:  # noqa: BLE001
            logger.exception(f"[{name}] crashed: {e}")
        await asyncio.sleep(interval_s)


def start_background_loops(
    *,
    run_subscription_tick: AsyncFn,
    run_empty_tiffin_reminders: AsyncFn,
    run_expiry_reminders: AsyncFn,
) -> List[asyncio.Task]:
    """Launch all three daemons. Returns the list of asyncio Tasks so the caller
    can cancel them on shutdown if needed."""
    tasks = [
        asyncio.create_task(_periodic("CRON TICK LOOP", run_subscription_tick, TICK_INTERVAL_SECONDS, _INITIAL_DELAY_TICK)),
        asyncio.create_task(_periodic("REMINDER LOOP", run_empty_tiffin_reminders, REMINDER_INTERVAL_SECONDS, _INITIAL_DELAY_REMINDER)),
        asyncio.create_task(_periodic("EXPIRY LOOP", run_expiry_reminders, EXPIRY_SCAN_INTERVAL_SECONDS, _INITIAL_DELAY_EXPIRY)),
    ]
    logger.info(
        "[STARTUP] background scheduler launched · "
        f"tick={TICK_INTERVAL_SECONDS}s · reminder={REMINDER_INTERVAL_SECONDS}s · expiry={EXPIRY_SCAN_INTERVAL_SECONDS}s"
    )
    return tasks
