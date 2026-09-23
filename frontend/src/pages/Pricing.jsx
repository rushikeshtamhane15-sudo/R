import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import SEO from "../components/SEO";
import {
  IndianRupee, Users, Wallet, ShieldCheck, Sparkles, CheckCircle2, ArrowRight,
  Zap, Rocket, Building2, Loader2, Pencil, X, Check, CreditCard, Smartphone,
  Landmark, Wallet as WalletIcon,
} from "lucide-react";

/**
 * Pricing page — iter-180
 *
 * B2B platform-fee page for MESS OWNERS.
 * Three tiers based on the number of active subscribers on their mess:
 *   Starter  · Up to 100         · ₹2,799 / month
 *   Growth   · 101 – 200         · ₹4,499 / month
 *   Scale    · 200+              · ₹9,499 / month
 *
 * - Tier prices are loaded from the `pricing` CMS content key so super-admin
 *   can edit them from an inline pencil (visible to role=admin only).
 * - Razorpay Standard Checkout wired for the "Subscribe" CTA on each tier
 *   (all payment modes enabled by the platform's Razorpay dashboard settings).
 * - Mess-owner must be logged in to subscribe. Guests are redirected to /login.
 */
const DEFAULT_TIERS = [
  {
    id: "starter", name: "Starter",
    amount: 2799,
    upto: 100,  min: 0,
    tagline: "Just starting out",
    highlight: false,
    features: [
      "Up to 100 active subscribers",
      "QR + Face check-in kiosk",
      "Subscriber wallet on autopilot",
      "WhatsApp meal receipts",
      "Direct-to-bank Razorpay payouts",
      "Community email support",
    ],
  },
  {
    id: "growth", name: "Growth",
    amount: 4499,
    upto: 200, min: 101,
    tagline: "Most popular · scaling messes",
    highlight: true,
    features: [
      "101 – 200 active subscribers",
      "Everything in Starter",
      "Tiffin routing + rider tracking",
      "Weekly WhatsApp owner digest",
      "Admin drill-downs + PnL reports",
      "Priority WhatsApp support",
    ],
  },
  {
    id: "scale", name: "Scale",
    amount: 9499,
    upto: null, min: 201,
    tagline: "Multi-branch operations",
    highlight: false,
    features: [
      "200+ active subscribers",
      "Everything in Growth",
      "Multi-branch tenant scoping",
      "Custom Wall Kiosk CMS",
      "Custom branding + domain support",
      "Dedicated onboarding + SLA",
    ],
  },
];

