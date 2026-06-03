import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { readCmsCache, writeCmsCache } from "../lib/cms-cache";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, User as UserIcon, KeyRound } from "lucide-react";
import { GoogleLogin, useGoogleOneTapLogin } from "@react-oauth/google";
import BadStuffMarquee from "../components/login/BadStuffMarquee";
import SEO from "../components/SEO";

const HERO_FOOD_IMG = "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?crop=entropy&cs=srgb&fm=jpg&q=85&w=1400";

const DEFAULTS = {
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
  icon_bg_color_end: "#ffd9c8",
  icon_color: "#a02323",
  icon_show: true,
  // === BadStuffMarquee (admin-editable, iter-51) ===
  // The full-bleed "0% bad stuff" scroller below the red header. Admin
  // can change pill list, colors, and speed from /admin/content/login.
  marquee_show: true,
  marquee_bg_color: "#a02323",         // brand-red default per request
  marquee_text_color: "#a02323",       // pill text is brand-red on white pill
  marquee_pill_bg_color: "#ffffff",    // solid white pill stands out on red bar
  marquee_pill_border_color: "rgba(255,255,255,0.95)",
  marquee_pill_text_color: "#a02323",
  marquee_speed_seconds: 12,           // animation duration; lower = faster
  // Pill labels — pipe-separated for easy admin editing in a single field.
  marquee_pills: "0% Ajinomoto|0% Maida|0% Artificial Flavours|0% Artificial Colours|0% Polished Grains|0% Refined Oil|0% Palm Oil|0% Pre-made Gravy",
};

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, setUser } = useAuth();

  // Decide post-login destination — `?next=/path` wins, else session-stashed
  // pending action (cart→checkout / buy-now), else cart-aware default
  // (if cart has items → /restaurant/checkout), else role-based default.
  const computeNext = (u) => {
    // Detect "cart has items" once and reuse for the entire decision.
    let hasCartItems = false;
    try {
      const cartRaw = localStorage.getItem("efc_restaurant_cart_v1");
      if (cartRaw) {
        const cart = JSON.parse(cartRaw) || {};
        hasCartItems = Object.values(cart).some((l) => (Number(l?.qty) || 0) > 0);
      }
    } catch {}

    const raw = searchParams.get("next");
    // Skip self-referential nexts ("/" and "/login*") — they would loop.
    const validNext = raw && raw.startsWith("/") && !raw.startsWith("//") &&
      raw !== "/" && !raw.startsWith("/login");

    // Role-based overrides — admin/staff/rider should always land on their
    // role home unless they were specifically deep-linking into a role-scoped
    // page (e.g. /admin/users → keep, /restaurant → upgrade to /admin).
    const role = u?.role;
    const isAdminScoped = (p) => p && (p.startsWith("/admin") || p.startsWith("/boy") || p.startsWith("/rider"));
    if (validNext && role === "admin" && !isAdminScoped(raw)) return "/admin";
    if (validNext && role === "staff" && !raw.startsWith("/admin")) return "/admin/deliveries-today";
    if (validNext && role === "rider" && !raw.startsWith("/rider")) return "/rider";

    if (validNext) {
      // Upgrade: user was on /restaurant (just menu) but has items in cart —
      // they almost certainly want to finish ordering, not browse again.
      if ((raw === "/restaurant" || raw.startsWith("/restaurant?")) && hasCartItems) {
        return "/restaurant/checkout";
      }
      return raw;
    }
    // Fallback: session-stashed pending action set by Restaurant.jsx / Header
    try {
      const pending = sessionStorage.getItem("efc_pending_action_v1");
      if (pending && pending.startsWith("/") && !pending.startsWith("//") && pending !== "/" && !pending.startsWith("/login")) {
        sessionStorage.removeItem("efc_pending_action_v1");
        // Same role-override rules as the `?next=` branch above
        if (role === "admin" && !isAdminScoped(pending)) return "/admin";
        if (role === "staff" && !pending.startsWith("/admin")) return "/admin/deliveries-today";
        if (role === "rider" && !pending.startsWith("/rider")) return "/rider";
        if ((pending === "/restaurant" || pending.startsWith("/restaurant?")) && hasCartItems) {
          return "/restaurant/checkout";
        }
        return pending;
      }
    } catch {}
    if (!u) return "/dashboard";
    if (u.role === "admin") return "/admin";
    if (u.role === "staff") return "/admin/deliveries-today";
    if (u.role === "delivery_boy") return "/boy";
    if (u.role === "rider") return "/rider";
    // Cart-aware fallback for regular subscribers — items in cart → checkout
    if (hasCartItems) return "/restaurant/checkout";
    return "/restaurant";
  };

  // If already logged in, bounce — honour ?next= when present.
  // Ref guard — set to true when verifyOtp / handleGoogle navigates here.
  // Prevents the useEffect below from firing a second (stale) navigate that
  // would overwrite the carefully-computed destination from verifyOtp.
  const verifiedHereRef = useRef(false);

  useEffect(() => {
    if (verifiedHereRef.current) return; // verifyOtp already handled it
    if (user) {
      navigate(computeNext(user), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // iter-59 #5: read cached CMS payload synchronously on first paint so the
  // hardcoded DEFAULTS don't flash before the network response.
  const [content, setContent] = useState(() => ({ ...DEFAULTS, ...(readCmsCache("/content/login") || {}) }));
  const [mode, setMode] = useState("phone"); // phone | verify
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/content/login");
        setContent({ ...DEFAULTS, ...r.data });
        writeCmsCache("/content/login", r.data);
      } catch {}
    })();
  }, []);
  const c = content;

  const sendOtp = async () => {
    const p = phone.trim();
    if (p.length < 10) {
      toast.error("Enter a valid 10-digit phone number");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post("/auth/send-otp", { phone: p });
      if (r.data.dev_otp) setDevOtp(r.data.dev_otp);
      toast.success("OTP sent");
      setMode("verify");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send OTP");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyOtp = async () => {
    if (otp.length < 4) {
      toast.error("Enter the OTP");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post("/auth/verify-otp", {
        phone: phone.trim(),
        otp: otp.trim(),
        name: name.trim() || undefined,
      });
      // CRITICAL — mark BEFORE setUser so the useEffect ([user] dep)
      // re-fire bails out, and capture dest BEFORE the state update
      // batches a re-render.
      verifiedHereRef.current = true;
      const dest = computeNext(r.data.user);
      setUser(r.data.user);
      toast.success("Welcome to efoodcare");
      navigate(dest, { replace: true, state: { user: r.data.user } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  // === Google sign-in handler ============================================
  // Shared by both the visible <GoogleLogin> button AND the auto-firing
  // useGoogleOneTapLogin hook. credential is the ID-token JWT from Google.
  const handleGoogleCredential = async (credentialResponse) => {
    const credential = credentialResponse?.credential;
    if (!credential) { toast.error("No credential from Google"); return; }
    try {
      const r = await api.post("/auth/google/verify", { credential });
      verifiedHereRef.current = true;
      const dest = computeNext(r.data.user);
      setUser(r.data.user);
      toast.success("Welcome to efoodcare");
      navigate(dest, { replace: true, state: { user: r.data.user } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Google sign-in failed");
    }
  };

  // One-Tap prompt — fires automatically (Google's UX) ONLY when:
  //   - user is anonymous (no `user` in AuthContext)
  //   - the Client ID is configured
  //   - the user hasn't already declined Google on this device (Google handles
  //     the cooldown internally).
  useGoogleOneTapLogin({
    onSuccess: handleGoogleCredential,
    disabled: !!user || !process.env.REACT_APP_GOOGLE_CLIENT_ID,
  });

  return (
    <div className="min-h-screen bg-primary flex flex-col" data-testid="login-page">
      <SEO title="Login or Sign up" path="/login" description="Login or sign up to efoodcare — India's smartest zero-adulteration tiffin pass. OTP or Google sign-in." />
      {/* HERO — dark red full-bleed top with 3D depth + extruded text. */}
      {(c.title_line1 || c.title_line2) && (
        <div className="hero-3d relative overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <img src={HERO_FOOD_IMG} alt="" className="w-full h-full object-cover opacity-25" />
            <div className="absolute inset-0 bg-gradient-to-b from-primary/95 via-primary/90 to-primary"></div>
          </div>
          <div className="max-w-md mx-auto w-full px-6 pt-6 pb-7 md:pt-8 md:pb-9 text-primary-foreground text-center">
            <h1
              className="text-3d-title font-display font-extrabold text-2xl md:text-3xl tracking-tight leading-[1.05]"
              data-testid="login-title"
            >
              {c.title_line1 && <span className="block">{c.title_line1}</span>}
              {c.title_line2 && <span className="block">{c.title_line2}</span>}
            </h1>
          </div>
        </div>
      )}

      {/* FORM SHEET — Zomato-clone style: floating white card with 3D depth.
          The "0% bad stuff" marquee sits FULL-BLEED directly below the red
          header (escapes the form-sheet horizontal padding via negative
          margins), then the compensation spacer pushes the form card back
          to its previous Y so the login form position is preserved. */}
      <div className="bg-background flex-1 px-3 sm:px-6 relative pb-12 overflow-hidden flex flex-col">
        {/* Top scrolling marquee — edge-to-edge, sits immediately below the
            red hero. `-mx-3 sm:-mx-6` cancels the parent's gutter so the
            pills sweep across the full viewport width. All visuals are
            admin-editable via /admin/content/login (iter-51). */}
        {c.marquee_show !== false && (
          <div className="w-screen -mx-3 sm:-mx-6 max-w-none" aria-hidden data-testid="login-top-marquee">
            <BadStuffMarquee
              pills={c.marquee_pills}
              bgColor={c.marquee_bg_color}
              textColor={c.marquee_text_color}
              pillBgColor={c.marquee_pill_bg_color}
              pillBorderColor={c.marquee_pill_border_color}
              speedSeconds={c.marquee_speed_seconds}
            />
          </div>
        )}
        {/* Compensation spacer — tuned to land the form card at ~Y=170px
            on 390x844 mobile, matching its pre-iter-50 position. */}
        <div aria-hidden className="h-7 sm:h-10 w-full" data-testid="announce-bar-compensator" />
        <div className="relative max-w-[280px] sm:max-w-sm mx-auto w-full">
          <div
            className="login-card-3d relative bg-card rounded-2xl px-3 py-2.5 sm:px-6 sm:py-5 z-[1]"
            data-testid="login-form-card"
          >
          {/* Login icon badge — user-silhouette, slightly larger than the
              previous shield, admin-editable bg + foreground color via
              /admin/content/login. Hidden entirely when icon_show=false. */}
          {c.icon_show !== false && (
            <div
              data-testid="login-icon-badge"
              className="mx-auto mb-5 sm:mb-5 flex items-center justify-center h-11 w-11 sm:h-14 sm:w-14 rounded-2xl"
              style={{
                background: `linear-gradient(145deg, ${c.icon_bg_color_start || "#fff4ee"} 0%, ${c.icon_bg_color_end || "#ffd9c8"} 100%)`,
                // Stronger 3D bevel — outer drop shadow + colored ambient
                // shadow + inset highlight (top) + inset shadow (bottom)
                boxShadow:
                  "0 10px 22px rgba(160,35,35,0.22), 0 4px 8px rgba(0,0,0,0.12), inset 0 2px 0 rgba(255,255,255,0.85), inset 0 -3px 4px rgba(160,35,35,0.18)",
              }}
            >
              <UserIcon
                className="h-6 w-6 sm:h-8 sm:w-8"
                style={{ color: c.icon_color || "#a02323" }}
                strokeWidth={2.1}
                data-testid="login-icon"
              />
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {mode === "phone" && (
              <motion.div
                key="phone"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                data-testid="login-choose"
              >
                <div data-testid="otp-phone-form">
                  <p className="text-[10px] sm:text-xs tracking-overline uppercase font-bold text-secondary">{c.form_overline}</p>
                  <h2 className="font-display font-extrabold text-base sm:text-xl tracking-tight mt-1 leading-tight">
                    {c.form_heading}
                  </h2>
                  <p className="hidden sm:block text-xs text-muted-foreground mt-1">{c.form_subheading}</p>

                  <label className="block text-[10px] sm:text-xs tracking-overline uppercase font-bold text-muted-foreground mt-3 sm:mt-5" htmlFor="phone-input">
                    {c.phone_label}
                  </label>
                  <div className="mt-1 sm:mt-1.5 flex items-stretch rounded-2xl border border-input bg-background overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 transition-colors">
                    <span className="flex items-center gap-1.5 pl-3 pr-2.5 sm:pl-4 sm:pr-3 text-sm font-semibold text-foreground border-r border-input bg-muted/40">
                      <span aria-hidden>🇮🇳</span> +91
                    </span>
                    <Input
                      id="phone-input"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                      placeholder={c.phone_placeholder}
                      className="border-0 focus-visible:ring-0 text-sm sm:text-base h-9 sm:h-11 px-3"
                      data-testid="phone-input"
                      inputMode="numeric"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                    />
                  </div>

                  <label className="block text-[10px] sm:text-xs tracking-overline uppercase font-bold text-muted-foreground mt-2.5 sm:mt-3.5" htmlFor="name-input">
                    {c.name_label} <span className="text-muted-foreground/70 normal-case tracking-normal font-normal">{c.name_optional_label}</span>
                  </label>
                  <Input
                    id="name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={c.name_placeholder}
                    className="mt-1 sm:mt-1.5 rounded-2xl h-9 sm:h-11 px-4 text-sm sm:text-base"
                    data-testid="name-input"
                  />

                  <Button
                    onClick={sendOtp}
                    disabled={submitting || phone.length < 10}
                    data-testid="send-otp-button"
                    className="w-full h-10 sm:h-12 mt-3 sm:mt-5 rounded-2xl bg-primary hover:bg-primary/90 font-semibold text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? "Sending OTP…" : (
                      <>
                        {c.cta_label} <ArrowRight className="h-4 w-4 ml-1.5" />
                      </>
                    )}
                  </Button>

                  <div className="flex items-center gap-3 my-2.5 sm:my-4">
                    <span className="flex-1 h-px bg-border"></span>
                    <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{c.or_divider}</span>
                    <span className="flex-1 h-px bg-border"></span>
                  </div>

                  <div
                    className="google-3d-wrap mt-2 sm:mt-3 w-full h-10 sm:h-12 rounded-2xl"
                    data-testid="google-login-button"
                  >
                    {process.env.REACT_APP_GOOGLE_CLIENT_ID ? (
                      <GoogleLogin
                        onSuccess={handleGoogleCredential}
                        onError={() => toast.error("Google sign-in failed")}
                        useOneTap={false}
                        theme="outline"
                        size="large"
                        width="100%"
                        text="continue_with"
                        shape="rectangular"
                        logo_alignment="left"
                      />
                    ) : (
                      <Button
                        variant="outline"
                        disabled
                        className="w-full h-full rounded-2xl border-input font-semibold text-xs sm:text-sm bg-background opacity-60"
                      >
                        <GoogleIcon /> Google sign-in unavailable
                      </Button>
                    )}
                  </div>

                  <p className="hidden sm:block text-[11px] text-muted-foreground text-center mt-5 leading-relaxed">
                    {c.terms_prefix}{" "}
                    <Link to="/privacy" className="font-semibold text-foreground underline-offset-2 hover:underline">Privacy Policy</Link>{" "}
                    {c.terms_separator}{" "}
                    <Link to="/refund" className="font-semibold text-foreground underline-offset-2 hover:underline">Refund Policy</Link>.
                  </p>

                  {/* legacy testid for existing tests */}
                  <button type="button" data-testid="login-with-otp" onClick={sendOtp} className="sr-only" tabIndex={-1}>
                    {c.cta_label}
                  </button>
                </div>
              </motion.div>
            )}

            {mode === "verify" && (
              <motion.div
                key="verify"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                data-testid="otp-verify-form"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMode("phone");
                    setOtp("");
                    setDevOtp(null);
                  }}
                  className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
                  data-testid="back-to-phone"
                >
                  <ArrowLeft className="h-3 w-3" /> Change phone
                </button>

                <p className="text-xs tracking-overline uppercase font-bold text-secondary mt-5">{c.verify_overline}</p>
                <h2 className="font-display font-extrabold text-2xl tracking-tight mt-2 leading-tight">
                  {c.verify_heading}
                </h2>
                <p className="text-sm text-muted-foreground mt-1.5">
                  Sent to <span className="font-semibold text-foreground">+91 {phone}</span>
                </p>

                {devOtp && (
                  <div className="mt-5 rounded-2xl bg-secondary/10 border border-secondary/30 p-3.5" data-testid="dev-otp-banner">
                    <span className="text-[10px] tracking-overline uppercase font-bold text-secondary">Dev mode OTP</span>
                    <p className="font-mono font-bold text-xl tracking-[0.4em] text-foreground mt-1">{devOtp}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Swap to MSG91/Twilio for production.</p>
                  </div>
                )}

                <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground mt-6">
                  Enter 6-digit OTP
                </label>
                <Input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  placeholder="••••••"
                  className="mt-2 rounded-2xl text-center text-2xl font-mono font-bold tracking-[0.5em] h-14"
                  maxLength={6}
                  data-testid="otp-input"
                  inputMode="numeric"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                />

                <Button
                  onClick={verifyOtp}
                  disabled={submitting || otp.length < 4}
                  data-testid="verify-otp-button"
                  className="w-full h-13 mt-6 rounded-2xl bg-primary hover:bg-primary/90 font-semibold text-base disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4 mr-2" />
                  {submitting ? "Verifying…" : c.verify_cta_label}
                </Button>

                <p className="text-xs text-muted-foreground text-center mt-5">
                  {c.resend_prompt}{" "}
                  <button
                    type="button"
                    onClick={sendOtp}
                    disabled={submitting}
                    className="font-semibold text-primary hover:underline disabled:opacity-50"
                    data-testid="resend-otp-button"
                  >
                    {c.resend_label}
                  </button>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </div>
        {/* Spacer below the form — pushes the form into the middle of the
            mobile viewport with breathing room beneath. */}
        <div aria-hidden className="h-16 sm:h-24 w-full" />
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 mr-2" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/>
    </svg>
  );
}
