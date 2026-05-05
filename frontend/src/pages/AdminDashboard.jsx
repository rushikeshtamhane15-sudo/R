import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Users, Calendar, IndianRupee, Check } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [attendance, setAttendance] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [s, a] = await Promise.all([api.get("/admin/stats"), api.get("/admin/attendance/today")]);
        setStats(s.data);
        setAttendance(a.data.attendance || []);
      } catch {}
    })();
  }, []);

  if (!stats) return <div className="text-muted-foreground">Loading…</div>;

  const cards = [
    { label: "Total users", value: stats.total_users, icon: Users },
    { label: "Active subs", value: stats.active_subscriptions, icon: Check },
    { label: "Today's check-ins", value: stats.today_attendance, icon: Calendar },
    { label: "Revenue", value: `₹${Math.round(stats.revenue).toLocaleString("en-IN")}`, icon: IndianRupee },
  ];

  return (
    <div data-testid="admin-dashboard">
      <div>
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Control room</p>
        <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Overview</h1>
      </div>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="stat-cards">
        {cards.map((c, idx) => (
          <div key={c.label} className="bg-card rounded-2xl border border-border p-6" data-testid={`stat-card-${idx}`}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{c.label}</p>
              <c.icon className="h-4 w-4 text-primary" strokeWidth={1.75} />
            </div>
            <p className="font-display font-extrabold text-3xl md:text-4xl mt-3">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-card rounded-2xl border border-border p-6" data-testid="attendance-trend">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Attendance · last 7 days</p>
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

      <div className="mt-6 bg-card rounded-2xl border border-border p-6" data-testid="today-attendance-list">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today's check-ins</p>
        <div className="mt-4 max-h-80 overflow-auto divide-y divide-border">
          {attendance.length === 0 && <p className="text-sm text-muted-foreground">No check-ins yet.</p>}
          {attendance.map((r) => (
            <div key={r.att_id} className="flex items-center justify-between py-3 text-sm">
              <span className="font-semibold">{r.user_name}</span>
              <span className="text-xs text-muted-foreground capitalize">{r.meal_type} · {r.method}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
