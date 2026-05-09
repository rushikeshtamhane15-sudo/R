import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  Home, ChefHat, LayoutDashboard, Bike, User, Phone, LogIn, LogOut, Receipt,
  ShoppingBag, Wallet, Heart, Settings, Bell, MapPin, Clock, Star, ScanLine,
} from "lucide-react";

// Icons admin can pick from (mapped from lucide-react names sent by backend).
const ICON_MAP = {
  Home, ChefHat, LayoutDashboard, Bike, User, Phone, LogIn, LogOut, Receipt,
  ShoppingBag, Wallet, Heart, Settings, Bell, MapPin, Clock, Star, ScanLine,
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

  // Pull CMS config once. Errors silently fall back to defaults below.
  useEffect(() => {
    api.get("/bottom-nav").then((r) => setConfig(r.data)).catch(() => {});
  }, []);

  if (user && (user.role === "admin" || user.role === "staff" || user.role === "delivery_boy")) return null;

  const isRider = user?.role === "rider";
  const role = isRider ? "rider" : (user ? "subscriber" : "guest");

  const handleLogout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
    toast.success("Logged out");
    navigate("/login", { replace: true });
  };

  const nextParam = `?next=${encodeURIComponent(location.pathname + (location.search || ""))}`;

  // Resolve the live items list (CMS or fallback)
  const items = (config?.[role] || []).filter((it) => it.visible !== false);
  if (items.length === 0) return null;

  return (
    <nav
      className={`${isRider ? "md:flex md:max-w-2xl md:mx-auto md:rounded-t-2xl" : "md:hidden"} fixed bottom-0 inset-x-0 z-30 bg-background border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.04)]`}
      data-testid="bottom-nav"
    >
      <ul className="flex w-full">
        {items.map((it) => {
          const Icon = ICON_MAP[it.icon] || ChefHat;
          // Special routes
          let href = it.to;
          let onClick = null;
          if (it.to === "__logout__") { onClick = handleLogout; href = null; }
          else if (it.to === "__login__") { href = `/login${nextParam}`; }
          const isActive = href && location.pathname === href.split("?")[0];
          const className = `flex flex-col items-center justify-center gap-1 py-2.5 px-1 w-full transition-colors min-w-0 ${isActive ? "text-primary" : "text-muted-foreground hover:text-primary"}`;
          const tid = `bottom-nav-${it.id}`;
          const inner = (
            <>
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
