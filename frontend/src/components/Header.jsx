import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import WalletPill from "./WalletPill";
import { UtensilsCrossed, LogOut, Menu, X } from "lucide-react";

export default function Header() {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const brandName = theme?.brand_name || "eFoodCare";
  const brandTagline = theme?.brand_tagline || "ghar se achha khana";

  // Public-facing navigation only — admin tools are inside /admin
  const navLinks = [];
  if (user) {
    navLinks.push({ to: "/dashboard", label: "Dashboard" });
    navLinks.push({ to: "/plans", label: "Plans" });
    navLinks.push({ to: "/profile", label: "Profile" });
    if (user.role === "admin") navLinks.push({ to: "/admin", label: "Admin" });
  } else {
    navLinks.push({ to: "/", label: "Home" });
    navLinks.push({ to: "/plans", label: "Plans" });
  }

  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/85 border-b border-border" data-testid="app-header">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 md:px-8 lg:px-12 py-4">
        <Link to="/" className="flex items-center gap-2.5" data-testid="logo-link">
          <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center">
            <UtensilsCrossed className="h-5 w-5 text-primary-foreground" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display font-extrabold text-lg text-foreground">{brandName}</span>
            <span className="text-[10px] tracking-overline uppercase font-bold text-secondary mt-0.5 hidden sm:block">{brandTagline}</span>
          </div>
        </Link>

        <div className="flex items-center gap-2 md:gap-3">
          {user && user.role === "subscriber" && <WalletPill />}

          {/* Toggle menu (always available — works on mobile and desktop) */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-full h-10 w-10 p-0" data-testid="menu-toggle-button" aria-label="Open menu">
                {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72" data-testid="menu-drawer">
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2.5 mb-8">
                  <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center">
                    <UtensilsCrossed className="h-5 w-5 text-primary-foreground" strokeWidth={1.75} />
                  </div>
                  <div className="flex flex-col leading-none">
                    <span className="font-display font-extrabold text-lg">{brandName}</span>
                    <span className="text-[10px] tracking-overline uppercase font-bold text-secondary mt-0.5">{brandTagline}</span>
                  </div>
                </div>

                {user && (
                  <div className="rounded-2xl bg-muted/60 p-4 mb-6 flex items-center gap-3" data-testid="menu-user-card">
                    {user.picture ? (
                      <img src={user.picture} alt={user.name} className="h-10 w-10 rounded-full" />
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

                <nav className="flex flex-col gap-1">
                  {navLinks.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      onClick={close}
                      data-testid={`menu-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                      className={`px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                        location.pathname === l.to ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                      }`}
                    >
                      {l.label}
                    </Link>
                  ))}
                </nav>

                <div className="mt-auto pt-6 border-t border-border">
                  {user ? (
                    <Button onClick={() => { logout(); close(); }} variant="outline" data-testid="logout-button" className="w-full rounded-full">
                      <LogOut className="h-4 w-4 mr-2" /> Logout
                    </Button>
                  ) : (
                    <Link to="/login" onClick={close} data-testid="menu-login-link">
                      <Button className="w-full rounded-full bg-primary hover:bg-primary/90">Sign In</Button>
                    </Link>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
