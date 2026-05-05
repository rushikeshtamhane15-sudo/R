import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { UtensilsCrossed, Phone, KeyRound, ArrowLeft } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [mode, setMode] = useState("choose"); // choose | otp-phone | otp-verify
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const sendOtp = async () => {
    const p = phone.trim();
    if (p.length < 10) { toast.error("Enter a valid phone number"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/auth/send-otp", { phone: p });
      if (r.data.dev_otp) setDevOtp(r.data.dev_otp);
      toast.success("OTP sent");
      setMode("otp-verify");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send OTP");
    } finally { setSubmitting(false); }
  };

  const verifyOtp = async () => {
    if (otp.length < 4) { toast.error("Enter the OTP"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/auth/verify-otp", { phone: phone.trim(), otp: otp.trim(), name: name.trim() || undefined });
      setUser(r.data.user);
      toast.success("Signed in!");
      navigate("/dashboard", { replace: true, state: { user: r.data.user } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Verification failed");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-6 py-16" data-testid="login-page">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-3xl border border-black/5 shadow-xl p-10">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center mb-8">
            <UtensilsCrossed className="h-7 w-7 text-primary-foreground" strokeWidth={1.75} />
          </div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3">Welcome</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight leading-tight">
            Sign in to your<br />e-Meal Pass.
          </h1>
          <p className="mt-3 text-muted-foreground leading-relaxed text-sm">ghar se achha khana — ek tap door</p>

          {mode === "choose" && (
            <div className="mt-10 space-y-3" data-testid="login-choose">
              <Button onClick={() => setMode("otp-phone")} data-testid="login-with-otp" className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base">
                <Phone className="h-4 w-4 mr-2" /> Continue with Phone OTP
              </Button>
              <Button onClick={handleGoogle} variant="outline" data-testid="google-login-button" className="w-full h-12 rounded-full border-black/20 font-semibold text-base">
                Continue with Google
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-6">By continuing you agree to our terms and privacy policy.</p>
            </div>
          )}

          {mode === "otp-phone" && (
            <div className="mt-10 space-y-4" data-testid="otp-phone-form">
              <div>
                <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Phone number</label>
                <div className="mt-2 flex items-center rounded-xl border border-input bg-background pl-3">
                  <span className="text-sm text-muted-foreground">+91</span>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98XXXXXXXX" className="border-0 focus-visible:ring-0 text-base" data-testid="phone-input" inputMode="numeric" />
                </div>
              </div>
              <div>
                <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Your name (optional)</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aman Gupta" className="mt-2 rounded-xl" data-testid="name-input" />
              </div>
              <Button onClick={sendOtp} disabled={submitting} data-testid="send-otp-button" className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 font-semibold">
                {submitting ? "Sending…" : "Send OTP"}
              </Button>
              <button type="button" onClick={() => setMode("choose")} className="text-xs text-muted-foreground flex items-center gap-1" data-testid="back-to-choose">
                <ArrowLeft className="h-3 w-3" /> Back
              </button>
            </div>
          )}

          {mode === "otp-verify" && (
            <div className="mt-10 space-y-4" data-testid="otp-verify-form">
              <div className="rounded-xl bg-muted/60 p-4 text-sm">
                OTP sent to <span className="font-semibold">+91 {phone}</span>
              </div>
              {devOtp && (
                <div className="rounded-xl bg-secondary/10 border border-secondary/20 p-3 text-sm" data-testid="dev-otp-banner">
                  <span className="text-xs tracking-overline uppercase font-bold text-secondary">DEV MODE OTP</span>
                  <p className="font-mono font-bold text-lg mt-1">{devOtp}</p>
                  <p className="text-xs text-muted-foreground mt-1">Swap to MSG91/Twilio for production.</p>
                </div>
              )}
              <div>
                <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Enter 6-digit OTP</label>
                <Input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="______" className="mt-2 rounded-xl text-center text-2xl font-mono tracking-[0.5em]" maxLength={6} data-testid="otp-input" inputMode="numeric" />
              </div>
              <Button onClick={verifyOtp} disabled={submitting} data-testid="verify-otp-button" className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 font-semibold">
                <KeyRound className="h-4 w-4 mr-2" />
                {submitting ? "Verifying…" : "Verify & Sign in"}
              </Button>
              <button type="button" onClick={() => { setMode("otp-phone"); setOtp(""); setDevOtp(null); }} className="text-xs text-muted-foreground flex items-center gap-1" data-testid="back-to-phone">
                <ArrowLeft className="h-3 w-3" /> Change phone
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
