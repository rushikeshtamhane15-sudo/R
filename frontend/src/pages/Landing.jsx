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
  const subscriberCta = user ? "/nearby" : "/nearby";

  return (
    <div className="bg-white" data-testid="landing-page">
      <SEO title="efoodtech · Multi-tenant SaaS for messes across India · Onboard in 10 min"
        path="/"
        description="India's multi-tenant SaaS for messes: onboard in 10 min. QR + face check-in, subscriber wallets, per-mess Razorpay, 30-day meal passes. Payments land directly in your bank." />

      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-red-800 text-white" data-testid="hero">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 25% 25%, #ffffff 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="relative max-w-7xl mx-auto px-6 md:px-10 pt-16 md:pt-24 pb-20 md:pb-28">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-10 items-center">
            <div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 backdrop-blur px-3 py-1.5 mb-5"
                data-testid="hero-badge">
                <Rocket className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold uppercase tracking-widest">Onboard your mess in 10 minutes</span>
              </motion.div>
              <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
                className="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight">
                Your mess.{" "}
                <span className="text-white/90 underline decoration-white/40 decoration-4 underline-offset-4">Online in 10 minutes.</span>
              </motion.h1>
              <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
                className="mt-5 text-lg sm:text-xl text-white/85 max-w-2xl leading-relaxed">
                <b>efoodtech</b> is the multi-tenant SaaS messes across India run on — QR + face check-in, subscriber wallets, 30-day meal passes and <b>direct Razorpay payments to your bank</b>. Sign up, upload your logo, and your subscribers are checking in the same evening.
              </motion.p>
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}
                className="mt-8 flex flex-wrap gap-3">
                <Link to={ownerCta} data-testid="hero-cta-owner">
                  <Button size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 px-7 h-12 text-base font-bold">
                    <Store className="h-4 w-4 mr-2" /> Onboard my mess · 10 min
                  </Button>
                </Link>
                <Link to={subscriberCta} data-testid="hero-cta-subscriber">
                  <Button size="lg" variant="outline" className="rounded-full border-white/40 hover:bg-white/10 text-white px-7 h-12 text-base font-semibold bg-transparent">
                    Find messes near me <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </motion.div>
              <div className="mt-8 flex flex-wrap gap-6 text-xs sm:text-sm text-white/80" data-testid="hero-trust-strip">
                <div className="flex items-center gap-1.5"><BadgeCheck className="h-4 w-4" /> No app install · runs on any phone</div>
                <div className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> Payments land directly in your bank</div>
                <div className="flex items-center gap-1.5"><Star className="h-4 w-4 fill-white" /> Zero platform fee to start</div>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-4" data-testid="hero-stats">
              <StatCard label="Setup time" value="10 min" icon={Rocket} />
              <StatCard label="Messes on platform" value={messCount ?? "—"} icon={Building2} />
              <StatCard label="Check-in modes" value="QR + Face" icon={ScanFace} />
              <StatCard label="Payment routing" value="Direct to mess" icon={Wallet} />
            </div>
          </div>
        </div>
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
            <Link to="/nearby" className="text-primary font-semibold text-sm inline-flex items-center gap-1 hover:underline" data-testid="featured-see-all">
              See all <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featured.map((m) => (
              <Link to="/nearby" key={m.mess_id} className="rounded-2xl border border-slate-200 bg-white p-5 hover:shadow-md transition group"
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
