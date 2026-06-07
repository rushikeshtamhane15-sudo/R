import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import SEO from "../components/SEO";
import {
  ShieldCheck, Leaf, Sparkles, Heart, Truck, ChefHat, Users, Award,
  MapPin, Phone, Mail, ArrowRight, Utensils,
} from "lucide-react";

const PROMISE_ICONS = [ShieldCheck, Leaf, Utensils, Sparkles];

/**
 * About — iter-73 #11 · iter-75 #3 fully CMS-driven (text + colours).
 *
 * Iter-75 fixes:
 *   • Hero padding cut by 50% so the overline + H1 are visible on a 414-wide
 *     mobile viewport without scrolling. Stats grid now fits in the same
 *     fold.
 *   • All copy + bg/text colours pulled from /api/content/about; admins
 *     edit via the AdminContent dashboard.
 */
export default function About() {
  const [c, setC] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get("/content/about")
      .then((r) => { if (alive) setC(r.data || {}); })
      .catch(() => { if (alive) setC({}); });
    return () => { alive = false; };
  }, []);

  if (!c) return <div className="min-h-screen bg-background" data-testid="about-loading" />;

  const stats = [
    { value: c.stat_1_value, label: c.stat_1_label },
    { value: c.stat_2_value, label: c.stat_2_label },
    { value: c.stat_3_value, label: c.stat_3_label },
    { value: c.stat_4_value, label: c.stat_4_label },
  ].filter((s) => s.value);
  const promises = [1,2,3,4].map((i, idx) => ({
    icon: PROMISE_ICONS[idx],
    title: c[`promise_${i}_title`],
    body: c[`promise_${i}_body`],
  })).filter((p) => p.title);
  const timeline = [1,2,3,4].map((i) => ({
    year: c[`tl_${i}_year`], title: c[`tl_${i}_title`], body: c[`tl_${i}_body`],
  })).filter((t) => t.year);

  return (
    <div className="bg-background" data-testid="about-page">
      <SEO
        title="About efoodcare · zero-adulteration mess + restaurant"
        path="/about"
        description="efoodcare is Amravati's first zero-adulteration mess + restaurant. FSSAI-licensed, paperless, with a 30-day subscription pass, QR check-in and a wallet that pauses on skip-days."
      />

      {/* === HERO (compact) =================================================== */}
      <section
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${c.hero_bg_from || "#a02323"} 0%, ${c.hero_bg_to || "#7a1818"} 100%)`,
          color: c.hero_text_color || "#fff5f1",
        }}
      >
        <div className="absolute inset-0 pointer-events-none opacity-[0.08]"
             style={{ backgroundImage: "radial-gradient(circle at 20% 20%, white 2px, transparent 2px), radial-gradient(circle at 80% 60%, white 1.5px, transparent 1.5px)", backgroundSize: "40px 40px, 60px 60px" }} />
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 sm:py-10 md:py-14 relative">
          {c.hero_overline && (
            <p className="text-[10px] sm:text-[11px] tracking-[0.22em] uppercase font-bold text-secondary mb-2" data-testid="about-overline">
              {c.hero_overline}
            </p>
          )}
          {c.hero_headline && (
            <h1
              className="font-display font-extrabold text-2xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.05] max-w-3xl"
              data-testid="about-headline"
            >
              {c.hero_headline}
            </h1>
          )}
          {c.hero_lede && (
            <p className="mt-3 sm:mt-4 text-[13.5px] sm:text-base lg:text-lg max-w-2xl leading-relaxed" data-testid="about-lede" style={{ color: c.hero_text_color || "#fff5f1", opacity: 0.92 }}>
              {c.hero_lede}
            </p>
          )}
          <div className="mt-4 sm:mt-5 flex flex-wrap gap-2">
            {c.cta_primary_label && (
              <Link to={c.cta_primary_to || "/plans"} data-testid="about-cta-plans"
                className="inline-flex items-center gap-1.5 rounded-full bg-white text-primary px-4 sm:px-5 h-10 font-extrabold text-[12.5px] sm:text-sm hover:shadow-xl hover:-translate-y-0.5 transition-all"
              >
                {c.cta_primary_label} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
            {c.cta_secondary_label && (
              <Link to={c.cta_secondary_to || "/contact"} data-testid="about-cta-contact"
                className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur text-white px-4 sm:px-5 h-10 font-extrabold text-[12.5px] sm:text-sm hover:bg-white/25 transition-colors"
              >
                {c.cta_secondary_label}
              </Link>
            )}
          </div>

          {stats.length > 0 && (
            <div className="mt-6 sm:mt-8 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3" data-testid="about-stats">
              {stats.map((s, i) => (
                <div key={i}
                  className="rounded-xl backdrop-blur border border-white/15 px-3 py-2.5"
                  style={{ background: c.stats_bg || "rgba(255,255,255,0.10)", color: c.stats_text_color || "#ffffff" }}
                  data-testid={`about-stat-${i}`}
                >
                  <p className="font-mono font-extrabold text-[13px] sm:text-base tabular-nums leading-tight break-all">{s.value}</p>
                  <p className="text-[9px] sm:text-[10px] tracking-[0.16em] uppercase font-bold opacity-80 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* === PROMISE GRID ==================================================== */}
      {promises.length > 0 && (
        <section
          className="px-5 sm:px-8 py-10 sm:py-14"
          style={{ background: c.promise_bg || "#ffffff", color: c.promise_text_color || "#0c0c0c" }}
          data-testid="about-promise-section"
        >
          <div className="max-w-6xl mx-auto">
            <p className="text-[11px] tracking-[0.22em] uppercase font-bold text-secondary">The efoodcare promise</p>
            <h2 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-2 max-w-2xl leading-[1.05]" style={{ color: c.promise_text_color || "#0c0c0c" }}>
              {c.promise_heading}
            </h2>
            <div className="mt-6 grid sm:grid-cols-2 gap-3 sm:gap-4">
              {promises.map((p, i) => (
                <div key={i}
                  className="rounded-2xl border border-border p-4 sm:p-5 transition-all hover:-translate-y-0.5"
                  style={{ background: c.promise_bg || "#ffffff", color: c.promise_text_color || "#0c0c0c" }}
                  data-testid={`about-promise-${i}`}
                >
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                    <p.icon className="h-4 w-4 text-primary" strokeWidth={1.85} />
                  </div>
                  <p className="font-display font-extrabold text-base sm:text-lg leading-tight">{p.title}</p>
                  <p className="text-[12.5px] sm:text-sm mt-1.5 leading-relaxed opacity-80">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* === TIMELINE ======================================================== */}
      {timeline.length > 0 && (
        <section
          className="border-y border-border px-5 sm:px-8 py-10 sm:py-14"
          style={{ background: c.timeline_bg || "#f5efe7", color: c.timeline_text_color || "#0c0c0c" }}
          data-testid="about-timeline-section"
        >
          <div className="max-w-6xl mx-auto">
            <p className="text-[11px] tracking-[0.22em] uppercase font-bold text-secondary">How we got here</p>
            <h2 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-2 max-w-2xl leading-[1.05]">{c.timeline_heading}</h2>
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" data-testid="about-timeline">
              {timeline.map((t, i) => (
                <div key={i} className="rounded-2xl bg-white border border-border p-3.5 sm:p-4" data-testid={`about-timeline-${i}`}>
                  <span className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-primary text-white text-xs font-extrabold mb-2.5">{t.year}</span>
                  <p className="font-display font-extrabold text-sm leading-tight">{t.title}</p>
                  <p className="text-[11.5px] mt-1.5 leading-relaxed opacity-75">{t.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* === FOUNDER / KITCHEN ================================================ */}
      {c.founder_quote && (
        <section
          className="px-5 sm:px-8 py-10 sm:py-14"
          style={{ background: c.founder_bg || "#ffffff", color: c.founder_text_color || "#0c0c0c" }}
          data-testid="about-founder-section"
        >
          <div className="max-w-6xl mx-auto grid md:grid-cols-12 gap-6 sm:gap-8 items-center">
            <div className="md:col-span-7">
              <p className="text-[11px] tracking-[0.22em] uppercase font-bold text-secondary">Founder&apos;s note</p>
              <h2 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-2 leading-[1.05]">{c.founder_quote}</h2>
              <p className="mt-4 text-[13.5px] sm:text-[15px] leading-relaxed opacity-85">{c.founder_body}</p>
              <p className="mt-3 text-xs sm:text-sm font-extrabold">— {c.founder_name} <span className="font-normal opacity-70">· {c.founder_role}</span></p>
              <div className="mt-5 flex flex-wrap gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 font-bold"><ChefHat className="h-3 w-3" /> FSSAI-licensed</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 font-bold"><Award className="h-3 w-3" /> 100% pure veg</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2.5 py-1 font-bold"><Heart className="h-3 w-3" /> Daily kitchen photos</span>
              </div>
            </div>
            <div className="md:col-span-5 grid grid-cols-2 gap-2.5 sm:gap-3">
              {[
                { icon: ChefHat,     label: "Chef-led",     sub: "Recipes calibrated daily" },
                { icon: Users,       label: "Family-run",   sub: "No corporate shortcuts" },
                { icon: Truck,       label: "Delivery rails", sub: "Hyperlocal partner riders" },
                { icon: ShieldCheck, label: "Audited",      sub: "Every meal is QR-logged" },
              ].map((t, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-3 sm:p-4">
                  <div className="h-9 w-9 rounded-xl bg-secondary/15 flex items-center justify-center mb-2">
                    <t.icon className="h-4 w-4 text-secondary" strokeWidth={1.85} />
                  </div>
                  <p className="font-display font-extrabold text-[13px] leading-tight">{t.label}</p>
                  <p className="text-[10.5px] mt-0.5 opacity-75">{t.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* === VISIT US ======================================================== */}
      {c.visit_heading && (
        <section
          className="px-5 sm:px-8 py-10 sm:py-14"
          style={{
            background: `linear-gradient(135deg, ${c.visit_bg_from || "#a02323"} 0%, ${c.visit_bg_to || "#7a1818"} 100%)`,
            color: c.visit_text_color || "#ffffff",
          }}
          data-testid="about-visit-section"
        >
          <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-6 sm:gap-8 items-center">
            <div>
              <p className="text-[11px] tracking-[0.22em] uppercase font-bold text-secondary">Come say hi</p>
              <h2 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-2 leading-[1.05]">{c.visit_heading}</h2>
              <p className="mt-3 text-[13.5px] sm:text-base leading-relaxed opacity-90">{c.visit_body}</p>
            </div>
            <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/15 p-4 sm:p-5 space-y-2.5" data-testid="about-visit-card">
              <div className="flex items-start gap-2.5">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-secondary" />
                <p className="text-[13px] leading-snug">{c.visit_address}</p>
              </div>
              <a href={`tel:${(c.visit_phone || "").replace(/\s/g, "")}`} data-testid="about-phone-link" className="flex items-center gap-2.5 hover:text-secondary transition-colors">
                <Phone className="h-4 w-4 shrink-0 text-secondary" />
                <span className="text-[13px] font-bold tabular-nums">{c.visit_phone}</span>
              </a>
              <a href={`mailto:${c.visit_email}`} data-testid="about-email-link" className="flex items-center gap-2.5 hover:text-secondary transition-colors">
                <Mail className="h-4 w-4 shrink-0 text-secondary" />
                <span className="text-[13px] font-bold">{c.visit_email}</span>
              </a>
              <Link to="/contact" data-testid="about-contact-cta" className="inline-flex items-center gap-1.5 rounded-full bg-white text-primary px-4 h-9 font-extrabold text-[11px] mt-1 hover:-translate-y-0.5 transition-transform">
                Open in maps <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
