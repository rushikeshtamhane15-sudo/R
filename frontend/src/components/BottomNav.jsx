import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Home, ChefHat, LayoutDashboard, Bike, User as UserIcon, Phone, LogIn, LogOut, Receipt } from "lucide-react";

/**
 * Bottom nav — 4 tabs.
 * Hidden for staff / admin / delivery_boy (they get the admin sidebar).
 *
 * Roles:
 *  • subscriber: Restaurant · Orders · Dashboard · Tiffin
 *  • rider:      Dashboard · Contact · Logout · Account
 *  • guest:      Restaurant · Tiffin · Contact · Login
 *
 * Always visible on mobile (md:hidden) — desktop has Header / sidebar nav.
 * For riders, also shown on desktop (md:visible) since Header is hidden.
 */
export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const isRider = user?.role === "rider";
  if (user && (user.role === "admin" || user.role === "staff" || user.role === "delivery_boy")) return null;

  const nextParam = `?next=${encodeURIComponent(location.pathname + (location.search || ""))}`;

  const handleLogout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
    toast.success("Logged out");
    navigate("/login", { replace: true });
  };

  let items;
  if (isRider) {
    items = [
      { to: "/rider",          label: "Dashboard", icon: Bike },
      { to: "/contact",        label: "Contact",   icon: Phone },
      { onClick: handleLogout, label: "Logout",    icon: LogOut, testId: "logout" },
      { to: "/rider/account",  label: "Account",   icon: UserIcon },
    ];
  } else if (user) {
    items = [
      { to: "/restaurant",         label: "Restaurant", icon: ChefHat },
      { to: "/restaurant/orders",  label: "Orders",     icon: Receipt },
      { to: "/dashboard",          label: "Dashboard",  icon: LayoutDashboard },
      { to: "/home",               label: "Tiffin",     icon: Home },
    ];
  } else {
    items = [
      { to: "/restaurant",       label: "Restaurant", icon: ChefHat },
      { to: "/home",             label: "Tiffin",     icon: Home },
      { to: "/contact",          label: "Contact",    icon: Phone },
      { to: `/login${nextParam}`, label: "Login",     icon: LogIn, exactTo: "/login" },
    ];
  }

  return (
    <nav
      className={`${isRider ? "md:flex md:max-w-2xl md:mx-auto md:rounded-t-2xl" : "md:hidden"} fixed bottom-0 inset-x-0 z-30 bg-background border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.04)]`}
      data-testid="bottom-nav"
    >
      <ul className="flex items-stretch justify-around w-full">
        {items.map((it, idx) => {
          const isActive = it.to && location.pathname === (it.exactTo || it.to);
          const className = `flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors ${isActive ? "text-primary" : "text-muted-foreground hover:text-primary"}`;
          const tid = `bottom-nav-${it.testId || it.label.toLowerCase()}`;
          return (
            <li key={it.to || `btn-${idx}`} className="flex-1 flex">
              {it.onClick ? (
                <button type="button" onClick={it.onClick} data-testid={tid} className={className}>
                  <it.icon className="h-5 w-5" strokeWidth={1.75} />
                  <span className="text-[10px] tracking-overline uppercase font-bold">{it.label}</span>
                </button>
              ) : (
                <Link to={it.to} data-testid={tid} className={className}>
                  <it.icon className="h-5 w-5" strokeWidth={1.75} />
                  <span className="text-[10px] tracking-overline uppercase font-bold">{it.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
