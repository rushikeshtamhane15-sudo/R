import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Check } from "lucide-react";

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/plans");
        setPlans(r.data.plans);
      } finally { setLoading(false); }
    })();
  }, []);

  const checkout = async (planId) => {
    setSubmitting(planId);
    try {
      const r = await api.post("/checkout", { plan_id: planId, origin_url: window.location.origin });
      window.location.href = r.data.url;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start checkout. Please sign in first.");
      setSubmitting(null);
    }
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading plans…</div>;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-8 lg:px-12 py-12" data-testid="plans-page">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Subscription plans</p>
        <h1 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight mt-3 leading-[1.05]">Pick a pass. Eat well.</h1>
        <p className="text-muted-foreground mt-4 leading-relaxed">
          Simple, honest plans. No hidden fees. Unused meals don't roll over — every day is a fresh start.
        </p>
      </div>

      <div className="mt-12 grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {plans.map((p, i) => (
          <div
            key={p.id}
            data-testid={`plan-card-${p.id}`}
            className={`rounded-3xl border p-8 transition-all hover:-translate-y-1 hover:shadow-lg ${
              i === 0 ? "bg-primary text-primary-foreground border-primary" : "bg-card border-black/5"
            }`}
          >
            <p className={`text-xs tracking-overline uppercase font-bold ${i === 0 ? "text-primary-foreground/70" : "text-secondary"}`}>
              {p.meals} meals · {p.duration_days} days
            </p>
            <h3 className={`font-display font-extrabold text-2xl md:text-3xl mt-3 leading-tight`}>{p.name}</h3>
            <p className={`mt-2 text-sm ${i === 0 ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{p.description}</p>

            <div className="mt-6 flex items-baseline gap-2">
              <span className="font-display font-extrabold text-4xl">${p.amount.toFixed(2)}</span>
              <span className={`text-sm ${i === 0 ? "text-primary-foreground/70" : "text-muted-foreground"}`}>one-time</span>
            </div>

            <ul className="mt-6 space-y-2.5 text-sm">
              {[`${p.meals} total meals`, "Lunch + Dinner every day", "QR-based check-in", "No duplicate meals"].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <Check className={`h-4 w-4 ${i === 0 ? "text-primary-foreground" : "text-primary"}`} strokeWidth={2}/>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <Button
              onClick={() => checkout(p.id)}
              disabled={submitting === p.id}
              data-testid={`subscribe-button-${p.id}`}
              className={`mt-8 w-full rounded-full h-12 font-semibold ${
                i === 0 ? "bg-white text-primary hover:bg-white/90" : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {submitting === p.id ? "Redirecting…" : "Subscribe"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
