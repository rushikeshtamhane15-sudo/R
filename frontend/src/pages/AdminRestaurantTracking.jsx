import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { CheckCircle2, XCircle, Truck, Clock, RefreshCw, ChefHat, Package, Bike } from "lucide-react";
import { Link } from "react-router-dom";

const startOfDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export default function AdminRestaurantTracking() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/restaurant/orders?limit=500");
      setOrders(r.data?.orders || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // Today's slice
  const today = startOfDay();
  const todays = orders.filter((o) => (o.created_at || "") >= today);

  const groups = {
    delivered: todays.filter((o) => o.status === "delivered"),
    cancelled: todays.filter((o) => o.status === "cancelled"),
    rejected:  todays.filter((o) => o.status === "rejected"),
    out_for_delivery: todays.filter((o) => o.status === "out_for_delivery"),
    preparing: todays.filter((o) => ["paid", "preparing", "ready_for_pickup"].includes(o.status)),
  };

  const revenue = groups.delivered.reduce((s, o) => s + (o.total || 0), 0);
  const lostRevenue = [...groups.cancelled, ...groups.rejected].reduce((s, o) => s + (o.total || 0), 0);

  return (
    <div className="space-y-6" data-testid="admin-restaurant-tracking">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight flex items-center gap-2">
            <ChefHat className="h-6 w-6 text-primary" /> Restaurant delivery tracking
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Today's orders at a glance. Auto-refresh every 30s.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="rounded-full" data-testid="tracking-refresh">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat color="emerald" icon={CheckCircle2} label="Delivered today" value={groups.delivered.length} sub={`₹${revenue.toFixed(0)} revenue`} testid="stat-delivered" />
        <Stat color="rose" icon={XCircle} label="Rejected by rider" value={groups.rejected.length} sub={`₹${groups.rejected.reduce((s,o) => s+(o.total||0), 0).toFixed(0)} lost`} testid="stat-rejected" />
        <Stat color="amber" icon={XCircle} label="Cancelled" value={groups.cancelled.length} sub="customer + admin" testid="stat-cancelled" />
        <Stat color="blue" icon={Truck} label="Out for delivery" value={groups.out_for_delivery.length} sub="in flight now" testid="stat-out" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Stat color="indigo" icon={Clock} label="In kitchen" value={groups.preparing.length} sub="paid / preparing / ready" testid="stat-preparing" />
        <Stat color="rose" icon={Package} label="Lost revenue today" value={`₹${lostRevenue.toFixed(0)}`} sub={`${groups.cancelled.length + groups.rejected.length} order(s)`} testid="stat-lost" />
      </div>

      {/* Per-rider summary */}
      <RiderSummary orders={todays} />

      {/* Order tables — collapsed, showing top 10 per group */}
      <Group title="Rejected by rider" icon={XCircle} rows={groups.rejected} kind="rejected" />
      <Group title="Cancelled" icon={XCircle} rows={groups.cancelled} kind="cancelled" />
      <Group title="Delivered" icon={CheckCircle2} rows={groups.delivered.slice(0, 20)} kind="delivered" />
    </div>
  );
}

function Stat({ color, icon: Icon, label, value, sub, testid }) {
  const colorMap = {
    emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
    rose:    "bg-rose-100 text-rose-800 border-rose-200",
    amber:   "bg-amber-100 text-amber-800 border-amber-200",
    blue:    "bg-blue-100 text-blue-800 border-blue-200",
    indigo:  "bg-indigo-100 text-indigo-800 border-indigo-200",
  };
  return (
    <div className={`rounded-2xl border ${colorMap[color]} p-4`} data-testid={testid}>
      <div className="flex items-center gap-1.5 text-[10px] tracking-overline uppercase font-bold opacity-90"><Icon className="h-3 w-3" /> {label}</div>
      <p className="font-display font-extrabold text-2xl mt-1 tabular-nums">{value}</p>
      <p className="text-[11px] mt-0.5 opacity-90">{sub}</p>
    </div>
  );
}

function RiderSummary({ orders }) {
  const byRider = {};
  for (const o of orders) {
    if (!o.rider_id) continue;
    if (!byRider[o.rider_id]) byRider[o.rider_id] = { delivered: 0, rejected: 0, total: 0 };
    if (o.status === "delivered") { byRider[o.rider_id].delivered += 1; byRider[o.rider_id].total += o.total || 0; }
    if (o.status === "rejected")  { byRider[o.rider_id].rejected += 1; }
  }
  const rows = Object.entries(byRider);
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No rider activity yet today.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden" data-testid="rider-summary">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-display font-extrabold">
        <Bike className="h-4 w-4 text-primary" /> Rider activity (today)
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted text-[10px] uppercase tracking-overline">
          <tr><th className="text-left px-4 py-2">Rider</th><th className="text-right px-4 py-2">Delivered</th><th className="text-right px-4 py-2">Rejected</th><th className="text-right px-4 py-2">Earnings (₹50/order)</th></tr>
        </thead>
        <tbody>
          {rows.map(([rid, s]) => (
            <tr key={rid} className="border-t border-border" data-testid={`rider-row-${rid}`}>
              <td className="px-4 py-2 font-mono text-xs">{rid}</td>
              <td className="px-4 py-2 text-right tabular-nums text-emerald-700 font-bold">{s.delivered}</td>
              <td className="px-4 py-2 text-right tabular-nums text-rose-700 font-bold">{s.rejected}</td>
              <td className="px-4 py-2 text-right tabular-nums">₹{(s.delivered * 50).toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Group({ title, icon: Icon, rows, kind }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden" data-testid={`group-${kind}`}>
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-display font-extrabold">
        <Icon className="h-4 w-4" /> {title} <span className="text-xs text-muted-foreground font-normal">({rows.length})</span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted text-[10px] uppercase tracking-overline">
          <tr><th className="text-left px-4 py-2">Order</th><th className="text-left px-4 py-2">Customer</th><th className="text-right px-4 py-2">Total</th><th className="text-right px-4 py-2">Time</th></tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.order_id} className="border-t border-border" data-testid={`row-${o.order_id}`}>
              <td className="px-4 py-2 font-mono text-[11px]"><Link to={`/restaurant/track/${o.order_id}`} className="text-primary hover:underline">{o.order_id}</Link></td>
              <td className="px-4 py-2">{o.name || "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums">₹{Number(o.total||0).toFixed(0)}</td>
              <td className="px-4 py-2 text-right text-xs text-muted-foreground tabular-nums">{new Date(o.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
