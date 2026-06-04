import React, { useEffect, useRef } from "react";
import { ChefHat, Truck } from "lucide-react";
import { BRAND_LOGO_URL } from "../../lib/brand";

/**
 * HeroPanel — top "red plate" of /restaurant.
 *
 * Layout is admin-editable via theme.hero_layout (template picker) +
 * theme.hero_elements (per-element order, visibility, alignment, free
 * positioning offsets). When `hero_elements` is unset, falls back to the
 * default top-row Pure-Veg + overline → title → quote → tagline → 90-min.
 *
 * Free positioning ranges (intentionally clamped tight to keep things
 * responsive across mobile/desktop):
 *   • align: "left" | "center" | "right"
 *   • x_offset_pct: -50..50 (% of inner container width)
 *   • y_offset_px:  -40..40 (pixels)
 */

const DEFAULT_ELEMENTS = [
  { key: "pure_veg_overline", visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
  { key: "title",            visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
  { key: "hindi_quote",      visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
  { key: "tagline",          visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
  { key: "ninety_min",       visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
];

// Layout templates control inner-container alignment/padding/maxWidth.
const LAYOUT_TEMPLATES = {
  default:          { className: "max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8 text-left" },
  centered:         { className: "max-w-3xl mx-auto px-4 sm:px-5 py-8 sm:py-10 text-center" },
  "stacked-compact":{ className: "max-w-6xl mx-auto px-4 sm:px-5 py-3 sm:py-4 text-left" },
  split:            { className: "max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8 text-left" },
};

function alignClass(a) {
  return a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";
}

function offsetStyle(el) {
  const x = Number(el?.x_offset_pct || 0);
  const y = Number(el?.y_offset_px || 0);
  if (!x && !y) return undefined;
  // Clamp to sane bounds
  const cx = Math.max(-50, Math.min(50, x));
  const cy = Math.max(-40, Math.min(40, y));
  return { transform: `translate(${cx}%, ${cy}px)` };
}

export default function HeroPanel({ theme, meta }) {
  const ref = useRef(null);
  const inner = useRef(null);

  // Apply tilt on each frame — pointer (desktop) + device orientation (touch).
  useEffect(() => {
    const el = ref.current;
    const innerEl = inner.current;
    if (!el || !innerEl) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let rx = 0, ry = 0, tx = 0, ty = 0, raf = 0;
    const apply = () => {
      rx += (tx - rx) * 0.10;
      ry += (ty - ry) * 0.10;
      innerEl.style.setProperty("--hero-rx", `${rx.toFixed(2)}deg`);
      innerEl.style.setProperty("--hero-ry", `${ry.toFixed(2)}deg`);
      innerEl.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      raf = requestAnimationFrame(apply);
    };
    raf = requestAnimationFrame(apply);

    const onPointerMove = (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      ty = (x - 0.5) * 8;
      tx = (0.5 - y) * 6;
    };
    const onPointerLeave = () => { tx = 0; ty = 0; };
    const onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      const beta = Math.max(-40, Math.min(40, e.beta - 20));
      const gamma = Math.max(-20, Math.min(20, e.gamma));
      tx = (beta / 40) * 3;
      ty = (gamma / 20) * 4;
    };

    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerleave", onPointerLeave);
    const isTouch = "ontouchstart" in window;
    if (isTouch) window.addEventListener("deviceorientation", onOrient, true);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", onPointerLeave);
      if (isTouch) window.removeEventListener("deviceorientation", onOrient, true);
    };
  }, []);

  const elements = Array.isArray(theme?.hero_elements) && theme.hero_elements.length > 0
    ? theme.hero_elements
    : DEFAULT_ELEMENTS;
  const layoutKey = theme?.hero_layout && LAYOUT_TEMPLATES[theme.hero_layout] ? theme.hero_layout : "default";
  const layout = LAYOUT_TEMPLATES[layoutKey];

  const renderEl = (el, idx) => {
    if (el.visible === false) return null;
    const wrapClass = `${alignClass(el.align)}`;
    const wrapStyle = offsetStyle(el);
    switch (el.key) {
      case "pure_veg_overline":
        return (
          <div key={`${el.key}-${idx}`} className={`flex items-center justify-between gap-3 ${wrapClass}`} style={wrapStyle} data-testid="hero-row-pureveg-overline">
            <p className="text-[12px] sm:text-base tracking-wider uppercase font-extrabold flex items-center gap-1.5 min-w-0 truncate">
              <ChefHat className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" /> {theme?.hero_overline || "efoodcare restaurant"}
            </p>
            <span
              className="pure-veg-3d inline-flex items-center gap-1 rounded pl-1 pr-1.5 py-0.5 text-[9px] sm:text-[10px] font-extrabold tracking-wide uppercase flex-shrink-0"
              style={(theme?.pure_veg_color || theme?.pure_veg_bg_color) ? {
                backgroundColor: theme?.pure_veg_bg_color || undefined,
                color: theme?.pure_veg_color || undefined,
              } : undefined}
              data-testid="pure-veg-badge"
            >
              <img
                src={BRAND_LOGO_URL}
                alt="efoodcare"
                className="pure-veg-logo-3d h-3.5 w-3.5 rounded-sm flex-shrink-0"
                data-testid="pure-veg-logo"
              />
              <span aria-hidden className="opacity-60 text-[10px] leading-none">·</span>
              <span className="pure-veg-label-3d">{theme?.pure_veg_label || "101% Pure Veg"}</span>
            </span>
            <span className="sr-only" data-testid="zero-bad-stuff">101% Pure Veg</span>
          </div>
        );
      case "title":
        return (
          <h1 key={`${el.key}-${idx}`} className={`font-display font-extrabold text-2xl sm:text-3xl tracking-tight lowercase leading-tight mt-1.5 ${wrapClass}`} style={wrapStyle} data-testid="hero-title">
            {theme?.hero_title || "order online · ghar se accha khana"}
          </h1>
        );
      case "hindi_quote":
        return (
          <p
            key={`${el.key}-${idx}`}
            className={`-mt-0.5 text-[16px] sm:text-xl italic font-bold leading-snug ${wrapClass}`}
            style={wrapStyle}
            data-testid="hero-hindi-quote"
            lang="hi"
          >
            <span aria-hidden className="mr-1 text-white">“</span>
            {theme?.hero_promise_line1 || "हम टाइम लेते हैं पर फ्रेश लातें हैं"}
            <span aria-hidden className="ml-1 text-white">”</span>
          </p>
        );
      case "tagline":
        return (
          <p key={`${el.key}-${idx}`} className={`opacity-95 text-[13px] sm:text-base mt-2 leading-snug ${wrapClass}`} style={wrapStyle} data-testid="hero-tagline">
            <span className="inline-flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              {theme?.hero_tagline || `Free delivery on orders over ₹${meta.delivery_free_over} · ₹${meta.delivery_fee_flat} otherwise`}
            </span>
          </p>
        );
      case "ninety_min":
        return (
          <div key={`${el.key}-${idx}`} className={`mt-2.5 ${wrapClass}`} style={wrapStyle}>
            <div
              className="badge-3d inline-flex items-center gap-2 rounded-full px-3 py-1"
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
        );
      default:
        return null;
    }
  };

  return (
    <header
      ref={ref}
      className="hero-3d bg-primary text-primary-foreground relative"
      style={(theme?.hero_bg_color || theme?.hero_text_color)
        ? { backgroundColor: theme?.hero_bg_color || undefined, color: theme?.hero_text_color || undefined }
        : undefined}
      data-testid="restaurant-hero"
    >
      <div
        ref={inner}
        className={`${layout.className} relative z-[1]`}
        style={{ transformStyle: "preserve-3d", willChange: "transform" }}
        data-testid={`hero-layout-${layoutKey}`}
      >
        {elements.map((el, idx) => renderEl(el, idx))}
      </div>
    </header>
  );
}
