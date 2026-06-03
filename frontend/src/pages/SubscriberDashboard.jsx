import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import QRTicket from "../components/QRTicket";
import PendingDeliveriesBanner from "../components/PendingDeliveriesBanner";
import TiffinPreferencesCard from "../components/TiffinPreferencesCard";
import PendingDuesCard from "../components/PendingDuesCard";
import PendingCashOtpFlash from "../components/PendingCashOtpFlash";
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
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pausing, setPausing] = useState(false);

  const load = async () => {
    try {
      const [s, w, q, m, h, c] = await Promise.all([
        api.get("/my/subscription"),
        api.get("/my/wallet"),
        api.get("/my/qr"),
        api.get("/menu/today"),
        api.get("/my/attendance"),
        api.get("/dashboard/config"),
      ]);
      setSub(s.data.subscription);
      setWalletInfo(w.data);
      setQr(q.data);
      setMenu(m.data);
      setHistory(h.data.attendance || []);
      setConfig(c.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const isTiffin = sub?.service_type === "tiffin";
  const isPaused = !!sub?.user_paused;
  const today = new Date().toISOString().slice(0, 10);
  const todaysRecords = history.filter((r) => r.date_str === today);
  const lunchDone = todaysRecords.some((r) => r.meal_type === "lunch");
  const dinnerDone = todaysRecords.some((r) => r.meal_type === "dinner");
  const daysLeft = sub ? Math.max(0, Math.ceil((new Date(sub.end_date) - new Date()) / (1000 * 60 * 60 * 24))) : 0;
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

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard…</div>;

  // Section renderers — keyed for ordering
  const renderSection = (id) => {
    if (!visible(id)) return null;
    switch (id) {
      case "greeting":
        return (
          <div className="mb-8" data-testid="subscription-status">
            <p className="text-xs tracking-overline uppercase font-bold text-secondary">{texts.greeting_overline} {user?.name?.split(" ")[0]}</p>
            <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">
              {isTiffin ? texts.heading_tiffin : texts.heading_eatin}
            </h1>
            <p className="text-muted-foreground text-sm mt-1 italic">{texts.subtext}</p>
          </div>
        );
      case "tiffin_tracker":
        return isTiffin ? (
          <>
            <div className="space-y-5 mb-6" data-testid="dashboard-payment-stack">
              <PendingCashOtpFlash />
              <PendingDuesCard onRefreshUser={checkAuth} />
            </div>
            <PendingDeliveriesBanner />
            <TiffinPreferencesCard />
          </>
        ) : (
          <div className="space-y-5 mb-6" data-testid="dashboard-payment-stack">
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
      className={`text-primary-foreground rounded-2xl p-6 ${isPaused ? "bg-amber-600" : walletStyle ? "" : "bg-primary"}`}
      style={walletStyle || undefined}
      data-testid="wallet-card"
    >
      <div className="flex items-center justify-between">
        <Wallet className="h-5 w-5 opacity-70" strokeWidth={1.75} />
        <span className="text-[10px] tracking-overline uppercase font-bold opacity-70">{isPaused ? "Wallet · Paused" : "Wallet"}</span>
      </div>
      <p className="font-display font-extrabold text-5xl mt-3 leading-none flex items-baseline" data-testid="wallet-balance">
        <IndianRupee className="h-7 w-7" strokeWidth={2} />
        <span>{Math.round(sub.wallet_balance).toLocaleString("en-IN")}</span>
      </p>
      <p className="text-xs opacity-80 mt-3">of ₹{Math.round(sub.amount_paid).toLocaleString("en-IN")} loaded</p>
      <div className="mt-5 pt-5 border-t border-white/15 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-[10px] tracking-overline uppercase font-bold opacity-70">Per day</p>
          <p className="font-display font-bold text-lg mt-1">₹{Math.round(sub.per_day_amount)}</p>
        </div>
        <div>
          <p className="text-[10px] tracking-overline uppercase font-bold opacity-70 flex items-center gap-1"><Pause className="h-3 w-3" /> Extended</p>
          <p className="font-display font-bold text-lg mt-1" data-testid="paused-days">{sub.paused_days} days</p>
        </div>
      </div>
      <p className="text-xs opacity-70 mt-4">
        {isTiffin
          ? "Pause anytime · 7+ continuous days = end-date extended."
          : "Skip 3+ days in a row → wallet pauses & your plan auto-extends."}
      </p>
    </div>
  );

  const todayStatusSection = visible("today_status") && !isTiffin && sub && (
    <div className="surface-3d bg-card rounded-2xl border border-black/5 p-6" style={sideCardStyle || undefined} data-testid="status-card">
      <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today</p>
      <div className="mt-4 space-y-3">
        <StatusRow icon={Sun} label="Lunch" done={lunchDone} />
        <StatusRow icon={Moon} label="Dinner" done={dinnerDone} />
      </div>
      <Link to="/self-scan">
        <Button className="mt-5 w-full rounded-full bg-primary hover:bg-primary/90" data-testid="self-scan-cta">Scan counter QR</Button>
      </Link>
    </div>
  );

  const menuSection = visible("todays_menu") && (
    <div className="surface-3d bg-card rounded-2xl border border-black/5 p-6" style={sideCardStyle || undefined} data-testid="todays-menu">
      <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today's menu</p>
      <div className="mt-4 space-y-4">
        <div>
          <p className="text-sm font-display font-bold flex items-center gap-2"><Sun className="h-4 w-4 text-secondary" strokeWidth={1.75} /> Lunch</p>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{menu?.lunch_items?.join(" · ")}</p>
        </div>
        <div>
          <p className="text-sm font-display font-bold flex items-center gap-2"><Moon className="h-4 w-4 text-primary" strokeWidth={1.75} /> Dinner</p>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{menu?.dinner_items?.join(" · ")}</p>
        </div>
      </div>
    </div>
  );

  const historySection = visible("history") && !isTiffin && (
    <div className="surface-3d bg-card rounded-2xl border border-black/5 p-6" style={sideCardStyle || undefined} data-testid="history-card">
      <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Recent check-ins</p>
      <div className="mt-4 space-y-3 max-h-56 overflow-auto">
        {history.length === 0 && <p className="text-sm text-muted-foreground">No check-ins yet.</p>}
        {history.slice(0, 10).map((r) => (
          <div key={r.att_id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {r.meal_type === "lunch" ? <Sun className="h-4 w-4 text-secondary" strokeWidth={1.75} /> : <Moon className="h-4 w-4 text-primary" strokeWidth={1.75} />}
              <span className="capitalize font-medium">{r.meal_type}</span>
              <span className="text-muted-foreground text-xs">· {r.date_str}</span>
            </div>
            <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{formatTime(r.checked_at)}</span>
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
    <div className="max-w-6xl mx-auto px-6 md:px-8 lg:px-12 py-10" data-testid="subscriber-dashboard">
      {orderedTop.map((s) => <React.Fragment key={s.id}>{renderSection(s.id)}</React.Fragment>)}

      <div className="grid lg:grid-cols-5 gap-8">
        <div className="lg:col-span-3 space-y-6">
          {heroSection}
        </div>

        <div className="lg:col-span-2 space-y-6">
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
    <div className="rounded-3xl border border-border bg-card p-6 md:p-7 space-y-5" data-testid="tiffin-hero-card">
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
            While paused, your daily wallet deduction (₹{Math.round(sub.per_day_amount)}/day) continues —
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
    <div className={`flex items-center justify-between rounded-xl px-4 py-3 border ${done ? "bg-primary/10 border-primary/20" : "bg-muted/50 border-border"}`}>
      <div className="flex items-center gap-3">
        <Icon className={`h-4 w-4 ${done ? "text-primary" : "text-muted-foreground"}`} strokeWidth={1.75} />
        <span className="font-semibold text-sm">{label}</span>
      </div>
      <span className={`text-xs font-bold tracking-overline uppercase ${done ? "text-primary" : "text-muted-foreground"}`}>{done ? "Checked in" : "Pending"}</span>
    </div>
  );
}
