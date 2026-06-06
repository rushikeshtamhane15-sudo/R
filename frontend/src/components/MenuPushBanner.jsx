import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Megaphone, X, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * MenuPushBanner — iter-66 #3, iter-67 #1, iter-74 #2 layout fix.
 *
 * Iter-74 #2: the previous version put the icon, title+body, "Order now"
 * button, and dismiss X all on a single flex row — on a 390-px viewport
 * that crushed the body text into a 130-px column and wrapped it into ugly
 * stacked words ("Dal bhaji ·", "₹140 delivery ·", "order in 1 tap").
 * New layout: title/body get the full row width; CTA + X sit on a separate
 * row below, right-aligned. Desktop keeps the inline look via sm: classes.
 */
const DISMISS_KEY = "efc_menu_push_dismiss_v1";
const POLL_INTERVAL_MS = 90_000;

export default function MenuPushBanner() {
  const [bc, setBc] = useState(null);
  const navigate = useNavigate();

  const fetchBroadcast = useCallback(async () => {
    try {
      const r = await api.get("/mess-menu/push");
      const broadcast = r.data?.broadcast;
      if (!broadcast) { setBc(null); return; }
      const dismissedFor = localStorage.getItem(DISMISS_KEY);
      if (dismissedFor === broadcast.date) { setBc(null); return; }
      setBc((prev) => {
        if (prev && prev.broadcast_id === broadcast.broadcast_id && prev.sent_at === broadcast.sent_at) return prev;
        return broadcast;
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug("[MenuPushBanner] /mess-menu/push failed", e?.message || e);
    }
  }, []);

  useEffect(() => {
    fetchBroadcast();
    const id = setInterval(fetchBroadcast, POLL_INTERVAL_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") fetchBroadcast(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchBroadcast]);

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
      className="relative rounded-xl border border-emerald-300 bg-gradient-to-r from-emerald-50 to-amber-50 px-3 py-2.5 mb-3 shadow-sm"
      data-testid="menu-push-banner"
    >
      {/* Dismiss sits absolute top-right — out of flow so the title/body can use full width. */}
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-1.5 right-1.5 p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-white/60 transition-colors"
        data-testid="menu-push-dismiss"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-start gap-2.5 pr-6">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white shrink-0">
          <Megaphone className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold text-emerald-800 leading-tight" data-testid="menu-push-title">{bc.title}</p>
          <p className="text-[12.5px] sm:text-sm font-semibold text-foreground leading-snug mt-0.5 break-words" data-testid="menu-push-body">{bc.body}</p>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={cta}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 text-white px-3.5 h-8 text-[11px] font-extrabold hover:bg-emerald-700 shadow-sm active:scale-95 transition-transform"
          data-testid="menu-push-cta"
        >
          <ShoppingCart className="h-3.5 w-3.5" /> {bc.cta_label || "Order now"}
        </button>
      </div>
    </div>
  );
}
