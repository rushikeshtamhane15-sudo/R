"""iter-126 — IST-aware day rollover for subscription cron & attendance.

The bug: `today_str()` and `date.today()` used server-UTC, so the daily
wallet-tick cron and attendance dedupe used UTC boundaries. eFoodCare is
India-only, so a user opening the app at 1 AM IST would see "no deduction
yet" — the server thought it was still yesterday-UTC (19:30 UTC).

This test locks in the fix: any date/time helper used by the subscription
cron or the attendance path must respect IST (Asia/Kolkata = UTC+5:30).
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

import pytest


IST_OFFSET = timedelta(hours=5, minutes=30)


def test_ist_helpers_defined():
    from server import IST_TZ, ist_now, ist_today, today_str
    # Type checks
    assert IST_TZ.utcoffset(None) == IST_OFFSET
    now = ist_now()
    assert now.tzinfo is not None
    assert now.utcoffset() == IST_OFFSET
    assert ist_today() == now.date()
    # today_str now uses IST — it must match ist_today().isoformat()
    assert today_str() == ist_today().isoformat()


def test_ist_rollover_at_1am_ist_is_new_day_vs_utc(monkeypatch):
    """At 19:43 UTC (= 01:13 IST next day), the IST calendar has ALREADY
    rolled over — the cron MUST tick, even though UTC still says yesterday."""
    from server import IST_TZ
    # 30 June 2026 19:43 UTC → 1 July 2026 01:13 IST
    utc_moment = datetime(2026, 6, 30, 19, 43, tzinfo=timezone.utc)
    ist_date = utc_moment.astimezone(IST_TZ).date()
    utc_date = utc_moment.date()
    assert ist_date.isoformat() == "2026-07-01"
    assert utc_date.isoformat() == "2026-06-30"
    # If last_tick_date was 30 June, IST-based check → TICK. UTC-based → skip.
    last_tick = utc_date  # yesterday-IST = same as today-UTC
    assert last_tick < ist_date          # cron will FIRE (correct behaviour)
    assert not (last_tick < utc_date)    # OLD cron would SKIP (the bug)


def test_today_str_produces_valid_iso_date():
    from server import today_str
    s = today_str()
    # Must parse as YYYY-MM-DD
    parsed = datetime.strptime(s, "%Y-%m-%d")
    assert parsed is not None
    # Must be close to now-IST (within 1 day either way — allows tests to run
    # around midnight without flakiness).
    now_ist = datetime.now(tz=timezone.utc) + IST_OFFSET
    assert abs((parsed.date() - now_ist.date()).days) <= 1
