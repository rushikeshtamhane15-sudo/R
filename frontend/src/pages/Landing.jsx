import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { QrCode, Wallet, ShieldCheck, Utensils, TrendingUp, Smartphone, Ban, BadgeCheck, Wheat, Sprout, Droplet, Carrot, Sparkles, Soup } from "lucide-react";

const FOOD_IMG = "https://images.unsplash.com/photo-1676300186673-615bcc8d5d68?crop=entropy&cs=srgb&fm=jpg&q=85&w=900";
const QR_IMG = "https://images.unsplash.com/photo-1595079836278-25b7ad6d5ddb?crop=entropy&cs=srgb&fm=jpg&q=85&w=900";

export default function Landing() {
  const [content, setContent] = useState(null);

  useEffect(() => {
    (async () => { try { const r = await api.get("/content/landing"); setContent(r.data); } catch {} })();
  }, []);

  const c = content || {};
  const heroImg = c.hero_image_url || "https://images.unsplash.com/photo-1600488999806-8efb986d87b1?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600";

  return (
    <div data-testid="landing-page">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <img src={heroImg} alt="dining" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-background/85"></div>
        </div>
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-28 lg:py-36">
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-xs tracking-overline uppercase font-bold text-secondary mb-6">
            {c.hero_overline || "UPI · WALLET · E-MEAL PASS"}
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="font-display font-extrabold text-4xl sm:text-5xl lg:text-7xl tracking-tight leading-[0.95] max-w-4xl">
            <span className="text-primary">{c.hero_title_line1 || "ghar se achha khana,"}</span>{" "}
            <br className="hidden md:block" />
            {c.hero_title_line2 || "ab ek e-Meal Pass pe."}
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mt-8 text-lg max-w-xl text-muted-foreground leading-relaxed">
            {c.hero_subtitle || "30-day tiffin subscriptions with a smart wallet. Pay once by UPI, check-in by QR, skip a few days — we pause your wallet, no meals wasted."}
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-10 flex flex-wrap gap-4">
            <Link to="/login" data-testid="hero-cta-start">
              <Button size="lg" className="rounded-full bg-primary hover:bg-primary/90 px-8 h-12 text-base">{c.hero_cta_primary || "Get your e-Meal Pass"}</Button>
            </Link>
            <Link to="/plans" data-testid="hero-cta-plans">
              <Button size="lg" variant="outline" className="rounded-full px-8 h-12 text-base">{c.hero_cta_secondary || "View plans"}</Button>
            </Link>
          </motion.div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-28">
        <div className="grid md:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="md:col-span-6">
            <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-4">How it works</p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.05]">
              Pay once. Eat for 30 days. Pause when you travel.
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed max-w-lg">
              Money loads into your wallet on day one. Every day you eat, a small amount ticks down. Miss 3+ days in a row? Your subscription auto-extends — no wallet deduction on inactive days.
            </p>
            <div className="mt-10 space-y-6">
              {[
                { icon: Smartphone, t: "Pay by UPI in 10 seconds", d: "Razorpay checkout with UPI, cards, netbanking." },
                { icon: Wallet, t: "Your money lives in a wallet", d: "See ₹ ticking down every day as you eat." },
                { icon: QrCode, t: "Scan to check in", d: "Show your QR or scan the counter — your choice." },
                { icon: ShieldCheck, t: "Skip days? We pause.", d: "3+ inactive days → no deductions, auto-extend." },
              ].map((f, i) => (
                <div key={i} className="flex gap-5 items-start">
                  <div className="h-12 w-12 rounded-xl bg-accent flex items-center justify-center shrink-0">
                    <f.icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="font-display font-bold text-lg leading-tight">{f.t}</p>
                    <p className="text-muted-foreground text-sm mt-1">{f.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="md:col-span-6 grid grid-cols-2 gap-4">
            <img src={FOOD_IMG} alt="meal" className="rounded-2xl aspect-[4/5] object-cover w-full border border-border" />
            <img src={QR_IMG} alt="qr scan" className="rounded-2xl aspect-[4/5] object-cover w-full border border-border mt-10" />
          </div>
        </div>
      </section>

      <section className="bg-accent/60 border-y border-border">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-24">
          <div className="mb-12">
            <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3">Built for modern tiffin halls</p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-5xl tracking-tight max-w-xl leading-[1.05]">
              The wallet that eats with you.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Utensils, t: "Daily menu", d: "Lunch + dinner items published every day." },
              { icon: Wallet, t: "Smart wallet", d: "Auto-deduction · auto-pause · full transparency." },
              { icon: TrendingUp, t: "Admin analytics", d: "Attendance trends, revenue, wallet balances — live." },
            ].map((f, i) => (
              <div key={i} className="bg-card rounded-2xl border border-border p-8 transition-all hover:-translate-y-1 hover:shadow-lg" data-testid={`feature-card-${i}`}>
                <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <f.icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                </div>
                <p className="font-display font-bold text-xl">{f.t}</p>
                <p className="text-muted-foreground text-sm mt-2 leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Admin-editable custom sections */}
      {(c.sections || []).map((s, i) => (
        <section key={i} className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-14 md:py-20" data-testid={`custom-section-${i}`}>
          {s.align === "none" || !s.image_url ? (
            <div className="max-w-3xl">
              <h2 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight leading-[1.1]">{s.heading}</h2>
              <div className="mt-5 text-muted-foreground leading-relaxed whitespace-pre-wrap">{s.body}</div>
            </div>
          ) : (
            <div className={`grid md:grid-cols-12 gap-10 items-center ${s.align === "right" ? "md:[&>div:first-child]:order-2" : ""}`}>
              <div className="md:col-span-6">
                <img src={s.image_url} alt={s.heading} className="rounded-2xl w-full aspect-[4/3] object-cover border border-border" />
              </div>
              <div className="md:col-span-6">
                <h2 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight leading-[1.1]">{s.heading}</h2>
                <div className="mt-5 text-muted-foreground leading-relaxed whitespace-pre-wrap">{s.body}</div>
              </div>
            </div>
          )}
        </section>
      ))}

      {/* Healthy promise — what's NOT in vs what IS in */}
      <HealthyPromise />

      <section className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16 md:py-20">
        <div className="bg-primary rounded-3xl p-10 md:p-16 flex flex-col md:flex-row items-start md:items-center justify-between gap-8 text-primary-foreground">
          <div>
            <h3 className="font-display font-extrabold text-3xl md:text-4xl lg:text-5xl tracking-tight leading-[1.05]">
              ghar se achha khana, <br /> ab UPI pe.
            </h3>
            <p className="mt-4 text-primary-foreground/80 max-w-lg">Plans start at ₹1,800 for 30 days.</p>
          </div>
          <Link to="/login" data-testid="cta-footer">
            <Button size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 px-8 h-12 text-base font-bold">Start with OTP</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}

const NEVER_ITEMS = [
  { icon: Ban, label: "Ajinomoto / MSG", note: "Zero added flavour enhancers" },
  { icon: Ban, label: "Maida", note: "No refined white flour, ever" },
  { icon: Ban, label: "Artificial flavours", note: "Only real spices, real aroma" },
  { icon: Ban, label: "Artificial colours", note: "Naturally vibrant, never dyed" },
  { icon: Ban, label: "Polished grains", note: "We keep the bran, you get the fibre" },
  { icon: Ban, label: "Refined / Palm oil", note: "Cheap oils stay out of our kitchen" },
];

const ALWAYS_ITEMS = [
  { icon: Wheat, label: "Chakki atta", note: "Stone-ground whole wheat" },
  { icon: Sprout, label: "Unpolished toor dal", note: "Naturally protein-rich" },
  { icon: Soup, label: "Premium aged rice", note: "Fragrant, perfectly aged grains" },
  { icon: Carrot, label: "Fresh vegetables", note: "Sourced fresh — every single day" },
  { icon: Droplet, label: "Filter / Cold-pressed oil", note: "Wood-pressed, full of nutrients" },
  { icon: BadgeCheck, label: "Real ghar-style spices", note: "Hand-blended, small batch" },
];

function HealthyPromise() {
  return (
    <section className="relative overflow-hidden border-y border-border" data-testid="healthy-promise-section">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-accent/40 via-background to-secondary/5"></div>
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-28">
        <div className="max-w-3xl">
          <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3 flex items-center gap-1.5" data-testid="healthy-promise-overline">
            <Sparkles className="h-3.5 w-3.5" /> Our kitchen promise
          </p>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.05]">
            What's <span className="text-primary">NOT</span> in your tiffin matters as much as <span className="text-primary">what is</span>.
          </h2>
          <p className="mt-5 text-muted-foreground leading-relaxed max-w-2xl">
            Real ghar ka khana means clean, honest ingredients. Here's what we promise — and what we'll never compromise on.
          </p>
        </div>

        <div className="mt-12 grid lg:grid-cols-2 gap-6 lg:gap-8">
          {/* NEVER list */}
          <div
            className="rounded-3xl bg-card border border-border p-7 md:p-9 relative overflow-hidden"
            data-testid="never-card"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="inline-flex h-11 w-11 rounded-xl bg-destructive/10 text-destructive items-center justify-center">
                <Ban className="h-5 w-5" strokeWidth={2} />
              </span>
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-destructive">Never on your plate</p>
                <h3 className="font-display font-extrabold text-2xl leading-tight mt-1">0% the bad stuff</h3>
              </div>
            </div>
            <ul className="mt-6 divide-y divide-border">
              {NEVER_ITEMS.map((it) => (
                <li
                  key={it.label}
                  className="flex items-start gap-4 py-4"
                  data-testid={`never-item-${it.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <span className="font-display font-extrabold text-xl text-destructive shrink-0 w-12">0%</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{it.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{it.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* ALWAYS list */}
          <div
            className="rounded-3xl bg-primary text-primary-foreground p-7 md:p-9 relative overflow-hidden"
            data-testid="always-card"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="inline-flex h-11 w-11 rounded-xl bg-white/15 text-primary-foreground items-center justify-center">
                <BadgeCheck className="h-5 w-5" strokeWidth={2} />
              </span>
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/80">Always on your plate</p>
                <h3 className="font-display font-extrabold text-2xl leading-tight mt-1">100% the good stuff</h3>
              </div>
            </div>
            <ul className="mt-6 divide-y divide-white/15">
              {ALWAYS_ITEMS.map((it) => (
                <li
                  key={it.label}
                  className="flex items-start gap-4 py-4"
                  data-testid={`always-item-${it.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <span className="font-display font-extrabold text-xl shrink-0 w-12">100%</span>
                  <div className="min-w-0 flex items-start gap-3">
                    <span className="inline-flex h-7 w-7 shrink-0 rounded-full bg-white/15 items-center justify-center mt-0.5">
                      <it.icon className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                    <div>
                      <p className="font-semibold text-sm text-primary-foreground">{it.label}</p>
                      <p className="text-xs text-primary-foreground/80 mt-0.5">{it.note}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
