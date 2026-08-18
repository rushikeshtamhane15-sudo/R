import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import QRTicket from "../components/QRTicket";
import PendingDeliveriesBanner from "../components/PendingDeliveriesBanner";
import TiffinPreferencesCard from "../components/TiffinPreferencesCard";
import DeliveryTimeCard from "../components/DeliveryTimeCard";
import TiffinDashboardGrid from "../components/TiffinDashboardGrid";
import PendingDuesCard from "../components/PendingDuesCard";
import PendingCashOtpFlash from "../components/PendingCashOtpFlash";
import TodayMessMenuFlash from "../components/TodayMessMenuFlash";
import AdminNoticesBanner from "../components/AdminNoticesBanner";
import DashboardSkeleton from "../components/DashboardSkeleton";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import {
  Utensils, Moon, Sun, Clock, Wallet, Pause, Play, IndianRupee, Loader2, Truck, AlertCircle,
} from "lucide-react";

function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

const FALLBACK_TEXTS = {
  greeting_overline: "Hello,",
  heading_eatin: "Your e-Meal Pass",
  heading_tiffin: "Your tiffin delivery",
  subtext: "ghar se achha khana",
  no_sub_title: "You don't have an active plan",
  no_sub_subtext: "Pick a dining or tiffin plan to start eating ghar se achha khana.",
};

