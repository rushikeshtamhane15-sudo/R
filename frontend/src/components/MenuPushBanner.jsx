import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Megaphone, X, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * MenuPushBanner — iter-66 #3
 *
 * Renders today's daily mess-menu broadcast (if any) as a slim banner
 * above the menu-flash card. Dismissal is stored in localStorage so the
 * same user only sees it once per day, even across reloads.
 */
const DISMISS_KEY = "efc_menu_push_dismiss_v1";

export default function MenuPushBanner() {
  const [bc, setBc] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/mess-menu/push");
        const broadcast = r.data?.broadcast;
        if (!broadcast) return;
        const dismissedFor = localStorage.getItem(DISMISS_KEY);
        if (dismissedFor === broadcast.date) return;
        setBc(broadcast);
      } catch { /* no-op */ }
    })();
  }, []);
  if (!bc) return null;
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, bc.date); } catch { /* no-op */ }
    setBc(null);
  };
  const cta = () => {
    dismiss();
    navigate(bc.cta_route || "/dashboard");
  };
  return (
    <div
      className="relative rounded-xl border border-emerald-300 bg-gradient-to-r from-emerald-50 to-amber-50 px-3 py-2.5 mb-3 flex items-start gap-2.5 shadow-sm"
      data-testid="menu-push-banner"
    >
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white shrink-0">
        <Megaphone className="h-3.5 w-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] tracking-[0.18em] uppercase font-extrabold text-emerald-800" data-testid="menu-push-title">{bc.title}</p>
        <p className="text-[12px] sm:text-sm font-bold text-foreground leading-snug mt-0.5" data-testid="menu-push-body">{bc.body}</p>
      </div>
      <button
        type="button"
        onClick={cta}
        className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white px-3 h-8 text-[11px] font-extrabold hover:bg-emerald-700"
        data-testid="menu-push-cta"
      >
        <ShoppingCart className="h-3 w-3" /> {bc.cta_label || "Order now"}
      </button>
      <button type="button" onClick={dismiss} className="shrink-0 p-1 text-muted-foreground hover:text-foreground" data-testid="menu-push-dismiss" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
