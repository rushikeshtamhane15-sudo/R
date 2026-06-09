import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import WalletPill from "./WalletPill";
import MessSwitcher from "./MessSwitcher";
import { BRAND_LOGO_URL } from "../lib/brand";
import { api } from "../lib/api";
import { LogOut, Menu, X, Wallet } from "lucide-react";

const DEFAULT_INFO = [
  { id: "about",      label: "About us",               to: "/about",                    visible: true },
  { id: "contact",    label: "Contact",                to: "/contact",                  visible: true },
  { id: "franchise",  label: "Contact for Franchisee", to: "/contact?subject=franchise", visible: true },
  { id: "privacy",    label: "Privacy Policy",         to: "/privacy",                  visible: true },
  { id: "refund",     label: "Refund Policy",          to: "/refund",                   visible: true },
];

export default function Header() {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [cmsInfo, setCmsInfo] = useState(null);

  useEffect(() => {
    api.get("/header-menu").then((r) => setCmsInfo(r.data?.items || null)).catch(() => {});
  }, []);

  // Riders get their own bottom-nav-only chrome — no header / hamburger.
  if (user?.role === "rider") return null;

  const brandName = theme?.brand_name || "efoodcare";
  const brandTagline = theme?.brand_tagline || "ghar se achha khana";

  const primary = [];
  // iter-74 #9 follow-up: merge DEFAULT_INFO with CMS overrides BY ID so
  // newly-added defaults (like the About-us entry) always show up even
  // if the existing CMS doc was authored before the default was added.
  // CMS values win on overlap; defaults fill in any IDs the CMS lacks.
  const cmsById = new Map((cmsInfo || []).map((it) => [it.id, it]));
  const mergedInfo = DEFAULT_INFO.map((d) => cmsById.has(d.id) ? { ...d, ...cmsById.get(d.id) } : d);
  // Then append any CMS-only entries (custom links the admin added)
  // that don't exist in DEFAULT_INFO so we don't drop them.
  for (const it of (cmsInfo || [])) {
    if (!DEFAULT_INFO.find((d) => d.id === it.id)) mergedInfo.push(it);
  }
  const info = mergedInfo.filter((it) => it.visible !== false);
  if (user) {
    primary.push({ to: "/dashboard", label: "Dashboard" });
    primary.push({ to: "/plans", label: "Plans" });
    primary.push({ to: "/profile", label: "Profile" });
    if (user.role === "admin") primary.push({ to: "/admin", label: "Admin" });
  } else {
    primary.push({ to: "/", label: "Home" });
    primary.push({ to: "/plans", label: "Plans" });
  }
  const close = () => setOpen(false);
  const showWallet = user && user.role !== "staff" && user.role !== "admin";

  return (
    <header
      className="sticky top-0 z-30 bg-primary text-primary-foreground border-b border-primary/40 shadow-sm"
      data-testid="app-header"
    >
      {/* iter-58 #1: location pill moved from header to /restaurant page
          (under the hero) per user request. Header is now clean. */}
      <div className="max-w-7xl mx-auto flex items-center justify-between px-2 sm:px-3 md:px-8 lg:px-12 py-3 md:py-4 gap-1.5 sm:gap-3">
        <Link to="/" className="flex items-center gap-1.5 min-w-0 flex-shrink" data-testid="logo-link">
          <span
            className="inline-flex items-center justify-center h-9 w-12 sm:h-10 sm:w-14 md:h-11 md:w-16 rounded-md bg-primary shrink-0 overflow-hidden"
            data-testid="brand-logo-frame"
          >
            <img
              src={BRAND_LOGO_URL}
              alt={brandName}
              className="h-[92%] w-[92%] object-contain"
              data-testid="brand-logo"
            />
          </span>
          {/* iter-77 #4: brand name MUST stay visible. Hide tagline below
              sm breakpoint, shrink brand to text-base on tiny screens so
              the wallet + mess pill + hamburger all fit. */}
          <div className="flex flex-col justify-center h-9 sm:h-10 md:h-11 min-w-0">
            <span className="font-display font-extrabold text-base sm:text-xl md:text-2xl text-primary-foreground truncate leading-none">{brandName}</span>
            <span className="hidden sm:inline text-[8.5px] md:text-[10px] tracking-[0.18em] uppercase font-semibold text-primary-foreground/80 truncate leading-tight mt-0.5" data-testid="header-tagline">{brandTagline}</span>
          </div>
        </Link>

        <div className="flex items-center gap-1 sm:gap-1.5 md:gap-3 shrink-0 min-w-0">
          <MessSwitcher variant="pill" />
          {showWallet && <WalletPill compact />}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full h-9 w-9 md:h-10 md:w-10 p-0 bg-white/15 text-primary-foreground border-white/30 hover:bg-white/25 hover:text-primary-foreground"
                data-testid="menu-toggle-button"
                aria-label="Open menu"
              >
                {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 p-0 flex flex-col" data-testid="menu-drawer">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation menu</SheetTitle>
                <SheetDescription>Navigate to pages, sign in, or log out.</SheetDescription>
              </SheetHeader>

              <div className="bg-primary text-primary-foreground px-6 py-6" data-testid="drawer-brand">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center h-12 w-16 rounded-md bg-primary shrink-0 overflow-hidden">
                    <img src={BRAND_LOGO_URL} alt={brandName} className="h-[92%] w-[92%] object-contain" />
                  </span>
                  <div className="flex flex-col leading-none">
                    <span className="font-display font-extrabold text-xl text-primary-foreground" data-testid="drawer-brand-name">{brandName}</span>
                    <span className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/85 mt-1.5">{brandTagline}</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-5">
                {user && (
                  <div className="rounded-2xl bg-muted/60 p-4 mb-5 flex items-center gap-3" data-testid="menu-user-card">
                    {user.photo_url || user.picture ? (
                      <img src={user.photo_url || user.picture} alt={user.name} className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center font-bold">
                        {user.name?.[0]?.toUpperCase() || "U"}
                      </div>
                    )}
                    <div className="flex flex-col leading-none min-w-0">
                      <span className="font-semibold text-sm truncate">{user.name}</span>
                      <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground mt-0.5">{user.role}</span>
                    </div>
                  </div>
                )}

                {showWallet && (
                  <div className="mb-2">
                    <WalletPill
                      trigger={
                        <button type="button" data-testid="menu-wallet-button" className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
                          <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Wallet</span>
                          <span className="text-[10px] tracking-overline uppercase font-bold">Tap to open</span>
                        </button>
                      }
                    />
                  </div>
                )}

                <nav className="flex flex-col gap-1">
                  {primary.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      onClick={close}
                      data-testid={`menu-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                      className={`px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                        location.pathname === l.to ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                      }`}
                    >
                      {l.label}
                    </Link>
                  ))}
                </nav>

                <div className="mt-5 pt-5 border-t border-border">
                  <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground px-1 mb-1">Information</p>
                  <nav className="flex flex-col gap-1">
                    {info.map((l) => (
                      <Link
                        key={l.to}
                        to={l.to}
                        onClick={close}
                        data-testid={`menu-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                        className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                          location.pathname === l.to ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        {l.label}
                      </Link>
                    ))}
                  </nav>
                </div>
              </div>

              <div className="px-4 py-4 border-t border-border">
                {user ? (
                  <Button onClick={() => { logout(); close(); }} variant="outline" data-testid="logout-button" className="w-full rounded-full">
                    <LogOut className="h-4 w-4 mr-2" /> Logout
                  </Button>
                ) : (
                  <Link
                    to={`/login?next=${encodeURIComponent(location.pathname + (location.search || ""))}`}
                    onClick={() => {
                      // Stash pending action so post-login redirect honours
                      // wherever the user came from (cart-bearing /restaurant,
                      // /restaurant/checkout, etc.) even if they hit /login fresh.
                      try {
                        const here = location.pathname + (location.search || "");
                        if (here && here !== "/" && !here.startsWith("/login")) {
                          sessionStorage.setItem("efc_pending_action_v1", here);
                        }
                      } catch {}
                      close();
                    }}
                    data-testid="menu-login-link"
                  >
                    <Button className="w-full rounded-full bg-primary hover:bg-primary/90">Sign In</Button>
                  </Link>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
