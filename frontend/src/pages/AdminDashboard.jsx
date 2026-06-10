import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Users, Calendar, IndianRupee, Check, RefreshCw } from "lucide-react";
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
  const [period, setPeriod] = useState("cycle");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const refresh = async (p = period, d = date) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period: p });
      if (d) params.set("date", d);
      const [s, a] = await Promise.allSettled([
        api.get(`/admin/stats?${params.toString()}`),
        api.get("/admin/attendance/today"),
      ]);
      // iter-93: don't blow up the page when one of the two calls fails.
      // We surface the error inline (see "could not load" branch below).
      if (s.status === "fulfilled") setStats(s.value.data);
      else { setStats(null); setLoadError(s.reason?.response?.data?.detail || s.reason?.message || "Failed to load stats"); }
      if (a.status === "fulfilled") setAttendance(a.value.data.attendance || []);
      else setAttendance([]);
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
