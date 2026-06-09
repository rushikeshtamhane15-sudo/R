import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Clock, Power, PowerOff, Activity, ChefHat, Save, Loader2 } from "lucide-react";

/**
 * AdminRestaurantHours — iter-79 Batch B #4
 *
 * Admin tool to control restaurant order acceptance:
 *   • Mode: Manual ON / Manual OFF / Auto by schedule
 *   • Daily open/close window (single window applied to all 7 days — keeps
 *     the UI simple; per-day overrides can be added later if asked)
 *   • Capacity per hour (0 = unlimited) — pause when load is hit
 *   • Custom closed-message shown on the public popup
 *
 * Backend: routes/restaurant_hours.py
 */
const MODE_OPTIONS = [
  { id: "auto",       label: "Auto-schedule",      icon: Activity,  desc: "Open inside the configured hours, closed outside." },
  { id: "manual_on",  label: "Force ON",           icon: Power,     desc: "Override hours and accept orders right now." },
  { id: "manual_off", label: "Force OFF (closed)", icon: PowerOff,  desc: "Block all orders regardless of hours." },
];

export default function AdminRestaurantHours() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/admin/restaurant/hours");
      setCfg(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load config");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get("/admin/restaurant/hours");
        if (!cancelled) setCfg(r.data);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Could not load config");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await api.post("/admin/restaurant/hours", {
        mode: cfg.mode,
        open_time: cfg.open_time,
        close_time: cfg.close_time,
        capacity_per_hour: Number(cfg.capacity_per_hour) || 0,
        closed_message: cfg.closed_message || "",
      });
      toast.success(r.data?.open ? "Saved — restaurant is OPEN" : "Saved — restaurant is CLOSED");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  if (!cfg) {
    return (
      <div className="p-12 text-center text-muted-foreground" data-testid="hours-loading">
        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
      </div>
    );
  }

  const status = cfg.status || {};
  const isOpen = !!status.open;

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-8" data-testid="admin-restaurant-hours">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Restaurant ordering</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Working hours</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Decide when the restaurant accepts online orders. When closed, customers see a popup explaining why and a countdown until you re-open.
      </p>

      {/* Live status */}
      <div
        className={`mt-6 rounded-2xl border p-4 flex items-center gap-3 ${isOpen ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}
        data-testid="hours-live-status"
      >
        <span className={`inline-flex h-10 w-10 rounded-xl items-center justify-center ${isOpen ? "bg-emerald-500" : "bg-amber-500"} text-white`}>
          {isOpen ? <ChefHat className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] tracking-[0.18em] uppercase font-extrabold ${isOpen ? "text-emerald-800" : "text-amber-800"}`}>
            Right now
          </p>
          <p className={`font-display font-extrabold text-lg ${isOpen ? "text-emerald-900" : "text-amber-900"}`}>
            {isOpen ? "Accepting orders" : (status.opens_in_minutes != null ? `Closed — opens in ${formatMinutes(status.opens_in_minutes)}` : "Closed")}
          </p>
          {!isOpen && status.reason && (
            <p className="text-[11px] text-amber-800/80 mt-0.5">Reason: <code>{status.reason}</code></p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] tracking-[0.18em] uppercase font-extrabold text-muted-foreground">Last hour</p>
          <p className="font-display font-extrabold text-lg" data-testid="hours-current-orders">{cfg.current_hourly_order_count ?? 0}</p>
        </div>
      </div>

      {/* Mode picker */}
      <div className="mt-8">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Mode</p>
        <div className="mt-2 grid sm:grid-cols-3 gap-2">
          {MODE_OPTIONS.map((m) => {
            const active = cfg.mode === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setCfg({ ...cfg, mode: m.id })}
                className={`rounded-2xl border-2 p-3 text-left transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                data-testid={`hours-mode-${m.id}`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`text-sm font-extrabold ${active ? "text-primary" : "text-foreground"}`}>{m.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">{m.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Schedule */}
      <div className={`mt-6 grid sm:grid-cols-2 gap-4 transition-opacity ${cfg.mode === "auto" ? "" : "opacity-50"}`}>
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Daily open</p>
          <Input
            type="time"
            value={cfg.open_time}
            onChange={(e) => setCfg({ ...cfg, open_time: e.target.value })}
            className="mt-2 rounded-xl"
            data-testid="hours-open-time"
          />
        </div>
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Daily close</p>
          <Input
            type="time"
            value={cfg.close_time}
            onChange={(e) => setCfg({ ...cfg, close_time: e.target.value })}
            className="mt-2 rounded-xl"
            data-testid="hours-close-time"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">Applies to all 7 days (Asia/Kolkata local time).</p>

      {/* Capacity */}
      <div className="mt-6">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Kitchen capacity (per hour)</p>
        <div className="mt-2 flex items-center gap-3 max-w-xs">
          <Input
            type="number"
            min={0}
            max={10000}
            step={1}
            value={cfg.capacity_per_hour ?? 0}
            onChange={(e) => setCfg({ ...cfg, capacity_per_hour: e.target.value })}
            className="rounded-xl"
            data-testid="hours-capacity"
          />
          <span className="text-xs text-muted-foreground">orders/hr</span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          When the rolling 60-min order count hits this number, the kitchen auto-closes and reopens once it drops. Set to <b>0</b> for unlimited.
        </p>
      </div>

      {/* Custom closed message */}
      <div className="mt-6">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Closed-popup message</p>
        <Input
          value={cfg.closed_message || ""}
          onChange={(e) => setCfg({ ...cfg, closed_message: e.target.value.slice(0, 240) })}
          placeholder="We only deliver between our standard working hours"
          className="mt-2 rounded-xl"
          data-testid="hours-closed-message"
          maxLength={240}
        />
        <p className="text-[11px] text-muted-foreground mt-1.5">Up to 240 chars. Shown on the customer popup when ordering is paused.</p>
      </div>

      <div className="mt-8 flex gap-3 sticky bottom-4">
        <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90 flex-1 h-11" data-testid="hours-save-button">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function formatMinutes(mins) {
  if (mins == null) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
