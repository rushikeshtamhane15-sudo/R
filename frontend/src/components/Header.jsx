import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "./ui/button";
import { UtensilsCrossed, LogOut } from "lucide-react";

export default function Header() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navLinks = [];
  if (user) {
    navLinks.push({ to: "/dashboard", label: "Dashboard" });
    navLinks.push({ to: "/plans", label: "Plans" });
    if (user.role === "admin") navLinks.push({ to: "/admin", label: "Admin" });
    if (user.role === "admin" || user.role === "staff") {
      navLinks.push({ to: "/scan", label: "Scan" });
      navLinks.push({ to: "/counter", label: "Counter QR" });
    }
  }

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-xl bg-[hsl(var(--background))]/80 border-b border-black/5"
      data-testid="app-header"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 md:px-8 lg:px-12 py-5">
        <Link to="/" className="flex items-center gap-2.5" data-testid="logo-link">
          <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center">
            <UtensilsCrossed className="h-5 w-5 text-primary-foreground" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display font-extrabold text-lg text-foreground">MESSPASS</span>
            <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Dining Subscriptions</span>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              data-testid={`nav-${l.label.toLowerCase().replace(/\s/g, "-")}`}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                location.pathname === l.to
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="hidden sm:flex items-center gap-2">
                {user.picture ? (
                  <img src={user.picture} alt={user.name} className="h-8 w-8 rounded-full" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-sm font-bold">
                    {user.name?.[0]?.toUpperCase() || "U"}
                  </div>
                )}
                <div className="flex flex-col leading-none">
                  <span className="text-sm font-semibold">{user.name}</span>
                  <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{user.role}</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                data-testid="logout-button"
                className="rounded-full"
              >
                <LogOut className="h-4 w-4 mr-1.5" strokeWidth={1.75} /> Logout
              </Button>
            </>
          ) : (
            <Link to="/login" data-testid="header-login-link">
              <Button className="rounded-full bg-primary hover:bg-primary/90" data-testid="header-login-button">
                Sign In
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
