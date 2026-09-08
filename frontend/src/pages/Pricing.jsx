import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import SEO from "../components/SEO";
import { IndianRupee, Users, Wallet, ShieldCheck, Sparkles, CheckCircle2, AlertTriangle, ArrowRight, Zap } from "lucide-react";

/**
 * Pricing page — iter-157.
 * Explains the two revenue streams:
 *   1. One-time onboarding software fee (₹4999 default)
 *   2. Monthly per-user platform fee (₹100/user by default, super-admin editable per mess)
 * How wallet deduction works, and the 7-day grace window before auto-restrict.
 */
const DEFAULTS = {
  one_time_fee: 4999,
  monthly_per_user: 100,
  grace_days: 7,
};

export default function Pricing() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [users, setUsers] = useState(100);
  const [rate, setRate] = useState(DEFAULTS.monthly_per_user);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/content/pricing");
        setCfg({ ...DEFAULTS, ...(r.data || {}) });
        setRate(r.data?.monthly_per_user || DEFAULTS.monthly_per_user);
      } catch { /* keep defaults */ }
    })();
  }, []);

  const monthly = users * rate;

  return (
    <div className="bg-white" data-testid="pricing-page">
      <SEO title="Pricing · efoodtech" path="/pricing"
        description="Simple pricing for messes on efoodtech. One-time onboarding + per-user monthly. Wallet-based, no lock-in." />

      <section className="relative overflow-hidden bg-gradient-to-br from-primary to-red-800 text-white">
        <div className="max-w-5xl mx-auto px-6 md:px-10 pt-20 pb-16 text-center">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-3 py-1.5 mb-4">
            <IndianRupee className="h-3.5 w-3.5" /> <span className="text-xs font-semibold uppercase tracking-widest">Simple, honest pricing</span>
          </motion.div>
          <h1 className="font-display font-extrabold text-4xl sm:text-5xl leading-tight">Pay for what you use — nothing more.</h1>
          <p className="mt-4 text-white/85 text-lg max-w-2xl mx-auto">
            One-time onboarding, then a small per-user monthly fee. Rates are editable — talk to us if your mess needs custom terms.
          </p>
        </div>
      </section>

      {/* Two-plan grid */}
      <section className="max-w-5xl mx-auto px-6 md:px-10 -mt-8 pb-16">
        <div className="grid md:grid-cols-2 gap-5">
          <PlanCard
            title="Onboarding fee"
            amount={cfg.one_time_fee}
            unit="one-time"
            testid="plan-onetime"
            features={[
              "Custom Mess ID (or auto-generated)",
              "Your own tenant on efoodtech",
              "Kiosk hardware setup guide + support",
              "WhatsApp welcome to your owner phone",
              "Free branding kit templates",
            ]}
            note="Includes onboarding call + go-live checklist."
          />
          <PlanCard
            title="Monthly per-user"
            amount={cfg.monthly_per_user}
            unit="/ active user / month"
            testid="plan-monthly"
            highlight
            features={[
              "₹100 default — negotiable per plan type",
              "Charged monthly on active subscribers only",
              "Wallet-based auto-deduct (super-admin controlled)",
              "Volume discounts for 100+ users",
              "Different rates for dining vs tiffin users",
            ]}
            note="Super-admin can set custom rates per mess. Example: ₹100 for tiffin users, ₹50 for dining-only users."
          />
        </div>
      </section>

      {/* Rate calculator */}
      <section className="bg-accent/30 py-14" data-testid="pricing-calculator">
        <div className="max-w-3xl mx-auto px-6 md:px-10">
          <div className="text-center mb-8">
            <p className="text-xs uppercase tracking-widest font-bold text-secondary">Live calculator</p>
            <h2 className="font-display font-extrabold text-3xl mt-2">Your monthly platform fee</h2>
          </div>
          <div className="rounded-3xl bg-white border border-slate-200 p-6 space-y-5">
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Active users this month</label>
              <input type="range" min={10} max={2000} step={10} value={users} onChange={(e) => setUsers(+e.target.value)}
                className="w-full mt-2 accent-primary" data-testid="calc-users" />
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-slate-500">10</span>
                <span className="font-bold text-slate-900" data-testid="calc-users-value">{users}</span>
                <span className="text-slate-500">2,000</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Rate per user (super-admin editable)</label>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-slate-500 text-sm">₹</span>
                <input type="number" min={0} max={5000} value={rate} onChange={(e) => setRate(+e.target.value || 0)}
                  className="flex-1 rounded-lg border border-slate-300 px-3 h-10 text-sm font-mono" data-testid="calc-rate" />
                <span className="text-xs text-slate-500">/user/month</span>
              </div>
            </div>
            <div className="rounded-2xl bg-primary/5 border border-primary/15 p-5 text-center">
              <div className="text-xs uppercase tracking-widest font-bold text-primary">Monthly platform fee</div>
              <div className="text-4xl font-extrabold text-primary mt-2 tabular-nums" data-testid="calc-monthly">
                ₹{monthly.toLocaleString("en-IN")}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Deducted from your platform wallet at start of each month.</div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-6 md:px-10 py-16 space-y-6">
        <div className="text-center mb-4">
          <p className="text-xs uppercase tracking-widest font-bold text-secondary">How billing works</p>
          <h2 className="font-display font-extrabold text-3xl mt-2">Wallet-first · no invoicing headaches</h2>
        </div>
        <Step icon={Wallet} n={1} title="Top up your platform wallet"
          copy="From your mess-owner dashboard, top up any amount via Razorpay. Balance never expires." />
        <Step icon={Users} n={2} title="System counts active users"
          copy="At the end of each month, the platform counts every active subscriber (dining + tiffin, separately if your rates differ) and deducts the fee automatically from your wallet." />
        <Step icon={ShieldCheck} n={3} title={`${cfg.grace_days}-day grace window`}
          copy={`If your wallet runs dry, you get a ${cfg.grace_days}-day grace period with WhatsApp reminders. Add money any time to stay live.`} />
        <Step icon={AlertTriangle} n={4} title="Auto-restrict after grace"
          copy={`After ${cfg.grace_days} days of unpaid dues, your mess is temporarily suspended — subscribers see a "Payment pending" screen. Restore instantly by clearing dues.`} />
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-primary text-white">
        <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center">
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl">Ready to onboard your mess?</h2>
          <p className="mt-3 text-white/85">Under 10 minutes to go live. Rates editable per mess. Talk to us for volume discounts.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/login" data-testid="pricing-cta-start">
              <Button size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 px-8 h-12 font-bold">
                Get started <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link to="/about" data-testid="pricing-cta-about">
              <Button size="lg" variant="outline" className="rounded-full border-white/40 hover:bg-white/10 text-white bg-transparent px-8 h-12 font-semibold">
                Learn about us
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function PlanCard({ title, amount, unit, features, note, highlight, testid }) {
  return (
    <div className={`rounded-3xl border p-6 sm:p-7 ${highlight ? "bg-primary text-white border-primary shadow-xl relative" : "bg-white text-slate-900 border-slate-200"}`}
      data-testid={testid}>
      {highlight && (
        <span className="absolute -top-3 right-6 rounded-full bg-amber-400 text-slate-900 text-[10px] font-bold uppercase tracking-widest px-3 py-1">
          Most popular
        </span>
      )}
      <div className={`text-xs uppercase tracking-widest font-bold ${highlight ? "text-white/80" : "text-secondary"}`}>{title}</div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className={`text-4xl font-extrabold ${highlight ? "text-white" : "text-slate-900"}`}>₹{amount.toLocaleString("en-IN")}</span>
        <span className={`text-sm ${highlight ? "text-white/80" : "text-slate-500"}`}>{unit}</span>
      </div>
      <ul className="mt-5 space-y-2">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${highlight ? "text-white" : "text-primary"}`} strokeWidth={2} />
            <span className={highlight ? "text-white/90" : "text-slate-700"}>{f}</span>
          </li>
        ))}
      </ul>
      {note && <p className={`text-[11px] mt-4 ${highlight ? "text-white/70" : "text-slate-500"}`}>{note}</p>}
    </div>
  );
}

function Step({ icon: Icon, n, title, copy }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 flex items-start gap-4">
      <div className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center font-bold shrink-0">{n}</div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" strokeWidth={2} />
          <h3 className="font-bold text-slate-900">{title}</h3>
        </div>
        <p className="text-sm text-slate-600 mt-1 leading-relaxed">{copy}</p>
      </div>
    </div>
  );
}
