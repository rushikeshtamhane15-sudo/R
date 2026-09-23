import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";
import { readCmsCache, writeCmsCache } from "../lib/cms-cache";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { ArrowRight, KeyRound, Search, Building2, MapPin, ShieldCheck, X, Check, User as UserIcon, Truck } from "lucide-react";
import SEO from "../components/SEO";
import LocationPill from "../components/LocationPill";

import { LOGIN_DEFAULTS } from "./login/loginContentDefaults";

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
    if (u?.role === "mess_owner") return "/admin";
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
  const [content, setContent] = useState(() => ({ ...LOGIN_DEFAULTS, ...(readCmsCache("/content/login") || {}) }));
  const c = content;
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
    (async () => {
      try {
        const r = await api.get("/content/login");
        setContent({ ...LOGIN_DEFAULTS, ...r.data });
        writeCmsCache("/content/login", r.data);
      } catch (e) { /* keep defaults */ }
    })();
  }, []);

  // Strict prefix match — first letter of name OR first character of mess_id.
  // Nothing else (no city, no substring, no slug).
  const matches = useMemo(() => {
    const q = messQuery.trim().toLowerCase();
    if (!q) return [];
    const firstChar = q[0];
    return messes.filter((m) => {
      const nameFirst = (m.name || "").trim().charAt(0).toLowerCase();
      const idFirst = (m.mess_id || "").trim().charAt(0).toLowerCase();
      return nameFirst === firstChar || idFirst === firstChar;
    }).slice(0, 10);
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

  // iter-158h: super-admin phones bypass the mess-pick requirement.
  // Everyone else MUST pick a valid mess before continuing.
  const SUPER_ADMIN_PHONES = new Set(["9970705391"]);
  const isSuperAdminPhone = (p) => SUPER_ADMIN_PHONES.has((p || "").trim());

  const sendOtp = async () => {
    const p = phone.trim();
    if (p.length < 10) { toast.error("Enter a valid 10-digit phone number"); return; }
    // iter-158h: strict mess selection — no more random logins. Super-admin bypass only.
    if (!picked && !isSuperAdminPhone(p)) {
      toast.error("Please select your mess before continuing");
      return;
    }
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
      const u = r.data.user;
      // iter-151 BUGFIX #2: for admin / mess_owner, force a HARD nav
      // (full page reload) to /admin so the AuthContext refetches /auth/me
      // with the freshly-set cookie. This eliminates the race where a
      // stale AuthContext user (from a previous subscriber session) causes
      // RequireAuth on /admin to bounce to /dashboard before setUser has
      // committed the new role. Also clears the mess pick so admin always
      // owns the platform view (they can still open any mess via nav).
      if (u.role === "admin" || u.role === "mess_owner") {
        try { localStorage.removeItem("efoodtech.mess.picked"); } catch {}
        toast.success(`Welcome to efoodtech admin`);
        window.location.href = "/admin";
        return;
      }
      // iter-180: subscribers without a mess → bounce to Benefits page to
      // learn about efoodtech (Nearby mess picker has been removed).
      if (u.role === "subscriber" && !u.mess_id) {
        setUser(u);
        toast.success("Logged in — meet efoodtech");
        navigate("/benefits", { replace: true, state: { user: u } });
        return;
      }
      const dest = computeNext(u);
      setUser(u);
      toast.success(`Welcome to ${picked?.name || "efoodtech"}`);
      navigate(dest, { replace: true, state: { user: u } });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Verification failed");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col" data-testid="login-page">
      <SEO title="Login · efoodtech" path="/login" description="Login to efoodtech. Type your mess name to find it — one-step login." />

      {/* iter-149: hero block removed per user — brand identity already shown in the site header above. */}

      {/* iter-184 · LocationPill removed from Login body — auto-detected city
          now lives ONLY in the site header strip pill for a cleaner form.  */}

      {/* iter-148 · Super-admin editable 3D marquee announcement bar */}
      {(c.announcement_bar || "").trim() && (
        <div className="relative overflow-hidden bg-amber-100 border-y border-amber-200 text-amber-900 py-2" data-testid="login-announcement-bar" style={{ perspective: "500px" }}>
          <div
            className="whitespace-nowrap font-bold text-xs sm:text-sm inline-block"
            style={{
              animation: "efc-marquee-3d 22s linear infinite",
              transformStyle: "preserve-3d",
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="inline-block px-6" style={{ transform: "rotateY(-10deg) rotateX(4deg)", textShadow: "1px 1px 0 rgba(160,35,35,0.35), 2px 2px 4px rgba(0,0,0,0.15)" }}>
                {c.announcement_bar}
                <span className="mx-4 opacity-60">·</span>
              </span>
            ))}
          </div>
          <style>{`
            @keyframes efc-marquee-3d {
              0%   { transform: translate3d(0, 0, 0); }
              100% { transform: translate3d(-50%, 0, 0); }
            }
          `}</style>
        </div>
      )}

      {/* iter-170 · larger breathing gap between marquee and login card. */}
      <div className="bg-white flex-1 px-4 sm:px-6 pt-12 pb-4">
        <div className="max-w-[240px] mx-auto w-full relative z-10">
          {/* iter-158f · Green nutrient chip row (legacy eFoodCare hero feel, driven by CMS) */}
          {(c.chips || "").trim() && (
            <div className="flex flex-wrap justify-center gap-1 mb-2.5" data-testid="login-chip-row">
              {c.chips.split(",").map((raw, i) => {
                const label = raw.trim();
                if (!label) return null;
                return (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-[9px] font-extrabold uppercase tracking-widest px-2 py-0.5 shadow-sm" data-testid={`login-chip-${i}`}>
                    <Check className="h-2.5 w-2.5 -ml-0.5" strokeWidth={3} />
                    {label}
                  </span>
                );
              })}
            </div>
          )}

          {/* iter-168n · ultra-slim card padding */}
          <div className="bg-white rounded-xl px-3 py-1.5 shadow-lg border border-slate-200 relative" data-testid="login-form-card">
            {/* iter-158f · Avatar bubble hovering at the top of the card */}
            {c.avatar_show !== false && (
              <div
                className="absolute -top-5 left-1/2 -translate-x-1/2 h-10 w-10 rounded-full flex items-center justify-center shadow-lg ring-[3px] ring-white"
                style={{
                  background: `linear-gradient(135deg, ${c.icon_bg_color_start || "#fee2e2"}, ${c.icon_bg_color_end || "#fecaca"})`,
                  color: c.icon_color || "#a02323",
                }}
                data-testid="login-avatar-bubble"
              >
                {c.avatar_url ? (
                  <img src={c.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  <UserIcon className="h-5 w-5" strokeWidth={2.25} />
                )}
              </div>
            )}
            <div className={c.avatar_show !== false ? "pt-5" : ""}>
            <AnimatePresence mode="wait">
              {!otpMode ? (
                <motion.div key="single" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="login-single-step">
                  {/* iter-165 · shrink heading — removed "User Management System · for messes across India" tagline per user */}
                  <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">Sign in</p>

                  {/* Mess autocomplete */}
                  <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500 mt-3">Your mess</label>
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

                  <Button onClick={sendOtp} disabled={submitting || phone.length < 10}
                    className="w-full h-10 mt-4 rounded-2xl bg-primary hover:bg-primary/90 font-semibold text-sm disabled:opacity-50 text-white"
                    data-testid="send-otp-button">
                    {submitting ? "Sending OTP…" : (<>Continue <ArrowRight className="h-4 w-4 ml-1.5" /></>)}
                  </Button>

                  <p className="text-[10px] text-slate-500 text-center mt-3 leading-relaxed">
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
          </div>
          {/* iter-158f · Red delivery ribbon below the card (legacy eFoodCare feel) */}
          {(c.delivery_banner || "").trim() && (
            <div
              className="mt-4 rounded-2xl px-4 py-3 flex items-center gap-2.5 shadow-md text-white font-extrabold text-xs sm:text-sm text-center"
              style={{ background: "linear-gradient(90deg,#b91c1c,#dc2626,#ef4444)" }}
              data-testid="login-delivery-banner"
            >
              <Truck className="h-5 w-5 shrink-0" strokeWidth={2.5} />
              <span className="flex-1 tracking-wide">{c.delivery_banner}</span>
            </div>
          )}
          <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-secondary" />
            <span>Powered by <span className="font-bold text-primary">efoodtech</span> · Secure OTP · Multi-tenant SaaS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
