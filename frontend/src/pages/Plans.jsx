import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Check, Loader2, Sparkles, Utensils, Truck, MapPin, AlertTriangle } from "lucide-react";
import { ensureServiceableFix } from "../lib/serviceability";

const MEAL_PRICE_FULL = 70;
const MEAL_PRICE_HALF = 50;
const MEALS_PER_DAY = 2;
const MIN_DAYS = 3;
const MAX_DAYS = 90;

const SERVICES = [
  { id: "dining", label: "Dining", icon: Utensils, hint: "Eat at our hall — scan QR at counter" },
  { id: "tiffin", label: "Tiffin", icon: Truck, hint: "Delivered to your doorstep · twice daily" },
];

export default function Plans() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [service, setService] = useState("dining");
  const [days, setDays] = useState(7);
  const [tiffinSize, setTiffinSize] = useState("full");
  // iter-61 #1: serviceable PIN inline on the hero. Auto-detect silently on
  // mount via the same helper used by the action-time gate. If we already
  // have a cached fix we render it; otherwise this kicks off detection.
  const [hero, setHero] = useState(null); // {km, label} | null
  const [gateOpen, setGateOpen] = useState(false);
  const [gateMsg, setGateMsg] = useState("");
  const [gateAction, setGateAction] = useState(null); // closure to retry

  useEffect(() => {
    (async () => {
      // Background detect — no popup if denied, no block; just no hero pill.
      const fix = await ensureServiceableFix({ persistToUser: !!user });
      if (fix.ok) setHero({ km: fix.km, label: fix.label });
      else if (fix.reason === "out-of-range") setHero({ km: fix.km, label: fix.label, oor: true, radius: fix.radius });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const requireServiceableThen = async (next) => {
    const fix = await ensureServiceableFix({ persistToUser: !!user });
    if (fix.ok) { setHero({ km: fix.km, label: fix.label }); next(); return; }
    if (fix.reason === "out-of-range") {
      setHero({ km: fix.km, label: fix.label, oor: true, radius: fix.radius });
      setGateMsg(`Sorry — you're ${fix.km} km from our kitchen, outside our ${fix.radius} km zone. We can't deliver here.`);
      setGateAction(null);
      setGateOpen(true);
      return;
    }
    setGateMsg(
      fix.reason === "permission-denied"
        ? "Please enable location access — we need it to confirm we deliver in your area. Tap Allow when your browser prompts you."
        : fix.reason === "no-gps"
        ? "Your device doesn't support location. Please contact us at +91 90213 26739."
        : "Couldn't read your location. Tap retry."
    );
    setGateAction(() => () => requireServiceableThen(next));
    setGateOpen(true);
  };

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/plans"); setPlans(r.data.plans); }
      finally { setLoading(false); }
    })();
  }, []);

  // Filter plans by current service tab. Map "dining" tab -> dining category,
  // "tiffin" tab -> tiffin category. Plans persisted via /admin/plans set
  // `category` (iter-51). Older plans without `category` fall back to
  // `service_type` (pre-iter-51) and finally to "dining" so legacy data
  // doesn't disappear.
  const visiblePlans = useMemo(
    () => plans.filter((p) => {
      const cat = (p.category || p.service_type || "dining").toLowerCase();
      return cat === service;
    }),
    [plans, service]
  );

  const customPreview = useMemo(() => {
    const d = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Number(days) || 1));
    const meals = d * MEALS_PER_DAY;
    const mealPrice = service === "tiffin" && tiffinSize === "half" ? MEAL_PRICE_HALF : MEAL_PRICE_FULL;
    return { days: d, meals, amount: meals * mealPrice, perDay: MEALS_PER_DAY * mealPrice, mealPrice };
  }, [days, service, tiffinSize]);

  const profileIncomplete = (u) => !u || !u.name || !u.phone || !u.address || !u.photo_url;

  const startCheckout = (planId) => {
    requireServiceableThen(() => {
      if (!user) return navigate(`/login?next=${encodeURIComponent(`/checkout/${planId}`)}`);
      if (profileIncomplete(user)) return navigate(`/profile?next=/checkout/${planId}`);
      navigate(`/checkout/${planId}`);
    });
  };

  const startCustomCheckout = () => {
    const params = new URLSearchParams({ days: String(customPreview.days), service });
    if (service === "tiffin") params.set("tiffin_size", tiffinSize);
    const next = `/checkout/custom?${params.toString()}`;
    requireServiceableThen(() => {
      if (!user) return navigate(`/login?next=${encodeURIComponent(next)}`);
      if (profileIncomplete(user)) return navigate(`/profile?next=${encodeURIComponent(next)}`);
      navigate(next);
    });
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading plans…</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 lg:px-12 py-5 sm:py-8" data-testid="plans-page">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Subscription plans</p>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl tracking-tight mt-2 leading-[1.05]">Pick a plan. Eat <span className="text-primary">ghar se achha khana.</span></h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-3 leading-relaxed">All plans cover 2 meals per day — wallet auto-pauses when you skip 3+ days in a row.</p>
        {/* iter-61 #1: inline serviceable PIN — boosts trust before Subscribe */}
        {hero && !hero.oor && (
          <div
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold text-emerald-900"
            style={{
              background: "linear-gradient(145deg, #ecfdf5 0%, #d1fae5 100%)",
              border: "1px solid rgba(16, 185, 129, 0.35)",
              boxShadow: "0 2px 8px -2px rgba(16, 185, 129, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.6)",
            }}
            data-testid="plans-serviceable-hero"
          >
            <MapPin className="h-3.5 w-3.5 text-emerald-700" />
            <span>Delivering to <b>{hero.label || "your area"}</b> · <span className="tabular-nums">{hero.km} km</span></span>
          </div>
        )}
        {hero && hero.oor && (
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-300" data-testid="plans-out-of-range-hero">
            <AlertTriangle className="h-3.5 w-3.5" /> {hero.label || "Your area"} · {hero.km} km — outside our {hero.radius} km zone
          </div>
        )}
      </div>

      {/* Service tabs — explicit horizontal row, compact on mobile */}
      <div className="mt-6 sm:mt-8 flex justify-center px-2" data-testid="service-tabs">
        <div className="inline-flex flex-row bg-muted/50 rounded-full p-1 gap-1 w-full max-w-md">
          {SERVICES.map((s) => (
            <button
              key={s.id} type="button" onClick={() => setService(s.id)}
              data-testid={`service-tab-${s.id}`}
              className={`flex-1 px-3 sm:px-5 h-10 rounded-full text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap ${service === s.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <s.icon className="h-3.5 w-3.5 shrink-0" /> {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground mt-2">{SERVICES.find((s) => s.id === service)?.hint}</p>

      {/* iter-60 #6: premium plan cards — gradient backdrop, accent ring, gloss highlight,
          hover lift with shadow halo. Popular card gets richer metallic red gradient. */}
      <div className={`mt-8 grid gap-5 sm:gap-6 mx-auto ${visiblePlans.length === 1 ? "max-w-md" : visiblePlans.length === 2 ? "md:grid-cols-2 max-w-3xl" : "md:grid-cols-3 max-w-5xl"}`}>
        {visiblePlans.map((p, i) => {
          const isPopular = i === 0 && visiblePlans.length > 1;
          const perDay = (p.amount / p.duration_days).toFixed(0);
          return (
            <div
              key={p.plan_id}
              data-testid={`plan-card-${p.plan_id}`}
              className={`group relative rounded-[28px] p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1.5 overflow-hidden ${
                isPopular
                  ? "text-primary-foreground"
                  : "bg-gradient-to-br from-card to-muted/30 border border-border/80 hover:border-primary/40"
              }`}
              style={isPopular ? {
                background: "linear-gradient(155deg, #c92626 0%, #a02323 40%, #7a1a1a 100%)",
                boxShadow: "0 20px 44px -16px rgba(160,35,35,0.55), 0 6px 14px rgba(0,0,0,0.18), inset 0 0 0 3px rgba(255,255,255,0.55), inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -2px 6px rgba(0,0,0,0.22)",
              } : {
                boxShadow: "0 8px 24px -16px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.04), inset 0 0 0 2px rgba(160,35,35,0.35), inset 0 1px 0 rgba(255,255,255,0.6)",
              }}
            >
              {/* Decorative gloss & accent corner */}
              {!isPopular && (
                <span aria-hidden className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br from-primary/12 to-transparent blur-2xl" />
              )}
              {isPopular && (
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-[radial-gradient(80%_60%_at_50%_0%,_rgba(255,255,255,0.18)_0%,_transparent_70%)]" />
              )}

              {isPopular && (
                <span className="relative z-10 inline-flex items-center gap-1 bg-white text-primary text-[10px] tracking-overline uppercase font-extrabold px-3 py-1 rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.18)]">
                  Most popular
                </span>
              )}
              <p className={`relative z-10 ${isPopular ? "mt-3" : ""} text-[10px] sm:text-xs tracking-overline uppercase font-bold ${isPopular ? "text-primary-foreground/80" : "text-secondary"}`}>
                {p.meals} meals · {p.duration_days} days
              </p>
              <h3 className="relative z-10 font-display font-extrabold text-2xl sm:text-[28px] mt-2 leading-tight">{p.name}</h3>
              <p className={`relative z-10 mt-2 text-[13px] sm:text-sm leading-relaxed ${isPopular ? "text-primary-foreground/85" : "text-muted-foreground"}`}>{p.description}</p>

              {/* Price strip with tabular numerals + per-day micro */}
              <div className={`relative z-10 mt-5 rounded-2xl p-4 ${isPopular ? "bg-white/12 backdrop-blur-sm" : "bg-muted/40 border border-border/60"}`}>
                <div className="flex items-baseline gap-2">
                  <span className="font-display font-extrabold text-[40px] sm:text-[44px] tabular-nums leading-none">₹{p.amount.toFixed(0)}</span>
                  <span className={`text-[11px] sm:text-xs ${isPopular ? "text-primary-foreground/75" : "text-muted-foreground"}`}>one-time</span>
                </div>
                <p className={`text-[11px] mt-1 tabular-nums ${isPopular ? "text-primary-foreground/80" : "text-muted-foreground"}`}>≈ ₹{perDay} per day · ₹{(p.amount / p.meals).toFixed(0)} per meal</p>
              </div>

              <ul className="relative z-10 mt-5 space-y-2.5 text-[13px] sm:text-sm">
                {(service === "dining"
                  ? [`${p.meals} total meals`, "Lunch + Dinner at our hall", "Scan QR at counter", "Auto-pause on 3+ skipped days"]
                  : [`${p.meals} tiffins · ${p.duration_days} days`, "Lunch + Dinner delivered daily", "Doorstep geofence verification", "Pause anytime · 7+ days extends plan"]
                ).map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full ${isPopular ? "bg-white/20" : "bg-primary/10"} shrink-0`}>
                      <Check className={`h-3 w-3 ${isPopular ? "text-white" : "text-primary"}`} strokeWidth={2.5} />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => startCheckout(p.plan_id)}
                data-testid={`subscribe-button-${p.plan_id}`}
                className={`relative z-10 mt-7 w-full rounded-full h-12 font-bold text-sm tracking-wide transition-shadow ${
                  isPopular
                    ? "bg-white text-primary hover:bg-white/95 shadow-[0_6px_16px_rgba(0,0,0,0.18)]"
                    : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_6px_16px_-6px_rgba(160,35,35,0.45)]"
                }`}
              >
                Subscribe →
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
        <div
          className="rounded-3xl border border-border bg-card p-4 sm:p-8 md:p-10 grid lg:grid-cols-5 gap-6 sm:gap-8"
          style={{ boxShadow: "0 8px 24px -16px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.04), inset 0 0 0 2px rgba(160,35,35,0.35), inset 0 1px 0 rgba(255,255,255,0.6)" }}
        >
          <div className="lg:col-span-3 min-w-0">
            <p className="text-[10px] sm:text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Build your own</p>
            <h2 className="font-display font-extrabold text-xl sm:text-3xl md:text-4xl tracking-tight mt-3 leading-tight break-words">Pick any number of days.</h2>
            <p className="text-sm sm:text-base text-muted-foreground mt-3 leading-relaxed">Pay exactly for the days you'll eat. <span className="font-semibold text-foreground">₹{MEAL_PRICE_FULL}/meal</span> for full tiffin or dining; <span className="font-semibold text-foreground">₹{MEAL_PRICE_HALF}/meal</span> for half tiffin.</p>

            {/* Iter-58 #3: stack — Service tabs first (row), Tiffin size tabs UNDER as a 2nd row. */}
            <div className="mt-6 flex flex-col items-stretch gap-5">
              <div className="text-center" data-testid="custom-service">
                <label className="text-sm sm:text-base tracking-overline uppercase font-extrabold text-muted-foreground">Service</label>
                <div className="mt-2.5 flex flex-row gap-2 justify-center flex-nowrap">
                  {SERVICES.map((s) => (
                    <button
                      key={s.id} type="button" onClick={() => setService(s.id)}
                      data-testid={`custom-service-${s.id}`}
                      className={`px-4 sm:px-5 h-10 rounded-full text-xs sm:text-sm font-bold border-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${service === s.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}
                    >
                      <s.icon className="h-3.5 w-3.5 shrink-0" /> {s.label}
                    </button>
                  ))}
                </div>
                {/* thin red divider below Service tabs */}
                <hr className="mt-3 mx-auto w-32 h-0.5 border-0 bg-primary rounded-sm" data-testid="service-divider" />
              </div>

              <div className={`text-center transition-opacity ${service !== "tiffin" ? "opacity-40 pointer-events-none" : ""}`} data-testid="custom-tiffin-size">
                <label className="text-sm sm:text-base tracking-overline uppercase font-extrabold text-muted-foreground">Tiffin size</label>
                <div className="mt-2.5 flex flex-row gap-2 justify-center flex-nowrap">
                  {[
                    { id: "half", label: "3 chapati" },
                    { id: "full", label: "5 chapati" },
                  ].map((t) => (
                    <button
                      key={t.id} type="button" onClick={() => setTiffinSize(t.id)}
                      className={`px-4 sm:px-5 h-10 rounded-full text-xs sm:text-sm font-bold border-2 transition-colors whitespace-nowrap ${tiffinSize === t.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}
                      data-testid={`custom-tiffin-${t.id}`}
                    >{t.label}</button>
                  ))}
                </div>
                {/* thin red divider below Tiffin size tabs */}
                <hr className="mt-3 mx-auto w-32 h-0.5 border-0 bg-primary rounded-sm" data-testid="tiffin-size-divider" />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2 justify-center" data-testid="day-presets">
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
              <p className="text-xs text-primary-foreground/80 mt-4">≈ ₹{customPreview.perDay} per day · ₹{customPreview.mealPrice} per meal{service === "tiffin" && tiffinSize === "half" ? " · Half tiffin (3 chapati)" : ""}</p>
            </div>
            <Button onClick={startCustomCheckout} data-testid="custom-subscribe-button" className="mt-6 w-full rounded-full bg-white text-primary hover:bg-white/90 h-12 font-semibold">
              Subscribe for {customPreview.days} day{customPreview.days > 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      </div>

      {/* iter-61 #5: action-time location gate modal */}
      {gateOpen && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onClick={() => setGateOpen(false)} data-testid="action-location-gate">
          <div className="bg-card rounded-3xl max-w-sm w-full p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="inline-flex h-11 w-11 rounded-2xl bg-primary/12 text-primary items-center justify-center">
              <MapPin className="h-5 w-5" />
            </div>
            <h3 className="font-display font-extrabold text-lg sm:text-xl mt-3 leading-tight">Location needed to subscribe</h3>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed" data-testid="action-gate-msg">{gateMsg}</p>
            <div className="mt-4 flex gap-2 justify-end">
              <button type="button" onClick={() => setGateOpen(false)} className="px-4 py-2 rounded-full text-xs font-bold border border-border hover:bg-muted/60">Close</button>
              {gateAction && (
                <button
                  type="button"
                  onClick={() => { setGateOpen(false); gateAction(); }}
                  className="px-4 py-2 rounded-full text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="action-gate-retry"
                >Allow & retry</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
