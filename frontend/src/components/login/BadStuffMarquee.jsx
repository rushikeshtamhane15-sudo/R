import React from "react";

/**
 * BadStuffMarquee — full-bleed horizontal scroller listing the brand
 * "0% bad stuff" promise. Renders TWICE (`duplicate` track) so the
 * CSS keyframe `bad-stuff-marquee-scroll` can move -50% for seamless loop.
 *
 * Iter-52: all layout uses inline styles instead of CSS classes — this
 * avoids the iter-51 regression where `.bad-stuff-marquee-track` was being
 * computed at width=0 because of a Tailwind/CSS layer specificity conflict
 * that we couldn't easily debug. Inline styles win regardless.
 *
 * Props:
 *   pills:               Array<string> | "|"-delimited string
 *   bgColor:             outer container background (default brand-red)
 *   textColor:           pill label color
 *   pillBgColor:         pill background (default solid white)
 *   pillBorderColor:     pill border color
 *   pillTextColor:       optional override for pill text color
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
  pillBgColor = "#ffffff",
  pillBorderColor = "rgba(255,255,255,0.95)",
  pillTextColor,
  speedSeconds = 12,
}) {
  const items = parsePills(pills);
  // Duplicate so the -50% scroll loops seamlessly.
  const doubled = [...items, ...items];
  const dur = Math.max(4, Number(speedSeconds) || 12);
  const finalPillTextColor = pillTextColor || textColor;
  return (
    <div
      style={{
        backgroundColor: bgColor,
        color: textColor,
        overflow: "hidden",
        width: "100%",
        padding: "10px 0",
        pointerEvents: "none",
      }}
      data-testid="bad-stuff-marquee"
    >
      <div
        style={{
          display: "flex",
          flexWrap: "nowrap",
          gap: "12px",
          width: "max-content",
          animation: `bad-stuff-marquee-scroll ${dur}s linear infinite`,
          willChange: "transform",
        }}
      >
        {doubled.map((text, i) => (
          <span
            key={i}
            style={{
              backgroundColor: pillBgColor,
              border: `1px solid ${pillBorderColor}`,
              color: finalPillTextColor,
              display: "inline-flex",
              alignItems: "center",
              padding: "6px 14px",
              borderRadius: "9999px",
              fontFamily: "var(--font-display, 'Cabinet Grotesk'), system-ui, sans-serif",
              fontWeight: 800,
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
