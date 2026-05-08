import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Home, ChefHat, LayoutDashboard, User as UserIcon, Phone, LogIn, Receipt } from "lucide-react";

/**
 * Bottom nav — 4-tab, equally spaced.
 * Hidden for staff / admin / delivery_boy / rider (they get the admin sidebar
 * / rider dashboard instead).
 *
 * Logged-in subscriber: Home (Restaurant) · Dashboard · Account
 * Logged-out: Home (Restaurant) · Tiffin Plans · Contact · Login
 */
export default function BottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  if (user && (user.role === "admin" || user.role === "staff" || user.role === "delivery_boy" || user.role === "rider")) return null;

  const items = user
    ? [
        { to: "/restaurant",         label: "Restaurant", icon: ChefHat },
        { to: "/restaurant/orders",  label: "Orders",     icon: Receipt },
        { to: "/dashboard",          label: "Dashboard",  icon: LayoutDashboard },
        { to: "/profile",            label: "Account",    icon: UserIcon },
      ]
    : [
        { to: "/restaurant", label: "Restaurant", icon: ChefHat },
        { to: "/home",       label: "Tiffin",     icon: Home },
        { to: "/contact",    label: "Contact",    icon: Phone },
        { to: "/login",      label: "Login",      icon: LogIn },
      ];

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-background border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.04)]"
      data-testid="bottom-nav"
    >
      <ul className="flex items-stretch justify-around">
        {items.map((it) => {
          const isActive = location.pathname === it.to;
          return (
            <li key={it.to} className="flex-1 flex">
              <Link
                to={it.to}
                data-testid={`bottom-nav-${it.label.toLowerCase()}`}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors ${isActive ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
              >
                <it.icon className="h-5 w-5" strokeWidth={1.75} />
                <span className="text-[10px] tracking-overline uppercase font-bold">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
