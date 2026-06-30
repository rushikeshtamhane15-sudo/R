// Unit tests for /pages/login/resolveLoginNext.js — extracted in iter-123.
// Run with: cd /app/frontend && node src/pages/login/resolveLoginNext.test.mjs
//
// Covers all post-login routing decisions: ?next param, role-based overrides,
// session pending-action restoration, cart-aware upgrades, and the
// self-referential-path loop blockers.

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { resolveLoginNext } = await import("./resolveLoginNext.js");

const tests = [
  // [label, user, nextParam, expected]
  ["anon · no next → /dashboard",                       null,                        null,           "/dashboard"],
  ["anon · ?next=/x → /x",                              null,                        "/x",           "/x"],
  ["anon · ?next=/ → fallback (self-ref blocked)",      null,                        "/",            "/dashboard"],
  ["anon · ?next=/login → fallback (loop blocked)",     null,                        "/login?abc",   "/dashboard"],
  ["subscriber · no next → /restaurant",                { role: "subscriber" },      null,           "/restaurant"],
  ["admin · no next → /admin",                          { role: "admin" },           null,           "/admin"],
  ["admin · ?next=/restaurant → /admin (override)",     { role: "admin" },           "/restaurant",  "/admin"],
  ["admin · ?next=/admin/users → /admin/users",         { role: "admin" },           "/admin/users", "/admin/users"],
  ["staff · no next → /admin/deliveries-today",         { role: "staff" },           null,           "/admin/deliveries-today"],
  ["rider · no next → /rider",                          { role: "rider" },           null,           "/rider"],
  ["rider · ?next=/dashboard → /rider (override)",      { role: "rider" },           "/dashboard",   "/rider"],
  ["franchise_owner → /admin",                          { role: "franchise_owner" }, null,           "/admin"],
  ["delivery_boy → /boy",                               { role: "delivery_boy" },    null,           "/boy"],
];

let passed = 0, failed = 0;
for (const [label, user, np, expected] of tests) {
  const got = resolveLoginNext(user, np);
  if (got === expected) { console.log("✅", label); passed++; }
  else { console.log("❌", label, "got:", got, "wanted:", expected); failed++; }
}
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
