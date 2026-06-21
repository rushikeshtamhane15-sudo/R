import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Users, Calendar, IndianRupee, Check, RefreshCw, AlertTriangle, Phone, MessageCircle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

const PERIODS = [
  { id: "cycle", label: "Billing cycle" },
  { id: "day", label: "Day" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [period, setPeriod] = useState("cycle");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const refresh = async (p = period, d = date) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period: p });
      if (d) params.set("date", d);
      const [s, a, e] = await Promise.allSettled([
        api.get(`/admin/stats?${params.toString()}`),
        api.get("/admin/attendance/today"),
        api.get("/admin/expiring-subscriptions?within_days=7"),
      ]);
      // iter-93: don't blow up the page when one of the two calls fails.
      // We surface the error inline (see "could not load" branch below).
      if (s.status === "fulfilled") setStats(s.value.data);
      else { setStats(null); setLoadError(s.reason?.response?.data?.detail || s.reason?.message || "Failed to load stats"); }
      if (a.status === "fulfilled") setAttendance(a.value.data.attendance || []);
      else setAttendance([]);
      if (e.status === "fulfilled") setExpiring(e.value.data.subscriptions || []);
      else setExpiring([]);
      if (s.status === "fulfilled") setLoadError(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(period, date); /* eslint-disable-next-line */ }, [period, date]);

  const cards = useMemo(() => {
    if (!stats) return [];
    return [
      { label: "Total users", value: stats.total_users, icon: Users },
      { label: "Active subs", value: stats.active_subscriptions, icon: Check },
      { label: "Today's check-ins", value: stats.today_attendance, icon: Calendar },
      { label: `Revenue · ${stats.period_label || ""}`, value: `₹${Math.round(stats.revenue || 0).toLocaleString("en-IN")}`, icon: IndianRupee },
    ];
  }, [stats]);

  if (!stats && loading) return <div className="text-muted-foreground" data-testid="overview-loading">Loading…</div>;

  // iter-93: when /admin/stats fails (or returns null), render a graceful
  // error state instead of crashing on stats.period_label below.
  if (!stats) {
    return (
      <div data-testid="admin-dashboard-error" className="max-w-2xl">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Control room</p>
        <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Overview</h1>
        <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/5 p-5 text-sm">
          <p className="font-bold text-red-700 dark:text-red-300">Could not load dashboard.</p>
          <p className="text-red-700/80 dark:text-red-300/80 mt-1">{loadError || "Please refresh in a moment."}</p>
          <button onClick={() => refresh()} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-600 text-white px-4 h-9 text-xs font-bold" data-testid="overview-retry">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="admin-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Control room</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Overview</h1>
          {stats?.scope === "branch" && (
            <p className="text-[11px] mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 px-2.5 h-6 font-bold" data-testid="overview-branch-scope">
              · Branch view · your mess only
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 h-9 text-xs font-semibold hover:bg-muted/40"
          data-testid="overview-refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* iter-65 #10: period + date picker */}
      <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="period-controls">
        <div className="inline-flex rounded-full bg-muted/60 p-1 gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              data-testid={`period-${p.id}`}
              className={`px-3 h-8 rounded-full text-xs font-semibold ${period === p.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            >{p.label}</button>
          ))}
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-full border border-border bg-card px-3 h-8 text-xs"
          data-testid="period-date"
        />
        {stats?.period_label && (
          <span className="text-xs text-muted-foreground" data-testid="period-window-label">{stats.period_label}</span>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="stat-cards">
        {cards.map((c, idx) => (
          <div key={c.label} className="bg-card rounded-2xl border border-border p-6" data-testid={`stat-card-${idx}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground line-clamp-2">{c.label}</p>
              <c.icon className="h-4 w-4 text-primary flex-shrink-0" strokeWidth={1.75} />
            </div>
            <p className="font-display font-extrabold text-3xl md:text-4xl mt-3 tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-card rounded-2xl border border-border p-6" data-testid="attendance-trend">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Attendance · {stats.period_label}</p>
        <div className="h-64 mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stats.attendance_trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
              <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* iter-107 #2 / iter-108: Expiring subscriptions — call-to-action for renewals.
          iter-109: always visible with an empty state so admin knows the feature exists. */}
      <div
        className={`mt-6 surface-3d rounded-2xl border-2 p-6 ${expiring.length > 0 ? "bg-amber-50 dark:bg-amber-500/10 border-amber-500/40" : "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500/30"}`}
        data-testid="expiring-subs-card"
      >
        <div className="flex items-start gap-3">
          <span className={`inline-flex h-10 w-10 rounded-xl items-center justify-center shrink-0 ${expiring.length > 0 ? "bg-amber-500/20 text-amber-700" : "bg-emerald-500/20 text-emerald-700"}`}>
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] tracking-overline uppercase font-bold ${expiring.length > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
              Renewal alert · next 7 days
            </p>
            <h2 className="font-display font-extrabold text-lg mt-0.5">
              {expiring.length > 0
                ? `${expiring.length} subscription${expiring.length === 1 ? "" : "s"} expiring soon`
                : "All clear — nobody is expiring in the next 7 days"}
            </h2>
            <p className={`text-xs mt-1 ${expiring.length > 0 ? "text-amber-800/90 dark:text-amber-200/90" : "text-emerald-800/90 dark:text-emerald-200/90"}`}>
              {expiring.length > 0
                ? "Tap Call to dial them, or WhatsApp to send a templated nudge with a 1-click renew link."
                : "The moment any active subscription crosses the 7-day window, it'll show up here with Call + WhatsApp + 1-click renew."}
            </p>
          </div>
        </div>

        {expiring.length > 0 && (
        <div className="mt-4 divide-y divide-amber-500/20" data-testid="expiring-subs-list">
            {expiring.map((s) => {
              // iter-108: build a one-click renewal link and a templated
              // WhatsApp nudge. Manual / admin-assigned plans (plan_id
              // starts with "manual_") fall back to /plans because there's
              // no template to repurchase against.
              const origin = typeof window !== "undefined" ? window.location.origin : "";
              const renewPath = s.plan_id && !s.plan_id.startsWith("manual_")
                ? `/checkout/${s.plan_id}`
                : "/plans";
              const renewUrl = `${origin}${renewPath}`;
              const daysLabel = s.days_left === 0
                ? "today"
                : s.days_left === 1 ? "in 1 day" : `in ${s.days_left} days`;
              const waText = encodeURIComponent(
                `Hi ${s.name || "there"}, your efoodcare plan (${s.plan_name}) expires ${daysLabel}. ` +
                `Tap to renew in 1 click: ${renewUrl}`,
              );
              const waHref = s.phone ? `https://wa.me/91${s.phone}?text=${waText}` : null;
              return (
                <div
                  key={s.sub_id}
                  className="flex items-center gap-3 py-3"
                  data-testid={`expiring-sub-${s.sub_id}`}
                >
                  <span className="h-9 w-9 rounded-full bg-amber-500/15 text-amber-700 flex items-center justify-center font-extrabold text-xs shrink-0">
                    {(s.name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" data-testid={`expiring-name-${s.sub_id}`}>{s.name}</p>
                    <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80 truncate">
                      {s.plan_name} · {s.meals_left} meals · ₹{Math.round(s.wallet_balance)} wallet
                    </p>
                    <p className="text-[10px] text-amber-700/70 dark:text-amber-300/70 mt-0.5 truncate font-mono">
                      Renew → {renewPath}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] tracking-overline uppercase font-bold text-amber-700">
                      {s.days_left === 0 ? "Expires today" : s.days_left === 1 ? "1 day left" : `${s.days_left} days left`}
                    </p>
                    <div className="mt-1 flex gap-1.5 justify-end">
                      {s.phone && (
                        <a
                          href={`tel:+91${s.phone}`}
                          className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold px-2.5 py-1"
                          data-testid={`expiring-call-${s.sub_id}`}
                        >
                          <Phone className="h-3 w-3" /> Call
                        </a>
                      )}
                      {waHref && (
                        <a
                          href={waHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2.5 py-1"
                          data-testid={`expiring-whatsapp-${s.sub_id}`}
                          title={`WhatsApp ${s.name} with the 1-click renew link`}
                        >
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6 surface-3d bg-card rounded-2xl border border-border p-6" data-testid="today-attendance-list">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today's check-ins</p>
        <div className="mt-4 max-h-80 overflow-auto divide-y divide-border">
          {attendance.length === 0 && <p className="text-sm text-muted-foreground">No check-ins yet.</p>}
          {attendance.map((r) => {
            const displayName = r.subscriber_name || r.user_name || "—";
            const phone = r.subscriber_phone;
            return (
              <div key={r.att_id} className="flex items-center gap-3 py-3 text-sm" data-testid={`attendance-row-${r.att_id}`}>
                {r.profile_photo_url ? (
                  <img src={r.profile_photo_url} alt="" className="h-8 w-8 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <span className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center font-extrabold text-xs flex-shrink-0">
                    {(displayName || "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate" data-testid={`attendance-name-${r.att_id}`}>{displayName}</p>
                  {phone && <p className="text-[11px] text-muted-foreground" data-testid={`attendance-phone-${r.att_id}`}>{phone}</p>}
                </div>
                <span className="text-xs text-muted-foreground capitalize flex-shrink-0">{r.meal_type} · {r.method}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
