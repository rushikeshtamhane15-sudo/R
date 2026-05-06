import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Check, Loader2, Sparkles, Utensils, Truck } from "lucide-react";

const MEAL_PRICE = 70;
const MEALS_PER_DAY = 2;
const MIN_DAYS = 1;
const MAX_DAYS = 90;

const SERVICES = [
  { id: "dining", label: "Dining", icon: Utensils, hint: "Eat at our hall — scan QR at counter" },
  { id: "tiffin", label: "Tiffin delivery", icon: Truck, hint: "Delivered to your doorstep · twice daily" },
];

export default function Plans() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [service, setService] = useState("dining");
  const [days, setDays] = useState(7);
  const [tiffinSize, setTiffinSize] = useState("full");

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/plans"); setPlans(r.data.plans); }
      finally { setLoading(false); }
    })();
  }, []);

  // Filter plans by current service tab. Fall back: legacy plans without service_type are dining.
  const visiblePlans = useMemo(
    () => plans.filter((p) => (p.service_type || "dining") === service),
    [plans, service]
  );

  const customPreview = useMemo(() => {
    const d = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Number(days) || 1));
    const meals = d * MEALS_PER_DAY;
    return { days: d, meals, amount: meals * MEAL_PRICE, perDay: MEALS_PER_DAY * MEAL_PRICE };
  }, [days]);

  const profileIncomplete = (u) => !u || !u.name || !u.phone || !u.address || !u.photo_url;

  const startCheckout = (planId) => {
    if (!user) return navigate(`/login`);
    if (profileIncomplete(user)) return navigate(`/profile?next=/checkout/${planId}`);
    navigate(`/checkout/${planId}`);
  };

  const startCustomCheckout = () => {
    const params = new URLSearchParams({ days: String(customPreview.days), service });
    if (service === "tiffin") params.set("tiffin_size", tiffinSize);
    const next = `/checkout/custom?${params.toString()}`;
    if (!user) return navigate(`/login`);
    if (profileIncomplete(user)) return navigate(`/profile?next=${encodeURIComponent(next)}`);
    navigate(next);
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading plans…</div>;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-8 lg:px-12 py-12" data-testid="plans-page">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Subscription plans</p>
        <h1 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight mt-3 leading-[1.05]">Pick a plan. Eat <span className="text-primary">ghar se achha khana.</span></h1>
        <p className="text-muted-foreground mt-4 leading-relaxed">All plans cover 2 meals per day — wallet auto-pauses when you skip 3+ days in a row.</p>
      </div>

      {/* Service tabs */}
      <div className="mt-10 flex justify-center" data-testid="service-tabs">
        <div className="inline-flex bg-muted/50 rounded-full p-1 gap-1">
          {SERVICES.map((s) => (
            <button
              key={s.id} type="button" onClick={() => setService(s.id)}
              data-testid={`service-tab-${s.id}`}
              className={`px-5 h-10 rounded-full text-sm font-semibold transition-colors flex items-center gap-2 ${service === s.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <s.icon className="h-3.5 w-3.5" /> {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground mt-3">{SERVICES.find((s) => s.id === service)?.hint}</p>

      <div className={`mt-10 grid gap-6 mx-auto ${visiblePlans.length === 1 ? "max-w-md" : visiblePlans.length === 2 ? "md:grid-cols-2 max-w-3xl" : "md:grid-cols-3 max-w-5xl"}`}>
        {visiblePlans.map((p, i) => {
          const isPopular = i === 0 && visiblePlans.length > 1;
          const perDay = (p.amount / p.duration_days).toFixed(0);
          return (
            <div
              key={p.plan_id}
              data-testid={`plan-card-${p.plan_id}`}
              className={`rounded-3xl border p-8 transition-all hover:-translate-y-1 hover:shadow-lg relative ${
                isPopular ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"
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
                {(service === "dining"
                  ? [`${p.meals} total meals`, "Lunch + Dinner at our hall", "Scan QR at counter", "Auto-pause on 3+ skipped days"]
                  : [`${p.meals} tiffins · ${p.duration_days} days`, "Lunch + Dinner delivered daily", "Doorstep geofence verification", "Pause anytime · 7+ days extends plan"]
                ).map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className={`h-4 w-4 ${isPopular ? "text-primary-foreground" : "text-primary"}`} strokeWidth={2} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => startCheckout(p.plan_id)}
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
        {visiblePlans.length === 0 && (
          <div className="text-center text-muted-foreground py-10 col-span-full">No {service} plans yet.</div>
        )}
      </div>

      {/* Custom subscription */}
      <div className="mt-14 max-w-5xl mx-auto" data-testid="custom-plan-section">
        <div className="rounded-3xl border border-border bg-card p-8 md:p-10 grid lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3">
            <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Build your own</p>
            <h2 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-3 leading-tight">Pick any number of days.</h2>
            <p className="text-muted-foreground mt-3 leading-relaxed">Pay exactly for the days you'll eat. Fixed at <span className="font-semibold text-foreground">₹{MEAL_PRICE} per meal</span> (₹{MEAL_PRICE * MEALS_PER_DAY}/day).</p>

            <div className="mt-6">
              <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Service</label>
              <div className="mt-2 flex gap-2 flex-wrap" data-testid="custom-service">
                {SERVICES.map((s) => (
                  <button
                    key={s.id} type="button" onClick={() => setService(s.id)}
                    data-testid={`custom-service-${s.id}`}
                    className={`px-4 h-10 rounded-full text-sm font-semibold border transition-colors flex items-center gap-1.5 ${service === s.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}
                  >
                    <s.icon className="h-3.5 w-3.5" /> {s.label}
                  </button>
                ))}
              </div>
            </div>

            {service === "tiffin" && (
              <div className="mt-5" data-testid="custom-tiffin-size">
                <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Tiffin size</label>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {[
                    { id: "full", label: "Full · 5 chapati" },
                    { id: "half", label: "Half · 3 chapati" },
                  ].map((t) => (
                    <button
                      key={t.id} type="button" onClick={() => setTiffinSize(t.id)}
                      className={`px-4 h-10 rounded-full text-sm font-semibold border transition-colors ${tiffinSize === t.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}
                      data-testid={`custom-tiffin-${t.id}`}
                    >{t.label}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-2" data-testid="day-presets">
              {[3, 5, 7, 10, 15, 21].map((d) => (
                <button key={d} type="button" onClick={() => setDays(d)}
                  data-testid={`day-preset-${d}`}
                  className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${Number(days) === d ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}
                >{d} days</button>
              ))}
            </div>

            <div className="mt-6 max-w-xs">
              <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Days</label>
              <Input type="number" min={MIN_DAYS} max={MAX_DAYS} value={days} onChange={(e) => setDays(e.target.value)} className="mt-2 rounded-xl text-lg font-display font-bold" data-testid="custom-days-input" />
              <p className="text-xs text-muted-foreground mt-1.5">Between {MIN_DAYS} and {MAX_DAYS} days</p>
            </div>
          </div>

          <div className="lg:col-span-2 bg-primary text-primary-foreground rounded-2xl p-6 flex flex-col justify-between" data-testid="custom-summary">
            <div>
              <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">{service === "tiffin" ? "Tiffin plan" : "Dining plan"}</p>
              <p className="font-display font-extrabold text-5xl mt-2 leading-none">₹{customPreview.amount.toLocaleString("en-IN")}</p>
              <div className="mt-5 pt-5 border-t border-white/15 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">Days</p>
                  <p className="font-display font-bold text-lg mt-1" data-testid="custom-days">{customPreview.days}</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">Meals</p>
                  <p className="font-display font-bold text-lg mt-1" data-testid="custom-meals">{customPreview.meals}</p>
                </div>
              </div>
              <p className="text-xs text-primary-foreground/80 mt-4">≈ ₹{customPreview.perDay} per day · ₹{MEAL_PRICE} per meal{service === "tiffin" && tiffinSize === "half" ? " · Half tiffin" : ""}</p>
            </div>
            <Button onClick={startCustomCheckout} data-testid="custom-subscribe-button" className="mt-6 w-full rounded-full bg-white text-primary hover:bg-white/90 h-12 font-semibold">
              Subscribe for {customPreview.days} day{customPreview.days > 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
