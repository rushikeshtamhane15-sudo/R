/* /staff/dispatch — standalone dispatch console for kitchen staff + admin.
 *
 * Purpose: kitchen tablet lives on this page. Staff flips lunch/dinner tiffins
 * from "planned" → "ready" (one item at a time, or the whole batch at once).
 * As soon as every item in a slot is ready, the delivery-boy's "Start dispatch"
 * button unlocks (green). Also shows a live Leaflet map with the fastest
 * driving route from the kitchen to every stop via OSRM.
 *
 * Access: admin, staff, mess_owner (see App.js RequireAuth).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import DeliveryMap from "../components/DeliveryMap";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import {
  Truck, Sun, Moon, RefreshCw, CheckCircle2, Circle, Loader2, ArrowLeft,
  Package, MapPin, Route as RouteIcon, ChefHat,
} from "lucide-react";
import DeliveryWindowPill from "../components/DeliveryWindowPill";

const POLL_MS = 20000;

export default function StaffDispatch() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [meal, setMeal] = useState("lunch");
  const [flipping, setFlipping] = useState(null);
  const [batching, setBatching] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/staff/dispatch/today");
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load dispatch console");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const items = useMemo(
    () => {
      const filtered = (data?.items || []).filter((i) => i.meal_type === meal);
      // iter-131.16: sort by user's delivery window (earliest first).
      // Items without a preference sink to the bottom, then fall back to name.
      const parse = (s) => {
        if (!s || !/^\d{2}:\d{2}$/.test(s)) return 10 ** 6;
        const [h, m] = s.split(":");
        return parseInt(h, 10) * 60 + parseInt(m, 10);
      };
      return filtered.sort((a, b) => {
        const da = parse(a.pref_start);
        const db = parse(b.pref_start);
        if (da !== db) return da - db;
        return (a.name || "").localeCompare(b.name || "");
      });
    },
    [data, meal],
  );
  const stats = data?.ready_stats?.[meal] || { total: 0, ready: 0, pending: 0 };
  const lateStats = data?.late_stats || {};
  const allReady = stats.total > 0 && stats.pending === 0;

  const flipReady = async (rosterId, wantReady) => {
    setFlipping(rosterId);
    try {
      await api.post(`/staff/dispatch/roster/${rosterId}/ready`, { ready: wantReady });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update tiffin");
    } finally { setFlipping(null); }
  };

  const batchReady = async () => {
    setBatching(true);
    try {
      const r = await api.post("/staff/dispatch/batch-ready", { meal_type: meal });
      toast.success(`Marked ${r.data.marked} ${meal} tiffin${r.data.marked === 1 ? "" : "s"} ready`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to mark batch ready");
    } finally { setBatching(false); }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2" data-testid="staff-dispatch-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading dispatch console…
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 pb-28 md:pb-12 space-y-5" data-testid="staff-dispatch-page">
      <Link to="/admin/deliveries-today" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="dispatch-back">
        <ArrowLeft className="h-4 w-4" /> Back to today&apos;s packing list
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">
            <ChefHat className="h-3.5 w-3.5" /> Kitchen · dispatch console
          </p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-1">
            Dispatch · {new Date((data?.date || "") + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Flip tiffins from &quot;planned&quot; to &quot;ready&quot; as they leave the kitchen. Once every stop is ready, the delivery boy&apos;s dispatch button unlocks — you&apos;ll see the fastest route on the map below.
          </p>
        </div>
        <Button onClick={load} variant="outline" className="rounded-full" data-testid="dispatch-refresh">
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ReadyTile
          meal="lunch"
          stats={data?.ready_stats?.lunch}
          active={meal === "lunch"}
          onClick={() => setMeal("lunch")}
        />
        <ReadyTile
          meal="dinner"
          stats={data?.ready_stats?.dinner}
          active={meal === "dinner"}
          onClick={() => setMeal("dinner")}
        />
      </div>

      <div className="rounded-3xl border border-border bg-card p-4 md:p-5 space-y-4" data-testid="dispatch-actions">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Ready progress</p>
            <p className="font-display font-extrabold text-2xl mt-0.5 tabular-nums">
              {stats.ready}/{stats.total} <span className="text-base font-semibold text-muted-foreground">tiffins ready</span>
            </p>
          </div>
          <Button
            onClick={batchReady}
            disabled={batching || stats.total === 0 || stats.pending === 0}
            className={`rounded-full h-11 px-5 font-bold ${
              stats.total === 0 || stats.pending === 0
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-emerald-700 hover:bg-emerald-800 text-white"
            }`}
            data-testid="mark-all-ready"
          >
            {batching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            {stats.pending === 0 ? "All ready" : `Mark ${stats.pending} remaining ready`}
          </Button>
        </div>
        <div className="h-2 rounded-full bg-black/5 overflow-hidden">
          <div
            className={`h-full transition-all ${allReady ? "bg-emerald-600" : stats.ready > 0 ? "bg-amber-500" : "bg-destructive"}`}
            style={{ width: `${stats.total ? Math.round((stats.ready * 100) / stats.total) : 0}%` }}
            data-testid="ready-progress-bar"
          />
        </div>
        {allReady && (
          <p className="text-sm text-emerald-700 font-semibold flex items-center gap-1.5" data-testid="dispatch-unlocked">
            <Truck className="h-4 w-4" /> Dispatch unlocked · the delivery boy can now start the {meal} run.
          </p>
        )}
      </div>

      {(lateStats[`delivered_late_${meal}`] > 0 || lateStats[`no_pref_${meal}`] > 0) && (
        <div
          className="rounded-2xl border border-amber-300 bg-amber-50 p-3 flex flex-wrap items-center gap-2 text-xs text-amber-900"
          data-testid="dispatch-late-strip"
        >
          {lateStats[`delivered_late_${meal}`] > 0 && (
            <span className="inline-flex items-center gap-1 font-bold" data-testid="stat-late-count">
              ⏰ {lateStats[`delivered_late_${meal}`]} delivered late today
            </span>
          )}
          {lateStats[`no_pref_${meal}`] > 0 && (
            <span className="inline-flex items-center gap-1" data-testid="stat-no-pref-count">
              · {lateStats[`no_pref_${meal}`]} customer{lateStats[`no_pref_${meal}`] === 1 ? "" : "s"} haven&apos;t set a window
            </span>
          )}
        </div>
      )}

      {(!data?.dispatch?.lat || !data?.dispatch?.lng) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-900" data-testid="dispatch-no-coords">
          <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Kitchen location not set</p>
            <p className="text-xs mt-0.5">Ask the admin to pin the kitchen on <Link to="/admin/kitchen-radius" className="underline">Kitchen & radius</Link> — the fastest-route map needs it to compute driving directions.</p>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-border overflow-hidden" data-testid="dispatch-map-wrapper">
        <div className="px-4 md:px-5 py-3 bg-muted/40 flex items-center gap-2 text-xs tracking-overline uppercase font-bold text-muted-foreground">
          <RouteIcon className="h-3.5 w-3.5" /> Fastest driving route · kitchen → {items.length} stop{items.length === 1 ? "" : "s"}
        </div>
        <DeliveryMap
          items={items.map((i) => ({
            ...i,
            roster_id: i.roster_id,
            customer_lat: i.customer_lat,
            customer_lng: i.customer_lng,
            name: i.name,
            address: i.address,
            tiffin_size: i.tiffin_size,
            meal_type: i.meal_type,
            status: i.status,
            tiffin_balance: i.tiffin_balance,
          }))}
          dispatch={data?.dispatch}
          drivingRoute
          height={420}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5" /> {meal} stops · tap to flip ready
        </p>
        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-8 text-center text-sm text-muted-foreground" data-testid="dispatch-empty">
            No {meal} tiffins scheduled today.
          </div>
        )}
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="dispatch-item-list">
          {items.map((it) => (
            <TiffinRow
              key={it.roster_id}
              item={it}
              flipping={flipping === it.roster_id}
              onFlip={(want) => flipReady(it.roster_id, want)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ReadyTile({ meal, stats, active, onClick }) {
  const s = stats || { total: 0, ready: 0, pending: 0 };
  const pct = s.total ? Math.round((s.ready * 100) / s.total) : 0;
  const status = s.total === 0 ? "empty" : s.pending === 0 ? "green" : s.ready > 0 ? "amber" : "red";
  const palette = {
    empty: "bg-muted text-muted-foreground ring-border",
    red: "bg-destructive/10 text-destructive ring-destructive/40",
    amber: "bg-amber-50 text-amber-900 ring-amber-300",
    green: "bg-emerald-50 text-emerald-900 ring-emerald-300",
  }[status];
  const Icon = meal === "lunch" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-2xl p-4 ring-1 transition-all ${palette} ${active ? "ring-2 shadow-md" : "ring-1"}`}
      data-testid={`dispatch-tile-${meal}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <p className="text-[10px] tracking-overline uppercase font-bold">{meal}</p>
      </div>
      <p className="font-display font-extrabold text-3xl mt-1 tabular-nums" data-testid={`dispatch-tile-${meal}-count`}>{s.ready}<span className="text-lg opacity-70">/{s.total}</span></p>
      <div className="mt-2 h-1.5 rounded-full bg-black/10 overflow-hidden">
        <div
          className={`h-full transition-all ${status === "green" ? "bg-emerald-600" : status === "amber" ? "bg-amber-500" : status === "red" ? "bg-destructive" : "bg-muted-foreground"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs mt-1.5 font-semibold">
        {status === "empty" && "No tiffins"}
        {status === "red"   && `${s.pending} pending — kitchen not started`}
        {status === "amber" && `${s.ready}/${s.total} ready · ${s.pending} to go`}
        {status === "green" && `All ${s.total} ready — dispatch unlocked`}
      </p>
    </button>
  );
}

function TiffinRow({ item, flipping, onFlip }) {
  const isReady = item.status !== "planned";
  const isDone = item.status === "delivered";
  const disabled = flipping || item.status === "out" || item.status === "delivered";
  return (
    <li
      className={`rounded-2xl border p-3 flex items-start gap-3 ${
        isDone ? "border-emerald-200 bg-emerald-50/50"
        : isReady ? "border-emerald-200 bg-emerald-50/30"
        : "border-border bg-card"
      }`}
      data-testid={`dispatch-item-${item.roster_id}`}
    >
      <button
        type="button"
        onClick={() => onFlip(!isReady)}
        disabled={disabled}
        className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
          isReady
            ? "bg-emerald-600 text-white"
            : "bg-muted text-muted-foreground hover:bg-muted/70"
        } ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
        aria-label={isReady ? "Mark not ready" : "Mark ready"}
        data-testid={`toggle-ready-${item.roster_id}`}
      >
        {flipping ? <Loader2 className="h-4 w-4 animate-spin" /> : isReady ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold truncate">{item.name || "—"}</p>
          <span className={`text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full ${item.tiffin_size === "full" ? "bg-primary/10 text-primary" : "bg-secondary/15 text-secondary"}`}>
            {item.tiffin_size}
          </span>
          <DeliveryWindowPill
            start={item.pref_start}
            end={item.pref_end}
            status={item.status}
            deliveredLate={item.delivered_late}
            deliveredLateBy={item.delivered_late_by}
          />
          <span className={`text-[10px] tracking-overline uppercase font-bold ${
            item.status === "delivered" ? "text-emerald-700"
            : item.status === "out" ? "text-secondary"
            : item.status === "ready" ? "text-emerald-700"
            : "text-muted-foreground"
          }`}>
            {item.status}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.address || "No address"}</p>
        {item.tiffin_preferences && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {["rice", "dal", "chapati", "sabji"].map((k) => {
              const on = item.tiffin_preferences[k] !== false;
              return (
                <span
                  key={k}
                  className={`text-[9px] tracking-wide font-bold px-1.5 py-0.5 rounded ${on ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700 line-through"}`}
                >
                  {on ? "✓" : "✗"} {k}
                </span>
              );
            })}
            {item.tiffin_preferences.chapati_count != null && item.tiffin_preferences.chapati !== false && (
              <span className="text-[9px] tracking-wide font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                {item.tiffin_preferences.chapati_count}× chapati
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
