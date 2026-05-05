import React from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, ScanLine, QrCode, Utensils, Users, Palette } from "lucide-react";

const ITEMS = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/plans", label: "Plans", icon: Package },
  { to: "/admin/scanner", label: "QR Scanner", icon: ScanLine },
  { to: "/admin/counter", label: "Counter QR", icon: QrCode },
  { to: "/admin/menu", label: "Daily Menu", icon: Utensils },
  { to: "/admin/users", label: "Users & Roles", icon: Users },
  { to: "/admin/theme", label: "Design", icon: Palette },
];

export default function AdminLayout() {
  const location = useLocation();
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 lg:px-12 py-8" data-testid="admin-layout">
      <div className="grid lg:grid-cols-[240px_1fr] gap-6 lg:gap-10">
        {/* Sidebar (also a horizontal scroller on mobile) */}
        <aside className="lg:sticky lg:top-24 lg:self-start" data-testid="admin-sidebar">
          <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-4 hidden lg:block">Admin</p>
          <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible -mx-4 lg:mx-0 px-4 lg:px-0 pb-2 lg:pb-0">
            {ITEMS.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                data-testid={`admin-nav-${it.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className={({ isActive }) =>
                  `shrink-0 lg:shrink flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                    isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
                  }`
                }
              >
                <it.icon className="h-4 w-4" strokeWidth={1.75} />
                {it.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
