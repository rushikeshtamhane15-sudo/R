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
  // Soft navy gradient badge for the SaaS platform brand.
  icon_bg_color_start: "#e0e8ff",
  icon_bg_color_end:   "#c7d2fe",
  icon_color:          "#0a1f44",
  icon_show: true,

  // Bad-stuff marquee is now per-mess — leave blank on the platform default.
  marquee_show: false,
  marquee_pills: "",
};
