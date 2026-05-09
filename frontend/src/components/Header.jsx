import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import WalletPill from "./WalletPill";
import { BRAND_LOGO_URL } from "../lib/brand";
import { LogOut, Menu, X, Wallet } from "lucide-react";

export default function Header() {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Riders get their own bottom-nav-only chrome — no header / hamburger.
  if (user?.role === "rider") return null;

  const brandName = theme?.brand_name || "efoodcare";
  const brandTagline = theme?.brand_tagline || "ghar se achha khana";

  const primary = [];
  const info = [
    { to: "/contact", label: "Contact" },
    { to: "/contact?subject=franchise", label: "Contact for Franchisee" },
    { to: "/privacy", label: "Privacy Policy" },
    { to: "/refund", label: "Refund Policy" },
  ];
  // Surface "Become a rider" CTA in info section for non-rider, non-admin users
  if (!user || (user.role !== "rider" && user.role !== "admin" && user.role !== "staff")) {
    info.unshift({ to: "/become-a-rider", label: "Become a rider" });
  }
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
      <div className="max-w-7xl mx-auto flex items-center justify-between px-3 md:px-8 lg:px-12 py-3 md:py-4 gap-3">
        <Link to="/" className="flex items-center gap-1 min-w-0" data-testid="logo-link">
          <span
            className="inline-flex items-center justify-center h-10 w-14 md:h-11 md:w-16 rounded-md bg-primary shrink-0 overflow-hidden"
            data-testid="brand-logo-frame"
          >
            <img
              src={BRAND_LOGO_URL}
              alt={brandName}
              className="h-full w-full object-contain p-0.5"
              data-testid="brand-logo"
            />
          </span>
          <div className="flex flex-col leading-none min-w-0">
            <span className="font-display font-extrabold text-base md:text-lg text-primary-foreground truncate">{brandName}</span>
            <span className="text-[9px] md:text-[10px] tracking-overline uppercase font-bold text-primary-foreground/85 mt-1 truncate" data-testid="header-tagline">{brandTagline}</span>
          </div>
        </Link>

        <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
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
                    <img src={BRAND_LOGO_URL} alt={brandName} className="h-full w-full object-contain p-0.5" />
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
                  <Link to={`/login?next=${encodeURIComponent(location.pathname + (location.search || ""))}`} onClick={close} data-testid="menu-login-link">
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
