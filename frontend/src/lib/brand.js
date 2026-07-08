// Brand assets — single source of truth
// Served from /public so it is bundled with the frontend build and cannot be
// broken by external CDN URL rotations. Update the file in
// /app/frontend/public/brand-logo.jpg to change the brand icon.
//
// BRAND_LOGO_URL  — the "app icon" mark (red rounded-square, iter-131 upload).
//                   Used EVERYWHERE except the site header and the "PURE VEG"
//                   certification tag. Overridable at runtime via the
//                   BrandingContext (populated from /api/branding).
// HEADER_LOGO_URL — the icon used ONLY in the top navigation Header.
//                   Kept as a SEPARATE constant (never affected by the
//                   admin BrandingContext), but points to the same
//                   bundled `/brand-logo.jpg` file so it (a) always loads
//                   even when the CDN is unreachable, and (b) can never
//                   flash a broken-image glyph on cold production loads.
export const BRAND_LOGO_URL = "/brand-logo.jpg";
export const HEADER_LOGO_URL = "/brand-logo.jpg";
