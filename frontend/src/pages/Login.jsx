import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, KeyRound } from "lucide-react";

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
};

export default function Login() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [content, setContent] = useState(DEFAULTS);
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
      } catch {}
    })();
  }, []);
  const c = content;

  const handleGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

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
      setUser(r.data.user);
      toast.success("Welcome to eFoodCare");
      navigate("/dashboard", { replace: true, state: { user: r.data.user } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-primary flex flex-col" data-testid="login-page">
      {/* HERO — dark red full-bleed top, simple & centered. Collapses if no title. */}
      {(c.title_line1 || c.title_line2) && (
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <img src={HERO_FOOD_IMG} alt="" className="w-full h-full object-cover opacity-25" />
            <div className="absolute inset-0 bg-gradient-to-b from-primary/95 via-primary/90 to-primary"></div>
          </div>
          <div className="max-w-md mx-auto w-full px-6 pt-8 pb-10 md:pt-10 md:pb-12 text-primary-foreground text-center">
            <h1
              className="font-display font-extrabold text-3xl md:text-4xl tracking-tight leading-[1.05]"
              data-testid="login-title"
            >
              {c.title_line1 && <span className="block">{c.title_line1}</span>}
              {c.title_line2 && <span className="block">{c.title_line2}</span>}
            </h1>
          </div>
        </div>
      )}

      {/* FORM SHEET — pulls up over the hero */}
      <div className="bg-card flex-1 -mt-6 rounded-t-3xl shadow-[0_-12px_30px_-10px_rgba(0,0,0,0.18)] relative">
        <div className="max-w-md mx-auto w-full px-6 py-9">
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
                  <p className="text-xs tracking-overline uppercase font-bold text-secondary">{c.form_overline}</p>
                  <h2 className="font-display font-extrabold text-2xl tracking-tight mt-2 leading-tight">
                    {c.form_heading}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1.5">{c.form_subheading}</p>

                  <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground mt-7" htmlFor="phone-input">
                    {c.phone_label}
                  </label>
                  <div className="mt-2 flex items-stretch rounded-2xl border border-input bg-background overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 transition-colors">
                    <span className="flex items-center gap-1.5 pl-4 pr-3 text-sm font-semibold text-foreground border-r border-input bg-muted/40">
                      <span aria-hidden>🇮🇳</span> +91
                    </span>
                    <Input
                      id="phone-input"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                      placeholder={c.phone_placeholder}
                      className="border-0 focus-visible:ring-0 text-base h-12 px-3"
                      data-testid="phone-input"
                      inputMode="numeric"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                    />
                  </div>

                  <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground mt-5" htmlFor="name-input">
                    {c.name_label} <span className="text-muted-foreground/70 normal-case tracking-normal font-normal">{c.name_optional_label}</span>
                  </label>
                  <Input
                    id="name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={c.name_placeholder}
                    className="mt-2 rounded-2xl h-12 px-4"
                    data-testid="name-input"
                  />

                  <Button
                    onClick={sendOtp}
                    disabled={submitting || phone.length < 10}
                    data-testid="send-otp-button"
                    className="w-full h-13 mt-7 rounded-2xl bg-primary hover:bg-primary/90 font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? "Sending OTP…" : (
                      <>
                        {c.cta_label} <ArrowRight className="h-4 w-4 ml-1.5" />
                      </>
                    )}
                  </Button>

                  <div className="flex items-center gap-3 my-6">
                    <span className="flex-1 h-px bg-border"></span>
                    <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{c.or_divider}</span>
                    <span className="flex-1 h-px bg-border"></span>
                  </div>

                  <Button
                    onClick={handleGoogle}
                    variant="outline"
                    data-testid="google-login-button"
                    className="w-full h-12 rounded-2xl border-input font-semibold text-sm bg-background hover:bg-muted/60"
                  >
                    <GoogleIcon /> {c.google_label}
                  </Button>

                  <p className="text-[11px] text-muted-foreground text-center mt-7 leading-relaxed">
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
