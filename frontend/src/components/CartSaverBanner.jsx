import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Flame, X, ShoppingCart } from "lucide-react";
import { useAuth } from "../context/AuthContext";

/**
 * CartSaverBanner — iter-68
 *
 * Polls /api/me/cart-saver for the logged-in user. If they opened the
 * mess-menu order form >5 minutes ago without completing payment, a
 * warm gentle banner appears with one-tap resume.
 *
 * Polls every 60 s + refetches on visibilitychange. Dismissal hits the
 * backend so the same intent won't surface again.
 */
const POLL_MS = 60_000;

export default function CartSaverBanner({ onResume }) {
  const { user } = useAuth();
  const [banner, setBanner] = useState(null);

  const fetchBanner = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.get("/me/cart-saver");
      const b = r.data?.banner;
      setBanner((prev) => {
        if (prev && b && prev.intent_id === b.intent_id) return prev;
        return b || null;
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug("[CartSaverBanner] poll failed", e?.message || e);
    }
  }, [user]);

  useEffect(() => {
    if (!user) { setBanner(null); return; }
    fetchBanner();
    const id = setInterval(fetchBanner, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") fetchBanner(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [user, fetchBanner]);

  if (!banner) return null;

  const dismiss = async () => {
    setBanner(null);
    try { await api.post("/me/cart-saver/dismiss", { intent_id: banner.intent_id }); } catch { /* no-op */ }
  };
  const resume = () => {
    setBanner(null);
    // Hand the saved selection back to TodayMessMenuFlash so it can re-open
    // the order form pre-filled. Caller takes care of dismiss + Razorpay.
    onResume?.(banner);
  };

  return (
    <div
      className="relative rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 px-3 py-2.5 mb-3 shadow-sm"
      data-testid="cart-saver-banner"
    >
      <div className="flex items-start gap-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-white shrink-0 animate-pulse">
          <Flame className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.18em] uppercase font-extrabold text-amber-900" data-testid="cart-saver-title">{banner.title}</p>
          <p className="text-[12px] sm:text-sm font-bold text-foreground leading-snug mt-0.5" data-testid="cart-saver-body">{banner.body}</p>
        </div>
        <button type="button" onClick={dismiss} className="shrink-0 p-1 text-muted-foreground hover:text-foreground" data-testid="cart-saver-dismiss" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={resume}
        className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-full bg-amber-600 text-white px-3 h-8 text-[11px] font-extrabold hover:bg-amber-700"
        data-testid="cart-saver-cta"
      >
        <ShoppingCart className="h-3 w-3" /> {banner.cta_label || "Resume order"}
      </button>
    </div>
  );
}
