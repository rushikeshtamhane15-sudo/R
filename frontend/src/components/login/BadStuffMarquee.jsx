import React from "react";

/**
 * Login-page "0% the bad stuff" marquee.
 *
 * Replaces the circular halo with a continuously-scrolling horizontal strip
 * of pills naming every ingredient we never put in your plate. Pills are
 * decorative (aria-hidden + pointer-events: none) so they never capture
 * focus or block taps.
 *
 * Reference: same list as server.py `healthy_never_items` and the landing
 * page "0% the bad stuff" card — keeps the brand promise consistent.
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

export default function BadStuffMarquee() {
  return (
    <div
      className="bad-stuff-marquee"
      aria-hidden
      data-testid="bad-stuff-marquee"
    >
      {/* Render the list twice so the CSS @keyframes can scroll seamlessly
          from 0% → -50% without a visible jump back to start. */}
      <div className="bad-stuff-marquee-track">
        {[...BAD_STUFF, ...BAD_STUFF].map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="bad-stuff-pill-mq"
            data-testid={i < BAD_STUFF.length ? `bad-stuff-marquee-pill-${i}` : undefined}
          >
            <span className="bad-stuff-pill-zero">0%</span>
            <span className="bad-stuff-pill-label">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
