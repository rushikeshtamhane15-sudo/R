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

/**
 * RevenueAreaSparkline — iter-79 Batch C #8.
 * Bigger area-chart variant of Sparkline used for the per-mess daily
 * revenue trend (subscriptions + orders combined). 280×60 SVG with a
 * gradient fill so the chart reads as a hero element. Falls back to a
 * dashed baseline when all values are zero.
 */
function RevenueAreaSparkline({ values = [], height = 60 }) {
  const w = 100; // viewBox width — we use a stretchy preserveAspectRatio so the SVG fills its container responsively
  const h = height;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = h - (v / max) * (h - 8) - 4;
    return [x, y];
  });
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${(values.length - 1) * step},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block w-full mt-3" style={{ height: `${h}px` }} aria-hidden data-testid="revenue-area-spark">
      <defs>
        <linearGradient id="revAreaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.30" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.00" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#revAreaFill)" />
      <path d={linePath} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {/* dot on the last point */}
      {pts.length > 0 && (
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="1.6" fill="hsl(var(--primary))" vectorEffect="non-scaling-stroke" />
      )}
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

function MetricsBody({ source, headerExtra, visibleSections }) {
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

  // iter-91: per-mess franchise visibility — null = show everything (admin view).
  const showAll = !visibleSections;
  const show = (key) => showAll || visibleSections.includes(key);

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
            {show("subscribers") && (
              <MetricCard testId="metric-subscribers"  icon={Users}        label="Active subscribers" value={data.subscribers_active}  sub={`${data.subscribers_total} all-time`} accent="primary" />
            )}
            {show("revenue_sub") && (
              <MetricCard testId="metric-revenue-sub"  icon={IndianRupee}  label="Subscription revenue (active)" value={`₹${data.subscription_revenue_active.toLocaleString("en-IN")}`} sub={`New signups · last ${data.window_days}d`} accent="emerald" spark={data.subscription_revenue_series} />
            )}
            {show("revenue_ord") && (
              <MetricCard testId="metric-revenue-ord"  icon={ShoppingCart} label={`Order revenue · ${data.window_days}d`} value={`₹${data.order_revenue_window.toLocaleString("en-IN")}`} sub={`${data.order_count_window} orders`} accent="amber" spark={data.order_revenue_series} />
            )}
            {show("checkins") && (
              <MetricCard testId="metric-checkins"     icon={ScanLine}     label={`QR check-ins · ${data.window_days}d`} value={data.checkins_window} sub={`${data.checkins_per_day_avg} / day average`} accent="blue" spark={data.checkins_per_day_series} />
            )}
            {show("capacity") && (
              <MetricCard testId="metric-capacity"     icon={Activity}     label="Daily capacity" value={data.capacity_daily} sub={`Lunch+Dinner combined`} accent="fuchsia" />
            )}
            {show("utilization") && (
              <MetricCard testId="metric-utilization"  icon={TrendingUp}   label="Kitchen utilization" value={`${data.utilization_pct}%`} sub={`Check-ins / (capacity × ${data.window_days} days)`} accent="emerald" />
            )}
          </div>
          {/* iter-79 Batch C #8: total daily revenue trend (orders + subscriptions) */}
          {data.total_revenue_series && data.total_revenue_series.length > 0 && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="metric-total-revenue-trend">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <IndianRupee className="h-4 w-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Total daily revenue · last {data.window_days}d</p>
                  <p className="font-display font-extrabold text-xl sm:text-2xl tabular-nums leading-tight mt-0.5">₹{(data.total_revenue_series.reduce((a, b) => a + b, 0)).toLocaleString("en-IN")}</p>
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  <p>Peak day</p>
                  <p className="font-display font-extrabold text-sm text-foreground tabular-nums">₹{Math.max(...data.total_revenue_series).toLocaleString("en-IN")}</p>
                </div>
              </div>
              <RevenueAreaSparkline values={data.total_revenue_series} />
            </div>
          )}
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
  // iter-91: respect per-mess section visibility set by HQ admin.
  const [visibleSections, setVisibleSections] = useState(null);
  useEffect(() => {
    let mounted = true;
    const fetchSections = async () => {
      try {
        const r = await api.get("/franchise/me/visible-sections");
        if (mounted) setVisibleSections(r.data?.visible_sections || []);
      } catch (_e) { if (mounted) setVisibleSections(null); /* fail-open: show all */ }
    };
    fetchSections();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="min-h-[calc(100vh-72px)] bg-background">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Franchise portal · efoodcare</p>
        <MetricsBody
          source={{ url: "/franchise/me/metrics", testIdRoot: "franchise-portal" }}
          visibleSections={visibleSections}
        />
      </div>
    </div>
  );
}

export default AdminMessMetrics;