export default function Pricing() {
  const { user } = useAuth();
  const [tiers, setTiers] = useState(DEFAULT_TIERS);
  const [rzp, setRzp] = useState({ key: null, mock: true });
  const [loading, setLoading] = useState(false);
  const [payingTier, setPayingTier] = useState(null);
  // Admin inline editor
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState(DEFAULT_TIERS.map((t) => ({ id: t.id, amount: t.amount })));
  const isSuperAdmin = user?.role === "admin";

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/content/pricing");
        const remoteTiers = r.data?.tiers;
        if (Array.isArray(remoteTiers) && remoteTiers.length > 0) {
          // merge remote amounts (and any override fields) into defaults so
          // client stays resilient to partial CMS payloads.
          const merged = DEFAULT_TIERS.map((d) => {
            const o = remoteTiers.find((t) => t.id === d.id) || {};
            return { ...d, ...o };
          });
          setTiers(merged);
          setDrafts(merged.map((t) => ({ id: t.id, amount: t.amount })));
        }
      } catch { /* keep defaults */ }
      try {
        const s = await api.get("/billing/platform-fee/status");
        setRzp({ key: s.data?.razorpay_key_id || null, mock: !!s.data?.mock });
      } catch { /* silently fall back to mock */ }
    })();
  }, []);

  const loadRazorpayScript = () => new Promise((res) => {
    if (typeof window !== "undefined" && window.Razorpay) return res(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => res(true);
    s.onerror = () => res(false);
    document.body.appendChild(s);
  });

  const subscribe = async (tier) => {
    if (!user) {
      window.location.href = `/login?next=${encodeURIComponent("/pricing")}`;
      return;
    }
    if (user.role !== "mess_owner" && user.role !== "admin") {
      toast.error("Only mess owners can subscribe to a platform tier.");
      return;
    }
    setPayingTier(tier.id);
    try {
      const ordr = await api.post("/billing/platform-fee/order", { tier_id: tier.id });
      const { order_id, amount_paise, currency, key_id, mock } = ordr.data;
      if (mock) {
        // In dev / no-key mode, mark it verified without opening the modal.
        await api.post("/billing/platform-fee/verify", {
          order_id, razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock",
        });
        toast.success(`Platform tier '${tier.name}' activated · mock mode`);
        setPayingTier(null);
        return;
      }
      const ok = await loadRazorpayScript();
      if (!ok) {
        toast.error("Couldn't load payment gateway — check your connection.");
        setPayingTier(null);
        return;
      }
      const rz = new window.Razorpay({
        key: key_id,
        amount: amount_paise,
        currency,
        name: "efoodtech",
        description: `${tier.name} platform tier · monthly`,
        order_id,
        prefill: {
          name: user.name || "",
          email: user.email || "",
          contact: user.phone || "",
        },
        theme: { color: "#a02323" },
        // No `method` block → Razorpay dashboard controls which modes are
        // enabled (UPI, cards, netbanking, wallets, EMI). Owner can toggle
        // any of those in their Razorpay account.
        handler: async (resp) => {
          try {
            await api.post("/billing/platform-fee/verify", {
              order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            toast.success(`${tier.name} tier active — welcome aboard!`);
          } catch (e) {
            toast.error(e?.response?.data?.detail || "Verification failed");
          } finally { setPayingTier(null); }
        },
        modal: {
          ondismiss: () => setPayingTier(null),
        },
      });
      rz.open();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start payment");
      setPayingTier(null);
    }
  };

  const saveTierPrices = async () => {
    setLoading(true);
    try {
      const nextTiers = tiers.map((t) => {
        const d = drafts.find((x) => x.id === t.id);
        return { ...t, amount: Number(d?.amount) || t.amount };
      });
      await api.post("/admin/content/pricing", { tiers: nextTiers });
      setTiers(nextTiers);
      toast.success("Tier prices saved · live for everyone");
      setEditing(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally { setLoading(false); }
  };

  return (
    <div className="bg-white" data-testid="pricing-page">
      <SEO
        title="Platform pricing · efoodtech"
        path="/pricing"
        description="Three simple monthly tiers for mess owners on efoodtech. ₹2,799 / ₹4,499 / ₹9,499 per month based on active subscriber count. Direct Razorpay payment." />

      {/* HERO */}
      <section
        className="relative isolate overflow-hidden text-white"
        style={{
          background: "radial-gradient(1000px 520px at 15% -20%, #7f1d1d 0%, transparent 55%), radial-gradient(880px 500px at 105% 15%, #b91c1c 0%, transparent 55%), linear-gradient(160deg, #4c0f14 0%, #7a1418 45%, #a02323 100%)",
        }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-[0.10] mix-blend-overlay"
          style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")" }} />
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-300/25 blur-3xl" />
        <div className="relative max-w-5xl mx-auto px-6 md:px-10 pt-6 sm:pt-8 pb-14 text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/25 backdrop-blur-md pl-1.5 pr-3.5 py-1.5 mb-4 shadow-[0_1px_0_rgba(255,255,255,0.14)_inset]"
            data-testid="pricing-hero-badge">
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-400 text-red-900">
              <IndianRupee className="h-3.5 w-3.5" strokeWidth={2.6} />
            </span>
            <span className="text-[11px] font-black uppercase tracking-[0.18em]">For mess owners</span>
          </motion.div>
          <h1 className="font-display font-black text-4xl sm:text-5xl leading-[1.05] tracking-tight">
            Three tiers.<br className="hidden sm:block" /> One monthly bill.
          </h1>
          <p className="mt-5 text-white/85 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Pay a flat monthly platform fee based on how many active subscribers you have. No per-user math, no surprise invoices, no lock-in.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {[
              { icon: Smartphone, text: "UPI · GPay · PhonePe" },
              { icon: CreditCard, text: "Card · Debit / Credit" },
              { icon: Landmark, text: "Netbanking" },
              { icon: WalletIcon, text: "Wallets" },
            ].map((m, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-md px-3 py-1 text-[11px] font-semibold text-white/90">
                <m.icon className="h-3.5 w-3.5" strokeWidth={2.25} /> {m.text}
              </span>
            ))}
          </div>
        </div>
        <svg aria-hidden viewBox="0 0 1440 60" className="absolute bottom-0 inset-x-0 w-full text-white" preserveAspectRatio="none">
          <path fill="currentColor" d="M0,30 C220,60 420,0 720,30 C1020,60 1220,0 1440,30 L1440,60 L0,60 Z" />
        </svg>
      </section>

      {/* Tier cards */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 -mt-4 sm:-mt-6 pb-10">
        {isSuperAdmin && (
          <div className="flex justify-end mb-3" data-testid="pricing-admin-toolbar">
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black bg-slate-900 text-white hover:bg-slate-800"
                data-testid="pricing-edit-toggle"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit tier prices
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(false); setDrafts(tiers.map((t) => ({ id: t.id, amount: t.amount }))); }}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
                  data-testid="pricing-edit-cancel"
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button
                  onClick={saveTierPrices}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                  data-testid="pricing-edit-save"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-5" data-testid="pricing-tier-grid">
          {tiers.map((t) => {
            const draft = drafts.find((x) => x.id === t.id) || { amount: t.amount };
            const busy = payingTier === t.id;
            return (
              <div
                key={t.id}
                className={`relative rounded-2xl border p-6 flex flex-col ${t.highlight ? "border-primary shadow-xl bg-gradient-to-br from-white to-rose-50" : "border-slate-200 bg-white shadow-sm"}`}
                data-testid={`pricing-tier-${t.id}`}
              >
                {t.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-white text-[10px] font-black px-3 py-1 uppercase tracking-widest shadow-md">
                    Most popular
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className={`h-9 w-9 rounded-xl flex items-center justify-center ${t.highlight ? "bg-primary/15 text-primary" : "bg-slate-100 text-slate-700"}`}>
                    {t.id === "starter" ? <Rocket className="h-4.5 w-4.5" /> : t.id === "growth" ? <Zap className="h-4.5 w-4.5" /> : <Sparkles className="h-4.5 w-4.5" />}
                  </span>
                  <div>
                    <h3 className="font-display font-black text-lg leading-none">{t.name}</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">{t.tagline}</p>
                  </div>
                </div>
                <p className="text-[11px] uppercase tracking-widest font-black text-slate-500 mt-4">Active subscribers</p>
                <p className="text-sm font-bold text-slate-700 mt-0.5">
                  {t.min === 0 ? `Up to ${t.upto}` : t.upto ? `${t.min} – ${t.upto}` : `${t.min}+`}
                </p>

                {editing && isSuperAdmin ? (
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-2xl font-black">₹</span>
                    <Input
                      type="number"
                      value={draft.amount}
                      onChange={(e) => setDrafts((d) => d.map((x) => x.id === t.id ? { ...x, amount: e.target.value } : x))}
                      className="h-11 text-2xl font-black tabular-nums max-w-[160px]"
                      data-testid={`pricing-tier-${t.id}-input`}
                    />
                    <span className="text-sm text-slate-500 ml-1">/ month</span>
                  </div>
                ) : (
                  <div className="mt-4 flex items-baseline gap-1.5">
                    <span className="text-3xl sm:text-4xl font-black tabular-nums">₹{Number(t.amount).toLocaleString("en-IN")}</span>
                    <span className="text-sm text-slate-500">/ month</span>
                  </div>
                )}

                <ul className="mt-5 space-y-2.5 flex-1" data-testid={`pricing-tier-${t.id}-features`}>
                  {t.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <CheckCircle2 className={`h-4 w-4 mt-0.5 flex-shrink-0 ${t.highlight ? "text-primary" : "text-emerald-600"}`} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={() => subscribe(t)}
                  disabled={busy || editing}
                  className={`mt-6 rounded-full h-11 font-black ${t.highlight ? "bg-primary hover:bg-primary/95" : "bg-slate-900 hover:bg-slate-800 text-white"}`}
                  data-testid={`pricing-tier-${t.id}-cta`}
                >
                  {busy ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting payment…</>
                  ) : (
                    <>Subscribe · ₹{Number(t.amount).toLocaleString("en-IN")} <ArrowRight className="h-4 w-4 ml-2" /></>
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-slate-500 mt-8">
          Prices are per-mess, per-month. GST additional at check-out where applicable. You can upgrade / downgrade at any renewal cycle.
        </p>
      </section>

      {/* Why efoodtech strip */}
      <section className="bg-slate-50 py-16 border-y border-slate-200">
        <div className="max-w-5xl mx-auto px-6 md:px-10 grid sm:grid-cols-3 gap-6 text-center">
          <div>
            <div className="h-12 w-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto"><ShieldCheck className="h-6 w-6" /></div>
            <h4 className="font-display font-black text-lg mt-3">Direct-to-bank</h4>
            <p className="text-sm text-slate-600 mt-1">Subscriber payments land in YOUR Razorpay account — not ours.</p>
          </div>
          <div>
            <div className="h-12 w-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto"><Users className="h-6 w-6" /></div>
            <h4 className="font-display font-black text-lg mt-3">No hidden per-user math</h4>
            <p className="text-sm text-slate-600 mt-1">Flat monthly fee. Your bill doesn't change mid-cycle.</p>
          </div>
          <div>
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto"><Wallet className="h-6 w-6" /></div>
            <h4 className="font-display font-black text-lg mt-3">Cancel anytime</h4>
            <p className="text-sm text-slate-600 mt-1">Skip a month, downgrade, or leave. No contracts, no lock-in.</p>
          </div>
        </div>
      </section>

      {/* CTA strip */}
      <section className="max-w-4xl mx-auto px-6 md:px-10 py-16 text-center">
        <h2 className="font-display font-black text-3xl sm:text-4xl">Not sure which tier fits?</h2>
        <p className="mt-3 text-slate-600 max-w-xl mx-auto">Start on Starter and upgrade whenever you cross 100 subscribers. Zero downtime, no re-onboarding.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/login">
            <Button size="lg" className="rounded-full h-12 px-7 font-black" data-testid="pricing-cta-onboard">
              <Building2 className="h-4 w-4 mr-2" /> Onboard my mess
            </Button>
          </Link>
          <Link to="/contact">
            <Button size="lg" variant="outline" className="rounded-full h-12 px-6 font-bold" data-testid="pricing-cta-contact">
              Talk to founder <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
