import React from "react";

/**
 * TrustChipsMarquee — iter-63 #6
 *
 * Lifted out of `pages/Restaurant.jsx` so the same emerald trust-chips
 * marquee can be reused on the login page (replacing the louder
 * `BadStuffMarquee`) and removed from the home page.
 */
const TRUST_CHIPS = [
  "0% Ajinomoto",
  "0% Maida",
  "No Artificial Flavours",
  "No Artificial Colour",
  "No Refined & Palm Oil",
  "0% Polished Grains",
  "100% Fresh Vegetables",
  "No Pre Made Gravy",
];

export default function TrustChipsMarquee({ className = "", testid = "trust-chips" }) {
  return (
    <section className={`overflow-hidden ${className}`} data-testid={testid}>
      <div className="flex items-center gap-2 animate-trust-marquee py-1" style={{ width: "max-content" }}>
        {[...TRUST_CHIPS, ...TRUST_CHIPS].map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="flex-shrink-0 text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wide rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/40"
            data-testid={i < TRUST_CHIPS.length ? `trust-chip-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : undefined}
          >
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
