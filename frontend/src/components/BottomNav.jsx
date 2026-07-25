import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  Home, ChefHat, LayoutDashboard, Bike, User, Phone, LogIn, LogOut, Receipt,
  ShoppingBag, Wallet, Heart, Settings, Bell, MapPin, Clock, Star, ScanLine, Radio,
} from "lucide-react";

// Icons admin can pick from (mapped from lucide-react names sent by backend).
const ICON_MAP = {
  Home, ChefHat, LayoutDashboard, Bike, User, Phone, LogIn, LogOut, Receipt,
  ShoppingBag, Wallet, Heart, Settings, Bell, MapPin, Clock, Star, ScanLine, Radio,
};

/**
 * Bottom navigation — items, labels, icons, order all driven by GET /bottom-nav
 * (admin-editable in /admin/bottom-nav). Falls back gracefully on API failure.
 *
 * Hidden for staff / admin / delivery_boy (they get the admin sidebar).
 */
export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [config, setConfig] = useState(null);
  const [hasActiveSub, setHasActiveSub] = useState(false);

  // Pull CMS config once. Errors silently fall back to defaults below.
  useEffect(() => {
    api.get("/bottom-nav").then((r) => setConfig(r.data)).catch(() => {});
  }, []);

  // iter-131.26: check if the logged-in subscriber has an active subscription.
  // For users WITHOUT a valid plan, the "Dashboard" tab is swapped to "Orders"
  // (their more relevant destination), per user request.
  useEffect(() => {
    if (!user || user.role !== "subscriber") { setHasActiveSub(false); return; }
    api.get("/my/subscriptions").then((r) => {
      const subs = r.data?.subscriptions || [];
      setHasActiveSub(subs.some((s) => s.status === "active"));
    }).catch(() => setHasActiveSub(false));
  }, [user]);

  // iter-88 #1: franchise_owner gets their own bottom nav (Dashboard /
  // Account / Contact / Home / Logout). Other admins/staff/delivery still
  // hide the bottom nav (they use the AdminLayout sidebar).
  if (user && (user.role === "admin" || user.role === "staff" || user.role === "delivery_boy")) return null;

  const isFranchise = user?.role === "franchise_owner";
  const isRider = user?.role === "rider";
  const role = isFranchise ? "franchise" : isRider ? "rider" : (user ? "subscriber" : "guest");

  const handleLogout = async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    setUser(null);
    toast.success("Logged out");
    navigate("/login", { replace: true });
  };

  const nextParam = `?next=${encodeURIComponent(location.pathname + (location.search || ""))}`;

  // iter-88 #1: franchise nav fallback — uses the same item shape as the
  // CMS bottom-nav config so existing rendering code works unchanged.
  // iter-92 #1: "Home" now lands the franchise owner on the Partner Portal
  // (which IS their home, since they took over `/`).
  const FRANCHISE_FALLBACK = [
    { id: "fr-home",      label: "Home",      icon: "Home",            to: "/",                    visible: true },
    { id: "fr-dashboard", label: "Dashboard", icon: "LayoutDashboard", to: "/admin",               visible: true },
    { id: "fr-control",   label: "Control",   icon: "Radio",           to: "/admin/control-tower", visible: true },
    { id: "fr-account",   label: "Account",   icon: "User",            to: "/profile",             visible: true },
    { id: "fr-logout",    label: "Logout",    icon: "LogOut",          to: "__logout__",           visible: true },
  ];
  let items = (config?.[role] || []).filter((it) => it.visible !== false);
  if (isFranchise && items.length === 0) items = FRANCHISE_FALLBACK;
  if (items.length === 0) return null;

  // iter-131.26: subscribers WITHOUT an active plan see "Orders" in the slot
  // where valid subscribers see "Dashboard" — the CMS default keeps Dashboard
  // and this swap is done client-side so admin editability is preserved.
  if (role === "subscriber" && !hasActiveSub) {
    items = items.map((it) => {
      if (it.id === "dashboard") {
        return { ...it, id: "orders", label: "Orders", icon: "Receipt", to: "/restaurant/orders" };
      }
      return it;
    });
  }

  // Make the franchise bottom nav visible on every screen size (admin sidebar
  // is hidden on mobile so they'd otherwise have no nav).
  const visibilityCls = isFranchise || isRider
    ? "md:flex md:max-w-2xl md:mx-auto md:rounded-t-2xl"
    : "md:hidden";

  return (
    <nav
      className={`${visibilityCls} fixed bottom-0 inset-x-0 z-30 bg-background border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.04)]`}
      data-testid="bottom-nav"
    >
      <ul className="flex w-full items-end">
        {items.map((it, idx) => {
          const Icon = ICON_MAP[it.icon] || ChefHat;
          // Special routes
          let href = it.to;
          let onClick = null;
          if (it.to === "__logout__") { onClick = handleLogout; href = null; }
          else if (it.to === "__login__") { href = `/login${nextParam}`; }
          const isActive = href && location.pathname === href.split("?")[0];
          // iter-131.24: for a 5-item subscriber nav, the center item (index 2)
          // is rendered as a big elevated floating red circle so it stands out
          // as the primary CTA (Scan & eat) — matches the target mobile-app UI.
          const isFloating = role === "subscriber" && items.length === 5 && idx === 2;
          const tid = `bottom-nav-${it.id}`;

          if (isFloating) {
            const inner = (
              <>
                <span className="absolute -top-5 h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-[0_6px_16px_rgba(220,38,38,0.45),0_2px_4px_rgba(0,0,0,0.15)] ring-4 ring-background" aria-hidden>
                  <Icon className="h-6 w-6" strokeWidth={2.25} />
                </span>
                <span className={`text-[10px] font-bold leading-tight mt-9 ${isActive ? "text-primary" : "text-muted-foreground"}`}>{it.label}</span>
              </>
            );
            return (
              <li key={it.id} className="flex-1 min-w-0">
                {onClick ? (
                  <button type="button" onClick={onClick} data-testid={tid} className="relative flex flex-col items-center justify-end py-2 pt-3 w-full">{inner}</button>
                ) : (
                  <Link to={href} data-testid={tid} className="relative flex flex-col items-center justify-end py-2 pt-3 w-full">{inner}</Link>
                )}
              </li>
            );
          }

          const className = `relative flex flex-col items-center justify-center gap-1 py-2.5 px-1 w-full transition-colors min-w-0 ${isActive ? "text-primary" : "text-muted-foreground hover:text-primary"}`;
          const inner = (
            <>
              {/* iter-131.21: subtle red dot indicator above the active tab
                  so users know which page they are on at a glance. */}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute top-1 h-1 w-1 rounded-full bg-primary"
                  data-testid={`bottom-nav-active-dot-${it.id}`}
                />
              )}
              <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={1.75} />
              <span className="text-[10px] font-bold leading-tight truncate max-w-full block text-center">{it.label}</span>
            </>
          );
          return (
            <li key={it.id} className="flex-1 min-w-0">
              {onClick ? (
                <button type="button" onClick={onClick} data-testid={tid} className={className}>{inner}</button>
              ) : (
                <Link to={href} data-testid={tid} className={className}>{inner}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
