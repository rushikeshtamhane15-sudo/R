import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import SEO from "../components/SEO";
import PromotionPopup from "../components/PromotionPopup";
import {
  Building2, Sparkles, ShieldCheck, ScanFace, QrCode, Wallet, Rocket,
  ArrowRight, BadgeCheck, Star, MapPin, Store, PhoneCall, ChevronRight,
} from "lucide-react";

/**
 * efoodtech — fresh SaaS landing (iter-155).
 * Old efoodcare tiffin marketing replaced with multi-tenant "mess management
 * software for India" positioning. Two audiences up-top:
 *   1. Subscribers → find and join a mess near them
 *   2. Mess owners → onboard their mess and run it end-to-end
 */
export default function Landing() {
  const { user } = useAuth();
  const [messCount, setMessCount] = useState(null);
  const [featured, setFeatured] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/nearby/messes/top5");
        const messes = r.data?.messes || [];
        setMessCount(r.data?.total_in_radius || messes.length);
        setFeatured(messes.slice(0, 3));
      } catch { /* silent */ }
    })();
  }, []);

  const ownerCta = user?.role === "mess_owner" || user?.role === "admin" ? "/admin" : "/login";
  // iter-180 · Nearby mess concept removed platform-wide (no competition
  // between messes). Subscribers now go to the /benefits explainer instead.
  const subscriberCta = "/benefits";

  return (
    <div className="bg-white" data-testid="landing-page">
      <SEO title="efoodtech · Multi-tenant SaaS for messes across India · Onboard in 10 min"
        path="/"
        description="India's multi-tenant SaaS for messes: onboard in 10 min. QR + face check-in, subscriber wallets, per-mess Razorpay, 30-day meal passes. Payments land directly in your bank." />

      {/* HERO — iter-179 rebuild
           - Deep gradient stack + floating orbs + fine grain overlay for depth
           - Left column: badge / H1 / sub / CTAs / trust chips
           - Right column: layered app-preview mockups (Meal Pass QR / Wallet /
             Check-in toast / Live counter) — anchors the eye and shows product
             instead of forcing a wall of text on mobile.
      */}
      <section className="relative isolate overflow-hidden text-white" data-testid="hero"
        style={{
          background: "radial-gradient(1200px 620px at 15% -10%, #7f1d1d 0%, transparent 55%), radial-gradient(900px 520px at 105% 10%, #b91c1c 0%, transparent 55%), linear-gradient(160deg, #4c0f14 0%, #7a1418 45%, #a02323 100%)",
        }}
      >
        {/* Grain — subtle SVG noise, dampens the flat gradient */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.10] mix-blend-overlay"
          style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")" }} />
        {/* Floating orbs */}
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-300/25 blur-3xl" />
        <div className="pointer-events-none absolute top-40 -left-20 h-64 w-64 rounded-full bg-rose-400/20 blur-3xl" />
        {/* Dot-mesh */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{ backgroundImage: "radial-gradient(circle at 25% 25%, #ffffff 1px, transparent 1px)", backgroundSize: "28px 28px" }} />

        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 md:px-10 pt-12 sm:pt-16 md:pt-24 pb-16 md:pb-28">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-14 items-center">
            {/* -------- Left copy column -------- */}
            <div>
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/25 backdrop-blur-md pl-1.5 pr-3.5 py-1.5 mb-5 shadow-[0_1px_0_rgba(255,255,255,0.14)_inset,0_10px_30px_-12px_rgba(0,0,0,0.5)]"
                data-testid="hero-badge">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-400 text-red-900">
                  <Rocket className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                <span className="text-[11px] font-black uppercase tracking-[0.18em]">Live in 10 minutes</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
                className="font-display font-black text-[38px] leading-[1.02] sm:text-5xl lg:text-[64px] tracking-tight">
                Your mess.<br className="hidden sm:block" />
                <span className="relative inline-block">
                  <span className="relative z-10">Online</span>
                  <span aria-hidden className="absolute inset-x-0 bottom-1.5 h-3 sm:h-4 bg-amber-300/70 rounded-sm -z-0 skew-x-[-6deg]" />
                </span>{" "}
                in <span className="tabular-nums">10 min</span>.
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
                className="mt-5 text-[15px] sm:text-lg text-white/85 max-w-xl leading-relaxed">
                The multi-tenant SaaS for messes across India — QR + face check-in, subscriber wallets, 30-day meal passes and <span className="font-bold text-white">Razorpay payouts straight to your bank</span>. Zero platform fee to start.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}
                className="mt-8 flex flex-wrap gap-3">
                <Link to={ownerCta} data-testid="hero-cta-owner">
                  <Button size="lg" className="rounded-full bg-white text-primary hover:bg-white/95 px-7 h-12 text-sm sm:text-base font-black shadow-[0_10px_30px_-10px_rgba(0,0,0,0.55)] hover:shadow-[0_16px_36px_-10px_rgba(0,0,0,0.55)] transition-shadow">
                    <Store className="h-4 w-4 mr-2" /> Onboard my mess
                  </Button>
                </Link>
                <Link to={subscriberCta} data-testid="hero-cta-subscriber">
                  <Button size="lg" variant="outline" className="rounded-full border-white/30 hover:bg-white/10 text-white px-7 h-12 text-sm sm:text-base font-bold bg-white/5 backdrop-blur">
                    Find messes near me <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </motion.div>

              {/* Pill trust chips */}
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                className="mt-7 flex flex-wrap gap-2" data-testid="hero-trust-strip">
                {[
                  { icon: BadgeCheck, text: "No app install" },
                  { icon: ShieldCheck, text: "Direct-to-bank payouts" },
                  { icon: Star, text: "Zero platform fee" },
                ].map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-md px-3 py-1 text-[11px] font-semibold text-white/90">
                    <c.icon className="h-3.5 w-3.5" strokeWidth={2.25} /> {c.text}
                  </span>
                ))}
              </motion.div>
            </div>

            {/* -------- Right visual column — app-preview mockups -------- */}
            <motion.div
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.45 }}
              className="relative h-[380px] sm:h-[440px] lg:h-[520px] mt-4 lg:mt-0"
              data-testid="hero-mockups"
            >
              {/* Halo behind the stack */}
              <div className="absolute inset-0 rounded-[36px] bg-gradient-to-br from-white/15 via-white/5 to-transparent border border-white/15 backdrop-blur-[2px]" />

              {/* Meal Pass card (main, back-left) */}
              <div className="absolute left-3 sm:left-6 top-5 w-[62%] sm:w-[64%] rounded-2xl bg-gradient-to-br from-white to-rose-50 text-slate-900 shadow-2xl p-4 -rotate-[6deg] border border-white/60">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-widest text-rose-700">30-day meal pass</p>
                  <span className="inline-flex h-6 items-center rounded-full bg-emerald-100 text-emerald-800 px-2 text-[9px] font-black">ACTIVE</span>
                </div>
                <p className="mt-2 text-xl sm:text-2xl font-black tracking-tight">Rahul S.</p>
                <p className="text-[11px] text-slate-500">Mess ID · MESS-C0A9</p>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Meals left</p>
                    <p className="text-2xl font-black leading-none tabular-nums">42<span className="text-sm text-slate-400"> / 60</span></p>
                  </div>
                  <div className="h-16 w-16 rounded-lg bg-slate-900 p-1.5 shadow-inner">
                    {/* Faux QR made of a CSS grid */}
                    <div className="grid grid-cols-6 gap-[2px] h-full w-full">
                      {Array.from({ length: 36 }).map((_, i) => (
                        <span key={i} className={`rounded-[1px] ${["00","01","05","06","07","0b","0c","0d","0f","10","11","14","17","1a","1c","20","22","23"].includes(i.toString(16).padStart(2,"0")) ? "bg-white" : "bg-slate-900"}`} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Wallet card (mid, front-right) */}
              <div className="absolute right-2 sm:right-4 top-24 sm:top-32 w-[56%] sm:w-[58%] rounded-2xl bg-slate-900 text-white shadow-2xl p-4 rotate-[5deg] border border-white/10">
                <div className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded-lg bg-emerald-400/20 text-emerald-300 flex items-center justify-center"><Wallet className="h-4 w-4" strokeWidth={2.4} /></span>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Subscriber wallet</p>
                </div>
                <p className="mt-3 text-xl sm:text-2xl font-black tracking-tight tabular-nums">₹ 2,940</p>
                <p className="text-[10px] text-white/50">14 days · 28 meals left</p>
                <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full w-[68%] bg-gradient-to-r from-emerald-400 to-lime-400" />
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[9px] text-white/50">
                  <span>Cron tick · 06:20 AM</span>
                  <span className="tabular-nums">−₹140 today</span>
                </div>
              </div>

              {/* Check-in success toast (top-right) */}
              <div className="absolute right-4 sm:right-8 -top-1 sm:top-2 w-[52%] sm:w-[46%] rounded-xl bg-white text-slate-900 shadow-2xl p-3 rotate-[-3deg] border border-emerald-200">
                <div className="flex items-center gap-2.5">
                  <span className="relative h-9 w-9 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
                    <ScanFace className="h-4.5 w-4.5" />
                    <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-60" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Checked in</p>
                    <p className="text-xs font-bold truncate">Ananya · Lunch</p>
                  </div>
                </div>
              </div>

              {/* Live counter (bottom-left) */}
              <div className="absolute left-0 bottom-2 w-[46%] sm:w-[42%] rounded-xl bg-white/10 border border-white/20 backdrop-blur-md text-white shadow-2xl p-3 rotate-[3deg]">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/70">Today's plate count</p>
                <p className="text-2xl font-black tabular-nums leading-none mt-1.5">238 <span className="text-[10px] text-emerald-300 align-middle">▲ 12%</span></p>
                <div className="mt-2 flex items-end gap-1 h-6">
                  {[35, 60, 48, 72, 55, 88, 70, 92].map((h, i) => (
                    <span key={i} className="w-1.5 rounded-sm bg-white/60" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Bottom decorative wave */}
        <svg aria-hidden viewBox="0 0 1440 60" className="absolute bottom-0 inset-x-0 w-full text-white" preserveAspectRatio="none">
          <path fill="currentColor" d="M0,30 C220,60 420,0 720,30 C1020,60 1220,0 1440,30 L1440,60 L0,60 Z" />
        </svg>
      </section>

      {/* WHY EFOODTECH */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 py-20" data-testid="why-section">
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest font-bold text-secondary">Why efoodtech</p>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl mt-2">A full mess kitchen, in one dashboard.</h2>
          <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">Every module a modern mess owner asks for — pre-built, per-tenant, ready to launch.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Feature icon={Building2} title="Your own tenant" copy="Custom Mess ID, logo, tagline, tag chips, hero copy — every subscriber sees YOUR brand." />
          <Feature icon={Wallet} title="Per-mess wallet + Razorpay" copy="Plug in your Razorpay keys once. Every subscription payment lands in YOUR bank, minus zero platform fees." />
          <Feature icon={ScanFace} title="QR + Face check-in" copy="Wall kiosk with camera, WhatsApp receipts, and automatic 2-meals-per-day wallet math. Grandma-proof." />
          <Feature icon={Rocket} title="30-day meal passes" copy="Sell it once, cron does the rest — daily debits, streaks, auto-pause, wallet rollovers. Zero manual work." />
          <Feature icon={ShieldCheck} title="Trusted + Verified badges" copy="Real ratings from your subscribers roll up to a Trusted pill (20 reviews · 4.0+ avg). Super-admin manually verifies premium tenants." />
          <Feature icon={Sparkles} title="Featured slot #1" copy="₹499 for 30 days pins your mess to the top of the Nearby discovery page. Slot 1 in your area, guaranteed." />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-accent/30 py-20" data-testid="how-section">
        <div className="max-w-7xl mx-auto px-6 md:px-10">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-widest font-bold text-secondary">How it works</p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl mt-2">Live in under 10 minutes.</h2>
            <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">3 short steps — most owners finish onboarding on a single WhatsApp call.</p>
          </div>
          <ol className="grid md:grid-cols-3 gap-6">
            {[
              { n: 1, t: "Onboard · 2 min", c: "Share your mess name, city and owner phone. Super-admin creates your Mess ID and WhatsApps it to you instantly." },
              { n: 2, t: "Set up · 5 min",  c: "Upload logo, add your plans, paste your Razorpay keys once. All payments land directly in your bank from day one." },
              { n: 3, t: "Go live · 3 min", c: "Share your Mess ID. Subscribers type it on /login, subscribe, and start checking in via QR + face on your wall kiosk." },
            ].map((s) => (
              <li key={s.n} className="rounded-2xl bg-white border border-slate-200 p-6 relative overflow-hidden">
                <span className="absolute -top-3 -left-3 text-[100px] font-black text-primary/5 leading-none">{s.n}</span>
                <div className="relative">
                  <div className="h-9 w-9 rounded-lg bg-primary text-white flex items-center justify-center font-bold mb-3">{s.n}</div>
                  <h3 className="font-display font-extrabold text-xl text-slate-900">{s.t}</h3>
                  <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{s.c}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* FEATURED MESSES */}
      {featured.length > 0 && (
        <section className="max-w-7xl mx-auto px-6 md:px-10 py-20" data-testid="featured-messes-section">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
            <div>
              <p className="text-xs uppercase tracking-widest font-bold text-secondary">Live on efoodtech</p>
              <h2 className="font-display font-extrabold text-3xl sm:text-4xl mt-2">Messes already serving on our platform.</h2>
            </div>
            <Link to="/pricing" className="text-primary font-semibold text-sm inline-flex items-center gap-1 hover:underline" data-testid="featured-see-all">
              See platform pricing <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featured.map((m) => (
              <Link to="/pricing" key={m.mess_id} className="rounded-2xl border border-slate-200 bg-white p-5 hover:shadow-md transition group"
                data-testid={`landing-mess-${m.mess_id}`}>
                <div className="flex items-center gap-3">
                  {m.logo_url ? (
                    <img src={m.logo_url} alt="" className="h-12 w-12 rounded-xl object-cover border border-slate-200" />
                  ) : (
                    <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Building2 className="h-6 w-6" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900 truncate">{m.name}</h3>
                      {m.is_verified && <BadgeCheck className="h-4 w-4 text-blue-600 shrink-0" />}
                      {m.is_trusted && <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3" /> {m.city}
                      <span className="ml-auto font-mono text-primary">{m.mess_id}</span>
                    </div>
                  </div>
                </div>
                {m.tagline && <p className="text-xs text-slate-600 mt-3 line-clamp-2">{m.tagline}</p>}
                <div className="flex items-center gap-1 mt-3 text-xs text-slate-500">
                  {[1,2,3,4,5].map((n) => <Star key={n} className={`h-3 w-3 ${n <= Math.round(m.avg_rating||0) ? "text-amber-500 fill-amber-500" : "text-slate-300"}`} strokeWidth={1.5} />)}
                  <span className="ml-1">{(m.avg_rating||0).toFixed(1)} · {m.review_count||0} reviews</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* FINAL CTA */}
      <section className="relative overflow-hidden bg-primary text-white" data-testid="final-cta-section">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 80% 30%, #ffffff 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        <div className="relative max-w-4xl mx-auto px-6 md:px-10 py-20 md:py-24 text-center">
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl leading-tight">Onboard your mess in 10 minutes.</h2>
          <p className="mt-5 text-white/85 text-lg max-w-2xl mx-auto">Every mess on efoodtech gets a custom Mess ID, its own branded subscriber app, wallet math on autopilot and Razorpay payments straight to the mess's bank. Zero platform fee to start.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to={ownerCta} data-testid="final-cta-owner">
              <Button size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 px-8 h-12 text-base font-bold">
                <Store className="h-4 w-4 mr-2" /> Get started · 10 min setup
              </Button>
            </Link>
            <a href="tel:+919970705391" className="inline-flex items-center gap-2 rounded-full border border-white/40 hover:bg-white/10 px-7 h-12 font-semibold" data-testid="final-cta-call">
              <PhoneCall className="h-4 w-4" /> Talk to founder · +91 99707 05391
            </a>
          </div>
        </div>
      </section>

      <PromotionPopup />
    </div>
  );
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl bg-white/10 border border-white/20 backdrop-blur p-4">
      <Icon className="h-5 w-5 text-white/80 mb-2" strokeWidth={2} />
      <div className="text-2xl font-extrabold leading-none">{value}</div>
      <div className="text-[11px] uppercase tracking-widest font-semibold text-white/70 mt-1.5">{label}</div>
    </div>
  );
}

function Feature({ icon: Icon, title, copy }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-md transition-shadow group" data-testid={`feature-${title.toLowerCase().replace(/\s+/g,'-')}`}>
      <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-white transition-colors">
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <h3 className="font-display font-extrabold text-lg text-slate-900">{title}</h3>
      <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{copy}</p>
    </div>
  );
}
