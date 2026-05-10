import React, { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/**
 * Email / Google auth callback. Emergent Google flow redirects back to
 * /auth/callback#session_id=<id>. We exchange that for our session token
 * then redirect to the SAME destination logic the OTP flow uses:
 *   - `?next=/path` query param (or hash-state) — explicit deep-link
 *   - sessionStorage('efc_pending_action_v1') — cart/buy-now intent
 *   - admin/staff/rider → role home (overrides next if not admin-scoped)
 *   - subscriber with cart items → /restaurant/checkout
 *   - subscriber default → /restaurant
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = location.hash || window.location.hash;
    const match = hash.match(/session_id=([^&]+)/);
    if (!match) {
      navigate("/login", { replace: true });
      return;
    }
    const sessionId = decodeURIComponent(match[1]);

    (async () => {
      try {
        const res = await api.post("/auth/session", { session_id: sessionId });
        const user = res.data.user;
        setUser(user);
        navigate(computeDest(user), { replace: true, state: { user } });
      } catch (e) {
        navigate("/login", { replace: true });
      }
    })();
  }, [location.hash, navigate, setUser]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center" data-testid="auth-callback">
      <div className="text-center">
        <div className="inline-block h-10 w-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
        <p className="mt-4 text-muted-foreground">Signing you in…</p>
      </div>
    </div>
  );
}

// Mirror of Login.jsx::computeNext — same precedence so email-login post-flow
// lands in the same spot as OTP-login post-flow.
function computeDest(u) {
  let hasCartItems = false;
  try {
    const cartRaw = localStorage.getItem("efc_restaurant_cart_v1");
    if (cartRaw) {
      const cart = JSON.parse(cartRaw) || {};
      hasCartItems = Object.values(cart).some((l) => (Number(l?.qty) || 0) > 0);
    }
  } catch {}

  // The Emergent Google flow strips the query, but preserves the `redirect`
  // param from the initial login click. We honour `?next=` if it survived,
  // else fall back to the sessionStorage pending action set on Restaurant.jsx
  // and Header.jsx hamburger Login click.
  const url = new URL(window.location.href);
  const raw = url.searchParams.get("next");
  const role = u?.role;
  const isAdminScoped = (p) => p && (p.startsWith("/admin") || p.startsWith("/boy") || p.startsWith("/rider"));
  const validNext = raw && raw.startsWith("/") && !raw.startsWith("//") &&
    raw !== "/" && !raw.startsWith("/login");

  if (validNext && role === "admin" && !isAdminScoped(raw)) return "/admin";
  if (validNext && role === "staff" && !raw.startsWith("/admin")) return "/admin/deliveries-today";
  if (validNext && role === "rider" && !raw.startsWith("/rider")) return "/rider";
  if (validNext) {
    if ((raw === "/restaurant" || raw.startsWith("/restaurant?")) && hasCartItems) {
      return "/restaurant/checkout";
    }
    return raw;
  }

  try {
    const pending = sessionStorage.getItem("efc_pending_action_v1");
    if (pending && pending.startsWith("/") && !pending.startsWith("//") && pending !== "/" && !pending.startsWith("/login")) {
      sessionStorage.removeItem("efc_pending_action_v1");
      if (role === "admin" && !isAdminScoped(pending)) return "/admin";
      if (role === "staff" && !pending.startsWith("/admin")) return "/admin/deliveries-today";
      if (role === "rider" && !pending.startsWith("/rider")) return "/rider";
      if ((pending === "/restaurant" || pending.startsWith("/restaurant?")) && hasCartItems) {
        return "/restaurant/checkout";
      }
      return pending;
    }
  } catch {}

  if (!u) return "/dashboard";
  if (role === "admin") return "/admin";
  if (role === "staff") return "/admin/deliveries-today";
  if (role === "delivery_boy") return "/boy";
  if (role === "rider") return "/rider";
  if (hasCartItems) return "/restaurant/checkout";
  return "/restaurant";
}
