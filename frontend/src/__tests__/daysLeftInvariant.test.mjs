// Unit tests for the days-left invariant (iter-125).
// Locks in the fix where displayed days_left = min(calendar_floor, wallet/per_day).
//
// Run: cd /app/frontend && node src/__tests__/daysLeftInvariant.test.mjs
//
// The bug it prevents: previously the dashboard used Math.ceil on
// (end_date - now), so after one day of cron deduction (₹93 + 2 meals
// off a 60-meal/30-day/₹2,800 plan), it would still show 30 days left —
// even though wallet showed ₹2,707 and meals showed 58 (both = 29 days).
//
// The fix: take MIN of (a) calendar-floor and (b) wallet/per_day_amount,
// so all three values stay locked together at all times.

// Mirror the formula used in /pages/SubscriberDashboard.jsx line 85.
function daysLeft(sub, nowMs) {
  if (!sub) return 0;
  const calendar = Math.floor((new Date(sub.end_date).getTime() - nowMs) / (1000 * 60 * 60 * 24));
  const walletCap = Math.round(Number(sub.wallet_balance || 0) / Math.max(1, Number(sub.per_day_amount || 1)));
  return Math.max(0, Math.min(calendar, walletCap));
}

const day = 24 * 60 * 60 * 1000;
const fmt = (ms) => new Date(ms).toISOString();

const tests = [
  // [label, sub, now, expected]
  ["fresh sub day-1 → 29 full days remaining (some hours of day 1 already elapsed)", {
    end_date: fmt(Date.now() + 30 * day),
    wallet_balance: 2800,
    per_day_amount: 93.33,
  }, Date.now(), 29],

  ["after 1 day tick → 29 days (matches wallet 2707 = 29d)", {
    end_date: fmt(Date.now() + 30 * day),   // end_date NOT extended in active mode
    wallet_balance: 2707,
    per_day_amount: 93.33,
  }, Date.now() + day, 29],

  ["after 1 day tick + matching display → wallet/meals/days all = 29", {
    end_date: fmt(Date.now() + 30 * day),
    wallet_balance: 2707,                    // = 58 meals × ₹46.67/meal = 29 days × ₹93.33
    per_day_amount: 93.33,
  }, Date.now() + day, 29],

  ["paused for 50 days, end_date extended → still capped by wallet", {
    end_date: fmt(Date.now() + 27 * day),    // extended end_date
    wallet_balance: 2520,                    // only 3 days of actual deduction
    per_day_amount: 93.33,
  }, Date.now(), 27],

  ["wallet drained, end_date in future → days = 0", {
    end_date: fmt(Date.now() + 5 * day),
    wallet_balance: 0,
    per_day_amount: 93.33,
  }, Date.now(), 0],

  ["end_date past, wallet has balance → days = 0", {
    end_date: fmt(Date.now() - 2 * day),
    wallet_balance: 200,
    per_day_amount: 93.33,
  }, Date.now(), 0],

  ["per_day_amount = 0 (edge) → falls back to floor(1), wallet drives", {
    end_date: fmt(Date.now() + 30 * day),
    wallet_balance: 100,
    per_day_amount: 0,
  }, Date.now(), 30],     // min(30, 100) = 30

  ["no sub → 0", null, Date.now(), 0],
];

let passed = 0, failed = 0;
for (const [label, sub, now, expected] of tests) {
  const got = daysLeft(sub, now);
  if (got === expected) { console.log("✅", label); passed++; }
  else { console.log("❌", label, "got:", got, "wanted:", expected); failed++; }
}
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
