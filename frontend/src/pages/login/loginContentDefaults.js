// Default CMS content for the Login page — overridable via /api/content/login.
// iter-143 · efoodtech: rebranded from efoodcare with mess-agnostic defaults.
// Per-mess overrides (e.g. custom tagline chips) live on each mess document
// and are picked up after mess selection.

export const LOGIN_DEFAULTS = {
  title_line1: "Welcome to",
  title_line2: "efoodtech",
  form_overline: "Pick your mess to continue",
  form_heading: "User Management System",
  form_subheading: "Enter your phone number to log in.",
  phone_label: "Phone number",
  phone_placeholder: "Enter 10-digit number",
  name_label: "Your name",
  name_optional_label: "(optional)",
  name_placeholder: "e.g. Aman Gupta",
  cta_label: "Continue",
  or_divider: "Or",
  google_label: "Continue with Google",
  terms_prefix: "By continuing, you agree to our",
  terms_separator: "and",
  verify_overline: "Verify OTP",
  verify_heading: "Enter the 6-digit code",
  verify_cta_label: "Verify & Continue",
  resend_prompt: "Didn't get it?",
  resend_label: "Resend OTP",

  // === Login icon (admin-editable) ===
  // Soft red gradient badge for the SaaS platform brand.
  icon_bg_color_start: "#fee2e2",
  icon_bg_color_end:   "#fecaca",
  icon_color:          "#a02323",
  icon_show: true,

  // === Legacy hero visuals (iter-158f) ===
  // iter-158h: chip row removed by default per user — leave empty so the
  // row does not render. Super-admin can re-enable via CMS by adding
  // comma-separated labels (e.g. "FRESH DAILY, NO ADULTERATION").
  chips: "",
  // Red delivery ribbon below the card — kept short/mobile-first.
  delivery_banner: "One step away from ghar se accha khana",
  // Avatar bubble on the card
  avatar_show: true,
  avatar_url: "",   // fallback to lucide User icon when blank

  // iter-148: Super-admin editable announcement bar between header + form.
  announcement_bar: "India's first Fully technologically advanced user management software for mess and restaurants",

  // Bad-stuff marquee is now per-mess — leave blank on the platform default.
  marquee_show: false,
  marquee_pills: "",
};
