import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "../components/ui/button";
import SEO from "../components/SEO";
import {
  Wallet, ScanFace, QrCode, MessageCircle, Flame, CalendarX,
  BadgeCheck, ArrowRight, Sparkles, ShieldCheck, Utensils, Truck,
  Bell, Star, Quote, MapPin, Rocket,
} from "lucide-react";

/**
 * Benefits.jsx — iter-179
 *
 * Subscriber-facing feature explainer for eFoodTech. Answers "what do I as a
 * subscriber get out of eFoodTech" — as opposed to Landing.jsx which is a
 * B2B SaaS pitch for mess owners.
 *
 * Layout:
 *   1. Hero — subscriber-first headline + CTA to Nearby / Plans
 *   2. Feature grid (6 tiles, rich icons on tinted panels)
 *   3. Mockup section — Meal pass + wallet render (CSS-only, same style as
 *      Landing hero mockups so the brand feels continuous)
 *   4. Testimonial pull-quotes
 *   5. FAQ strip
 *   6. Final CTA
 */
export default function Benefits() {
  return (
    <div className="bg-white" data-testid="benefits-page">
      <SEO title="Why efoodtech · Benefits for subscribers"
        path="/benefits"
        description="Meals sorted. Wallet in your pocket. QR + face check-in, 30-day meal passes, skip-a-day flexibility and WhatsApp receipts. Everything eFoodTech does for you." />

      {/* -------------------------------------------------- HERO */}
      <section
        className="relative isolate overflow-hidden text-white"
        data-testid="benefits-hero"
        style={{
          background: "radial-gradient(1100px 560px at 10% -20%, #065f46 0%, transparent 55%), radial-gradient(900px 500px at 110% 20%, #0891b2 0%, transparent 60%), linear-gradient(160deg, #052e2b 0%, #0f4c47 50%, #115e59 100%)",
        }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-[0.10] mix-blend-overlay"
          style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")" }} />
        <div className="pointer-events-none absolute -top-20 -left-16 h-72 w-72 rounded-full bg-lime-300/20 blur-3xl" />
        <div className="pointer-events-none absolute top-40 -right-20 h-64 w-64 rounded-full bg-cyan-400/25 blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 md:px-10 pt-14 sm:pt-20 pb-16 md:pb-24">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
            <div>
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/25 backdrop-blur-md pl-1.5 pr-3.5 py-1.5 mb-5 shadow-[0_1px_0_rgba(255,255,255,0.14)_inset]"
                data-testid="benefits-hero-badge">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-lime-300 text-emerald-900">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.6} />
                </span>
                <span className="text-[11px] font-black uppercase tracking-[0.18em]">For subscribers</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
                className="font-display font-black text-[38px] leading-[1.03] sm:text-5xl lg:text-[60px] tracking-tight">
                Meals sorted.<br className="hidden sm:block" />
                <span className="relative inline-block">
                  <span className="relative z-10">Wallet</span>
                  <span aria-hidden className="absolute inset-x-0 bottom-1.5 h-3 sm:h-4 bg-lime-300/70 rounded-sm -z-0 skew-x-[-6deg]" />
                </span>{" "}
                in your pocket.
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
                className="mt-5 text-[15px] sm:text-lg text-white/85 max-w-xl leading-relaxed">
                One 30-day pass. Two meals a day. Face or QR scan and you're in. Wallet keeps count, WhatsApp keeps the receipt. Skip a day — your pass patiently waits.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}
                className="mt-8 flex flex-wrap gap-3">
                <Link to="/plans" data-testid="benefits-cta-plans-primary">
                  <Button size="lg" className="rounded-full bg-white text-emerald-800 hover:bg-white/95 px-7 h-12 text-sm sm:text-base font-black shadow-[0_10px_30px_-10px_rgba(0,0,0,0.55)]">
                    <Utensils className="h-4 w-4 mr-2" /> See meal plans
                  </Button>
                </Link>
                <Link to="/plans" data-testid="benefits-cta-plans">
                  <Button size="lg" variant="outline" className="rounded-full border-white/30 hover:bg-white/10 text-white px-7 h-12 text-sm sm:text-base font-bold bg-white/5 backdrop-blur">
                    See plans <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </motion.div>

              <div className="mt-7 flex flex-wrap gap-2" data-testid="benefits-trust-chips">
                {[
                  { icon: BadgeCheck, text: "No app install" },
                  { icon: ShieldCheck, text: "Wallet auto-refund on skip" },
                  { icon: Bell,       text: "WhatsApp meal receipts" },
                ].map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-md px-3 py-1 text-[11px] font-semibold text-white/90">
                    <c.icon className="h-3.5 w-3.5" strokeWidth={2.25} /> {c.text}
                  </span>
                ))}
              </div>
            </div>

            {/* Mockup stack — greens for subscribers */}
            <div className="relative h-[380px] sm:h-[440px] lg:h-[500px] mt-2 lg:mt-0" data-testid="benefits-mockups">
              <div className="absolute inset-0 rounded-[36px] bg-gradient-to-br from-white/15 via-white/5 to-transparent border border-white/15 backdrop-blur-[2px]" />

              {/* Meal Pass */}
              <div className="absolute left-3 sm:left-6 top-6 w-[62%] sm:w-[62%] rounded-2xl bg-gradient-to-br from-white to-emerald-50 text-slate-900 shadow-2xl p-4 -rotate-[5deg] border border-white/60">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Your meal pass</p>
                  <span className="inline-flex h-6 items-center rounded-full bg-emerald-100 text-emerald-800 px-2 text-[9px] font-black">ACTIVE</span>
                </div>
                <p className="mt-2 text-xl sm:text-2xl font-black tracking-tight">Priya M.</p>
                <p className="text-[11px] text-slate-500">Mess · efoodcare Amravati</p>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Meals left</p>
                    <p className="text-2xl font-black leading-none tabular-nums">36<span className="text-sm text-slate-400"> / 60</span></p>
                  </div>
                  <div className="h-16 w-16 rounded-lg bg-slate-900 p-1.5 shadow-inner">
                    <div className="grid grid-cols-6 gap-[2px] h-full w-full">
                      {Array.from({ length: 36 }).map((_, i) => (
                        <span key={i} className={`rounded-[1px] ${["00","02","03","07","09","0c","0f","11","14","17","18","1c","1e","20","22"].includes(i.toString(16).padStart(2, "0")) ? "bg-white" : "bg-slate-900"}`} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Wallet */}
              <div className="absolute right-2 sm:right-4 top-24 sm:top-32 w-[56%] sm:w-[56%] rounded-2xl bg-slate-900 text-white shadow-2xl p-4 rotate-[5deg] border border-white/10">
                <div className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded-lg bg-lime-400/20 text-lime-300 flex items-center justify-center"><Wallet className="h-4 w-4" strokeWidth={2.4} /></span>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Your wallet</p>
                </div>
                <p className="mt-3 text-xl sm:text-2xl font-black tracking-tight tabular-nums">₹ 2,520</p>
                <p className="text-[10px] text-white/50">18 days · 36 meals left</p>
                <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full w-[60%] bg-gradient-to-r from-lime-400 to-emerald-400" />
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[9px] text-white/50">
                  <span>Auto-pause on skip</span>
                  <span className="tabular-nums">Fair usage</span>
                </div>
              </div>

              {/* WhatsApp receipt */}
              <div className="absolute right-4 sm:right-8 -top-1 sm:top-2 w-[52%] sm:w-[46%] rounded-xl bg-white text-slate-900 shadow-2xl p-3 rotate-[-3deg] border border-emerald-200">
                <div className="flex items-center gap-2.5">
                  <span className="h-9 w-9 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow"><MessageCircle className="h-4.5 w-4.5" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">WhatsApp receipt</p>
                    <p className="text-xs font-bold truncate">Lunch · ₹70 debited</p>
                  </div>
                </div>
              </div>

              {/* Streak */}
              <div className="absolute left-0 bottom-2 w-[46%] sm:w-[42%] rounded-xl bg-white/10 border border-white/20 backdrop-blur-md text-white shadow-2xl p-3 rotate-[3deg]">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/70">Meal streak</p>
                <p className="text-2xl font-black tabular-nums leading-none mt-1.5 flex items-center gap-1.5">
                  14<span className="text-amber-300"><Flame className="h-5 w-5 fill-amber-400" /></span>
                </p>
                <p className="mt-1 text-[10px] text-white/70">days on-the-trot</p>
              </div>
            </div>
          </div>
        </div>

        <svg aria-hidden viewBox="0 0 1440 60" className="absolute bottom-0 inset-x-0 w-full text-white" preserveAspectRatio="none">
          <path fill="currentColor" d="M0,30 C220,60 420,0 720,30 C1020,60 1220,0 1440,30 L1440,60 L0,60 Z" />
        </svg>
      </section>

      {/* -------------------------------------------------- FEATURE GRID */}
      <section className="max-w-7xl mx-auto px-5 sm:px-8 md:px-10 py-20" data-testid="benefits-features">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-xs uppercase tracking-widest font-black text-emerald-700">Six ways we save your day</p>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl mt-2">Every daily annoyance, quietly solved.</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="benefits-feature-grid">
          <FeatureTile
            icon={ScanFace}
            tone="rose"
            title="QR + Face check-in"
            copy="Walk in, glance at the tablet — your meal is logged. No token queue, no cash box, no register hunt."
          />
          <FeatureTile
            icon={Wallet}
            tone="emerald"
            title="Wallet on autopilot"
            copy="Every meal debits itself at the right slot. Skip 3 days in a row and the wallet auto-pauses — nothing is wasted."
          />
          <FeatureTile
            icon={QrCode}
            tone="amber"
            title="30-day meal pass"
            copy="Pay once, eat for a month. Two meals a day, half-tiffin available, and your unused meals roll over till the pass ends."
          />
          <FeatureTile
            icon={Flame}
            tone="orange"
            title="Streaks + rewards"
            copy="Show up daily and earn streak badges. 7-day, 30-day and mess-wide leaderboards. Bragging rights sold separately."
          />
          <FeatureTile
            icon={MessageCircle}
            tone="green"
            title="WhatsApp receipts"
            copy="Every scan pings a receipt to your WhatsApp. Meal type, wallet balance, days-left — all in one line."
          />
          <FeatureTile
            icon={CalendarX}
            tone="slate"
            title="Skip a day, no drama"
            copy="Out for a wedding? Pause your day in the app. No debit, no drama. Your pass patiently waits for you."
          />
        </div>
      </section>

      {/* -------------------------------------------------- HOW A DAY LOOKS */}
      <section className="bg-slate-50 py-20 border-y border-slate-200" data-testid="benefits-day">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 md:px-10">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-widest font-black text-emerald-700">A day on efoodtech</p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl mt-2">From "kya khana hai" to "khana done".</h2>
          </div>
          <ol className="grid md:grid-cols-3 gap-6">
            {[
              { n: 1, t: "12:45 PM — Walk in", c: "Head to the mess, phone in your pocket. Your pass is already ready on efoodtech." },
              { n: 2, t: "12:46 PM — Face scan", c: "Look at the wall kiosk. Green ring, ding, done. Lunch is logged, wallet ticks −₹70." },
              { n: 3, t: "12:47 PM — Eat",     c: "WhatsApp pings your receipt. Days-left updates. You already know when to renew." },
            ].map((s) => (
              <li key={s.n} className="rounded-2xl bg-white border border-slate-200 p-6 relative overflow-hidden shadow-sm">
                <span className="absolute -top-3 -left-3 text-[100px] font-black text-emerald-600/[0.06] leading-none">{s.n}</span>
                <div className="relative">
                  <div className="h-9 w-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold mb-3">{s.n}</div>
                  <h3 className="font-display font-extrabold text-lg text-slate-900">{s.t}</h3>
                  <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{s.c}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* -------------------------------------------------- TESTIMONIALS */}
      <section className="max-w-7xl mx-auto px-5 sm:px-8 md:px-10 py-20" data-testid="benefits-testimonials">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-xs uppercase tracking-widest font-black text-emerald-700">Subscribers say</p>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl mt-2">Real people. Real meals. Real time saved.</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { name: "Rahul S.", city: "Amravati · IT dept", quote: "Cash-box drama vanished. I just glance, ding, sit. Wallet does the math." },
            { name: "Priya M.", city: "Pune · MBA student", quote: "Skipped 4 days for a wedding — my pass just waited. Zero paise wasted." },
            { name: "Aman K.",  city: "Nagpur · rider",      quote: "Face scan even with helmet on. Faster than reaching for a token." },
          ].map((t, i) => (
            <figure key={i} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm relative overflow-hidden" data-testid={`benefits-testimonial-${i}`}>
              <Quote className="absolute top-3 right-3 h-8 w-8 text-emerald-600/10" />
              <blockquote className="text-slate-800 leading-relaxed text-[15px]">"{t.quote}"</blockquote>
              <figcaption className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-3">
                <span className="h-9 w-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-black text-sm">{t.name[0]}</span>
                <div>
                  <p className="text-sm font-black text-slate-900">{t.name}</p>
                  <p className="text-[11px] text-slate-500">{t.city}</p>
                </div>
                <div className="ml-auto flex items-center gap-0.5">
                  {[0,1,2,3,4].map((n) => <Star key={n} className="h-3 w-3 text-amber-500 fill-amber-500" strokeWidth={1.5} />)}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------- FAQ */}
      <section className="bg-slate-50 py-20 border-y border-slate-200" data-testid="benefits-faq">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 md:px-10">
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-widest font-black text-emerald-700">Straight answers</p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl mt-2">Quick FAQ.</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {[
              { q: "Do I need to download an app?",        a: "No. efoodtech opens in any phone browser. Tap Add to Home Screen for one-tap access." },
              { q: "What if I skip a day?",                a: "Pause it in the app — the wallet doesn't debit. Skip 3+ in a row and it auto-pauses." },
              { q: "Can I share my pass with a friend?",   a: "Nope. Face + QR is tied to you. Passes are per subscriber for fair use." },
              { q: "How do I pay?",                        a: "Razorpay UPI, card or netbanking. Payment lands directly in your mess's bank." },
            ].map((f, i) => (
              <div key={i} className="rounded-xl bg-white border border-slate-200 p-5">
                <p className="font-black text-sm text-slate-900">{f.q}</p>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- FINAL CTA */}
      <section className="relative overflow-hidden bg-emerald-700 text-white" data-testid="benefits-final-cta">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 80% 30%, #ffffff 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        <div className="relative max-w-4xl mx-auto px-6 md:px-10 py-20 md:py-24 text-center">
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl leading-tight">Ready for meals-on-autopilot?</h2>
          <p className="mt-5 text-white/85 text-lg max-w-2xl mx-auto">Find a mess near you and start today. Pay once, eat for a month, skip whenever you want.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/plans" data-testid="benefits-final-plans">
              <Button size="lg" className="rounded-full bg-white text-emerald-800 hover:bg-white/90 px-8 h-12 text-base font-black">
                <Utensils className="h-4 w-4 mr-2" /> See meal plans
              </Button>
            </Link>
            <Link to="/login" data-testid="benefits-final-login">
              <Button size="lg" variant="outline" className="rounded-full border-white/30 hover:bg-white/10 text-white px-7 h-12 font-bold bg-white/5 backdrop-blur">
                Login to my mess <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

const TONES = {
  rose:    { bg: "bg-rose-50",    icon: "text-rose-600",    accent: "group-hover:bg-rose-600" },
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-600", accent: "group-hover:bg-emerald-600" },
  amber:   { bg: "bg-amber-50",   icon: "text-amber-600",   accent: "group-hover:bg-amber-600" },
  orange:  { bg: "bg-orange-50",  icon: "text-orange-600",  accent: "group-hover:bg-orange-600" },
  green:   { bg: "bg-lime-50",    icon: "text-lime-600",    accent: "group-hover:bg-lime-600" },
  slate:   { bg: "bg-slate-100",  icon: "text-slate-700",   accent: "group-hover:bg-slate-800" },
};

function FeatureTile({ icon: Icon, title, copy, tone = "emerald" }) {
  const t = TONES[tone] || TONES.emerald;
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-lg hover:-translate-y-0.5 transition group"
      data-testid={`benefits-feature-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className={`h-11 w-11 rounded-xl ${t.bg} ${t.icon} flex items-center justify-center mb-4 ${t.accent} group-hover:text-white transition-colors`}>
        <Icon className="h-5 w-5" strokeWidth={2.2} />
      </div>
      <h3 className="font-display font-black text-lg text-slate-900">{title}</h3>
      <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{copy}</p>
    </div>
  );
}
