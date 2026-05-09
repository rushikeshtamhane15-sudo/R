import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { LayoutDashboard, Package, Truck, ScanLine, QrCode, Utensils, Users, Palette, Home, Shield, FileText, MapPin, FootprintsIcon, LogIn, Megaphone, Radio, Layout, Wheat, ClipboardList, Menu, MessageSquareQuote, UtensilsCrossed, MessageCircle, ChefHat, Bike } from "lucide-react";

// `roles`: which roles can see the item. Default: admin only.
const SECTIONS = [
  {
    title: "Overview",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true, roles: ["admin"] },
      { to: "/admin/plans", label: "Plans", icon: Package, roles: ["admin"] },
      { to: "/admin/users", label: "Users & Roles", icon: Users, roles: ["admin"] },
      { to: "/admin/rider-applications", label: "Rider applications", icon: Bike, roles: ["admin"] },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/admin/deliveries-today", label: "Today's deliveries", icon: ClipboardList, roles: ["admin", "staff"] },
      { to: "/admin/raw-materials", label: "Raw materials", icon: Wheat, roles: ["admin", "staff"] },
      { to: "/admin/restaurant", label: "Restaurant menu", icon: ChefHat, roles: ["admin"] },
      { to: "/admin/restaurant-orders", label: "Restaurant orders", icon: ChefHat, roles: ["admin", "staff"] },
      { to: "/admin/whatsapp", label: "WhatsApp outbox", icon: MessageCircle, roles: ["admin"] },
      { to: "/admin/delivery", label: "Tiffin delivery", icon: Truck, roles: ["admin"] },
      { to: "/admin/live", label: "Live tracking", icon: Radio, roles: ["admin"] },
      { to: "/admin/scanner", label: "QR Scanner", icon: ScanLine, roles: ["admin", "staff"] },
      { to: "/admin/counter", label: "Counter QR", icon: QrCode, roles: ["admin", "staff"] },
      { to: "/admin/menu", label: "Daily Menu", icon: Utensils, roles: ["admin"] },
    ],
  },
  {
    title: "Content & design",
    items: [
      { to: "/admin/landing", label: "Home page", icon: Home, roles: ["admin"] },
      { to: "/admin/dashboard-editor", label: "Subscriber dashboard", icon: Layout, roles: ["admin"] },
      { to: "/admin/testimonials", label: "Testimonials", icon: MessageSquareQuote, roles: ["admin"] },
      { to: "/admin/content/announcement", label: "Announcement bar", icon: Megaphone, roles: ["admin"] },
      { to: "/admin/content/login", label: "Login page", icon: LogIn, roles: ["admin"] },
      { to: "/admin/content/privacy", label: "Privacy Policy", icon: Shield, roles: ["admin"] },
      { to: "/admin/content/refund", label: "Refund Policy", icon: FileText, roles: ["admin"] },
      { to: "/admin/content/contact", label: "Contact Us", icon: MapPin, roles: ["admin"] },
      { to: "/admin/content/footer", label: "Footer", icon: FootprintsIcon, roles: ["admin"] },
      { to: "/admin/theme", label: "Design tokens", icon: Palette, roles: ["admin"] },
    ],
  },
];

function NavList({ filteredSections, onItemClick }) {
  return (
    <nav className="flex flex-col gap-5">
      {filteredSections.map((sec) => (
        <div key={sec.title}>
          <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground px-3 mb-2">{sec.title}</p>
          <div className="flex flex-col gap-1">
            {sec.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                onClick={onItemClick}
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
  );
}

export default function AdminLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const role = user?.role || "subscriber";
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Auto-close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Filter sections per role; hide a section when it ends up with zero visible items.
  const filteredSections = SECTIONS
    .map((sec) => ({ ...sec, items: sec.items.filter((it) => (it.roles || ["admin"]).includes(role)) }))
    .filter((sec) => sec.items.length > 0);

  // Find current page label for the mobile header
  const current = filteredSections.flatMap((s) => s.items).find((it) => location.pathname === it.to || (location.pathname.startsWith(it.to) && it.to !== "/admin"));
  const currentLabel = current?.label || (role === "staff" ? "Staff workspace" : "Admin");

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 lg:px-12 py-4 md:py-8" data-testid="admin-layout">
      {role === "staff" && (
        <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3 hidden lg:inline-flex items-center gap-1.5" data-testid="staff-mode-tag">
          <Shield className="h-3.5 w-3.5" /> Staff workspace
        </p>
      )}

      {/* Mobile / tablet header bar — sticky for fast nav switching */}
      <div className="lg:hidden sticky top-0 z-30 -mx-3 sm:-mx-4 mb-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border" data-testid="admin-mobile-header">
        <div className="flex items-center gap-3 px-3 sm:px-4 py-3">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <button className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground hover:bg-accent" data-testid="admin-menu-trigger" aria-label="Open admin menu">
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 overflow-y-auto" data-testid="admin-drawer">
              <div className="px-5 py-5 border-b border-border">
                <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">{role === "staff" ? "Staff workspace" : "Admin"}</p>
                <p className="font-display font-extrabold text-lg leading-tight mt-1 truncate">{user?.name || user?.email}</p>
              </div>
              <div className="px-3 py-4">
                <NavList filteredSections={filteredSections} onItemClick={() => setDrawerOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-overline uppercase font-bold text-secondary truncate">{role === "staff" ? "Staff" : "Admin"}</p>
            <p className="font-display font-extrabold text-base leading-tight truncate">{currentLabel}</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6 lg:gap-10">
        <aside className="hidden lg:block lg:sticky lg:top-24 lg:self-start" data-testid="admin-sidebar">
          <NavList filteredSections={filteredSections} />
        </aside>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
