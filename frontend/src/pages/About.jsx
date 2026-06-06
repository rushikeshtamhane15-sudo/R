import React from "react";
import { Link } from "react-router-dom";
import SEO from "../components/SEO";
import {
  ShieldCheck, Utensils, Leaf, Sparkles, Heart, Truck,
  ChefHat, Users, Award, MapPin, Phone, Mail, ArrowRight,
} from "lucide-react";

/**
 * Iter-73 #11 — About Us. Professional, brand-voiced page that tells the
 * efoodcare story (founders, kitchen, promise, mess vs restaurant lines)
 * and converts curious visitors into pass holders.
 */
const PROMISES = [
  { icon: ShieldCheck, title: "Zero adulteration kitchen", body: "No Ajinomoto, no maida, no palm or refined oil. No pre-made gravy, no artificial flavours or colours. The promise that started efoodcare." },
  { icon: Leaf,        title: "Cold-pressed, local first",  body: "Groundnut oil from Vidarbha farmers. Stone-ground spices. Fresh vegetables from Amravati's morning mandi — sourced before the kitchen turns on." },
  { icon: Utensils,    title: "Ghar-jaisa, every meal",     body: "Two seasonal Maharashtrian thalis a day. Recipes from our founder's mother — calibrated by an FSSAI-licensed chef so every plate tastes the same Tuesday or Sunday." },
  { icon: Sparkles,    title: "Modern, paperless, audited", body: "QR check-in, in-app wallet, e-Meal Pass, daily kitchen photos. Every meal you eat is logged — every meal you skip pauses your wallet." },
];

const STATS = [
  { value: "21521243000086", label: "FSSAI Licence" },
  { value: "3 yrs+",          label: "Serving Amravati" },
  { value: "150+",            label: "Monthly subscribers" },
  { value: "100%",            label: "Pure-veg kitchen" },
];

const TIMELINE = [
  { year: "2023", title: "The home-kitchen experiment",       body: "Rushikesh starts cooking lunch dabbas for engineering hostels in Amravati. The rule: nothing he wouldn&apos;t feed his mother." },
  { year: "2024", title: "efoodcare licence + 30-day pass",   body: "FSSAI licensing, the first 30-day e-Meal Pass model, and the original 'ghar se accha khana' tagline." },
  { year: "2025", title: "QR + wallet + delivery rails",      body: "QR-based attendance, an in-app wallet that pauses on skip-days, and partnered hyperlocal delivery for restaurant orders." },
  { year: "2026", title: "Wall kiosk + dynamic thali pricing", body: "Self-order wall kiosks at the dining hall, single-use anti-fraud QRs, and Paytm Dynamic QR for instant counter payments." },
];

