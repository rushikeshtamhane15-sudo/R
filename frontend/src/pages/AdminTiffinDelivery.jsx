import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import {
  Truck, RefreshCw, Plus, X, User as UserIcon, Phone, MapPin,
  CheckCircle2, Circle, Loader2, Trash2, ChevronUp, ChevronDown, AlertTriangle, Radio,
} from "lucide-react";

const POLL_MS = 30000;

const STATUS_COLORS = {
  pending: "bg-slate-100 text-slate-600 border-slate-200",
  dispatched: "bg-red-100 text-red-700 border-red-200",
  delivered: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const STATUS_ICON = {
  pending: Circle,
  dispatched: Radio,
  delivered: CheckCircle2,
};

export default function AdminTiffinDelivery() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addBoyOpen, setAddBoyOpen] = useState(false);
  const [pickBoyId, setPickBoyId] = useState("");
  const [addForRoute, setAddForRoute] = useState(null); // route obj if in "add stop" mode
  const today = new Date().toISOString().slice(0, 10);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get(`/admin/delivery-routes?date=${today}`);
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load routes");
    } finally { setLoading(false); }
  }, [today]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const routes = data?.routes || [];
  const unassigned = data?.unassigned || [];
  const boys = data?.boys || [];
  const boysById = useMemo(() => Object.fromEntries(boys.map((b) => [b.boy_id, b])), [boys]);
  const availableBoys = boys.filter((b) => !routes.some((r) => r.delivery_boy_id === b.boy_id));

  const upsertRoute = async (delivery_boy_id, checkpoints) => {
    setSaving(true);
    try {
      await api.post(`/admin/delivery-routes`, {
        date: today,
        delivery_boy_id,
        checkpoints,
      });
      toast.success("Route saved");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save route");
    } finally { setSaving(false); }
  };

  const addBoyToRoster = async () => {
    if (!pickBoyId) { toast.error("Pick a delivery boy first"); return; }
    await upsertRoute(pickBoyId, []);
    setAddBoyOpen(false); setPickBoyId("");
  };

  const removeStop = async (route, userId) => {
    const nextCps = (route.checkpoints || [])
      .filter((c) => c.user_id !== userId)
      .map((c, idx) => ({ user_id: c.user_id, priority: idx + 1 }));
    await upsertRoute(route.delivery_boy_id, nextCps);
  };

  const moveStop = async (route, userId, dir) => {
    const cps = [...(route.checkpoints || [])];
    const idx = cps.findIndex((c) => c.user_id === userId);
    if (idx < 0) return;
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= cps.length) return;
    [cps[idx], cps[swapIdx]] = [cps[swapIdx], cps[idx]];
    const payload = cps.map((c, i) => ({ user_id: c.user_id, priority: i + 1 }));
    await upsertRoute(route.delivery_boy_id, payload);
  };

  const addStop = async (route, userId) => {
    const cps = (route.checkpoints || []).map((c) => ({ user_id: c.user_id, priority: c.priority }));
    cps.push({ user_id: userId, priority: cps.length + 1 });
    await upsertRoute(route.delivery_boy_id, cps.map((c, i) => ({ user_id: c.user_id, priority: i + 1 })));
  };

  const deleteRoute = async (route) => {
    if (!window.confirm(`Clear ${route.boy_name}'s entire route for today?`)) return;
    setSaving(true);
    try {
      await api.delete(`/admin/delivery-routes/${route.route_id}`);
      toast.success("Route cleared");
      await refresh();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not delete route"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading routes…</div>;

  const remaining = data?.remaining_count || 0;
  const total = data?.total_count || 0;

  return (
    <div data-testid="admin-tiffin-delivery-page" className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 rounded-xl bg-primary/10 text-primary items-center justify-center">
          <Truck className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Operations · Manual routing</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight leading-tight">Tiffin delivery routes</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Assign each active tiffin subscriber to a delivery boy with a priority number.
            Blank → red (out for delivery) → green (delivered). Delivery boys see this pre-loaded
            route and tap Dispatch → all checkpoints turn red; tap each stop → it turns green.
          </p>
        </div>
        <Button onClick={refresh} variant="outline" size="sm" className="rounded-full" data-testid="routes-refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Remaining tile */}
      <div
        className={`rounded-3xl border-2 p-5 flex items-center gap-4 transition-colors ${remaining > 0 ? "bg-red-50 border-red-300" : "bg-emerald-50 border-emerald-300"}`}
        data-testid="routes-remaining-tile"
      >
        <span className={`inline-flex h-12 w-12 rounded-xl items-center justify-center ${remaining > 0 ? "bg-red-500 text-white" : "bg-emerald-500 text-white"}`}>
          {remaining > 0 ? <AlertTriangle className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
        </span>
        <div className="flex-1">
          <p className={`text-[10px] tracking-overline uppercase font-bold ${remaining > 0 ? "text-red-700" : "text-emerald-700"}`}>
            {remaining > 0 ? "Out for delivery" : "All delivered"}
          </p>
          <h2 className="font-display font-extrabold text-2xl mt-0.5" data-testid="remaining-count-value">
            {remaining} <span className="text-base font-semibold text-muted-foreground">/ {total} tiffins remaining</span>
          </h2>
        </div>
      </div>

      {/* Routes list */}
      <div className="space-y-4" data-testid="routes-list">
        {routes.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="routes-empty">
            No routes for today yet. Add a delivery boy below to start assigning stops.
          </div>
        )}
        {routes.map((route) => (
          <RouteCard
            key={route.route_id}
            route={route}
            saving={saving}
            unassigned={unassigned}
            addingFor={addForRoute === route.route_id}
            setAddingFor={(v) => setAddForRoute(v ? route.route_id : null)}
            onRemoveStop={(uid) => removeStop(route, uid)}
            onMove={(uid, dir) => moveStop(route, uid, dir)}
            onAddStop={(uid) => { addStop(route, uid); setAddForRoute(null); }}
            onDeleteRoute={() => deleteRoute(route)}
          />
        ))}
      </div>

      {/* Add delivery boy */}
      {availableBoys.length > 0 && (
        <div className="rounded-2xl border border-border p-5 bg-card" data-testid="add-boy-panel">
          {!addBoyOpen ? (
            <button
              onClick={() => setAddBoyOpen(true)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              data-testid="add-boy-open"
            >
              <Plus className="h-4 w-4" /> Add another delivery boy to today's roster
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={pickBoyId}
                onChange={(e) => setPickBoyId(e.target.value)}
                className="rounded-full border border-border bg-background px-4 h-10 text-sm min-w-[220px]"
                data-testid="add-boy-select"
              >
                <option value="">Pick a delivery boy…</option>
                {availableBoys.map((b) => (
                  <option key={b.boy_id} value={b.boy_id}>{b.name} · {b.phone}</option>
                ))}
              </select>
              <Button size="sm" onClick={addBoyToRoster} disabled={!pickBoyId || saving} data-testid="add-boy-confirm">Add to roster</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAddBoyOpen(false); setPickBoyId(""); }}>Cancel</Button>
            </div>
          )}
        </div>
      )}

      {/* Unassigned pool (shown at the bottom when NOT adding to a specific route) */}
      {!addForRoute && unassigned.length > 0 && (
        <div className="rounded-2xl border border-border p-5" data-testid="unassigned-panel">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs tracking-overline uppercase font-bold text-secondary">Unassigned</p>
              <h3 className="font-display font-bold text-lg mt-0.5">{unassigned.length} active tiffin subscriber{unassigned.length === 1 ? "" : "s"} waiting for a route</h3>
            </div>
          </div>
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="unassigned-list">
            {unassigned.map((u) => (
              <div key={u.user_id} className="rounded-xl bg-muted/40 border border-border p-3 text-xs" data-testid={`unassigned-${u.user_id}`}>
                <p className="font-semibold text-sm truncate">{u.name}</p>
                <p className="text-muted-foreground truncate">{u.phone || "—"}</p>
                <p className="text-muted-foreground truncate">{u.address || "no address"}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">Tip: open a boy's route above and tap "+ Add stop" to assign these customers.</p>
        </div>
      )}
    </div>
  );
}

function RouteCard({ route, saving, unassigned, addingFor, setAddingFor, onRemoveStop, onMove, onAddStop, onDeleteRoute }) {
  const cps = route.checkpoints || [];
  const remaining = cps.filter((c) => c.status !== "delivered").length;
  const status = route.status;
  const statusCopy = {
    draft: { text: "Draft — not dispatched yet", tone: "text-slate-600 bg-slate-100" },
    out_for_delivery: { text: "Out for delivery", tone: "text-red-700 bg-red-100" },
    completed: { text: "All delivered", tone: "text-emerald-700 bg-emerald-100" },
  }[status] || { text: status, tone: "text-slate-600 bg-slate-100" };

  return (
    <div
      className={`rounded-2xl border-2 bg-card p-5 ${status === "out_for_delivery" ? "border-red-300" : status === "completed" ? "border-emerald-300" : "border-border"}`}
      data-testid={`route-card-${route.delivery_boy_id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><Truck className="h-3 w-3" /> Delivery boy</p>
          <h3 className="font-display font-extrabold text-lg mt-0.5">{route.boy_name}</h3>
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> {route.boy_phone || "no phone"}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold rounded-full px-2.5 h-6 inline-flex items-center ${statusCopy.tone}`} data-testid={`route-status-${route.delivery_boy_id}`}>
            {statusCopy.text}
          </span>
          <span className="text-[11px] rounded-full px-2 h-6 inline-flex items-center bg-muted text-muted-foreground font-semibold">
            {remaining}/{cps.length} remaining
          </span>
          <button
            onClick={onDeleteRoute}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-full border border-border h-7 px-2 text-[11px] font-semibold text-red-600 hover:bg-red-50"
            data-testid={`route-delete-${route.delivery_boy_id}`}
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        </div>
      </div>

      {/* Vertical checkpoint list */}
      <div className="mt-4 space-y-2" data-testid={`checkpoints-${route.delivery_boy_id}`}>
        {cps.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No stops yet. Tap "Add stop" below.</p>
        )}
        {cps.map((cp, idx) => {
          const Icon = STATUS_ICON[cp.status] || Circle;
          return (
            <div
              key={cp.user_id}
              className={`flex items-center gap-3 rounded-xl border p-3 ${STATUS_COLORS[cp.status] || STATUS_COLORS.pending}`}
              data-testid={`cp-${route.delivery_boy_id}-${cp.user_id}`}
            >
              <span className="inline-flex h-8 w-8 rounded-full bg-white border-2 border-current items-center justify-center font-extrabold text-sm shrink-0" data-testid={`cp-priority-${cp.user_id}`}>
                {cp.priority}
              </span>
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2.2} />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate flex items-center gap-1"><UserIcon className="h-3 w-3" /> {cp.name}</p>
                <p className="text-[11px] opacity-80 truncate flex items-center gap-1"><Phone className="h-3 w-3" /> {cp.phone || "—"}</p>
                {cp.address && <p className="text-[11px] opacity-80 truncate flex items-center gap-1"><MapPin className="h-3 w-3" /> {cp.address}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onMove(cp.user_id, "up")}
                  disabled={idx === 0 || saving}
                  className="h-7 w-7 rounded-md bg-white border border-current disabled:opacity-30 flex items-center justify-center"
                  title="Move up"
                  data-testid={`cp-up-${cp.user_id}`}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onMove(cp.user_id, "down")}
                  disabled={idx === cps.length - 1 || saving}
                  className="h-7 w-7 rounded-md bg-white border border-current disabled:opacity-30 flex items-center justify-center"
                  title="Move down"
                  data-testid={`cp-down-${cp.user_id}`}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onRemoveStop(cp.user_id)}
                  disabled={saving || cp.status === "delivered"}
                  className="h-7 w-7 rounded-md bg-white border border-current disabled:opacity-30 flex items-center justify-center"
                  title="Remove stop"
                  data-testid={`cp-remove-${cp.user_id}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add stop */}
      <div className="mt-4">
        {!addingFor ? (
          <button
            onClick={() => setAddingFor(true)}
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            data-testid={`add-stop-open-${route.delivery_boy_id}`}
          >
            <Plus className="h-4 w-4" /> Add stop to {route.boy_name}'s route
          </button>
        ) : (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3" data-testid={`add-stop-panel-${route.delivery_boy_id}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-primary">Pick from {unassigned.length} unassigned subscriber{unassigned.length === 1 ? "" : "s"}</p>
              <button onClick={() => setAddingFor(false)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Close</button>
            </div>
            {unassigned.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No unassigned tiffin subscribers.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2 max-h-72 overflow-auto">
                {unassigned.map((u) => (
                  <button
                    key={u.user_id}
                    onClick={() => onAddStop(u.user_id)}
                    disabled={saving}
                    className="rounded-lg bg-card border border-border p-2.5 text-left text-xs hover:border-primary transition disabled:opacity-50"
                    data-testid={`pick-unassigned-${route.delivery_boy_id}-${u.user_id}`}
                  >
                    <p className="font-bold text-sm truncate">{u.name}</p>
                    <p className="text-muted-foreground truncate">{u.phone || "no phone"}</p>
                    <p className="text-muted-foreground truncate">{u.address || "no address"}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
