/**
 * resolveLoginNext — decide where to send a user after a successful OTP /
 * Google sign-in. Extracted from Login.jsx (iter-123) so this critical
 * post-login routing logic can be unit-tested in isolation.
 *
 * Precedence (highest first):
 *   1. `?next=/path` query param (validated; self-referential paths skipped)
 *   2. `sessionStorage["efc_pending_action_v1"]` set by Restaurant.jsx etc.
 *   3. Cart-aware default — if there are items in the cart, → /restaurant/checkout
 *   4. Role-based home (admin → /admin, rider → /rider, etc.)
 *   5. Fallback → /restaurant for subscribers, /dashboard for anon (rare)
 *
 * Role-based override applies to (1) and (2): admin/staff/rider/franchise
 * are always sent to their console unless the `next` is already inside it.
 *
 * @param {Object|null} user           — User object (with .role) from AuthContext
 * @param {string|null} nextParam      — Raw `?next=` URL param value
 * @returns {string}                   — Absolute path to navigate to
 */
export function resolveLoginNext(user, nextParam) {
  // Detect "cart has items" once and reuse for the entire decision.
  let hasCartItems = false;
  try {
    const cartRaw = localStorage.getItem("efc_restaurant_cart_v1");
    if (cartRaw) {
      const cart = JSON.parse(cartRaw) || {};
      hasCartItems = Object.values(cart).some((l) => (Number(l?.qty) || 0) > 0);
    }
  } catch (e) {
    // Cart is non-critical for routing — log and proceed without it.
    console.warn("[resolveLoginNext] cart parse failed", e);
  }

  const raw = nextParam;
  // Skip self-referential nexts ("/" and "/login*") — they would loop.
  const validNext = raw && raw.startsWith("/") && !raw.startsWith("//") &&
    raw !== "/" && !raw.startsWith("/login");

  const role = user?.role;
  const isAdminScoped = (p) => p && (p.startsWith("/admin") || p.startsWith("/boy") || p.startsWith("/rider"));

  // Role-based overrides on ?next=
  if (validNext && role === "admin" && !isAdminScoped(raw)) return "/admin";
  if (validNext && role === "franchise_owner" && !isAdminScoped(raw)) return "/admin";
  if (validNext && role === "staff" && !raw.startsWith("/admin")) return "/admin/deliveries-today";
  if (validNext && role === "rider" && !raw.startsWith("/rider")) return "/rider";

  if (validNext) {
    // Upgrade: user was on /restaurant (just menu) but has items in cart —
    // they almost certainly want to finish ordering, not browse again.
    if ((raw === "/restaurant" || raw.startsWith("/restaurant?")) && hasCartItems) {
      return "/restaurant/checkout";
    }
    return raw;
  }

  // Fallback: session-stashed pending action
  try {
    const pending = sessionStorage.getItem("efc_pending_action_v1");
    if (pending && pending.startsWith("/") && !pending.startsWith("//") && pending !== "/" && !pending.startsWith("/login")) {
      sessionStorage.removeItem("efc_pending_action_v1");
      if (role === "admin" && !isAdminScoped(pending)) return "/admin";
      if (role === "franchise_owner" && !isAdminScoped(pending)) return "/admin";
      if (role === "staff" && !pending.startsWith("/admin")) return "/admin/deliveries-today";
      if (role === "rider" && !pending.startsWith("/rider")) return "/rider";
      if ((pending === "/restaurant" || pending.startsWith("/restaurant?")) && hasCartItems) {
        return "/restaurant/checkout";
      }
      return pending;
    }
  } catch (e) {
    console.warn("[resolveLoginNext] pending-action parse failed", e);
  }

  if (!user) return "/dashboard";
  if (user.role === "admin") return "/admin";
  if (user.role === "franchise_owner") return "/admin";
  if (user.role === "staff") return "/admin/deliveries-today";
  if (user.role === "delivery_boy") return "/boy";
  if (user.role === "rider") return "/rider";
  // Cart-aware fallback for regular subscribers
  if (hasCartItems) return "/restaurant/checkout";
  return "/restaurant";
}
