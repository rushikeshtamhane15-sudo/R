import React from "react";

/**
 * Decorative "0% the bad stuff" halo for /login.
 *
 * Renders 8 small circular 3D pills arranged on a circle around the login
 * card. Each pill carries one of our "never on your plate" ingredients
 * (sourced from server.py `healthy_never_items`) prefixed with "0%". The
 * pills float gently and tilt independently — together they ring the login
 * card like a brand promise halo.
 *
 * `aria-hidden` + `pointer-events: none` so the decoration never captures
 * clicks or keyboard focus.
 */
const BAD_STUFF = [
  "Ajinomoto",
  "Maida",
  "Artificial Flavours",
  "Artificial Colours",
  "Polished Grains",
  "Refined Oil",
  "Palm Oil",
  "Pre-made Gravy",
];

export default function BadStuffBackground() {
  // Pre-compute trig per pill so the layout is deterministic. We anchor each
  // pill on a circle of radius `r%` from the centre of the parent box.
  const n = BAD_STUFF.length;
  const radius = 38; // % of the smaller side from the centre
  return (
    <div
      className="bad-stuff-bg"
      aria-hidden
      data-testid="bad-stuff-watermark"
    >
      {BAD_STUFF.map((label, i) => {
        // Distribute pills evenly on the circle, starting from the top.
        const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
        const x = 50 + radius * Math.cos(angle);
        const y = 50 + radius * Math.sin(angle);
        // Slight per-pill tilt for organic feel
        const tilt = ((i % 2 === 0) ? -6 : 6) + (i - n / 2) * 1.2;
        const dur = 6 + (i % 3) * 1.5;
        const delay = i * 0.35;
        return (
          <span
            key={label}
            className="bad-stuff-pill"
            style={{
              top: `${y}%`,
              left: `${x}%`,
              "--rot": `${tilt}deg`,
              "--dur": `${dur}s`,
              "--delay": `${delay}s`,
            }}
            data-testid={`bad-stuff-pill-${i}`}
          >
            <span className="bad-stuff-pill-zero">0%</span>
            <span className="bad-stuff-pill-label">{label}</span>
          </span>
        );
      })}
    </div>
  );
}
