import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import WalletPill from "./WalletPill";
import MessSwitcher from "./MessSwitcher";
import { useBranding } from "../context/BrandingContext";
import { api } from "../lib/api";
import { LogOut, Menu, X, Wallet, Home, LayoutDashboard, Package, User as UserIcon, ShieldCheck, Info, Phone, Handshake, Lock, RefreshCw, ChevronRight, Utensils, MapPin } from "lucide-react";

const DEFAULT_INFO = [
  { id: "about",      label: "About us",               to: "/about",                    visible: true, icon: Info },
  { id: "contact",    label: "Contact",                to: "/contact",                  visible: true, icon: Phone },
  { id: "franchise",  label: "Contact for Franchisee", to: "/contact?subject=franchise", visible: true, icon: Handshake },
  { id: "privacy",    label: "Privacy Policy",         to: "/privacy",                  visible: true, icon: Lock },
  { id: "refund",     label: "Refund Policy",          to: "/refund",                   visible: true, icon: RefreshCw },
];

export default function Header() {
  const { user, logout } = useAuth();
  const { headerLogoUrl } = useBranding();
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
  const cmsById = new Map((cmsInfo || []).map((it) => [it.id, it]));
  const mergedInfo = DEFAULT_INFO.map((d) => cmsById.has(d.id) ? { ...d, icon: d.icon, ...cmsById.get(d.id) } : d);
  for (const it of (cmsInfo || [])) {
    if (!DEFAULT_INFO.find((d) => d.id === it.id)) mergedInfo.push({ ...it, icon: Info });
  }
  const info = mergedInfo.filter((it) => it.visible !== false);
  if (user) {
    primary.push({ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard });
    primary.push({ to: "/plans", label: "Plans", icon: Package });
    primary.push({ to: "/restaurant", label: "Restaurant", icon: Utensils });
    primary.push({ to: "/profile", label: "My Account", icon: UserIcon });
    if (user.role === "admin") primary.push({ to: "/admin", label: "Admin", icon: ShieldCheck });
  } else {
    primary.push({ to: "/", label: "Home", icon: Home });
    primary.push({ to: "/plans", label: "Plans", icon: Package });
    primary.push({ to: "/restaurant", label: "Restaurant", icon: Utensils });
  }
  const close = () => setOpen(false);
  const showWallet = user && user.role !== "staff" && user.role !== "admin";

  return (
    <header
      className="sticky top-0 z-30 bg-primary text-primary-foreground border-b border-primary/40 shadow-sm"
      data-testid="app-header"
    >
      {/* iter-131.13: SINGLE-ROW header again. Sizes reduced enough that the
          full brand cluster + Amravati + ₹9,999 wallet + menu button all fit
          on a 360-wide screen without wrapping or truncation. */}
      <div className="max-w-7xl mx-auto flex items-center justify-between px-2 sm:px-3 md:px-8 lg:px-12 py-2 md:py-3 gap-1.5 sm:gap-3">
        <Link
          to="/"
          className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 overflow-hidden"
          data-testid="logo-link"
        >
          <span
            className="inline-flex items-center justify-center h-9 w-10 sm:h-10 sm:w-12 md:h-12 md:w-14 rounded-md bg-primary shrink-0 overflow-hidden"
            data-testid="brand-logo-frame"
          >
            <img
              src={headerLogoUrl}
              alt={brandName}
              className="h-[92%] w-[92%] object-contain"
              data-testid="brand-logo"
            />
          </span>
          <div className="flex flex-col justify-center min-w-0 leading-tight overflow-hidden">
            <span className="font-display font-extrabold text-[15px] sm:text-lg md:text-xl text-primary-foreground leading-[1.1] truncate" data-testid="header-brand-name">{brandName}</span>
            <span className="text-[7.5px] sm:text-[9px] md:text-[10px] tracking-[0.14em] uppercase font-semibold text-primary-foreground/85 leading-tight mt-0.5 truncate" data-testid="header-tagline">{brandTagline}</span>
          </div>
        </Link>

        <div className="flex items-center gap-1 md:gap-2 shrink-0 whitespace-nowrap">
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
            <SheetContent side="right" className="w-[86vw] max-w-sm p-0 flex flex-col bg-background" data-testid="menu-drawer">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation menu</SheetTitle>
                <SheetDescription>Navigate to pages, sign in, or log out.</SheetDescription>
              </SheetHeader>

              {/* iter-131.20: native-mobile-app-style header — big centered avatar,
                  name + role pill, small brand strip in the top-left. */}
              <div
                className="relative px-5 pt-8 pb-6 text-primary-foreground overflow-hidden"
                style={{
                  background: "linear-gradient(140deg, #c92626 0%, #a02323 55%, #7a1a1a 100%)",
                }}
                data-testid="drawer-brand"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -top-14 -right-14 h-40 w-40 rounded-full opacity-40"
                  style={{ background: "radial-gradient(circle at center, rgba(255,255,255,0.25) 0%, transparent 70%)" }}
                />
                <div className="relative flex items-center gap-2">
                  <span className="inline-flex items-center justify-center h-8 w-9 rounded bg-white/10 shrink-0 overflow-hidden">
                    <img src={headerLogoUrl} alt={brandName} className="h-[92%] w-[92%] object-contain" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display font-extrabold text-sm leading-none" data-testid="drawer-brand-name">{brandName}</p>
                    <p className="text-[8px] tracking-[0.16em] uppercase font-bold text-primary-foreground/80 mt-0.5">{brandTagline}</p>
                  </div>
                </div>

                {user ? (
                  <div className="relative mt-5 flex flex-col items-center text-center" data-testid="drawer-user-block">
                    {user.photo_url || user.picture ? (
                      <img src={user.photo_url || user.picture} alt={user.name} className="h-16 w-16 rounded-full object-cover ring-4 ring-white/25 shadow-md" />
                    ) : (
                      <div className="h-16 w-16 rounded-full bg-white text-primary flex items-center justify-center font-display font-extrabold text-2xl ring-4 ring-white/25 shadow-md">
                        {user.name?.[0]?.toUpperCase() || "U"}
                      </div>
                    )}
                    <p className="mt-3 font-display font-extrabold text-lg leading-tight truncate max-w-full" data-testid="drawer-user-name">{user.name || "Guest"}</p>
                    <p className="text-[10px] mt-1 tracking-[0.16em] uppercase font-bold text-primary-foreground/85">{user.phone || user.role}</p>
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/20 backdrop-blur-sm px-2.5 py-1 text-[9px] tracking-overline uppercase font-extrabold ring-1 ring-white/25">
                      {user.role}
                    </span>
                  </div>
                ) : (
                  <div className="relative mt-5 text-center">
                    <div className="h-16 w-16 mx-auto rounded-full bg-white/20 flex items-center justify-center ring-4 ring-white/25">
                      <UserIcon className="h-7 w-7 text-white/80" />
                    </div>
                    <p className="mt-3 font-display font-extrabold text-lg">Not signed in</p>
                    <p className="text-[10px] mt-1 tracking-[0.16em] uppercase font-bold text-primary-foreground/80">Sign in to unlock your dashboard</p>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-4 bg-muted/20">
                {showWallet && (
                  <div className="mb-3">
                    <WalletPill
                      trigger={
                        <button
                          type="button"
                          data-testid="menu-wallet-button"
                          className="w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-bold bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-[0_8px_20px_-10px_rgba(160,35,35,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] hover:from-primary/90"
                        >
                          <span className="flex items-center gap-2">
                            <span className="inline-flex h-8 w-8 rounded-lg bg-white/20 items-center justify-center">
                              <Wallet className="h-4 w-4" />
                            </span>
                            My wallet
                          </span>
                          <span className="text-[9px] tracking-overline uppercase font-bold flex items-center gap-1 text-primary-foreground/85">
                            Open <ChevronRight className="h-3 w-3" />
                          </span>
                        </button>
                      }
                    />
                  </div>
                )}

                {/* Menu section — grouped-list style like iOS/Android native app */}
                <div className="bg-card rounded-2xl overflow-hidden shadow-sm border border-black/5" data-testid="menu-primary">
                  {primary.map((l, idx) => {
                    const Icon = l.icon || Home;
                    const active = location.pathname === l.to;
                    return (
                      <Link
                        key={l.to}
                        to={l.to}
                        onClick={close}
                        data-testid={`menu-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                          active ? "bg-primary/8" : "hover:bg-accent/50"
                        } ${idx > 0 ? "border-t border-border/60" : ""}`}
                      >
                        <span className={`inline-flex h-9 w-9 rounded-xl items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted text-secondary"}`}>
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <span className={`flex-1 text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>{l.label}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </Link>
                    );
                  })}
                </div>

                <p className="text-[9px] tracking-[0.16em] uppercase font-extrabold text-muted-foreground px-4 mt-5 mb-2">Information</p>
                <div className="bg-card rounded-2xl overflow-hidden shadow-sm border border-black/5" data-testid="menu-info">
                  {info.map((l, idx) => {
                    const Icon = l.icon || Info;
                    const active = location.pathname === l.to;
                    return (
                      <Link
                        key={l.to}
                        to={l.to}
                        onClick={close}
                        data-testid={`menu-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                        className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                          active ? "bg-primary/8" : "hover:bg-accent/50"
                        } ${idx > 0 ? "border-t border-border/60" : ""}`}
                      >
                        <span className={`inline-flex h-8 w-8 rounded-lg items-center justify-center shrink-0 ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                        </span>
                        <span className={`flex-1 text-[13px] font-semibold ${active ? "text-primary" : "text-muted-foreground"}`}>{l.label}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="px-4 py-3 border-t border-border bg-background">
                {user ? (
                  <Button onClick={() => { logout(); close(); }} variant="outline" data-testid="logout-button" className="w-full rounded-xl h-11 font-bold text-destructive border-destructive/30 hover:bg-destructive/5">
                    <LogOut className="h-4 w-4 mr-2" /> Log out
                  </Button>
                ) : (
                  <Link
                    to={`/login?next=${encodeURIComponent(location.pathname + (location.search || ""))}`}
                    onClick={() => {
                      try {
                        const here = location.pathname + (location.search || "");
                        if (here && here !== "/" && !here.startsWith("/login")) {
                          sessionStorage.setItem("efc_pending_action_v1", here);
                        }
                      } catch { /* sessionStorage may be blocked */ }
                      close();
                    }}
                    data-testid="menu-login-link"
                  >
                    <Button className="w-full rounded-xl h-11 font-bold bg-primary hover:bg-primary/90">Sign In</Button>
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
