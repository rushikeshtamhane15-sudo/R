/**
 * AdminMessMetrics + FranchisePortal — iter-76 #1.
 *
 * Renders the per-mess P&L + attendance dashboard. The same view is shown
 * to admins (any mess via /admin/messes/:messId/metrics) and to franchise
 * owners (only THEIR mess via /franchise/me/metrics).
 */
import React, { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import {
  Users, ShoppingCart, ScanLine, Building2, IndianRupee, Activity,
  TrendingUp, Loader2, ChevronLeft,
} from "lucide-react";

function Sparkline({ values = [], width = 110, height = 28, accent = "currentColor" }) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1 || 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block mt-1" aria-hidden>
      <polyline points={points} fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricCard({ icon: Icon, label, value, sub, accent = "primary", testId, spark }) {
  const ring = {
    primary: "bg-primary/10 text-primary",
    emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    amber:   "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    blue:    "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    fuchsia: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  }[accent] || "bg-primary/10 text-primary";
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid={testId}>
      <div className="flex items-center gap-2.5">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${ring}`}>
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 font-display font-extrabold text-2xl sm:text-3xl tabular-nums leading-tight">{value}</p>
      {spark && spark.length > 0 && (
        <Sparkline values={spark} accent={`var(--${accent === "primary" ? "primary" : "foreground"})`} />
      )}
      {sub && <p className="text-[11px] mt-1 text-muted-foreground">{sub}</p>}
    </div>
  );
}

function MetricsBody({ source, headerExtra }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(source.url + (source.url.includes("?") ? "&" : "?") + `days=${days}`);
      setData(r.data || null);
    } catch (e) { setData({ error: e?.response?.data?.detail || "Failed" }); }
    finally { setLoading(false); }
  }, [source.url, days]);
  useEffect(() => { load(); }, [load]);

  return (
    <div data-testid={source.testIdRoot}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {headerExtra}
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-1" data-testid={`${source.testIdRoot}-title`}>{data?.mess?.name || "Mess metrics"}</h1>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5"><Building2 className="h-3 w-3" /> {data?.mess?.address}, {data?.mess?.city || ""}</p>
        </div>
        <div className="inline-flex bg-muted/60 rounded-full p-1 gap-1" data-testid={`${source.testIdRoot}-window`}>
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`px-3 h-9 rounded-full text-xs font-extrabold ${days === d ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`} data-testid={`metrics-window-${d}`}>Last {d}d</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : data?.error ? (
        <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-destructive">{data.error}</div>
      ) : !data ? null : (
        <>
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <MetricCard testId="metric-subscribers"  icon={Users}        label="Active subscribers" value={data.subscribers_active}  sub={`${data.subscribers_total} all-time`} accent="primary" />
            <MetricCard testId="metric-revenue-sub"  icon={IndianRupee}  label="Subscription revenue (active)" value={`₹${data.subscription_revenue_active.toLocaleString("en-IN")}`} sub="Sum of active passes' amount_paid" accent="emerald" />
            <MetricCard testId="metric-revenue-ord"  icon={ShoppingCart} label={`Order revenue · ${data.window_days}d`} value={`₹${data.order_revenue_window.toLocaleString("en-IN")}`} sub={`${data.order_count_window} orders`} accent="amber" />
            <MetricCard testId="metric-checkins"     icon={ScanLine}     label={`QR check-ins · ${data.window_days}d`} value={data.checkins_window} sub={`${data.checkins_per_day_avg} / day average`} accent="blue" spark={data.checkins_per_day_series} />
            <MetricCard testId="metric-capacity"     icon={Activity}     label="Daily capacity" value={data.capacity_daily} sub={`Lunch+Dinner combined`} accent="fuchsia" />
            <MetricCard testId="metric-utilization"  icon={TrendingUp}   label="Kitchen utilization" value={`${data.utilization_pct}%`} sub={`Check-ins / (capacity × ${data.window_days} days)`} accent="emerald" />
          </div>
          <p className="text-[10.5px] text-muted-foreground mt-5">Computed at {new Date(data.computed_at).toLocaleString("en-IN")}</p>
        </>
      )}
    </div>
  );
}

export function AdminMessMetrics() {
  const { messId } = useParams();
  return (
    <MetricsBody
      source={{ url: `/admin/messes/${messId}/metrics`, testIdRoot: "admin-mess-metrics" }}
      headerExtra={
        <Link to="/admin/messes" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="admin-mess-metrics-back">
          <ChevronLeft className="h-3.5 w-3.5" /> Back to messes
        </Link>
      }
    />
  );
}

export function FranchisePortal() {
  return (
    <div className="min-h-[calc(100vh-72px)] bg-background">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Franchise portal · efoodcare</p>
        <MetricsBody
          source={{ url: "/franchise/me/metrics", testIdRoot: "franchise-portal" }}
        />
      </div>
    </div>
  );
}

export default AdminMessMetrics;
