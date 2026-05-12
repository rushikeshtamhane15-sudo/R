import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X, Sparkles, ArrowRight } from "lucide-react";
import { api } from "../lib/api";

const DISMISS_KEY = "efc_promo_dismissed_v1";

// Helper — resolve relative /api/uploads/... URLs to absolute on the configured backend.
const absUrl = (u) => {
  if (!u) return "";
  if (/^https?:\/\//.test(u)) return u;
  const base = process.env.REACT_APP_BACKEND_URL || "";
  return `${base}${u}`;
};

/**
 * Landing promotional 3D popup. Auto-opens once per session (sessionStorage
 * dismissal) when the public endpoint returns an active promotion.
 *
 * Admin controls the contents + on/off via /admin/promotion.
 */
export default function PromotionPopup() {
  const [promo, setPromo] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api.get("/landing-promotion");
        const p = r.data?.promotion;
        if (!mounted || !p) return;
        // Skip if user dismissed this session
        try { if (sessionStorage.getItem(DISMISS_KEY) === "1") return; } catch { /* non-critical: storage/network unavailable */ }
        setPromo(p);
        // Tiny delay so it doesn't fight the hero entrance animation
        setTimeout(() => mounted && setOpen(true), 700);
      } catch { /* non-critical: storage/network unavailable */ }
    })();
    return () => { mounted = false; };
  }, []);

  const close = () => {
    setOpen(false);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* non-critical: storage/network unavailable */ }
  };

  if (!promo || !open) return null;
  const img = absUrl(promo.image_url);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={close}
      data-testid="promo-popup-overlay"
    >
      <div
        className="surface-3d relative w-full max-w-md bg-card rounded-3xl overflow-hidden border border-border animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        data-testid="promo-popup-card"
        style={{ borderColor: promo.accent_color || undefined }}
      >
        <button
          type="button"
          onClick={close}
          className="absolute top-2 right-2 z-10 h-9 w-9 rounded-full bg-background/95 hover:bg-background shadow-md flex items-center justify-center"
          aria-label="Close"
          data-testid="promo-popup-close"
        >
          <X className="h-4 w-4" />
        </button>
        {img && (
          <div className="surface-3d-image relative aspect-[16/9] w-full bg-muted">
            <img src={img} alt={promo.title} className="absolute inset-0 w-full h-full object-cover" />
          </div>
        )}
        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <p
            className="text-[10px] tracking-overline uppercase font-bold inline-flex items-center gap-1"
            style={{ color: promo.accent_color || undefined }}
          >
            <Sparkles className="h-3 w-3" /> Special offer
          </p>
          <h2
            className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-1 leading-tight"
            data-testid="promo-popup-title"
          >
            {promo.title}
          </h2>
          {promo.body && (
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed" data-testid="promo-popup-body">
              {promo.body}
            </p>
          )}
          {promo.cta_label && promo.cta_link && (
            <div className="mt-5">
              <Link
                to={promo.cta_link}
                onClick={close}
                className="inline-flex items-center gap-2 rounded-full px-5 h-11 font-bold text-sm text-white shadow-md"
                style={{ backgroundColor: promo.accent_color || "#b91c1c" }}
                data-testid="promo-popup-cta"
              >
                {promo.cta_label} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
