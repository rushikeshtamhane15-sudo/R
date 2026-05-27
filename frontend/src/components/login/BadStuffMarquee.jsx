import React from "react";

/**
 * BadStuffMarquee — full-bleed horizontal scroller listing the brand
 * "0% bad stuff" promise. Renders TWICE (`duplicate` track) so the
 * CSS keyframe `bad-stuff-marquee-scroll` can move -50% for seamless loop.
 *
 * Iter-51: every visual is admin-editable via /admin/content/login —
 * pill list, container bg, text + pill colors, animation speed.
 *
 * Props:
 *   pills:               Array<string> | string with "|" delimiter
 *   bgColor:             outer container background (default brand-red)
 *   textColor:           pill label color
 *   pillBgColor:         pill background (default translucent white)
 *   pillBorderColor:     pill border color
 *   speedSeconds:        number, lower = faster (default 12)
 */

const DEFAULT_PILLS = [
  "0% Ajinomoto", "0% Maida", "0% Artificial Flavours", "0% Artificial Colours",
  "0% Polished Grains", "0% Refined Oil", "0% Palm Oil", "0% Pre-made Gravy",
];

function parsePills(pills) {
  if (Array.isArray(pills) && pills.length > 0) return pills;
  if (typeof pills === "string" && pills.trim()) {
    return pills.split("|").map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_PILLS;
}

export default function BadStuffMarquee({
  pills,
  bgColor = "#a02323",
  textColor = "#ffffff",
  pillBgColor = "rgba(255,255,255,0.12)",
  pillBorderColor = "rgba(255,255,255,0.35)",
  speedSeconds = 12,
}) {
  const items = parsePills(pills);
  // Duplicate so the -50% scroll loops seamlessly.
  const doubled = [...items, ...items];
  return (
    <div
      className="bad-stuff-marquee"
      style={{ backgroundColor: bgColor, color: textColor }}
      data-testid="bad-stuff-marquee"
    >
      <div
        className="bad-stuff-marquee-track"
        style={{ animationDuration: `${Math.max(4, Number(speedSeconds) || 12)}s` }}
      >
        {doubled.map((text, i) => (
          <span
            key={i}
            className="bad-stuff-pill"
            style={{
              backgroundColor: pillBgColor,
              border: `1px solid ${pillBorderColor}`,
              color: textColor,
            }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
