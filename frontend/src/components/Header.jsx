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
import { LogOut, Menu, X, Wallet, Home, LayoutDashboard, Package, User as UserIcon, ShieldCheck, Info, Phone, Handshake, Lock, RefreshCw, ChevronRight, Utensils, MapPin, QrCode, Bike, Bell, SlidersHorizontal, Calendar, Store, MessageCircle, Receipt, ScanLine } from "lucide-react";

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
  // iter-131.21: fetch wallet balance for the drawer quick-action tile.
  // Lightweight — reuses the /my/subscriptions payload the app already fetches.
  const [walletValue, setWalletValue] = useState(0);
  const showWallet = user && user.role !== "staff" && user.role !== "admin";

  useEffect(() => {
    api.get("/header-menu").then((r) => setCmsInfo(r.data?.items || null)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user || !showWallet) return;
    let cancel = false;
    api.get("/my/subscriptions").then((r) => {
      if (cancel) return;
      const subs = r.data?.subscriptions || [];
      const total = subs.reduce((sum, s) => sum + (s.wallet_balance || 0), 0);
      setWalletValue(total);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [user, showWallet]);

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

  return (
    <header
      className="sticky top-0 z-30 bg-primary text-primary-foreground border-b border-primary/40 shadow-sm"
      data-testid="app-header"
    >
      {/* iter-131.13: SINGLE-ROW header again. Sizes reduced enough that the
          full brand cluster + Amravati + ₹9,999 wallet + menu button all fit
          on a 360-wide screen without wrapping or truncation. */}
      <div className="max-w-7xl mx-auto flex items-center justify-between px-2 sm:px-3 md:px-8 lg:px-12 py-2 md:py-3 gap-1 sm:gap-3">
        <Link
          to="/"
          className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1 overflow-hidden"
          data-testid="logo-link"
        >
          <span
            className="inline-flex items-center justify-center h-9 w-10 sm:h-10 sm:w-12 md:h-12 md:w-14 rounded-md bg-primary shrink-0 overflow-hidden"
            data-testid="brand-logo-frame"
          >            <img
              src={headerLogoUrl}
              alt={brandName}
              className="h-[92%] w-[92%] object-contain"
              data-testid="brand-logo"
            />
          </span>
          <div className="flex flex-col justify-center min-w-0 leading-none overflow-hidden">
            <span className="font-display font-extrabold text-[14px] sm:text-lg md:text-xl text-primary-foreground leading-[1.05] truncate" data-testid="header-brand-name">{brandName}</span>
            <span className="text-[7px] sm:text-[9px] md:text-[10px] tracking-[0.04em] sm:tracking-[0.14em] uppercase font-semibold text-primary-foreground/90 leading-tight mt-0.5 truncate" data-testid="header-tagline">{brandTagline}</span>
          </div>
        </Link>

        <div className="flex items-center gap-0.5 md:gap-2 shrink-0 whitespace-nowrap">
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
            <SheetContent side="right" className="w-[72vw] max-w-[340px] p-0 flex flex-col bg-white" data-testid="menu-drawer">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation menu</SheetTitle>
                <SheetDescription>Navigate to pages, sign in, or log out.</SheetDescription>
              </SheetHeader>

              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                data-testid="drawer-close"
                className="absolute top-3 right-3 z-20 h-9 w-9 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center backdrop-blur-sm ring-1 ring-white/20"
              >
                <X className="h-4 w-4" />
              </button>

              {/* iter-131.22: drawer clone. Top: red block with user avatar +
                  name + phone. Below the head: 3 quick-action tiles. */}
              <div
                className="relative text-primary-foreground overflow-hidden"
                style={{ background: "linear-gradient(160deg, #d92626 0%, #b32020 100%)" }}
                data-testid="drawer-brand"
              >
                <div className="relative px-4 pt-4 pb-3 flex items-center gap-3">
                  {user?.photo_url || user?.picture ? (
                    <img src={user.photo_url || user.picture} alt={user.name} className="h-12 w-12 rounded-full object-cover ring-2 ring-white/40 shadow" data-testid="drawer-user-avatar" />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-white/20 text-white flex items-center justify-center font-display font-extrabold text-lg ring-2 ring-white/40 shadow" data-testid="drawer-user-avatar">
                      {(user?.name || "G")[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-extrabold text-lg leading-tight truncate" data-testid="drawer-user-name">{user?.name || "Not signed in"}</p>
                    {user?.phone && (
                      <p className="text-xs text-primary-foreground/90 tabular-nums truncate">+91 {(user.phone).replace(/^\+?91/, "")}</p>
                    )}
                  </div>
                </div>

                {user && (
                  <div className="relative px-4 pb-4 grid grid-cols-3 gap-2" data-testid="drawer-quick-actions">
                    <QuickTile icon={QrCode} label="Pass" to="/dashboard" onClick={close} testid="drawer-quick-pass" />
                    <WalletPill
                      trigger={
                        <QuickTile icon={Wallet} label={`₹${Math.round(walletValue)}`} onClick={close} testid="drawer-quick-wallet" />
                      }
                    />
                    <QuickTile icon={ScanLine} label="Scan" to="/self-scan" onClick={close} testid="drawer-quick-scan" />
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-3 bg-white space-y-3">
                {user ? (
                  <>
                    <MenuSection label="Eat" testid="drawer-section-eat">
                      <MenuRow icon={Utensils} label="Home — restaurant menu" to="/restaurant" onClick={close} testid="drawer-item-restaurant" />
                      <MenuRow icon={Bell} label="Subscription plans" to="/plans" onClick={close} testid="drawer-item-plans" />
                      <MenuRow icon={Calendar} label="Today&apos;s mess menu" to="/dashboard" onClick={close} testid="drawer-item-mess-menu" />
                      <MenuRow icon={SlidersHorizontal} label="Tiffin preferences" to="/dashboard" onClick={close} testid="drawer-item-tiffin-prefs" />
                    </MenuSection>

                    <MenuSection label="My account" testid="drawer-section-account">
                      <MenuRow icon={QrCode} label="My e-meal pass" to="/dashboard" onClick={close} testid="drawer-item-emeal-pass" />
                      <MenuRow icon={Receipt} label="My orders" to="/restaurant/orders" onClick={close} testid="drawer-item-orders" />
                      <WalletPill
                        trigger={
                          <MenuRow icon={Wallet} label="Wallet & transactions" onClick={close} testid="drawer-item-wallet-tx" />
                        }
                      />
                      <MenuRow icon={UserIcon} label="Edit profile" to="/profile?edit=1" onClick={close} testid="drawer-item-edit-profile" />
                      {user.role === "admin" && <MenuRow icon={ShieldCheck} label="Admin console" to="/admin" onClick={close} testid="drawer-item-admin" />}
                    </MenuSection>
                  </>
                ) : (
                  <MenuSection label="Explore" testid="drawer-section-explore">
                    <MenuRow icon={Home} label="Home" to="/" onClick={close} testid="drawer-item-home" />
                    <MenuRow icon={Package} label="Subscription plans" to="/plans" onClick={close} testid="drawer-item-plans" />
                    <MenuRow icon={Utensils} label="Restaurant menu" to="/restaurant" onClick={close} testid="drawer-item-restaurant" />
                  </MenuSection>
                )}

                <MenuSection label="Discover" testid="drawer-section-discover">
                  <MenuRow icon={Store} label="Our branches" to="/contact" onClick={close} testid="drawer-item-branches" />
                  <MenuRow icon={Bike} label="Become a rider" to="/become-a-rider" onClick={close} testid="drawer-item-rider" />
                  <MenuRow icon={Info} label="About efoodcare" to="/about" onClick={close} testid="drawer-item-about" />
                  <MenuRow icon={Phone} label="Contact us" to="/contact" onClick={close} testid="drawer-item-contact" />
                </MenuSection>

                <MenuSection label="Policies" testid="drawer-section-policies">
                  <MenuRow icon={Lock} label="Privacy policy" to="/privacy" onClick={close} testid="drawer-item-privacy" />
                  <MenuRow icon={RefreshCw} label="Refund policy" to="/refund" onClick={close} testid="drawer-item-refund" />
                </MenuSection>
              </div>

              <div className="px-3 py-2.5 border-t border-border bg-white">
                {user ? (
                  <Button onClick={() => { logout(); close(); }} variant="outline" data-testid="logout-button" className="w-full rounded-xl h-10 font-bold text-primary border-primary/30 hover:bg-primary/5">
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
                    <Button className="w-full rounded-xl h-10 font-bold bg-primary hover:bg-primary/90">Sign In</Button>
                  </Link>
                )}
                <p className="text-center text-[9px] text-muted-foreground mt-2">
                  efoodcare · Dining Pass Scan · v1.0
                </p>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

// iter-131.21: mobile-app-clone drawer helpers.
// QuickTile — one of the 3 top action tiles (Pass / Wallet / Scan).
const QuickTile = React.forwardRef(function QuickTile({ icon: Icon, label, to, onClick, testid }, ref) {
  const inner = (
    <span className="flex flex-col items-center justify-center gap-1 h-[60px] rounded-2xl bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white transition-colors ring-1 ring-white/10">
      <Icon className="h-4 w-4" strokeWidth={2} />
      <span className="text-[10px] font-bold tracking-wide truncate max-w-full px-1">{label}</span>
    </span>
  );
  if (to) return <Link ref={ref} to={to} onClick={onClick} data-testid={testid}>{inner}</Link>;
  return <button ref={ref} type="button" onClick={onClick} data-testid={testid} className="w-full text-left">{inner}</button>;
});

// MenuSection — grouped-list section with a small overline label above.
function MenuSection({ label, testid, children }) {
  return (
    <div data-testid={testid}>
      <p className="text-[11px] tracking-wide font-bold text-muted-foreground/90 px-1 mb-1.5 uppercase">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

// MenuRow — individual row with icon squircle + label + chevron. iOS/Android
// card style with a subtle border and soft shadow — matches the mobile app.
const MenuRow = React.forwardRef(function MenuRow({ icon: Icon, label, to, onClick, testid }, ref) {
  const inner = (
    <span className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_10px_-6px_rgba(0,0,0,0.06)] hover:bg-accent/40 transition-colors">
      <span className="inline-flex h-7 w-7 rounded-full bg-primary/8 text-primary items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <span className="flex-1 text-[13px] font-bold text-foreground leading-tight">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
    </span>
  );
  if (to) return <Link ref={ref} to={to} onClick={onClick} data-testid={testid} className="block">{inner}</Link>;
  return <button ref={ref} type="button" onClick={onClick} data-testid={testid} className="block w-full text-left">{inner}</button>;
});
