import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { readCmsCache, writeCmsCache } from "../lib/cms-cache";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, KeyRound, Search, Building2, MapPin, ShieldCheck } from "lucide-react";
import { GoogleLogin, useGoogleOneTapLogin } from "@react-oauth/google";
import SEO from "../components/SEO";

import { LOGIN_DEFAULTS } from "./login/loginContentDefaults";
import { resolveLoginNext } from "./login/resolveLoginNext";

/**
 * efoodtech multi-tenant login — iter-143.
 *
 * Flow (compulsory):
 *   Step 0  "mess"    — user picks their mess by searchable dropdown OR
 *                       types the mess ID directly (both work). Once picked
 *                       the choice is persisted to localStorage so PWA users
 *                       don't have to re-pick on every launch.
 *   Step 1  "phone"   — enter phone + optional name.
 *   Step 2  "verify"  — 6-digit OTP.
 *
 * The picked mess_id is passed to /auth/verify-otp so the backend tags the
 * user on first login and rejects cross-mess logins on subsequent ones.
 */
const LS_MESS_KEY = "efoodtech.mess.picked";

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, setUser } = useAuth();

  const computeNext = (u) => resolveLoginNext(u, searchParams.get("next"));

  const verifiedHereRef = useRef(false);
  useEffect(() => {
    if (verifiedHereRef.current) return;
    if (user) navigate(computeNext(user), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const [content, setContent] = useState(() => ({ ...LOGIN_DEFAULTS, ...(readCmsCache("/content/login") || {}) }));
  // Steps: mess → phone → verify
  const [step, setStep] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(LS_MESS_KEY) || "null");
      return cached?.mess_id ? "phone" : "mess";
    } catch { return "mess"; }
  });
  const [picked, setPicked] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_MESS_KEY) || "null"); }
    catch { return null; }
  });
  const [messes, setMesses] = useState([]);
  const [messQuery, setMessQuery] = useState("");
  const [messIdInput, setMessIdInput] = useState("");
  const [messLoading, setMessLoading] = useState(true);

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [echoOtp, setEchoOtp] = useState("");

  // Load CMS content
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/content/login");
        setContent({ ...LOGIN_DEFAULTS, ...r.data });
        writeCmsCache("/content/login", r.data);
      } catch (e) { console.warn("[Login] /content/login fetch failed", e); }
    })();
  }, []);

  // Load mess directory (public list)
  useEffect(() => {
    (async () => {
      setMessLoading(true);
      try {
        const r = await api.get("/messes");
        setMesses(r.data?.messes || []);
      } catch (e) {
        console.warn("[Login] /messes fetch failed", e);
      } finally {
        setMessLoading(false);
      }
    })();
  }, []);

  const c = content;

  const filteredMesses = useMemo(() => {
    const q = messQuery.trim().toLowerCase();
    if (!q) return messes.slice(0, 40);
    return messes.filter((m) =>
      (m.name || "").toLowerCase().includes(q) ||
      (m.city || "").toLowerCase().includes(q) ||
      (m.mess_id || "").toLowerCase().includes(q) ||
      (m.slug || "").toLowerCase().includes(q),
    ).slice(0, 40);
  }, [messes, messQuery]);

  const chooseMess = (m) => {
    setPicked(m);
    try { localStorage.setItem(LS_MESS_KEY, JSON.stringify(m)); } catch {}
    setStep("phone");
  };

  const submitMessId = async () => {
    const id = messIdInput.trim();
    if (!id) { toast.error("Enter a Mess ID or pick from the list"); return; }
    // Look up by mess_id (case-insensitive) OR by slug
    const idUp = id.toUpperCase();
    let match = messes.find((m) => (m.mess_id || "").toUpperCase() === idUp);
    if (!match) match = messes.find((m) => (m.slug || "").toLowerCase() === id.toLowerCase());
    if (!match) {
      // fall back to server lookup by slug
      try {
        const r = await api.get(`/messes/${encodeURIComponent(id.toLowerCase())}`);
        if (r.data?.mess_id && r.data?.status === "active") match = r.data;
      } catch {}
    }
    if (!match) { toast.error("No active mess found with that ID. Try the search above."); return; }
    chooseMess(match);
  };

  const clearMess = () => {
    setPicked(null);
    try { localStorage.removeItem(LS_MESS_KEY); } catch {}
    setStep("mess");
  };

  const sendOtp = async () => {
    if (!picked?.mess_id) { toast.error("Please pick your mess first"); setStep("mess"); return; }
    const p = phone.trim();
    if (p.length < 10) { toast.error("Enter a valid 10-digit phone number"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/auth/send-otp", { phone: p });
      if (r.data?.dev_otp) {
        setEchoOtp(r.data.dev_otp);
        setOtp(r.data.dev_otp);
        toast.success("Verification code ready");
      } else {
        setEchoOtp("");
        toast.success("OTP sent to your phone");
      }
      setStep("verify");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send OTP");
    } finally { setSubmitting(false); }
  };

  const verifyOtp = async () => {
    if (otp.length < 4) { toast.error("Enter the OTP"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/auth/verify-otp", {
        phone: phone.trim(),
        otp: otp.trim(),
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
    if (!picked?.mess_id) { toast.error("Please pick your mess first"); setStep("mess"); return; }
    const credential = credentialResponse?.credential;
    if (!credential) { toast.error("No credential from Google"); return; }
    try {
      const r = await api.post("/auth/google/verify", { credential, mess_id: picked.mess_id });
      verifiedHereRef.current = true;
      const dest = computeNext(r.data.user);
      setUser(r.data.user);
      toast.success(`Welcome to ${picked?.name || "efoodtech"}`);
      navigate(dest, { replace: true, state: { user: r.data.user } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Google sign-in failed");
    }
  };

  useGoogleOneTapLogin({
    onSuccess: handleGoogleCredential,
    disabled: !!user || !process.env.REACT_APP_GOOGLE_CLIENT_ID || !picked?.mess_id,
  });

  return (
    <div className="min-h-screen bg-white flex flex-col" data-testid="login-page">
      <SEO title="Login · efoodtech" path="/login" description="Login to efoodtech — a SaaS user management system for messes. Pick your mess, then log in with OTP." />

      {/* Navy hero */}
      <div className="relative overflow-hidden bg-primary text-white">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #ffffff 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        <div className="relative max-w-md mx-auto w-full px-6 pt-8 pb-8 text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-white/10 backdrop-blur border border-white/20 mb-3">
            <Building2 className="h-6 w-6" strokeWidth={2.2} />
          </div>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight leading-tight" data-testid="login-title">
            <span className="block">efoodtech</span>
          </h1>
          <p className="text-white/80 text-sm mt-1 font-medium">User Management System · for messes across India</p>
        </div>
      </div>

      {/* FORM SHEET */}
      <div className="bg-white flex-1 px-4 sm:px-6 pb-16">
        <div className="max-w-md mx-auto w-full -mt-6 relative z-10">
          <div className="bg-white rounded-2xl px-5 py-6 sm:px-7 sm:py-7 shadow-xl border border-slate-200" data-testid="login-form-card">
            <AnimatePresence mode="wait" initial={false}>
              {step === "mess" && (
                <motion.div key="mess" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} data-testid="mess-picker">
                  <p className="text-[11px] tracking-overline uppercase font-bold text-secondary">Step 1 of 2</p>
                  <h2 className="font-display font-extrabold text-xl sm:text-2xl tracking-tight mt-1 leading-tight text-slate-900">Pick your mess</h2>
                  <p className="text-xs text-slate-500 mt-1">Search by name or city, or type the Mess ID your mess owner shared with you.</p>

                  <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500 mt-5">Search messes</label>
                  <div className="mt-1 flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 h-11 focus-within:border-secondary focus-within:ring-2 focus-within:ring-secondary/20">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      value={messQuery}
                      onChange={(e) => setMessQuery(e.target.value)}
                      placeholder="e.g. Mangal Mess · Amravati"
                      className="flex-1 bg-transparent outline-none text-sm placeholder:text-slate-400"
                      data-testid="mess-search-input"
                    />
                  </div>

                  <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-slate-200 divide-y divide-slate-100" data-testid="mess-list">
                    {messLoading && (
                      <div className="p-4 text-center text-sm text-slate-500">Loading messes…</div>
                    )}
                    {!messLoading && filteredMesses.length === 0 && (
                      <div className="p-4 text-center text-sm text-slate-500">No messes match "{messQuery}"</div>
                    )}
                    {filteredMesses.map((m) => (
                      <button
                        key={m.mess_id}
                        onClick={() => chooseMess(m)}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 active:bg-slate-100 transition"
                        data-testid={`mess-option-${m.mess_id}`}
                      >
                        <div className="flex items-center gap-3">
                          {m.logo_url ? (
                            <img src={m.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover border border-slate-200" />
                          ) : (
                            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                              <Building2 className="h-4 w-4" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">{m.name}</div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                              <MapPin className="h-3 w-3" />
                              <span className="truncate">{m.city}{m.state ? ` · ${m.state}` : ""}</span>
                              <span className="ml-auto font-mono font-bold text-primary">{m.mess_id}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 my-4">
                    <span className="flex-1 h-px bg-slate-200"></span>
                    <span className="text-[10px] tracking-overline uppercase font-bold text-slate-400">Or type mess ID</span>
                    <span className="flex-1 h-px bg-slate-200"></span>
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={messIdInput}
                      onChange={(e) => setMessIdInput(e.target.value.toUpperCase())}
                      placeholder="e.g. MESS-A7C3"
                      className="flex-1 rounded-2xl h-11 uppercase font-mono tracking-widest"
                      data-testid="mess-id-input"
                      onKeyDown={(e) => e.key === "Enter" && submitMessId()}
                    />
                    <Button onClick={submitMessId} data-testid="mess-id-submit" className="rounded-2xl h-11 px-5 bg-primary hover:bg-primary/90 text-white font-semibold">
                      Next <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </motion.div>
              )}

              {step === "phone" && (
                <motion.div key="phone" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} data-testid="login-choose">
                  <button type="button" onClick={clearMess} className="text-xs text-slate-500 flex items-center gap-1 hover:text-primary transition-colors mb-3" data-testid="back-to-mess">
                    <ArrowLeft className="h-3 w-3" /> Change mess
                  </button>

                  {/* Picked mess ribbon */}
                  {picked && (
                    <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/15 px-3 py-2 mb-4" data-testid="picked-mess">
                      {picked.logo_url ? (
                        <img src={picked.logo_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                          <ShieldCheck className="h-4 w-4" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-primary truncate">{picked.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{picked.mess_id}</div>
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] tracking-overline uppercase font-bold text-secondary">Step 2 of 2</p>
                  <h2 className="font-display font-extrabold text-xl sm:text-2xl tracking-tight mt-1 leading-tight text-slate-900">
                    Log in to continue
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Enter your phone number to receive an OTP.</p>

                  <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500 mt-4" htmlFor="phone-input">
                    Phone number
                  </label>
                  <div className="mt-1 flex items-stretch rounded-2xl border border-slate-300 bg-white overflow-hidden focus-within:border-secondary focus-within:ring-2 focus-within:ring-secondary/20 transition-colors">
                    <span className="flex items-center gap-1.5 pl-3 pr-2.5 text-sm font-semibold text-slate-700 border-r border-slate-200 bg-slate-50">
                      <span aria-hidden>🇮🇳</span> +91
                    </span>
                    <Input
                      id="phone-input"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                      placeholder="Enter 10-digit number"
                      className="border-0 focus-visible:ring-0 text-base h-11 px-3"
                      data-testid="phone-input"
                      inputMode="numeric"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                    />
                  </div>

                  <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500 mt-3" htmlFor="name-input">
                    Your name <span className="text-slate-400 normal-case tracking-normal font-normal">(optional)</span>
                  </label>
                  <Input
                    id="name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Aman Gupta"
                    className="mt-1 rounded-2xl h-11 px-4 text-base"
                    data-testid="name-input"
                  />

                  <Button
                    onClick={sendOtp}
                    disabled={submitting || phone.length < 10}
                    data-testid="send-otp-button"
                    className="w-full h-12 mt-4 rounded-2xl bg-primary hover:bg-primary/90 font-semibold text-base disabled:opacity-50 text-white"
                  >
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
                        <GoogleLogin
                          onSuccess={handleGoogleCredential}
                          onError={() => toast.error("Google sign-in failed")}
                          useOneTap={false}
                          theme="outline"
                          size="large"
                          width="100%"
                          text="continue_with"
                          shape="rectangular"
                        />
                      </div>
                    </>
                  )}

                  {/* iter-145 · Emergent-managed Google Auth (redirect flow). Works even when
                      REACT_APP_GOOGLE_CLIENT_ID isn't configured. Requires mess pick first. */}
                  <Button
                    type="button"
                    onClick={() => {
                      if (!picked?.mess_id) { toast.error("Please pick your mess first"); setStep("mess"); return; }
                      // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
                      const redirectUrl = window.location.origin + "/dashboard";
                      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
                    }}
                    variant="outline"
                    className="w-full h-11 rounded-2xl border-slate-300 hover:bg-slate-50 text-slate-900 font-semibold text-sm mt-2"
                    data-testid="emergent-google-btn"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 mr-2" aria-hidden>
                      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
                    </svg>
                    Continue with Google
                    <span className="ml-2 text-[10px] font-normal text-slate-500">via Emergent</span>
                  </Button>

                  <p className="text-[11px] text-slate-500 text-center mt-5 leading-relaxed">
                    By continuing, you agree to our{" "}
                    <Link to="/privacy" className="font-semibold text-primary underline-offset-2 hover:underline">Privacy Policy</Link>{" "}
                    and{" "}
                    <Link to="/refund" className="font-semibold text-primary underline-offset-2 hover:underline">Refund Policy</Link>.
                  </p>

                  <button type="button" data-testid="login-with-otp" onClick={sendOtp} className="sr-only" tabIndex={-1}>Continue</button>
                </motion.div>
              )}

              {step === "verify" && (
                <motion.div key="verify" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} data-testid="otp-verify-form">
                  <button
                    type="button"
                    onClick={() => { setStep("phone"); setOtp(""); }}
                    className="text-xs text-slate-500 flex items-center gap-1 hover:text-primary transition-colors"
                    data-testid="back-to-phone"
                  >
                    <ArrowLeft className="h-3 w-3" /> Change phone
                  </button>

                  <p className="text-xs tracking-overline uppercase font-bold text-secondary mt-5">Verify OTP</p>
                  <h2 className="font-display font-extrabold text-2xl tracking-tight mt-2 leading-tight text-slate-900">
                    Enter the 6-digit code
                  </h2>
                  <p className="text-sm text-slate-500 mt-1.5">
                    Sent to <span className="font-semibold text-slate-900">+91 {phone}</span>
                  </p>

                  {echoOtp && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-50 pl-3 pr-1.5 py-1" data-testid="otp-echo-card">
                      <p className="text-[11px] font-semibold text-amber-900 whitespace-nowrap">Your code:</p>
                      <p className="font-mono font-extrabold text-sm tabular-nums tracking-[0.2em] text-amber-900 select-all" data-testid="otp-echo-code">{echoOtp}</p>
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard?.writeText(echoOtp).catch(() => {}); setOtp(echoOtp); toast.success("Code copied"); }}
                        className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white"
                        data-testid="otp-echo-copy"
                      >Copy</button>
                    </div>
                  )}

                  <label className="block text-xs tracking-overline uppercase font-bold text-slate-500 mt-6">Enter 6-digit OTP</label>
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
                    className="w-full h-12 mt-6 rounded-2xl bg-primary hover:bg-primary/90 font-semibold text-base disabled:opacity-50 text-white"
                  >
                    <KeyRound className="h-4 w-4 mr-2" />
                    {submitting ? "Verifying…" : "Verify & Continue"}
                  </Button>

                  <p className="text-xs text-slate-500 text-center mt-5">
                    Didn't get it?{" "}
                    <button type="button" onClick={sendOtp} disabled={submitting} className="font-semibold text-primary hover:underline disabled:opacity-50" data-testid="resend-otp-button">
                      Resend OTP
                    </button>
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Trust ribbon */}
          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-secondary" />
            <span>Powered by <span className="font-bold text-primary">efoodtech</span> · Secure OTP · Multi-tenant SaaS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
