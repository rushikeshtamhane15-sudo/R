import React from "react";

/**
 * eFoodTech logo concept marks — iter-181
 *
 * Three professional SVG concept logos for the eFoodTech brand.
 * Each is a self-contained React component so it can be swapped into the
 * header (`<Header/>`) by importing the desired variant.
 *
 * Concept themes:
 *   - Concept A · "Plate + QR" — the food plate becomes a stylised QR grid
 *     for the check-in kiosk metaphor. Primary red on white.
 *   - Concept B · "Meal Ring" — a soft ring of dots (subscribers) around a
 *     wordmark "ef" nucleus — hints at the multi-tenant SaaS.
 *   - Concept C · "Chai Chip" — a warm tag/chip shape (like a mess token)
 *     with a subtle steam curl on top — feels distinctly Indian and homely.
 *
 * Each takes `size` (px) and `className` props. Pick the one you like and
 * we'll wire it into Header.jsx and Splash.jsx.
 */

export function EFoodTechLogoA({ size = 40, className = "" }) {
  // Plate + QR combo. Red ring frames a QR grid, with a small utensil
  // silhouette carved out of the top-right corner.
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-label="eFoodTech logo · plate + QR" role="img">
      <defs>
        <linearGradient id="a-plate" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a02323" />
          <stop offset="1" stopColor="#7a1418" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#a-plate)" />
      {/* QR grid — 5x5 stylised */}
      <g fill="#fff">
        {[
          [12,12],[16,12],[24,12],[36,12],[44,12],[48,12],
          [12,16],[20,16],[24,16],[32,16],[44,16],[48,16],
          [12,24],[16,24],[24,24],[28,24],[36,24],[44,24],
          [12,32],[20,32],[28,32],[32,32],[40,32],[48,32],
          [12,40],[24,40],[28,40],[32,40],[44,40],[48,40],
          [12,48],[16,48],[24,48],[36,48],[44,48],[48,48],
        ].map(([x,y],i) => <rect key={i} x={x} y={y} width="4" height="4" rx="0.6" />)}
      </g>
      {/* Little amber steam blip in top-right for the "food" cue */}
      <circle cx="49" cy="15" r="4" fill="#fbbf24" />
    </svg>
  );
}

export function EFoodTechLogoB({ size = 40, className = "" }) {
  // Meal Ring — a soft ring of colored dots (subscribers) around a bold
  // "ef" nucleus. Feels like a SaaS network mark.
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-label="eFoodTech logo · meal ring" role="img">
      <defs>
        <linearGradient id="b-core" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#b91c1c" />
          <stop offset="1" stopColor="#4c0f14" />
        </linearGradient>
      </defs>
      {/* Ring of 12 dots */}
      <g>
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
          const cx = 32 + Math.cos(a) * 26;
          const cy = 32 + Math.sin(a) * 26;
          const isAccent = i % 3 === 0;
          return (
            <circle key={i} cx={cx} cy={cy} r={isAccent ? 3 : 2}
              fill={isAccent ? "#fbbf24" : "#a02323"} opacity={isAccent ? 1 : 0.85} />
          );
        })}
      </g>
      {/* Nucleus */}
      <circle cx="32" cy="32" r="18" fill="url(#b-core)" />
      <text x="32" y="39" fill="#fff" fontFamily="ui-sans-serif, system-ui" fontSize="17" fontWeight="900" letterSpacing="-1" textAnchor="middle">ef</text>
    </svg>
  );
}

export function EFoodTechLogoC({ size = 40, className = "" }) {
  // Chai Chip — a stylised token-shaped chip (like a mess coupon) tilted,
  // with a steam curl on top. Warm, homely, distinctly Indian.
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-label="eFoodTech logo · chai chip" role="img">
      <defs>
        <linearGradient id="c-chip" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e11d48" />
          <stop offset="1" stopColor="#7a1418" />
        </linearGradient>
      </defs>
      {/* Steam curls */}
      <path d="M22 8 Q26 4, 24 -1" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M32 6 Q36 2, 34 -3" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M42 8 Q46 4, 44 -1" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.7" />
      {/* Chip body — hexagonal-ish rounded rect */}
      <g transform="rotate(-8 32 34)">
        <rect x="10" y="18" width="44" height="34" rx="9" fill="url(#c-chip)" />
        {/* Notch */}
        <circle cx="10" cy="35" r="4" fill="#ffffff" />
        <circle cx="54" cy="35" r="4" fill="#ffffff" />
        {/* Text */}
        <text x="32" y="41" fill="#fff" fontFamily="ui-sans-serif, system-ui" fontSize="15" fontWeight="900" letterSpacing="0" textAnchor="middle">ef</text>
        <line x1="18" y1="46" x2="46" y2="46" stroke="#fff" strokeWidth="1" opacity="0.5" />
      </g>
    </svg>
  );
}

/** Combined preview card used on the internal `/dev/logo-preview` route
 *  so you can see all three side-by-side and pick a winner. */
export default function LogoPreview() {
  return (
    <div className="min-h-screen bg-slate-50 p-8 flex flex-col items-center gap-8" data-testid="logo-preview">
      <h1 className="font-display font-black text-3xl">eFoodTech · logo concepts</h1>
      <p className="text-slate-600 text-sm max-w-md text-center">Pick a favourite and reply with A / B / C — we'll wire it into the header + splash.</p>
      <div className="grid sm:grid-cols-3 gap-8 max-w-4xl w-full">
        {[
          { L: EFoodTechLogoA, name: "Concept A — Plate + QR",   pitch: "Techy · direct · signals check-in kiosk." },
          { L: EFoodTechLogoB, name: "Concept B — Meal Ring",    pitch: "SaaS-network mark · warmer typography." },
          { L: EFoodTechLogoC, name: "Concept C — Chai Chip",    pitch: "Distinctly Indian · mess-coupon vibe." },
        ].map(({ L, name, pitch }) => (
          <div key={name} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col items-center gap-4">
            <L size={96} />
            <div className="text-center">
              <p className="font-display font-black text-base text-slate-900">{name}</p>
              <p className="text-xs text-slate-500 mt-1">{pitch}</p>
            </div>
            {/* Wordmark preview */}
            <div className="flex items-center gap-2.5 pt-3 border-t border-slate-100 w-full">
              <L size={36} />
              <div>
                <p className="font-display font-black text-lg text-slate-900 leading-none">efoodtech</p>
                <p className="text-[9px] uppercase tracking-widest text-slate-400">multi-tenant SaaS</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
