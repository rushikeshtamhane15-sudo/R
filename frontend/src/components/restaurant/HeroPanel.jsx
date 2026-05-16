import React, { useEffect, useRef } from "react";
import { ChefHat, Truck } from "lucide-react";
import { BRAND_LOGO_URL } from "../../lib/brand";

/**
 * HeroPanel — top "red plate" of /restaurant.
 *
 * Adds a tiny parallax tilt that follows the user's pointer on desktop and the
 * device orientation on mobile. Combined with the extruded-text shadows, this
 * makes the heading + Hindi quote feel genuinely embossed as the user moves
 * the phone or mouse. The effect is intentionally subtle (max ±6°) and uses
 * `prefers-reduced-motion` to disable for accessibility.
 *
 * Props mirror the data the page passes in (theme overrides + delivery meta)
 * so this component stays presentational — no API/state.
 */
export default function HeroPanel({ theme, meta }) {
  const ref = useRef(null);
  const inner = useRef(null);

  // Apply tilt on each frame. Reads pointer position OR DeviceOrientationEvent
  // and translates it into a CSS transform. Capped to feel subtle, not gimmicky.
  useEffect(() => {
    const el = ref.current;
    const innerEl = inner.current;
    if (!el || !innerEl) return;

    // Respect reduced-motion users — no tilt at all.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let rx = 0, ry = 0; // current rotation values
    let tx = 0, ty = 0; // target rotation values
    let raf = 0;

    const apply = () => {
      // ease toward target — gentle inertia
      rx += (tx - rx) * 0.10;
      ry += (ty - ry) * 0.10;
      innerEl.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      raf = requestAnimationFrame(apply);
    };
    raf = requestAnimationFrame(apply);

    const onPointerMove = (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;   // 0..1
      const y = (e.clientY - rect.top) / rect.height;   // 0..1
      ty = (x - 0.5) * 8;        // ±4° around Y axis
      tx = (0.5 - y) * 6;        // ±3° around X axis
    };
    const onPointerLeave = () => { tx = 0; ty = 0; };

    // Device orientation — beta = front/back tilt, gamma = left/right tilt.
    const onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      // Clamp to keep tilt subtle. Beta is 0..180 (phone flat→upright); we map
      // the comfort zone (0..40°) to ±3°. Gamma is -90..90; clamp to ±20° → ±4°.
      const beta = Math.max(-40, Math.min(40, e.beta - 20));
      const gamma = Math.max(-20, Math.min(20, e.gamma));
      tx = (beta / 40) * 3;
      ty = (gamma / 20) * 4;
    };

    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerleave", onPointerLeave);
    // Only attach orientation listener on actual touch devices to avoid
    // spurious events on hybrid laptops with accelerometers.
    const isTouch = "ontouchstart" in window;
    if (isTouch && typeof window.addEventListener === "function") {
      window.addEventListener("deviceorientation", onOrient, true);
    }

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", onPointerLeave);
      if (isTouch) window.removeEventListener("deviceorientation", onOrient, true);
    };
  }, []);

  return (
    <header
      ref={ref}
      className="hero-3d bg-primary text-primary-foreground relative"
      style={(theme?.hero_bg_color || theme?.hero_text_color)
        ? { backgroundColor: theme?.hero_bg_color || undefined, color: theme?.hero_text_color || undefined }
        : undefined}
      data-testid="restaurant-hero"
    >
      {/* Inner wrapper carries the tilt transform so the parent's gradient
          surface (and overflow) stays put while the content embosses. */}
      <div
        ref={inner}
        className="max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8 relative z-[1]"
        style={{ transformStyle: "preserve-3d", willChange: "transform" }}
      >
        {/* Row 1 — efoodcare restaurant overline (LEFT) ↔ tiny 100% Pure Veg badge (RIGHT).
            The Pure Veg badge leads with the eFoodCare logo on the LEFT,
            then a tiny dot, then the "100% Pure Veg" label. Both badge and
            label are styled in 3D (badge-3d + text-3d-pureveg). */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] sm:text-base tracking-wider uppercase font-extrabold flex items-center gap-1.5 min-w-0 truncate">
            <ChefHat className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" /> {theme?.hero_overline || "efoodcare restaurant"}
          </p>
          <span
            className="pure-veg-3d inline-flex items-center gap-1 rounded pl-1 pr-1.5 py-0.5 text-[9px] sm:text-[10px] font-extrabold tracking-wide uppercase flex-shrink-0"
            style={{
              backgroundColor: theme?.pure_veg_bg_color || "rgba(255,255,255,0.95)",
              color: theme?.pure_veg_color || "#057a3a",
            }}
            data-testid="pure-veg-badge"
          >
            <img
              src={BRAND_LOGO_URL}
              alt="eFoodCare"
              className="pure-veg-logo-3d h-3.5 w-3.5 rounded-sm flex-shrink-0"
              data-testid="pure-veg-logo"
            />
            <span aria-hidden className="opacity-60 text-[10px] leading-none">·</span>
            <span className="pure-veg-label-3d">{theme?.pure_veg_label || "100% Pure Veg"}</span>
          </span>
          <span className="sr-only" data-testid="zero-bad-stuff">100% Pure Veg</span>
        </div>

        {/* Row 2 — Title + tagline (overline pulled up to row 1) */}
        <div className="mt-1.5">
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight lowercase leading-tight">
            {theme?.hero_title || "order online · ghar se accha khana"}
          </h1>
          <p
            className="-mt-0.5 text-[16px] sm:text-xl italic font-bold leading-snug"
            data-testid="hero-hindi-quote"
            lang="hi"
          >
            <span aria-hidden className="mr-1 text-yellow-200">“</span>
            {theme?.hero_promise_line1 || "हम टाइम लेते हैं पर फ्रेश लातें हैं"}
            <span aria-hidden className="ml-1 text-yellow-200">”</span>
          </p>
          <p className="opacity-95 text-[13px] sm:text-base mt-2 flex items-center gap-1.5 leading-snug">
            <Truck className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
            <span className="truncate">
              {theme?.hero_tagline || `Free delivery on orders over ₹${meta.delivery_free_over} · ₹${meta.delivery_fee_flat} otherwise`}
            </span>
          </p>
        </div>

        {/* Row 3 — 90-min banner */}
        <div
          className="badge-3d mt-2.5 inline-flex items-center gap-2 rounded-full px-3 py-1"
          style={{
            backgroundColor: theme?.ninety_min_bg_color || "#059669",
            color: theme?.ninety_min_text_color || "#ffffff",
          }}
          data-testid="ninety-min-banner"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/95 text-emerald-700 text-[11px] font-extrabold">⏱</span>
          <span className="text-[12px] sm:text-sm font-extrabold tracking-tight">
            {theme?.hero_delivery_badge || "90 minutes Fresh Meal Delivery"}
          </span>
        </div>
      </div>
    </header>
  );
}
