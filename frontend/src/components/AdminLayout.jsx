import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { api } from "../lib/api";
import { LayoutDashboard, Package, Truck, ScanLine, QrCode, Utensils, Users, Palette, Home, Shield, FileText, MapPin, FootprintsIcon, LogIn, Megaphone, Radio, Layout, Wheat, ClipboardList, Menu, MessageSquareQuote, UtensilsCrossed, MessageCircle, ChefHat, Bike, AlertTriangle, X, Clock, Wallet, UserPlus } from "lucide-react";

// `roles`: which roles can see the item. Default: admin only.
// iter-78 #2: helper that grants franchise_owner read-only access to the
// listed sections. Used in Overview + Operations sections so franchise
// owners see "their admin panel" without editing platform-wide content.
const FRANCHISE_VIEW = ["admin", "staff", "franchise_owner"];

const SECTIONS = [
  {
    title: "Overview",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true, roles: FRANCHISE_VIEW },
      { to: "/admin/control-tower", label: "Control Tower", icon: Radio, roles: FRANCHISE_VIEW },
      { to: "/admin/plans", label: "Plans", icon: Package, roles: ["admin"] },
      { to: "/admin/users", label: "Users & Roles", icon: Users, roles: FRANCHISE_VIEW },
      { to: "/admin/rider-applications", label: "Rider applications", icon: Bike, roles: ["admin"] },
      { to: "/admin/restaurant-tracking", label: "Restaurant tracking", icon: Truck, roles: FRANCHISE_VIEW },
      { to: "/admin/restaurant-takeaway", label: "Take-away tiffins", icon: Package, roles: FRANCHISE_VIEW },
      { to: "/admin/restaurant-theme", label: "Restaurant page editor", icon: Palette, roles: ["admin"] },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/admin/deliveries-today", label: "Today's deliveries", icon: ClipboardList, roles: FRANCHISE_VIEW },
      { to: "/admin/raw-materials", label: "Raw materials", icon: Wheat, roles: FRANCHISE_VIEW },
      { to: "/admin/tiffin-stock", label: "Tiffin stock", icon: Package, roles: FRANCHISE_VIEW },
      { to: "/admin/cash-collections", label: "Cash collections", icon: ClipboardList, roles: FRANCHISE_VIEW },
      { to: "/admin/cash-analytics", label: "Cash analytics", icon: ClipboardList, roles: FRANCHISE_VIEW },
      { to: "/admin/partial-payments", label: "Partial payments", icon: ClipboardList, roles: FRANCHISE_VIEW },
      { to: "/admin/kitchen-settings", label: "Kitchen & radius", icon: MapPin, roles: ["admin"] },
      { to: "/admin/pnl", label: "Profit & loss", icon: ClipboardList, roles: FRANCHISE_VIEW },
      { to: "/admin/restaurant", label: "Restaurant menu", icon: ChefHat, roles: ["admin"] },
      { to: "/admin/restaurant-orders", label: "Restaurant orders", icon: ChefHat, roles: FRANCHISE_VIEW },
      { to: "/admin/restaurant-hours", label: "Restaurant hours / capacity", icon: Clock, roles: FRANCHISE_VIEW },
      { to: "/admin/wallet-topup", label: "Manual wallet top-up", icon: Wallet, roles: ["admin"] },
      { to: "/admin/whatsapp", label: "WhatsApp outbox", icon: MessageCircle, roles: ["admin"] },
      { to: "/admin/delivery", label: "Tiffin delivery", icon: Truck, roles: FRANCHISE_VIEW },
      { to: "/admin/live", label: "Live tracking", icon: Radio, roles: FRANCHISE_VIEW },
      { to: "/admin/scanner", label: "QR Scanner", icon: ScanLine, roles: FRANCHISE_VIEW },
      { to: "/admin/kiosk", label: "Wall Kiosk", icon: ScanLine, roles: FRANCHISE_VIEW },
      { to: "/admin/counter", label: "Counter QR", icon: QrCode, roles: FRANCHISE_VIEW },
      { to: "/admin/menu", label: "Daily Menu", icon: Utensils, roles: FRANCHISE_VIEW },
      { to: "/admin/mess-menu", label: "Mess Menu Calendar", icon: ClipboardList, roles: FRANCHISE_VIEW },
    ],
  },
  {
    title: "Content & design",
    items: [
      { to: "/admin/landing", label: "Home page", icon: Home, roles: ["admin"] },
      { to: "/admin/dashboard-editor", label: "Subscriber dashboard", icon: Layout, roles: ["admin"] },
      { to: "/admin/bottom-nav", label: "Bottom nav & sound", icon: Megaphone, roles: ["admin"] },
      { to: "/admin/header-menu", label: "Hamburger menu", icon: Menu, roles: ["admin"] },
      { to: "/admin/testimonials", label: "Testimonials", icon: MessageSquareQuote, roles: ["admin"] },
      { to: "/admin/tiffin-preferences", label: "Tiffin food preferences", icon: UtensilsCrossed, roles: ["admin"] },
      { to: "/admin/content/announcement", label: "Announcement bar", icon: Megaphone, roles: ["admin"] },
      { to: "/admin/content/login", label: "Login page", icon: LogIn, roles: ["admin"] },
      { to: "/admin/content/about", label: "About us page", icon: ChefHat, roles: ["admin"] },
      { to: "/admin/content/privacy", label: "Privacy Policy", icon: Shield, roles: ["admin"] },
      { to: "/admin/content/refund", label: "Refund Policy", icon: FileText, roles: ["admin"] },
      { to: "/admin/content/contact", label: "Contact Us", icon: MapPin, roles: ["admin"] },
      { to: "/admin/content/footer", label: "Footer", icon: FootprintsIcon, roles: ["admin"] },
      { to: "/admin/messes", label: "Messes & franchise", icon: UtensilsCrossed, roles: ["admin"] },
      { to: "/admin/franchise-onboarding", label: "Franchise onboarding", icon: UserPlus, roles: ["admin"] },
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
  const navigate = useNavigate();
  const role = user?.role || "subscriber";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingDeposit, setPendingDeposit] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // iter-90: per-mess page-access whitelist for franchise owners.
  // null = not loaded yet · array = allowed page keys (e.g. /admin/users).
  const [franchisePages, setFranchisePages] = useState(null);

  // Auto-close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // iter-90: franchise owners load their per-mess page whitelist so the
  // sidebar only shows what HQ admin has granted them.
  useEffect(() => {
    if (role !== "franchise_owner") return;
    let mounted = true;
    const fetchPages = async () => {
      try {
        const r = await api.get("/franchise/me/visible-pages");
        if (mounted) setFranchisePages(r.data?.visible_pages || []);
      } catch (_e) { if (mounted) setFranchisePages([]); }
    };
    fetchPages();
    return () => { mounted = false; };
  }, [role]);

  // iter-88 #1: franchise owners MUST complete their profile (name + phone +
  // address) before they can access the console. If any are missing, bounce
  // them to /profile with a `?next=/admin/control-tower` return param and a
  // toast prompting completion.
  const profileIncomplete = role === "franchise_owner" && user && (
    !String(user.name || "").trim() ||
    !String(user.phone || "").trim() ||
    !String(user.address || "").trim()
  );
  useEffect(() => {
    if (profileIncomplete && !location.pathname.startsWith("/profile")) {
      navigate(`/profile?next=${encodeURIComponent(location.pathname)}&reason=franchise-onboard`, { replace: true });
    }
  }, [profileIncomplete, location.pathname, navigate]);

  // Poll the pending-bank-deposit notification every 60s for admin/staff
  useEffect(() => {
    if (role !== "admin" && role !== "staff") return;
    let mounted = true;
    const fetchNotice = async () => {
      try {
        const r = await api.get("/admin/notifications/bank-deposit");
        if (mounted) setPendingDeposit(r.data || null);
      } catch (_e) { /* ignore — endpoint may 403 for non-admin */ }
    };
    fetchNotice();
    const id = setInterval(fetchNotice, 60_000);
    return () => { mounted = false; clearInterval(id); };
  }, [role, location.pathname]);

  const dismissBanner = async () => {
    setBannerDismissed(true);
    if (role === "admin") {
      try { await api.post("/admin/notifications/mark-read"); } catch (_e) { /* ignore */ }
    }
  };

  const showBanner = !bannerDismissed && pendingDeposit && pendingDeposit.show && role !== "subscriber";

  // Filter sections per role; hide a section when it ends up with zero visible items.
  // iter-90: when role is franchise_owner, ALSO filter by the per-mess
  // page whitelist (admin-controlled). While the whitelist is still loading
  // (franchisePages === null) we render role-allowed items so the sidebar
  // doesn't flash empty — we narrow once the fetch resolves.
  const filteredSections = SECTIONS
    .map((sec) => ({
      ...sec,
      items: sec.items.filter((it) => {
        if (!(it.roles || ["admin"]).includes(role)) return false;
        if (role === "franchise_owner" && Array.isArray(franchisePages)) {
          return franchisePages.includes(it.to);
        }
        return true;
      }),
    }))
    .filter((sec) => sec.items.length > 0);

  // Find current page label for the mobile header
  const current = filteredSections.flatMap((s) => s.items).find((it) => location.pathname === it.to || (location.pathname.startsWith(it.to) && it.to !== "/admin"));
  // iter-85: helper to label the workspace by role — franchise owners see
  // "Franchise Console", staff see "Staff workspace", admins see "Admin".
  const workspaceLabel = role === "franchise_owner" ? "Franchise Console" : role === "staff" ? "Staff workspace" : "Admin";
  const workspaceShort = role === "franchise_owner" ? "Franchise" : role === "staff" ? "Staff" : "Admin";
  const currentLabel = current?.label || workspaceLabel;

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-8 lg:px-12 py-3 md:py-8" data-testid="admin-layout">
      {showBanner && (
        <button
          type="button"
          onClick={() => navigate("/admin/cash-analytics")}
          className="w-full flex items-start gap-3 mb-4 px-4 py-3 rounded-2xl border border-red-300 bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-[0_8px_22px_-8px_rgba(220,38,38,0.55)] hover:shadow-[0_12px_28px_-10px_rgba(220,38,38,0.65)] transition-all text-left animate-pulse"
          data-testid="pending-deposit-banner"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[10px] tracking-[0.2em] uppercase font-extrabold opacity-90">Action required</span>
            <span className="block text-sm sm:text-base font-bold leading-snug" data-testid="pending-deposit-message">
              ₹{Math.round(pendingDeposit.pending).toLocaleString("en-IN")} cash collected but not yet deposited to bank ({pendingDeposit.count} orders). Tap to reconcile.
            </span>
          </span>
          {role === "admin" && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); dismissBanner(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); dismissBanner(); } }}
              className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 transition-colors cursor-pointer"
              aria-label="Dismiss"
              data-testid="pending-deposit-dismiss"
            >
              <X className="h-4 w-4" />
            </span>
          )}
        </button>
      )}
      {role === "staff" && (
        <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3 hidden lg:inline-flex items-center gap-1.5" data-testid="staff-mode-tag">
          <Shield className="h-3.5 w-3.5" /> Staff workspace
        </p>
      )}
      {role === "franchise_owner" && (
        <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3 hidden lg:inline-flex items-center gap-1.5" data-testid="franchise-mode-tag">
          <Shield className="h-3.5 w-3.5" /> Franchise Console · independent branch
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
                <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">{workspaceLabel}</p>
                <p className="font-display font-extrabold text-lg leading-tight mt-1 truncate">{user?.name || user?.email}</p>
              </div>
              <div className="px-3 py-4">
                <NavList filteredSections={filteredSections} onItemClick={() => setDrawerOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-overline uppercase font-bold text-secondary truncate">{workspaceShort}</p>
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
