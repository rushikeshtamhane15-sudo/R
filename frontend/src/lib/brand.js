// Brand assets — single source of truth
// Served from /public so it is bundled with the frontend build and cannot be
// broken by external CDN URL rotations. Update the file in
// /app/frontend/public/brand-logo.jpg to change the brand icon.
//
// BRAND_LOGO_URL  — the "app icon" mark (red rounded-square, iter-131 upload).
//                   Used EVERYWHERE except the site header and the "PURE VEG"
//                   certification tag.
// HEADER_LOGO_URL — the original efoodcare wordmark logo. Used ONLY in the
//                   Header (and the SplashScreen keeps its own copy of this
//                   URL inline for animation isolation).
export const BRAND_LOGO_URL = "/brand-logo.jpg";
export const HEADER_LOGO_URL =
  "https://customer-assets.emergentagent.com/job_dining-pass-scan/artifacts/uzs344m6_9a705f5a-b3a0-4286-b51d-b9bd6f55b7bb_20260504_011957_0000.png";
