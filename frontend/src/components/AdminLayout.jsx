import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Package, ScanLine, QrCode, Utensils, Users, Palette, Home, Shield, FileText, MapPin, FootprintsIcon, LogIn, Megaphone } from "lucide-react";

const SECTIONS = [
  {
    title: "Overview",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/admin/plans", label: "Plans", icon: Package },
      { to: "/admin/users", label: "Users & Roles", icon: Users },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/admin/scanner", label: "QR Scanner", icon: ScanLine },
      { to: "/admin/counter", label: "Counter QR", icon: QrCode },
      { to: "/admin/menu", label: "Daily Menu", icon: Utensils },
    ],
  },
  {
    title: "Content & design",
    items: [
      { to: "/admin/landing", label: "Home page", icon: Home },
      { to: "/admin/content/announcement", label: "Announcement bar", icon: Megaphone },
      { to: "/admin/content/login", label: "Login page", icon: LogIn },
      { to: "/admin/content/privacy", label: "Privacy Policy", icon: Shield },
      { to: "/admin/content/refund", label: "Refund Policy", icon: FileText },
      { to: "/admin/content/contact", label: "Contact Us", icon: MapPin },
      { to: "/admin/content/footer", label: "Footer", icon: FootprintsIcon },
      { to: "/admin/theme", label: "Design tokens", icon: Palette },
    ],
  },
];

export default function AdminLayout() {
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 lg:px-12 py-8" data-testid="admin-layout">
      <div className="grid lg:grid-cols-[260px_1fr] gap-6 lg:gap-10">
        <aside className="lg:sticky lg:top-24 lg:self-start" data-testid="admin-sidebar">
          <nav className="flex flex-col gap-5">
            {SECTIONS.map((sec) => (
              <div key={sec.title}>
                <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground px-3 mb-2">{sec.title}</p>
                <div className="flex flex-col gap-1">
                  {sec.items.map((it) => (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      end={it.end}
                      data-testid={`admin-nav-${it.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                          isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
                        }`
                      }
                    >
                      <it.icon className="h-4 w-4" strokeWidth={1.75} />
                      <span className="truncate">{it.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
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
