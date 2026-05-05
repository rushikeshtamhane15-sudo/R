import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import WalletPill from "./WalletPill";
import { Home, Package, Wallet, User as UserIcon } from "lucide-react";

export default function BottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "admin" || user.role === "staff") return null; // bottom nav is for subscribers

  const items = [
    { to: "/", label: "Home", icon: Home },
    { to: "/plans", label: "Plans", icon: Package },
    { wallet: true, label: "Wallet", icon: Wallet },
    { to: "/profile", label: "Account", icon: UserIcon },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-background border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.04)]"
      data-testid="bottom-nav"
    >
      <ul className="grid grid-cols-4">
        {items.map((it) => {
          const isActive = it.to && (it.to === "/" ? location.pathname === "/" : location.pathname.startsWith(it.to));
          if (it.wallet) {
            return (
              <li key="wallet" className="flex">
                <WalletPill
                  trigger={
                    <button type="button" className="w-full flex flex-col items-center justify-center gap-0.5 py-2.5 text-muted-foreground hover:text-primary transition-colors" data-testid="bottom-nav-wallet">
                      <it.icon className="h-5 w-5" strokeWidth={1.75} />
                      <span className="text-[10px] tracking-overline uppercase font-bold">{it.label}</span>
                    </button>
                  }
                />
              </li>
            );
          }
          return (
            <li key={it.to} className="flex">
              <Link
                to={it.to}
                data-testid={`bottom-nav-${it.label.toLowerCase()}`}
                className={`w-full flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors ${isActive ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
              >
                <it.icon className="h-5 w-5" strokeWidth={1.75} />
                <span className="text-[10px] tracking-overline uppercase font-bold">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