export default function About() {
  return (
    <div className="bg-background" data-testid="about-page">
      <SEO
        title="About efoodcare · zero-adulteration mess + restaurant"
        path="/about"
        description="efoodcare is Amravati's first zero-adulteration mess + restaurant. FSSAI-licensed, paperless, with a 30-day subscription pass, QR check-in and a wallet that pauses on skip-days."
      />

      {/* === HERO ============================================================ */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary/95 to-[#7a1818] text-primary-foreground">
        <div className="absolute inset-0 pointer-events-none opacity-[0.08]"
             style={{ backgroundImage: "radial-gradient(circle at 20% 20%, white 2px, transparent 2px), radial-gradient(circle at 80% 60%, white 1.5px, transparent 1.5px)", backgroundSize: "40px 40px, 60px 60px" }} />
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-14 md:py-20 relative">
          <p className="text-[11px] tracking-[0.22em] uppercase font-bold text-secondary mb-3" data-testid="about-overline">Our story · est. 2023 · Amravati</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-5xl lg:text-6xl tracking-tight leading-[1.02] max-w-3xl" data-testid="about-headline">
            We started efoodcare because <span className="italic">ghar se accha khana</span> shouldn&apos;t disappear when you move out.
          </h1>
          <p className="mt-5 text-base sm:text-lg max-w-2xl text-primary-foreground/85 leading-relaxed" data-testid="about-lede">
            One licensed kitchen. Two seasonal thalis a day. A 30-day e-Meal Pass. A wallet that pauses when you travel.
            And a promise that everything we cook is what we&apos;d eat at our own dining table — never anything else.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/plans" data-testid="about-cta-plans" className="inline-flex items-center gap-2 rounded-full bg-white text-primary px-6 h-12 font-extrabold text-sm hover:shadow-xl hover:-translate-y-0.5 transition-all">
              See subscription plans <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/contact" data-testid="about-cta-contact" className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur text-white px-6 h-12 font-extrabold text-sm hover:bg-white/25 transition-colors">
              Visit our kitchen
            </Link>
          </div>

          <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="about-stats">
            {STATS.map((s, i) => (
              <div key={i} className="rounded-2xl bg-white/10 backdrop-blur border border-white/15 px-4 py-3.5" data-testid={`about-stat-${i}`}>
                <p className="font-mono font-extrabold text-base sm:text-xl tabular-nums leading-tight">{s.value}</p>
                <p className="text-[10px] tracking-[0.18em] uppercase font-bold opacity-80 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === PROMISE GRID ==================================================== */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 py-16 md:py-20">
        <p className="text-xs tracking-[0.22em] uppercase font-bold text-secondary">The efoodcare promise</p>
        <h2 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-3 max-w-2xl leading-[1.05]">
          Four non-negotiables that make us different from a regular tiffin.
        </h2>
        <div className="mt-10 grid sm:grid-cols-2 gap-5">
          {PROMISES.map((p, i) => (
            <div key={i} className="surface-3d tile-3d rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-1" data-testid={`about-promise-${i}`}>
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <p.icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
              </div>
              <p className="font-display font-extrabold text-xl leading-tight">{p.title}</p>
              <p className="text-muted-foreground text-sm mt-2 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* === TIMELINE ======================================================== */}
      <section className="bg-accent/40 border-y border-border">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-16 md:py-20">
          <p className="text-xs tracking-[0.22em] uppercase font-bold text-secondary">How we got here</p>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-3 max-w-2xl leading-[1.05]">From a single hostel dabba to a 150-subscriber wall kiosk.</h2>
          <div className="mt-10 grid md:grid-cols-4 gap-5" data-testid="about-timeline">
            {TIMELINE.map((t, i) => (
              <div key={i} className="rounded-2xl bg-card border border-border p-5 relative" data-testid={`about-timeline-${i}`}>
                <span className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-primary text-white text-xs font-extrabold mb-3">{t.year}</span>
                <p className="font-display font-extrabold text-base leading-tight">{t.title}</p>
                <p className="text-[12.5px] text-muted-foreground mt-2 leading-relaxed">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === FOUNDER / KITCHEN ================================================ */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 py-16 md:py-20 grid md:grid-cols-12 gap-10 items-center">
        <div className="md:col-span-7">
          <p className="text-xs tracking-[0.22em] uppercase font-bold text-secondary">Founder&apos;s note</p>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-3 leading-[1.05]">
            &ldquo;I built efoodcare for the version of myself that left home at 18.&rdquo;
          </h2>
          <p className="mt-5 text-muted-foreground leading-relaxed">
            When I moved out for engineering, I traded my mother&apos;s kitchen for hostel mess food and corner-shop dabbas — and within a month
            I was eating Ajinomoto-laced gravy and reused refined oil without even knowing. efoodcare is the brand I wish I had then:
            a licensed kitchen with the same standards your mother applies at home, a wallet that respects the days you don&apos;t eat,
            and a counter that gives you a receipt for every thali. <strong>Nothing is hidden. Everything is logged. Every rupee is yours until you scan in.</strong>
          </p>
          <p className="mt-4 text-sm font-extrabold">— Rushikesh Tamhane <span className="text-muted-foreground font-normal">· Founder & head of kitchen, efoodcare</span></p>

          <div className="mt-7 flex flex-wrap gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1.5 font-bold"><ChefHat className="h-3.5 w-3.5" /> FSSAI-licensed chef</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 font-bold"><Award className="h-3.5 w-3.5" /> 100% pure veg</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-3 py-1.5 font-bold"><Heart className="h-3.5 w-3.5" /> Daily kitchen photos</span>
          </div>
        </div>

        <div className="md:col-span-5 grid grid-cols-2 gap-3" data-testid="about-kitchen-tiles">
          {[
            { icon: ChefHat, label: "Chef-led",      sub: "Recipes calibrated daily" },
            { icon: Users,   label: "Family-run",    sub: "No corporate shortcuts" },
            { icon: Truck,   label: "Delivery rails", sub: "Hyperlocal partner riders" },
            { icon: ShieldCheck, label: "Audited",   sub: "Every meal is QR-logged" },
          ].map((t, i) => (
            <div key={i} className="surface-3d rounded-2xl border border-border bg-card p-5">
              <div className="h-10 w-10 rounded-xl bg-secondary/15 flex items-center justify-center mb-3">
                <t.icon className="h-4 w-4 text-secondary" strokeWidth={1.85} />
              </div>
              <p className="font-display font-extrabold text-sm leading-tight">{t.label}</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{t.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* === VISIT US / FOOTER CTA =========================================== */}
      <section className="bg-primary text-primary-foreground">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-14 md:py-16 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <p className="text-xs tracking-[0.22em] uppercase font-bold text-secondary">Come say hi</p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-3 leading-[1.05]">Our kitchen is yours to inspect. Always.</h2>
            <p className="mt-4 text-primary-foreground/85 leading-relaxed text-sm sm:text-base">
              Drop by during lunch (12:30-3pm) or dinner (7-10:30pm). We&apos;ll walk you through the storeroom, the oil bottles, the dal counter
              and the spice grinder. No appointment, no NDA — just open shelves.
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/15 p-5 space-y-3" data-testid="about-visit-card">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 mt-0.5 shrink-0 text-secondary" />
              <p className="text-sm leading-snug">shilangan Road, behind bhaktidham mandir,<br />sai nagar, Amravati 444607, Maharashtra</p>
            </div>
            <a href="tel:+919175560211" data-testid="about-phone-link" className="flex items-center gap-3 hover:text-secondary transition-colors">
              <Phone className="h-5 w-5 shrink-0 text-secondary" />
              <span className="text-sm font-bold tabular-nums">+91 91755 60211</span>
            </a>
            <a href="mailto:hello@efoodcare.in" data-testid="about-email-link" className="flex items-center gap-3 hover:text-secondary transition-colors">
              <Mail className="h-5 w-5 shrink-0 text-secondary" />
              <span className="text-sm font-bold">hello@efoodcare.in</span>
            </a>
            <Link to="/contact" data-testid="about-contact-cta" className="inline-flex items-center gap-2 rounded-full bg-white text-primary px-5 h-10 font-extrabold text-xs mt-1 hover:-translate-y-0.5 transition-transform">
              Open in maps <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
