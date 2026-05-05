import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

export default function Plans() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(null);

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/plans"); setPlans(r.data.plans); }
      finally { setLoading(false); }
    })();
  }, []);

  const startCheckout = async (planId) => {
    if (!user) {
      navigate(`/login`);
      return;
    }
    if (!user.name || !user.phone || !user.address || !user.photo_url) {
      navigate(`/profile?next=/checkout/${planId}`);
      return;
    }
    navigate(`/checkout/${planId}`);
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading plans…</div>;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-8 lg:px-12 py-12" data-testid="plans-page">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Subscription plans</p>
        <h1 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight mt-3 leading-[1.05]">Pick a plan. Eat <span className="text-primary">ghar se achha khana.</span></h1>
        <p className="text-muted-foreground mt-4 leading-relaxed">All plans cover 30 days × 2 meals — wallet unused amount auto-pauses when you skip 3+ days in a row.</p>
      </div>

      <div className="mt-12 grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {plans.map((p, i) => {
          const isPopular = i === 0;
          const perDay = (p.amount / p.duration_days).toFixed(0);
          return (
            <div
              key={p.plan_id}
              data-testid={`plan-card-${p.plan_id}`}
              className={`rounded-3xl border p-8 transition-all hover:-translate-y-1 hover:shadow-lg relative ${
                isPopular ? "bg-primary text-primary-foreground border-primary" : "bg-card border-black/5"
              }`}
            >
              {isPopular && (
                <span className="absolute -top-3 left-8 bg-secondary text-secondary-foreground text-[10px] tracking-overline uppercase font-bold px-3 py-1 rounded-full">Popular</span>
              )}
              <p className={`text-xs tracking-overline uppercase font-bold ${isPopular ? "text-primary-foreground/70" : "text-secondary"}`}>
                {p.meals} meals · {p.duration_days} days
              </p>
              <h3 className="font-display font-extrabold text-2xl md:text-3xl mt-3 leading-tight">{p.name}</h3>
              <p className={`mt-2 text-sm ${isPopular ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{p.description}</p>

              <div className="mt-6 flex items-baseline gap-2">
                <span className="font-display font-extrabold text-4xl">₹{p.amount.toFixed(0)}</span>
                <span className={`text-sm ${isPopular ? "text-primary-foreground/70" : "text-muted-foreground"}`}>one-time</span>
              </div>
              <p className={`text-xs mt-1 ${isPopular ? "text-primary-foreground/70" : "text-muted-foreground"}`}>≈ ₹{perDay} per day</p>

              <ul className="mt-6 space-y-2.5 text-sm">
                {[`${p.meals} total meals`, "Lunch + Dinner daily", "QR-based check-in", "Auto-pause on 3+ skipped days"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className={`h-4 w-4 ${isPopular ? "text-primary-foreground" : "text-primary"}`} strokeWidth={2} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => startCheckout(p.plan_id)}
                disabled={submitting === p.plan_id}
                data-testid={`subscribe-button-${p.plan_id}`}
                className={`mt-8 w-full rounded-full h-12 font-semibold ${
                  isPopular ? "bg-white text-primary hover:bg-white/90" : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                Subscribe
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