export default function SubscriberDashboard() {
  const { user, checkAuth } = useAuth();
  const [sub, setSub] = useState(null);
  const [walletInfo, setWalletInfo] = useState(null);
  const [qr, setQr] = useState(null);
  const [menu, setMenu] = useState(null);
  const [history, setHistory] = useState([]);
  // iter-111: warm-start config from localStorage — /dashboard/config rarely
  // changes (sections + ordering driven by admin CMS), so reading the last
  // cached copy lets the dashboard skeleton render instantly while the
  // fresh value is fetched in the background. Saves the first-paint round-trip.
  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem("dashCfg") || "null"); }
    catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [pausing, setPausing] = useState(false);

  // iter-131.12: dual-subscription support. Track ALL active subs and let
  // the user toggle which one drives the dashboard content.
  const [allSubs, setAllSubs] = useState([]);
  const [activeSubIdx, setActiveSubIdx] = useState(0);

  const load = async () => {
    // iter-111: progressive render — fire all 6 reads in parallel but use
    // Promise.allSettled so a single slow/failed call can't lock the UI.
    // iter-131.12: replaced `/my/subscription` with `/my/subscriptions` to
    // fetch every active plan; the toggle bar picks which one is shown.
    const [s, w, q, m, h, c] = await Promise.allSettled([
      api.get("/my/subscriptions"),
      api.get("/my/wallet"),
      api.get("/my/qr"),
      api.get("/menu/today"),
      api.get("/my/attendance"),
      api.get("/dashboard/config"),
    ]);
    if (s.status === "fulfilled") {
      const arr = s.value.data.subscriptions || [];
      setAllSubs(arr);
      setSub(arr[activeSubIdx] || arr[0] || null);
    }
    if (w.status === "fulfilled") setWalletInfo(w.value.data);
    if (q.status === "fulfilled") setQr(q.value.data);
    if (m.status === "fulfilled") setMenu(m.value.data);
    if (h.status === "fulfilled") setHistory(h.value.data.attendance || []);
    if (c.status === "fulfilled") {
      setConfig(c.value.data);
      try { localStorage.setItem("dashCfg", JSON.stringify(c.value.data)); } catch { /* quota */ }
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const isTiffin = sub?.service_type === "tiffin";
  const isPaused = !!sub?.user_paused;
  const today = new Date().toISOString().slice(0, 10);
  const todaysRecords = history.filter((r) => r.date_str === today);
  const lunchDone = todaysRecords.some((r) => r.meal_type === "lunch");
  const dinnerDone = todaysRecords.some((r) => r.meal_type === "dinner");
  // iter-125 — Days-Left invariant fix. Previously this used `Math.ceil` on
  // `(end_date - now)`, which after one day's deduction (₹93 + 2 meals)
  // would still round UP to the full 30-day duration — making it look like
  // no time had passed even though wallet and meals had clearly ticked.
  // The fix takes the MIN of two sources of truth:
  //   • Calendar floor   : how many WHOLE days until `end_date`
  //   • Wallet capacity  : how many days the remaining ₹ can fund at `per_day_amount`
  // After day-1 of a 30/60/₹2,800 plan, both report 29 → display stays
  // synchronised with the visible wallet (₹2,707) and meals-left (58).
  // iter-138.v — compare CALENDAR days instead of timestamps. A sub created
  // 3 seconds ago used to show 29 because `Math.floor((end - now) / 86400000)`
  // hit 29.9999 → floor → 29. We now zero the hh:mm on both sides and use
  // Math.round so a fresh sub reports the full 30 days remaining.
  const daysLeft = sub ? (() => {
    const end = new Date(sub.end_date);
    const now = new Date();
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rawDaysLeft = Math.round((endDay - nowDay) / (1000 * 60 * 60 * 24));
    const walletCapacity = Math.round(Number(sub.wallet_balance || 0) / Math.max(1, Number(sub.per_day_amount || 1)));
    return Math.max(0, Math.min(rawDaysLeft, walletCapacity));
  })() : 0;
  const mealsLeft = sub ? sub.meals_total - sub.meals_used : 0;

  const togglePause = async () => {
    setPausing(true);
    try {
      const ep = isPaused ? "/my/subscription/resume" : "/my/subscription/pause";
      await api.post(ep);
      toast.success(isPaused ? "Tiffin delivery resumed — see you tomorrow!" : "Tiffin paused — you're off the dispatch list.");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not update"); }
    finally { setPausing(false); }
  };

  const texts = { ...FALLBACK_TEXTS, ...(config?.texts || {}) };
  const colors = config?.colors || {};
  const sectionsByOrder = useMemo(
    () => (config?.sections || []).slice().sort((a, b) => a.order - b.order),
    [config]
  );
  const visible = (id) => {
    const s = (config?.sections || []).find((x) => x.id === id);
    return !s || s.visible !== false;
  };

  if (loading) return <DashboardSkeleton />;

  // iter-131.12: helper — friendly label for each active subscription tab.
  const labelForSub = (s) => {
    const svc = (s?.service_type || s?.category || "").toLowerCase();
    if (svc === "tiffin") return "Tiffin plan";
    if (svc === "dining") return "Dining plan";
    if (svc === "delivery") return "Delivery plan";
    return s?.plan_name || "Plan";
  };
  const pickSub = (idx) => {
    setActiveSubIdx(idx);
    setSub(allSubs[idx] || null);
  };

  // Section renderers — keyed for ordering
  const renderSection = (id) => {
    if (!visible(id)) return null;
    switch (id) {
      case "greeting":
        return (
          <div className="mb-6 md:mb-8 text-center" data-testid="subscription-status">
            <p className="text-xs tracking-overline uppercase font-bold text-secondary">{texts.greeting_overline} {user?.name?.split(" ")[0]}</p>
            <h1 className="font-display font-extrabold text-2xl md:text-4xl tracking-tight mt-2">
              {isTiffin ? texts.heading_tiffin : texts.heading_eatin}
            </h1>
            <p className="text-muted-foreground text-sm mt-1 italic">{texts.subtext}</p>
            {/* iter-131.12: dual-plan toggle. Only rendered when the user
                holds 2+ active subscriptions. Clicking swaps the entire
                dashboard content to that plan's stats. */}
            {allSubs.length > 1 && (
              <div className="mt-4 flex justify-center" data-testid="dashboard-plan-toggle-wrap">
                <div className="inline-flex rounded-full bg-muted p-0.5 gap-0.5" role="tablist" data-testid="dashboard-plan-toggle">
                  {allSubs.map((s, i) => {
                    const on = i === activeSubIdx;
                    const svc = (s?.service_type || "").toLowerCase();
                    return (
                      <button
                        key={s.sub_id}
                        type="button"
                        onClick={() => pickSub(i)}
                        role="tab"
                        aria-selected={on}
                        data-testid={`dashboard-plan-tab-${svc || i}`}
                        className={`px-4 h-9 rounded-full text-xs font-extrabold transition-colors ${on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        Active {labelForSub(s)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      case "tiffin_tracker":
        return isTiffin ? (
          <div className="max-w-[280px] sm:max-w-none mx-auto sm:mx-0 space-y-3 mb-3" data-testid="tiffin-tracker-wrapper">
            <div className="space-y-3" data-testid="dashboard-payment-stack">
              <PendingCashOtpFlash />
              <PendingDuesCard onRefreshUser={checkAuth} />
            </div>
            <PendingDeliveriesBanner />
          </div>
        ) : (
          <div className="space-y-3 mb-3" data-testid="dashboard-payment-stack">
            <PendingCashOtpFlash />
            <PendingDuesCard onRefreshUser={checkAuth} />
          </div>
        );
      default:
        return null;
    }
  };

  const heroSection = visible("hero") && (
    !sub ? (
      <NoSubscriptionCard texts={texts} />
    ) : isTiffin ? (
      <TiffinHeroCard sub={sub} isPaused={isPaused} pausing={pausing} togglePause={togglePause} daysLeft={daysLeft} accent={colors.hero_accent} />
    ) : (
      <QRTicket
        token={qr?.qr_token}
        userName={qr?.user_name || user?.name}
        mealsLeft={mealsLeft}
        mealsTotal={sub.meals_total}
        daysLeft={daysLeft}
        planName={sub.plan_name}
      />
    )
  );

  const walletStyle = (colors.wallet_bg || colors.wallet_fg) ? {
    background: colors.wallet_bg || undefined,
    color: colors.wallet_fg || undefined,
  } : null;

  const sideCardStyle = colors.section_card_bg ? { background: colors.section_card_bg } : null;

  const walletSection = visible("wallet") && sub && (
    <div
      className={`text-primary-foreground rounded-2xl p-4 md:p-5 ${isPaused ? "bg-amber-600" : walletStyle ? "" : "bg-primary"}`}
      style={{
        ...(walletStyle || {}),
        boxShadow: "0 10px 24px -14px rgba(160,35,35,0.4), 0 2px 6px -2px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.24)",
      }}
      data-testid="wallet-card"
    >
      <div className="flex items-center justify-between">
        <Wallet className="h-4 w-4 opacity-70" strokeWidth={1.75} />
        <span className="text-[10px] tracking-overline uppercase font-bold opacity-70">{isPaused ? "Wallet · Paused" : "Wallet"}</span>
      </div>
      <p className="font-display font-extrabold text-3xl md:text-4xl mt-2 leading-none flex items-baseline" data-testid="wallet-balance">
        <IndianRupee className="h-5 w-5" strokeWidth={2} />
        <span>{Math.round(sub.wallet_balance).toLocaleString("en-IN")}</span>
      </p>
      <p className="text-[11px] opacity-80 mt-1.5">of ₹{Math.round(sub.amount_paid).toLocaleString("en-IN")} loaded</p>

      {(isPaused || (sub.paused_days || 0) > 0) && (
        <div
          className="mt-3 rounded-lg bg-white/15 border border-white/25 px-2.5 py-2 flex items-start gap-2"
          data-testid="wallet-pause-banner"
        >
          <Pause className="h-3 w-3 mt-0.5 shrink-0" strokeWidth={2} />
          <div className="text-[11px] leading-snug">
            <p className="font-extrabold">
              {isPaused
                ? "Plan paused — no deduction today."
                : `Extended by ${sub.paused_days} day${sub.paused_days === 1 ? "" : "s"}.`}
            </p>
          </div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-white/15 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[9px] tracking-overline uppercase font-bold opacity-70">Per day</p>
          <p className="font-display font-bold text-base mt-0.5" data-testid="per-day-amount">
            ₹{Number(sub.per_day_amount || 0).toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[9px] tracking-overline uppercase font-bold opacity-70 flex items-center gap-1"><Pause className="h-2.5 w-2.5" /> Extended</p>
          <p className="font-display font-bold text-base mt-0.5" data-testid="paused-days">{sub.paused_days} d</p>
        </div>
      </div>
    </div>
  );

  const todayStatusSection = visible("today_status") && !isTiffin && sub && (
    <div
      className="bg-card rounded-2xl border border-black/5 p-4"
      style={{
        ...(sideCardStyle || {}),
        boxShadow: "0 8px 20px -12px rgba(15,23,42,0.16), 0 2px 6px -2px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.85)",
      }}
      data-testid="status-card"
    >
      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Today</p>
      <div className="mt-2.5 space-y-2">
        <StatusRow icon={Sun} label="Lunch" done={lunchDone} />
        <StatusRow icon={Moon} label="Dinner" done={dinnerDone} />
      </div>
      <Link to="/self-scan">
        <Button size="sm" className="mt-3 w-full rounded-full bg-primary hover:bg-primary/90 h-9 text-xs font-bold" data-testid="self-scan-cta">Scan counter QR</Button>
      </Link>
    </div>
  );

  const menuSection = visible("todays_menu") && (
    <div
      className="bg-card rounded-2xl border border-black/5 p-4"
      style={{
        ...(sideCardStyle || {}),
        boxShadow: "0 8px 20px -12px rgba(15,23,42,0.16), 0 2px 6px -2px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.85)",
      }}
      data-testid="todays-menu"
    >
      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Today&apos;s menu</p>
      <TodayMessMenuFlash compact />
    </div>
  );

  const historySection = visible("history") && !isTiffin && (
    <div
      className="bg-card rounded-2xl border border-black/5 p-4"
      style={{
        ...(sideCardStyle || {}),
        boxShadow: "0 8px 20px -12px rgba(15,23,42,0.16), 0 2px 6px -2px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.85)",
      }}
      data-testid="history-card"
    >
      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Recent check-ins</p>
      <div className="mt-2.5 space-y-2 max-h-44 overflow-auto">
        {history.length === 0 && <p className="text-xs text-muted-foreground">No check-ins yet.</p>}
        {history.slice(0, 10).map((r) => (
          <div key={r.att_id} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              {r.meal_type === "lunch" ? <Sun className="h-3.5 w-3.5 text-secondary" strokeWidth={1.75} /> : <Moon className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />}
              <span className="capitalize font-semibold">{r.meal_type}</span>
              <span className="text-muted-foreground text-[10px]">· {r.date_str}</span>
            </div>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{formatTime(r.checked_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // Determine which order group each section belongs to
  // greeting + tiffin_tracker render full-width above; hero is the main column hero;
  // wallet, today_status, todays_menu, history live in the side column.
  // We respect admin order *within each lane*.
  const lane = {
    top: ["greeting", "tiffin_tracker"],
    main: ["hero"],
    side: ["wallet", "today_status", "todays_menu", "history"],
  };
  const orderedTop = sectionsByOrder.filter((s) => lane.top.includes(s.id));
  const orderedSide = sectionsByOrder.filter((s) => lane.side.includes(s.id));

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 md:px-8 lg:px-12 py-6 md:py-10" data-testid="subscriber-dashboard">
      <AdminNoticesBanner onAcknowledged={load} />
      {orderedTop.map((s) => <React.Fragment key={s.id}>{renderSection(s.id)}</React.Fragment>)}

      {isTiffin && sub ? (
        <TiffinDashboardGrid
          sub={sub}
          qr={qr}
          history={history}
          isPaused={isPaused}
          pausing={pausing}
          togglePause={togglePause}
          daysLeft={daysLeft}
          preferencesSlot={<TiffinPreferencesCard />}
          deliveryTimeSlot={<DeliveryTimeCard />}
        />
      ) : (
        <div className="grid lg:grid-cols-5 gap-3 md:gap-4">
          <div className="lg:col-span-3 max-w-[280px] mx-auto lg:max-w-none lg:mx-0 w-full space-y-3 md:space-y-4">
            {heroSection}
          </div>

          <div className="lg:col-span-2 max-w-[280px] mx-auto lg:max-w-none lg:mx-0 w-full space-y-3 md:space-y-4">
            {orderedSide.map((s) => {
              switch (s.id) {
                case "wallet": return <React.Fragment key={s.id}>{walletSection}</React.Fragment>;
                case "today_status": return <React.Fragment key={s.id}>{todayStatusSection}</React.Fragment>;
                case "todays_menu": return <React.Fragment key={s.id}>{menuSection}</React.Fragment>;
                case "history": return <React.Fragment key={s.id}>{historySection}</React.Fragment>;
                default: return null;
              }
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NoSubscriptionCard({ texts }) {
  return (
    <div className="bg-secondary/10 border border-secondary/20 rounded-2xl p-8 text-center" data-testid="no-sub-banner">
      <Utensils className="h-8 w-8 text-secondary mx-auto" />
      <p className="font-display font-bold text-xl mt-3">{texts.no_sub_title}</p>
      <p className="text-sm text-muted-foreground mt-1">{texts.no_sub_subtext}</p>
      <Link to="/plans">
        <Button className="mt-5 rounded-full bg-secondary hover:bg-secondary/90" data-testid="get-plan-button">Choose a plan</Button>
      </Link>
    </div>
  );
}

function TiffinHeroCard({ sub, isPaused, pausing, togglePause, daysLeft, accent }) {
  const accentStyle = accent ? { color: accent } : null;
  return (
    <div
      className="rounded-3xl border border-border bg-card p-6 md:p-7 space-y-5 relative overflow-hidden transition-transform hover:-translate-y-0.5"
      style={{
        // iter-131.13: pseudo-3D depth around the tile — layered outer soft
        // shadow, inner top highlight, and a subtle bottom shade. Text is
        // untouched by the 3D treatment; only the container reads as raised.
        boxShadow: "0 22px 40px -20px rgba(15,23,42,0.28), 0 6px 12px -6px rgba(15,23,42,0.14), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(15,23,42,0.06)",
      }}
      data-testid="tiffin-hero-card"
    >
      {/* subtle radial highlight in the upper-left corner for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 h-56 w-56 rounded-full opacity-60"
        style={{ background: "radial-gradient(circle at center, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 65%)" }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5" style={accentStyle || undefined}>
            <Truck className="h-3.5 w-3.5" /> {sub.tiffin_size === "half" ? "Half" : "Full"} tiffin · {sub.plan_name}
          </p>
          <h2 className="font-display font-extrabold text-2xl md:text-3xl mt-2 leading-tight">
            {isPaused ? "Delivery is paused" : "Delivery is active"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {isPaused
              ? "You're off the dispatch list — wallet keeps deducting; pause for 7+ days to auto-extend."
              : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} of tiffins left.`}
          </p>
        </div>
        <Button
          onClick={togglePause}
          disabled={pausing}
          className={`rounded-full font-semibold ${isPaused ? "bg-primary hover:bg-primary/90" : "bg-amber-500 hover:bg-amber-600 text-white"}`}
          data-testid="toggle-pause-button"
        >
          {pausing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
          {isPaused ? "Resume delivery" : "Pause delivery"}
        </Button>
      </div>

      <Link to="/track" className="block">
        <Button variant="outline" className="w-full rounded-full font-semibold" data-testid="open-live-tracking">
          <Truck className="h-4 w-4 mr-2" /> Open live tracking
        </Button>
      </Link>

      {isPaused && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900" data-testid="pause-info">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            While paused, your daily wallet deduction (₹{Number(sub.per_day_amount || 0).toFixed(2)}/day) continues —
            but once you've been paused for <b>more than 7 days continuously</b>, every additional paused day
            extends your subscription end-date by 1 day. <span className="font-semibold">Resume any time.</span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 pt-2">
        <Stat label="Days left" value={daysLeft} />
        <Stat label="Tiffins left" value={Math.max(0, sub.meals_total - sub.meals_used)} />
        <Stat label="End date" value={new Date(sub.end_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-muted/40 px-4 py-3">
      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p>
      <p className="font-display font-extrabold text-xl mt-1 leading-tight">{value}</p>
    </div>
  );
}

function StatusRow({ icon: Icon, label, done }) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-2 border ${done ? "bg-primary/10 border-primary/20" : "bg-muted/50 border-border"}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${done ? "text-primary" : "text-muted-foreground"}`} strokeWidth={1.75} />
        <span className="font-semibold text-xs">{label}</span>
      </div>
      <span className={`text-[10px] font-bold tracking-overline uppercase ${done ? "text-primary" : "text-muted-foreground"}`}>{done ? "Done" : "Pending"}</span>
    </div>
  );
}
