import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { ArrowRight, KeyRound, Search, Building2, MapPin, ShieldCheck, X, Check } from "lucide-react";
import { GoogleLogin } from "@react-oauth/google";
import SEO from "../components/SEO";

/**
 * efoodtech — iter-146 single-step login with typed-autocomplete mess picker.
 *
 * One form, three inputs:
 *   1. Mess search (typing filters — no scroll list until user types)
 *   2. Phone
 *   3. Name (optional)
 * Continue → sends OTP → OTP verify inline.
 *
 * Google (Emergent) sign-in still requires a picked mess.
 */
const LS_MESS_KEY = "efoodtech.mess.picked";

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, setUser } = useAuth();
  const verifiedHereRef = useRef(false);

  const computeNext = (u) => {
    const next = searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("/login")) return next;
    if (u?.role === "admin") return "/admin";
    if (u?.role === "franchise_owner") return "/admin";
    if (u?.role === "staff") return "/admin/deliveries-today";
    if (u?.role === "rider") return "/rider";
    return "/dashboard";
  };

  useEffect(() => {
    if (verifiedHereRef.current) return;
    if (user) navigate(computeNext(user), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const [messes, setMesses] = useState([]);
  const [messQuery, setMessQuery] = useState("");
  const [picked, setPicked] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_MESS_KEY) || "null"); }
    catch { return null; }
  });
  const [openDropdown, setOpenDropdown] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otpMode, setOtpMode] = useState(false);
  const [otp, setOtp] = useState("");
  const [echoOtp, setEchoOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/messes"); setMesses(r.data?.messes || []); }
      catch (e) { console.warn("[Login] /messes fetch failed", e); }
    })();
  }, []);

  // Typed-prefix + substring match: appears ONLY when user types.
  const matches = useMemo(() => {
    const q = messQuery.trim().toLowerCase();
    if (!q) return [];
    const starts = [], contains = [];
    for (const m of messes) {
      const name = (m.name || "").toLowerCase();
      const city = (m.city || "").toLowerCase();
      const id = (m.mess_id || "").toLowerCase();
      const slug = (m.slug || "").toLowerCase();
      if (name.startsWith(q) || id.startsWith(q)) starts.push(m);
      else if (name.includes(q) || city.includes(q) || id.includes(q) || slug.includes(q)) contains.push(m);
    }
    return [...starts, ...contains].slice(0, 10);
  }, [messes, messQuery]);

  const chooseMess = (m) => {
    setPicked(m);
    setMessQuery("");
    setOpenDropdown(false);
    try { localStorage.setItem(LS_MESS_KEY, JSON.stringify(m)); } catch {}
  };

  const clearMess = () => {
    setPicked(null);
    try { localStorage.removeItem(LS_MESS_KEY); } catch {}
  };

  const sendOtp = async () => {
    if (!picked?.mess_id) { toast.error("Please pick your mess first"); return; }
    const p = phone.trim();
    if (p.length < 10) { toast.error("Enter a valid 10-digit phone number"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/auth/send-otp", { phone: p });
      if (r.data?.dev_otp) { setEchoOtp(r.data.dev_otp); setOtp(r.data.dev_otp); toast.success("Code ready"); }
      else { setEchoOtp(""); toast.success("OTP sent"); }
      setOtpMode(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send OTP");
    } finally { setSubmitting(false); }
  };

  const verifyOtp = async () => {
    if (otp.length < 4) { toast.error("Enter the OTP"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/auth/verify-otp", {
        phone: phone.trim(), otp: otp.trim(),
        name: name.trim() || undefined,
        mess_id: picked?.mess_id || undefined,
      });
      verifiedHereRef.current = true;
      const dest = computeNext(r.data.user);
      setUser(r.data.user);
      toast.success(`Welcome to ${picked?.name || "efoodtech"}`);
      navigate(dest, { replace: true, state: { user: r.data.user } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Verification failed");
    } finally { setSubmitting(false); }
  };

  const handleGoogleCredential = async (credentialResponse) => {
    if (!picked?.mess_id) { toast.error("Please pick your mess first"); return; }
    const credential = credentialResponse?.credential;
    if (!credential) { toast.error("No credential from Google"); return; }
    try {
      const r = await api.post("/auth/google/verify", { credential, mess_id: picked.mess_id });
      verifiedHereRef.current = true;
      const dest = computeNext(r.data.user);
      setUser(r.data.user);
      toast.success(`Welcome to ${picked?.name || "efoodtech"}`);
      navigate(dest, { replace: true, state: { user: r.data.user } });
    } catch (e) { toast.error(e?.response?.data?.detail || "Google sign-in failed"); }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col" data-testid="login-page">
      <SEO title="Login · efoodtech" path="/login" description="Login to efoodtech. Type your mess name to find it — one-step login." />

      <div className="relative overflow-hidden bg-primary text-white">
        <div className="max-w-md mx-auto w-full px-6 pt-8 pb-8 text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-white/10 backdrop-blur border border-white/20 mb-3">
            <Building2 className="h-6 w-6" strokeWidth={2.2} />
          </div>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight leading-tight">efoodtech</h1>
          <p className="text-white/85 text-sm mt-1 font-medium">User Management System · for messes across India</p>
        </div>
      </div>

      <div className="bg-white flex-1 px-4 sm:px-6 pb-16">
        <div className="max-w-md mx-auto w-full -mt-6 relative z-10">
          <div className="bg-white rounded-2xl px-5 py-6 sm:px-7 sm:py-7 shadow-xl border border-slate-200" data-testid="login-form-card">
            <AnimatePresence mode="wait">
              {!otpMode ? (
                <motion.div key="single" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="login-single-step">
                  <p className="text-[11px] tracking-overline uppercase font-bold text-secondary">One-step login</p>
                  <h2 className="font-display font-extrabold text-xl sm:text-2xl tracking-tight mt-1 leading-tight text-slate-900">Log in to continue</h2>

                  {/* Mess autocomplete */}
                  <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500 mt-5">Your mess</label>
                  {picked ? (
                    <div className="mt-1 flex items-center gap-3 rounded-2xl bg-primary/5 border border-primary/15 px-3 py-2.5" data-testid="picked-mess">
                      {picked.logo_url ? (
                        <img src={picked.logo_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center"><Check className="h-4 w-4" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-primary truncate">{picked.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{picked.mess_id}</div>
                      </div>
                      <button type="button" onClick={clearMess} className="text-slate-400 hover:text-red-600" data-testid="clear-mess-btn"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <div className="relative mt-1">
                      <div className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 h-11 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                        <Search className="h-4 w-4 text-slate-400" />
                        <input
                          value={messQuery}
                          onChange={(e) => { setMessQuery(e.target.value); setOpenDropdown(true); }}
                          onFocus={() => setOpenDropdown(true)}
                          onBlur={() => setTimeout(() => setOpenDropdown(false), 180)}
                          placeholder="Start typing mess name or ID…"
                          className="flex-1 bg-transparent outline-none text-sm placeholder:text-slate-400"
                          data-testid="mess-search-input"
                          autoFocus
                        />
                      </div>
                      {openDropdown && messQuery.trim() && (
                        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100" data-testid="mess-search-results">
                          {matches.length === 0 ? (
                            <div className="p-3 text-center text-xs text-slate-500">No mess matches "{messQuery}"</div>
                          ) : (
                            matches.map((m) => (
                              <button
                                key={m.mess_id}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); chooseMess(m); }}
                                className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-center gap-2.5"
                                data-testid={`mess-option-${m.mess_id}`}
                              >
                                {m.logo_url ? (
                                  <img src={m.logo_url} alt="" className="h-7 w-7 rounded-md object-cover" />
                                ) : (
                                  <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Building2 className="h-3.5 w-3.5" /></div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-semibold text-slate-900 truncate">{m.name}</div>
                                  <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                    <MapPin className="h-3 w-3" /> {m.city}
                                    <span className="ml-auto font-mono font-bold text-primary">{m.mess_id}</span>
                                  </div>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Phone */}
                  <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500 mt-4">Phone number</label>
                  <div className="mt-1 flex items-stretch rounded-2xl border border-slate-300 bg-white overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                    <span className="flex items-center gap-1.5 pl-3 pr-2.5 text-sm font-semibold text-slate-700 border-r border-slate-200 bg-slate-50">
                      <span aria-hidden>🇮🇳</span> +91
                    </span>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                      placeholder="10-digit number" className="border-0 focus-visible:ring-0 text-base h-11 px-3"
                      data-testid="phone-input" inputMode="numeric" onKeyDown={(e) => e.key === "Enter" && sendOtp()} />
                  </div>

                  <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500 mt-3">
                    Your name <span className="text-slate-400 normal-case tracking-normal font-normal">(optional)</span>
                  </label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aman Gupta"
                    className="mt-1 rounded-2xl h-11 px-4 text-base" data-testid="name-input" />

                  <Button onClick={sendOtp} disabled={submitting || phone.length < 10 || !picked}
                    className="w-full h-12 mt-5 rounded-2xl bg-primary hover:bg-primary/90 font-semibold text-base disabled:opacity-50 text-white"
                    data-testid="send-otp-button">
                    {submitting ? "Sending OTP…" : (<>Continue <ArrowRight className="h-4 w-4 ml-1.5" /></>)}
                  </Button>

                  {process.env.REACT_APP_GOOGLE_CLIENT_ID && (
                    <>
                      <div className="flex items-center gap-3 my-4">
                        <span className="flex-1 h-px bg-slate-200"></span>
                        <span className="text-[10px] tracking-overline uppercase font-bold text-slate-400">Or</span>
                        <span className="flex-1 h-px bg-slate-200"></span>
                      </div>
                      <div className="w-full h-11 rounded-2xl overflow-hidden" data-testid="google-login-button">
                        <GoogleLogin onSuccess={handleGoogleCredential} onError={() => toast.error("Google sign-in failed")}
                          useOneTap={false} theme="outline" size="large" width="100%" text="continue_with" shape="rectangular" />
                      </div>
                    </>
                  )}

                  <Button
                    type="button"
                    onClick={() => {
                      if (!picked?.mess_id) { toast.error("Please pick your mess first"); return; }
                      // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
                      const redirectUrl = window.location.origin + "/dashboard";
                      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
                    }}
                    variant="outline"
                    className="w-full h-11 rounded-2xl border-slate-300 hover:bg-slate-50 text-slate-900 font-semibold text-sm mt-2"
                    data-testid="emergent-google-btn"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 mr-2" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/></svg>
                    Continue with Google <span className="ml-2 text-[10px] font-normal text-slate-500">via Emergent</span>
                  </Button>

                  <p className="text-[11px] text-slate-500 text-center mt-5 leading-relaxed">
                    By continuing, you agree to our{" "}
                    <Link to="/privacy" className="font-semibold text-primary underline-offset-2 hover:underline">Privacy Policy</Link>{" "}and{" "}
                    <Link to="/refund" className="font-semibold text-primary underline-offset-2 hover:underline">Refund Policy</Link>.
                  </p>
                </motion.div>
              ) : (
                <motion.div key="otp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="otp-verify-form">
                  <button type="button" onClick={() => { setOtpMode(false); setOtp(""); }}
                    className="text-xs text-slate-500 hover:text-primary" data-testid="back-to-phone">← Change phone</button>
                  <h2 className="font-display font-extrabold text-2xl tracking-tight mt-3 leading-tight text-slate-900">Enter 6-digit OTP</h2>
                  <p className="text-sm text-slate-500 mt-1.5">Sent to <span className="font-semibold text-slate-900">+91 {phone}</span></p>
                  {echoOtp && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-50 pl-3 pr-1.5 py-1" data-testid="otp-echo-card">
                      <p className="text-[11px] font-semibold text-amber-900">Code:</p>
                      <p className="font-mono font-extrabold text-sm tabular-nums tracking-[0.2em] text-amber-900 select-all" data-testid="otp-echo-code">{echoOtp}</p>
                    </div>
                  )}
                  <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    placeholder="••••••" className="mt-4 rounded-2xl text-center text-2xl font-mono font-bold tracking-[0.5em] h-14"
                    maxLength={6} data-testid="otp-input" inputMode="numeric" autoFocus
                    onKeyDown={(e) => e.key === "Enter" && verifyOtp()} />
                  <Button onClick={verifyOtp} disabled={submitting || otp.length < 4}
                    className="w-full h-12 mt-5 rounded-2xl bg-primary hover:bg-primary/90 font-semibold text-white"
                    data-testid="verify-otp-button">
                    <KeyRound className="h-4 w-4 mr-2" />{submitting ? "Verifying…" : "Verify & Continue"}
                  </Button>
                  <p className="text-xs text-slate-500 text-center mt-4">
                    Didn't get it?{" "}
                    <button type="button" onClick={sendOtp} disabled={submitting}
                      className="font-semibold text-primary hover:underline" data-testid="resend-otp-button">Resend OTP</button>
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-secondary" />
            <span>Powered by <span className="font-bold text-primary">efoodtech</span> · Secure OTP · Multi-tenant SaaS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
