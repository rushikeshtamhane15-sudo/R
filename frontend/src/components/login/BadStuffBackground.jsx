import React from "react";

/**
 * Subtle, decorative background watermark for /login.
 *
 * Renders the "0% the bad stuff" list (referenced from server.py
 * `healthy_never_items`) as low-opacity 3D-extruded words scattered across
 * the page, each with a thin red diagonal strike-through to communicate
 * "we never put this in your plate". Decorative only — `aria-hidden` and
 * `pointer-events: none`.
 *
 * The list mirrors what we surface in the landing-page "Our kitchen promise"
 * section to keep the brand promise consistent across surfaces.
 */
const WORDS = [
  { text: "Ajinomoto",        top: "8%",   left: "6%",   size: 56, rot: -8 },
  { text: "Maida",            top: "18%",  left: "72%",  size: 48, rot: 6 },
  { text: "Artificial Flavours", top: "30%",  left: "2%",   size: 40, rot: -5 },
  { text: "Artificial Colours",  top: "44%",  left: "70%",  size: 36, rot: 4 },
  { text: "Polished Grains",  top: "60%",  left: "4%",   size: 42, rot: -7 },
  { text: "Refined Oil",      top: "72%",  left: "65%",  size: 50, rot: 5 },
  { text: "Palm Oil",         top: "84%",  left: "10%",  size: 44, rot: -6 },
  { text: "Pre-made Gravy",   top: "92%",  left: "55%",  size: 38, rot: 7 },
];

export default function BadStuffBackground() {
  return (
    <div
      className="bad-stuff-bg"
      aria-hidden
      data-testid="bad-stuff-watermark"
    >
      {WORDS.map((w, i) => (
        <span
          key={w.text}
          className="bad-stuff-word"
          style={{
            top: w.top,
            left: w.left,
            fontSize: `${w.size}px`,
            // CSS vars consumed by the keyframes for per-word tilt + cadence
            "--rot": `${w.rot}deg`,
            "--dur": `${7 + (i % 3) * 1.5}s`,
            "--delay": `${i * 0.4}s`,
          }}
        >
          {w.text}
        </span>
      ))}
    </div>
  );
}
