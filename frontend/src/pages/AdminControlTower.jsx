import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import {
  Activity, Bike, Truck, Users, Package, AlertTriangle, ChefHat,
  Wallet, ScanLine, RefreshCw, ExternalLink, Building2, Banknote,
} from "lucide-react";
import { Button } from "../components/ui/button";
import KitchenCloseOutCard from "../components/KitchenCloseOutCard";
import BranchPnlCard from "../components/BranchPnlCard";

/**
 * AdminControlTower — iter-59 #8
 *
 * Single window that surfaces every live tracking signal in the system:
 *   • Today: orders shipped, scans, cash collected, online collected
 *   • Active staff: counter + kitchen + admins online (last_seen ≤ 5 min)
 *   • Active tiffin deliveries (status ∈ {out_for_delivery, dispatched})
 *   • Active restaurant orders (status ∈ {preparing, out_for_delivery, ready})
 *   • Online riders (delivery_boys + restaurant riders with location_ts ≤ 3 min)
 *   • Pending bank deposits (mirrors the existing iter-56 banner check)
 *   • Open admin notifications (unread)
 *   • Today's kitchen close-out + reconciliation gap (#9)
 *
 * Designed to refresh every 60 s. Drills-down to the existing detail pages
 * via "Open" buttons so existing surfaces are reused, not duplicated.
 */
export default function AdminControlTower() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/control-tower");
      setData(r.data || {});
      setRefreshedAt(new Date());
    } catch (e) { console.warn("[control-tower] load failed", e); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const today = data?.today || {};
  const live = data?.live || {};
  const notifications = data?.notifications || {};

  return (
    <div data-testid="admin-control-tower">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] sm:text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Control Tower · single window
          </p>
          <h1 className="font-display font-extrabold text-xl sm:text-2xl md:text-3xl tracking-tight mt-1 leading-tight">Everything live in one place</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Auto-refreshing every 60 s.
            {refreshedAt && <span className="ml-1">Last update {refreshedAt.toLocaleTimeString()}</span>}
          </p>
        </div>
        <Button variant="outline" onClick={load} className="rounded-full" disabled={loading} data-testid="ct-refresh">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* iter-86 #5: Branch P&L scoreboard — surfaces revenue / cost /
          margin / target hit % per branch. */}
      <div className="mt-5">
        <BranchPnlCard days={30} />
      </div>

      {/* TODAY KPIs */}
      <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
        <Tile icon={Package} label="Tiffins shipped" value={today.tiffins_shipped} testid="ct-today-tiffins" />
        <Tile icon={ScanLine} label="Scans recorded" value={today.scans} testid="ct-today-scans" />
        <Tile icon={Banknote} label="Cash collected" value={`₹${Math.round(today.cash || 0).toLocaleString("en-IN")}`} testid="ct-today-cash" />
        <Tile icon={Wallet} label="Online collected" value={`₹${Math.round(today.online || 0).toLocaleString("en-IN")}`} testid="ct-today-online" />
      </div>

      {/* LIVE OPS */}
      <div className="mt-5 grid lg:grid-cols-3 gap-3 sm:gap-4">
        <LiveCard
          icon={Truck} title="Active tiffin deliveries"
          count={live.tiffin_deliveries_active || 0}
          subtitle={`${live.tiffin_riders_online || 0} riders online`}
          openTo="/admin/live"
          testid="ct-tiffin-live"
        />
        <LiveCard
          icon={ChefHat} title="Restaurant orders in-flight"
          count={live.restaurant_orders_active || 0}
          subtitle={`${live.restaurant_riders_online || 0} restaurant riders online`}
          openTo="/admin/restaurant-tracking"
          testid="ct-restaurant-live"
        />
        <LiveCard
          icon={Users} title="Active staff (last 5 min)"
          count={live.staff_online || 0}
          subtitle={`${live.admins_online || 0} admin · ${live.counter_staff_online || 0} counter`}
          openTo="/admin/users"
          testid="ct-staff-live"
        />
      </div>

      {/* ALERTS */}
      <div className="mt-5 grid md:grid-cols-2 gap-3 sm:gap-4">
        <AlertCard
          icon={Building2} tone={notifications.pending_bank_amt > 10000 ? "warn" : "ok"}
          title="Pending bank deposit"
          value={`₹${Math.round(notifications.pending_bank_amt || 0).toLocaleString("en-IN")}`}
          subtitle={`${notifications.pending_bank_count || 0} cash orders awaiting deposit`}
          openTo="/admin/cash-analytics"
          testid="ct-pending-bank"
        />
        <AlertCard
          icon={AlertTriangle}
          tone={(notifications.kitchen_alerts || 0) > 0 ? "warn" : "ok"}
          title="Kitchen fraud alerts (unread)"
          value={`${notifications.kitchen_alerts || 0}`}
          subtitle={(notifications.kitchen_alerts || 0) > 0 ? "Dispatch-vs-scan gap exceeded threshold" : "All days reconciled"}
          openTo="/admin/control-tower"
          testid="ct-kitchen-alerts"
        />
      </div>

      {/* KITCHEN CLOSE-OUT (#9) */}
      <div className="mt-6">
        <KitchenCloseOutCard onSubmitted={load} />
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, testid }) {
  return (
    <div className="card-3d p-3 sm:p-4" data-testid={testid}>
      <div className="flex items-center justify-between gap-1">
        <p className="text-[9px] sm:text-[10px] tracking-overline uppercase font-bold text-muted-foreground truncate">{label}</p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </div>
      <p className="font-display font-extrabold text-lg sm:text-2xl tabular-nums mt-1 leading-tight">
        {value != null ? value : "—"}
      </p>
    </div>
  );
}

function LiveCard({ icon: Icon, title, count, subtitle, openTo, testid }) {
  return (
    <Link
      to={openTo}
      className="card-3d p-4 sm:p-5 hover:shadow-[0_12px_24px_-12px_rgba(0,0,0,0.18)] transition-shadow group"
      data-testid={testid}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <p className="text-[10px] sm:text-[11px] tracking-overline uppercase font-bold text-muted-foreground mt-3">{title}</p>
      <p className="font-display font-extrabold text-2xl sm:text-3xl tabular-nums leading-tight mt-1">{count}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{subtitle}</p>
    </Link>
  );
}

function AlertCard({ icon: Icon, tone, title, value, subtitle, openTo, testid }) {
  const isWarn = tone === "warn";
  return (
    <Link
      to={openTo}
      className={`p-4 sm:p-5 rounded-2xl border ${isWarn ? "border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50" : "border-emerald-200 bg-emerald-50/60"} hover:shadow-[0_12px_24px_-12px_rgba(0,0,0,0.18)] transition-shadow block`}
      data-testid={testid}
    >
      <div className="flex items-center gap-3">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl shrink-0 ${isWarn ? "bg-amber-500 text-white" : "bg-emerald-600 text-white"}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] sm:text-[11px] tracking-overline uppercase font-bold ${isWarn ? "text-amber-800" : "text-emerald-800"}`}>{title}</p>
          <p className="font-display font-extrabold text-xl sm:text-2xl tabular-nums leading-tight mt-0.5">{value}</p>
          <p className={`text-[11px] mt-0.5 ${isWarn ? "text-amber-700" : "text-emerald-700"}`}>{subtitle}</p>
        </div>
      </div>
    </Link>
  );
}
