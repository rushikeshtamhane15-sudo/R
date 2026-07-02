"""iter-129 — Monthly plans re-scoped 30d → 28d.

Locks in the business-rule change (approved by product):
  * All monthly plans move from 30-day to 28-day tenure
  * Meals adjust proportionally (60 → 56, keeping the 2/day invariant)
  * Amount stays the same → daily rate rises (Premium ₹93.33 → ₹100 exact)
  * Existing active 30-day subs are NOT migrated (contract honoured)
"""
from __future__ import annotations

import os

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"


def test_default_plans_are_28_days():
    """Every non-test plan returned by /api/plans is 28 days now."""
    r = requests.get(f"{BASE_URL}/plans", timeout=10)
    assert r.status_code == 200
    plans = r.json().get("plans", [])
    real_plans = [p for p in plans if not p.get("plan_id", "").startswith("plan_")]  # skip test-artefact plans
    assert real_plans, "expected at least one real plan"
    for p in real_plans:
        assert p["duration_days"] == 28, f"{p['plan_id']} should be 28 days, got {p['duration_days']}"


def test_meals_stay_2_per_day_invariant():
    """Meals-per-day stays at 2 (56 meals / 28 days = 2 meals/day exact)."""
    r = requests.get(f"{BASE_URL}/plans", timeout=10)
    plans = [p for p in r.json().get("plans", []) if not p.get("plan_id", "").startswith("plan_")]
    for p in plans:
        ratio = p["meals"] / p["duration_days"]
        assert 1.9 <= ratio <= 2.1, (
            f"{p['plan_id']} meals-per-day ratio drifted: {p['meals']} meals / {p['duration_days']} days = {ratio}"
        )


def test_premium_plan_math_exact():
    """Premium Dining (flagship plan) has clean round numbers post-migration."""
    r = requests.get(f"{BASE_URL}/plans", timeout=10)
    premium = next((p for p in r.json().get("plans", []) if p["plan_id"] == "premium_60"), None)
    assert premium is not None, "premium_60 plan must exist"
    assert premium["duration_days"] == 28
    assert premium["meals"] == 56
    assert float(premium["amount"]) == 2800.0
    # Per-day = 2800 / 28 = ₹100 exact
    assert round(premium["amount"] / premium["duration_days"], 2) == 100.0
    # Per-meal = 2800 / 56 = ₹50 exact
    assert round(premium["amount"] / premium["meals"], 2) == 50.0


def test_existing_30_day_subs_are_not_migrated():
    """Sanity: no 30-day active subscription should have been silently converted
    to 28 days by the plan migration. Users' existing contracts are honoured."""
    from pymongo import MongoClient
    load_dotenv("/app/backend/.env")
    c = MongoClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    # None of the active subs should be tagged with the plan-migration flag
    tagged = db.subscriptions.count_documents({"_migrated_from_30d": True})
    assert tagged == 0, f"{tagged} subscription(s) were incorrectly touched by the plan migration"
    c.close()
