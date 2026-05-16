import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import TestimonialsSection from "../components/TestimonialsSection";
import PromotionPopup from "../components/PromotionPopup";
import SEO from "../components/SEO";
import * as Icons from "lucide-react";

const DEFAULT_HERO = "https://images.unsplash.com/photo-1600488999806-8efb986d87b1?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600";

// Pick an icon by name from lucide-react; fall back to BadgeCheck if unknown
function Icon({ name, className, strokeWidth = 1.75 }) {
  const Cmp = (name && Icons[name]) || Icons.BadgeCheck;
  return <Cmp className={className} strokeWidth={strokeWidth} />;
}

const ALWAYS_BG_CLASSES = {
  green: "bg-emerald-700 text-white",
  red: "bg-primary text-primary-foreground",
  blue: "bg-blue-700 text-white",
  amber: "bg-amber-600 text-white",
};

export default function Landing() {
  const [content, setContent] = useState(null);
  const { user } = useAuth();
  const ctaTarget = user
    ? user.role === "admin" ? "/admin" : user.role === "staff" ? "/staff/scanner" : "/dashboard"
    : "/login";
  const ctaLabelOverride = user ? "Go to dashboard" : null;

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/content/landing");
        setContent(r.data);
      } catch {}
    })();
  }, []);

  const c = content || {};
  const heroImg = c.hero_image_url || DEFAULT_HERO;

  const alwaysBgClass = useMemo(
    () => ALWAYS_BG_CLASSES[c.healthy_always_bg] || ALWAYS_BG_CLASSES.green,
    [c.healthy_always_bg]
  );

  return (
    <div data-testid="landing-page">
      <SEO
        title="Subscription tiffin · ghar se accha khana"
        path="/home"
        description="India's first zero adulteration meal app · 30-day subscription tiffin plans with smart wallet & QR check-in. No Ajinomoto, No Maida, No Refined or Palm oil. Subscribe in minutes via UPI."
      />
      {/* Hero */}
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
            <Link to={ctaTarget} data-testid="hero-cta-start">
              <Button size="lg" className="rounded-full bg-primary hover:bg-primary/90 px-8 h-12 text-base">{ctaLabelOverride || c.hero_cta_primary || "Get your e-Meal Pass"}</Button>
            </Link>
            <Link to="/plans" data-testid="hero-cta-plans">
              <Button size="lg" variant="outline" className="rounded-full px-8 h-12 text-base">{c.hero_cta_secondary || "View plans"}</Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-28">
        <div className="grid md:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="md:col-span-6">
            <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-4">{c.how_overline || "How it works"}</p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.05]">
              {c.how_title || "Pay once. Eat for 30 days. Pause when you travel."}
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed max-w-lg whitespace-pre-line">
              {c.how_body || "Money loads into your wallet on day one. Every day you eat, a small amount ticks down."}
            </p>
            <div className="mt-10 space-y-6">
              {(c.how_features || []).map((f, i) => (
                <div key={i} className="flex gap-5 items-start" data-testid={`how-feature-${i}`}>
                  <div className="h-12 w-12 rounded-xl bg-accent flex items-center justify-center shrink-0">
                    <Icon name={f.icon} className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-display font-bold text-lg leading-tight">{f.title}</p>
                    <p className="text-muted-foreground text-sm mt-1">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="md:col-span-6 grid grid-cols-2 gap-4">
            {c.how_image_1 && <img src={c.how_image_1} alt="meal" className="surface-3d rounded-2xl aspect-[4/5] object-cover w-full border border-border" />}
            {c.how_image_2 && <img src={c.how_image_2} alt="qr scan" className="surface-3d rounded-2xl aspect-[4/5] object-cover w-full border border-border mt-10" />}
          </div>
        </div>
      </section>

      {/* Features band */}
      <section className="bg-accent/60 border-y border-border">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-24">
          <div className="mb-12">
            <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3">{c.band_overline || "Built for modern tiffin halls"}</p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-5xl tracking-tight max-w-xl leading-[1.05]">
              {c.band_title || "The wallet that eats with you."}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(c.band_items || []).map((f, i) => (
              <div key={i} className="surface-3d tile-3d bg-card rounded-2xl border border-border p-8 transition-all hover:-translate-y-1" data-testid={`feature-card-${i}`}>
                <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <Icon name={f.icon} className="h-5 w-5 text-primary" />
                </div>
                <p className="font-display font-bold text-xl">{f.title}</p>
                <p className="text-muted-foreground text-sm mt-2 leading-relaxed">{f.body}</p>
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

      <HealthyPromise c={c} alwaysBgClass={alwaysBgClass} />

      <TestimonialsSection />

      {/* Final CTA */}
      <section className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16 md:py-20">
        <div className="bg-primary rounded-3xl p-10 md:p-16 flex flex-col md:flex-row items-start md:items-center justify-between gap-8 text-primary-foreground">
          <div>
            <h3 className="font-display font-extrabold text-3xl md:text-4xl lg:text-5xl tracking-tight leading-[1.05]">
              {c.cta_title_line1 || "ghar se achha khana,"} <br />
              {c.cta_title_line2 || "ab UPI pe."}
            </h3>
            <p className="mt-4 text-primary-foreground/80 max-w-lg">{c.cta_subtitle || "Plans start at ₹1,800 for 30 days."}</p>
          </div>
          <Link to={ctaTarget} data-testid="cta-footer">
            <Button size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 px-8 h-12 text-base font-bold">
              {ctaLabelOverride || c.cta_button_label || "Start with OTP"}
            </Button>
          </Link>
        </div>
      </section>
      <PromotionPopup />
    </div>
  );
}

function HealthyPromise({ c, alwaysBgClass }) {
  const never = c.healthy_never_items || [];
  const always = c.healthy_always_items || [];
  return (
    <section className="relative overflow-hidden border-y border-border" data-testid="healthy-promise-section">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-accent/40 via-background to-secondary/5"></div>
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-28">
        <div className="max-w-3xl">
          <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3 flex items-center gap-1.5" data-testid="healthy-promise-overline">
            <Icons.Sparkles className="h-3.5 w-3.5" /> {c.healthy_overline || "Our kitchen promise"}
          </p>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.05]">
            {c.healthy_title_part_1 || "What's "}
            <span className="text-primary">{c.healthy_title_highlight_1 || "NOT"}</span>
            {c.healthy_title_part_2 || " in your tiffin matters as much as "}
            <span className="text-primary">{c.healthy_title_highlight_2 || "what is"}</span>
            {c.healthy_title_part_3 || "."}
          </h2>
          <p className="mt-5 text-muted-foreground leading-relaxed max-w-2xl whitespace-pre-line">
            {c.healthy_subtitle || "Real ghar ka khana means clean, honest ingredients."}
          </p>
        </div>

        <div className="mt-12 grid lg:grid-cols-2 gap-6 lg:gap-8">
          {/* NEVER list */}
          <div className="surface-3d rounded-3xl bg-card border border-border p-7 md:p-9 relative overflow-hidden" data-testid="never-card">
            <div className="flex items-center gap-3 mb-2">
              <span className="inline-flex h-11 w-11 rounded-xl bg-destructive/10 text-destructive items-center justify-center">
                <Icons.Ban className="h-5 w-5" strokeWidth={2} />
              </span>
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-destructive">{c.healthy_never_title || "Never on your plate"}</p>
                <h3 className="font-display font-extrabold text-2xl leading-tight mt-1">{c.healthy_never_heading || "0% the bad stuff"}</h3>
              </div>
            </div>
            <ul className="mt-6 divide-y divide-border">
              {never.map((it, i) => (
                <li key={i} className="flex items-start gap-4 py-4" data-testid={`never-item-${i}`}>
                  <span className="font-display font-extrabold text-xl text-destructive shrink-0 w-12">0%</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{it.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{it.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* ALWAYS list — admin-selectable bg */}
          <div className={`surface-3d rounded-3xl p-7 md:p-9 relative overflow-hidden ${alwaysBgClass}`} data-testid="always-card">
            <div className="flex items-center gap-3 mb-2">
              <span className="inline-flex h-11 w-11 rounded-xl bg-white/15 text-white items-center justify-center">
                <Icons.BadgeCheck className="h-5 w-5" strokeWidth={2} />
              </span>
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-white/80">{c.healthy_always_title || "Always on your plate"}</p>
                <h3 className="font-display font-extrabold text-2xl leading-tight mt-1">{c.healthy_always_heading || "100% the good stuff"}</h3>
              </div>
            </div>
            <ul className="mt-6 divide-y divide-white/15">
              {always.map((it, i) => (
                <li key={i} className="flex items-start gap-4 py-4" data-testid={`always-item-${i}`}>
                  <span className="font-display font-extrabold text-xl shrink-0 w-12">100%</span>
                  <div className="min-w-0 flex items-start gap-3">
                    <span className="inline-flex h-7 w-7 shrink-0 rounded-full bg-white/15 items-center justify-center mt-0.5">
                      <Icon name={it.icon} className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                    <div>
                      <p className="font-semibold text-sm">{it.label}</p>
                      <p className="text-xs text-white/80 mt-0.5">{it.note}</p>
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
