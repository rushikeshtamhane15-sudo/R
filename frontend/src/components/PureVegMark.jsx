import React from "react";

/**
 * PureVegMark — the standard Indian "vegetarian" food-safety symbol:
 * a green filled circle inside a green square border. Renders as
 * scalable inline SVG so it stays crisp at any size.
 *
 * Used by HeroPanel's "Pure Veg" badge and the site Footer's FSSAI card.
 * Kept intentionally decoupled from BRAND_LOGO_URL so a brand-logo swap
 * from the admin panel never affects this certification mark.
 */
export function PureVegMark({ className = "h-4 w-4", strokeColor = "#065f46", fillColor = "#059669", "data-testid": testId }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Pure Vegetarian"
      data-testid={testId}
    >
      <rect x="1.5" y="1.5" width="21" height="21" rx="2" ry="2" fill="#ffffff" stroke={strokeColor} strokeWidth="2" />
      <circle cx="12" cy="12" r="6" fill={fillColor} />
    </svg>
  );
}

export default PureVegMark;
