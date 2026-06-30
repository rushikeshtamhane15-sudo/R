// Default CMS content for the Login page — overridable via /api/content/login.
// Extracted from Login.jsx (iter-123) so the page file stays focused on
// state + behaviour; admin content lives separately for clarity.

export const LOGIN_DEFAULTS = {
  title_line1: "Login or",
  title_line2: "Sign up",
  form_overline: "Enter your details",
  form_heading: "India's smartest tiffin pass.",
  form_subheading: "Login with your phone number to continue.",
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
  // The small badge above the form. Defaults to a soft cream/pink gradient
  // with brand-red foreground so the icon reads warm-and-inviting rather
  // than the older corporate navy shield. Admin can override these via
  // /admin/content/login or set icon_show=false to hide the badge entirely.
  icon_bg_color_start: "#fff4ee",
  icon_bg_color_end:   "#ffd9c8",
  icon_color:          "#a02323",
  icon_show: true,

  // === BadStuffMarquee (admin-editable, iter-51) ===
  // The full-bleed "0% bad stuff" scroller below the red header. Admin
  // can change pill list, colors, and speed from /admin/content/login.
  marquee_show: true,
  marquee_bg_color:          "#a02323",
  marquee_text_color:        "#a02323",
  marquee_pill_bg_color:     "#ffffff",
  marquee_pill_border_color: "rgba(255,255,255,0.95)",
  marquee_pill_text_color:   "#a02323",
  marquee_speed_seconds:     12,
  marquee_pills: "0% Ajinomoto|0% Maida|0% Artificial Flavours|0% Artificial Colours|0% Polished Grains|0% Refined Oil|0% Palm Oil|0% Pre-made Gravy",
};
