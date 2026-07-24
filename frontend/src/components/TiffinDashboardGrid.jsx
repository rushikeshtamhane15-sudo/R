/* TiffinDashboardGrid — professional mobile-first grid for tiffin subscribers.
 *
 * iter-131.18: replaces the tiffin variant of the SubscriberDashboard hero
 * + side lanes. Tiny 3D-elevated tiles (~120–160 px), uniform 12 px gaps,
 * 2-col grid on mobile with occasional full-width cards. Includes:
 *   • Active plan tile (compact hero) with pause toggle + live tracking
 *   • Wallet tile (compact)
 *   • Meal streak tile
 *   • Today's delivery status tile
 *   • Delivery-time card (mounted from prop)
 *   • Tiffin preferences card (mounted from prop)
 *   • QR identity tile
 *   • Attendance / recent deliveries tile
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  Truck, Wallet, IndianRupee, Pause, Play, Loader2, Sun, Moon,
  Flame, Calendar, QrCode, MapPin, Package, Clock, ArrowRight, CheckCircle2, Circle,
} from "lucide-react";

const TILE_BASE =
  "relative rounded-2xl bg-card border border-black/5 p-4 transition-all duration-200 hover:-translate-y-0.5 overflow-hidden";
const TILE_SHADOW = {
  boxShadow:
    "0 8px 20px -12px rgba(15,23,42,0.16), 0 2px 6px -2px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(15,23,42,0.04)",
};
const TILE_SHADOW_PRIMARY = {
  boxShadow:
    "0 12px 28px -14px rgba(160,35,35,0.45), 0 3px 8px -3px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.12)",
};

export default function TiffinDashboardGrid({
  sub,
  qr,
  history,
  isPaused,
  pausing,
  togglePause,
  daysLeft,
  preferencesSlot,   // React node — the existing TiffinPreferencesCard
  deliveryTimeSlot,  // React node — the existing DeliveryTimeCard
}) {
  const [pending, setPending] = useState({ pending: [], loading: true });

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/my/deliveries/pending");
        setPending({ pending: r.data.pending || [], loading: false });
      } catch {
        setPending({ pending: [], loading: false });
      }
    })();
  }, []);

  const mealsLeft = useMemo(
    () => Math.max(0, (sub?.meals_total || 0) - (sub?.meals_used || 0)),
    [sub]
  );
  const perDay = Number(sub?.per_day_amount || 0);
  const walletBalance = Math.round(sub?.wallet_balance || 0);

  // iter-131.18: consecutive-day streak based on delivered attendance in history.
  const streak = useMemo(() => {
    if (!history || history.length === 0) return 0;
    const days = new Set(history.map((h) => h.date_str));
    let s = 0;
    const oneDay = 86400000;
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.now() - i * oneDay);
      const key = d.toISOString().slice(0, 10);
      if (days.has(key)) s++;
      else if (i > 0) break;   // allow today's absence
    }
    return s;
  }, [history]);

  const todayLunch = pending.pending.find((p) => p.meal_type === "lunch");
  const todayDinner = pending.pending.find((p) => p.meal_type === "dinner");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[280px] sm:max-w-none mx-auto sm:mx-0" data-testid="tiffin-dashboard-grid">
      {/* Row 1 — Active plan hero (full width) */}
      <div
        className={`${TILE_BASE} col-span-2 text-primary-foreground bg-primary`}
        style={TILE_SHADOW_PRIMARY}
        data-testid="tile-active-plan"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full opacity-40"
          style={{ background: "radial-gradient(circle at center, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 70%)" }}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/80 flex items-center gap-1.5">
              <Truck className="h-3 w-3" /> {sub?.tiffin_size === "half" ? "Half" : "Full"} · {sub?.plan_name}
            </p>
            <h2 className="font-display font-extrabold text-xl sm:text-2xl mt-1 leading-tight" data-testid="tile-plan-status">
              {isPaused ? "Delivery paused" : "Delivery active"}
            </h2>
            <p className="text-xs text-primary-foreground/80 mt-1">
              {isPaused ? "You're off the dispatch list" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} · ${mealsLeft} tiffins left`}
            </p>
          </div>
          <Button
            onClick={togglePause}
            disabled={pausing}
            size="sm"
            className={`rounded-full font-bold text-xs h-9 px-3 shrink-0 ${isPaused ? "bg-white text-primary hover:bg-white/90" : "bg-amber-400 hover:bg-amber-500 text-amber-950"}`}
            data-testid="tile-pause-toggle"
          >
            {pausing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isPaused ? <><Play className="h-3.5 w-3.5 mr-1" /> Resume</> : <><Pause className="h-3.5 w-3.5 mr-1" /> Pause</>}
          </Button>
        </div>
        <div className="relative mt-3 grid grid-cols-3 gap-2">
          <MiniStat label="Days left" value={daysLeft} dark />
          <MiniStat label="Tiffins" value={mealsLeft} dark />
          <MiniStat label="End" value={sub?.end_date ? new Date(sub.end_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"} dark />
        </div>
        <Link to="/track" className="relative mt-3 block">
          <button className="w-full rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-bold h-9 flex items-center justify-center gap-1.5 backdrop-blur-sm" data-testid="tile-track-link">
            <MapPin className="h-3.5 w-3.5" /> Live tracking <ArrowRight className="h-3 w-3" />
          </button>
        </Link>
      </div>

      {/* Row 2 — Wallet + Meal Streak (2-col) */}
      <div className={TILE_BASE} style={TILE_SHADOW} data-testid="tile-wallet">
        <div className="flex items-center gap-1.5 text-secondary">
          <Wallet className="h-3.5 w-3.5" />
          <p className="text-[10px] tracking-overline uppercase font-bold">Wallet</p>
        </div>
        <p className="font-display font-extrabold text-2xl sm:text-3xl mt-1 tabular-nums leading-none flex items-baseline" data-testid="tile-wallet-balance">
          <IndianRupee className="h-4 w-4" strokeWidth={2.5} />
          <span>{walletBalance.toLocaleString("en-IN")}</span>
        </p>
        <p className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">₹{perDay.toFixed(2)} per day</p>
        {(sub?.paused_days || 0) > 0 && (
          <p className="mt-2 text-[10px] text-amber-700 font-semibold flex items-center gap-1">
            <Pause className="h-3 w-3" /> +{sub.paused_days} d extension
          </p>
        )}
      </div>

      <div className={TILE_BASE} style={TILE_SHADOW} data-testid="tile-streak">
        <div className="flex items-center gap-1.5 text-orange-600">
          <Flame className="h-3.5 w-3.5" />
          <p className="text-[10px] tracking-overline uppercase font-bold">Meal streak</p>
        </div>
        <p className="font-display font-extrabold text-2xl sm:text-3xl mt-1 tabular-nums leading-none flex items-baseline gap-1" data-testid="tile-streak-value">
          {streak}<span className="text-sm text-muted-foreground font-semibold">day{streak === 1 ? "" : "s"}</span>
        </p>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {streak === 0 ? "Start today — never miss a meal" : streak < 7 ? "Keep going — 7 days unlocks a badge" : "Blazing streak · keep it up"}
        </p>
      </div>

      {/* Row 3 — Today's delivery status (full width) */}
      <div className={`${TILE_BASE} col-span-2`} style={TILE_SHADOW} data-testid="tile-today-meal">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-primary">
            <Package className="h-3.5 w-3.5" />
            <p className="text-[10px] tracking-overline uppercase font-bold">Today&apos;s meals</p>
          </div>
          <Link to="/track" className="text-[10px] tracking-overline uppercase font-bold text-primary hover:underline">Track →</Link>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <MealCell icon={Sun} label="Lunch" item={todayLunch} />
          <MealCell icon={Moon} label="Dinner" item={todayDinner} />
        </div>
      </div>

      {/* Row 4 — Delivery time (full width) */}
      <div className="col-span-2" data-testid="tile-delivery-time-slot">{deliveryTimeSlot}</div>

      {/* Row 5 — Tiffin preferences (full width) */}
      <div className="col-span-2" data-testid="tile-preferences-slot">{preferencesSlot}</div>

      {/* Row 6 — QR identity + Attendance (2-col) */}
      <div className={`${TILE_BASE} flex flex-col items-center text-center`} style={TILE_SHADOW} data-testid="tile-qr">
        <div className="flex items-center gap-1.5 text-secondary self-start">
          <QrCode className="h-3.5 w-3.5" />
          <p className="text-[10px] tracking-overline uppercase font-bold">My QR</p>
        </div>
        <div className="mt-2 p-1.5 rounded-xl bg-white ring-1 ring-border">
          {qr?.qr_token ? (
            <QRCodeSVG value={qr.qr_token} size={78} bgColor="#ffffff" fgColor="#0f172a" includeMargin={false} />
          ) : (
            <div className="h-[78px] w-[78px] rounded-lg bg-muted flex items-center justify-center text-[10px] text-muted-foreground">No QR</div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">Show to the delivery boy for verification</p>
      </div>

      <div className={TILE_BASE} style={TILE_SHADOW} data-testid="tile-attendance">
        <div className="flex items-center gap-1.5 text-secondary">
          <Calendar className="h-3.5 w-3.5" />
          <p className="text-[10px] tracking-overline uppercase font-bold">Recent</p>
        </div>
        <div className="mt-2 space-y-1">
          {(history || []).slice(0, 4).length === 0 && (
            <p className="text-[11px] text-muted-foreground">No deliveries yet — history appears here.</p>
          )}
          {(history || []).slice(0, 4).map((r) => (
            <div key={r.att_id} className="flex items-center gap-1.5 text-[11px]" data-testid={`tile-attendance-row-${r.att_id}`}>
              {r.meal_type === "lunch" ? <Sun className="h-3 w-3 text-amber-500" /> : <Moon className="h-3 w-3 text-primary" />}
              <span className="capitalize font-semibold">{r.meal_type}</span>
              <span className="text-muted-foreground">· {r.date_str.slice(5)}</span>
              <Clock className="h-2.5 w-2.5 text-muted-foreground ml-auto" />
              <span className="tabular-nums text-muted-foreground">{formatTime(r.checked_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, dark = false }) {
  return (
    <div className={`rounded-xl px-2.5 py-1.5 ${dark ? "bg-black/25 backdrop-blur-sm" : "bg-muted/40"}`}>
      <p className={`text-[8px] tracking-overline uppercase font-bold ${dark ? "text-white/70" : "text-muted-foreground"}`}>{label}</p>
      <p className={`font-display font-extrabold text-sm mt-0.5 leading-tight ${dark ? "text-white" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function MealCell({ icon: Icon, label, item }) {
  const status = (item && item.status) || null;
  const done = status === "delivered";
  const outForDel = status === "out";
  const undelivered = status === "undelivered" || status === "returned";
  const tone = done
    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
    : outForDel
    ? "bg-blue-50 border-blue-200 text-blue-900"
    : undelivered
    ? "bg-rose-50 border-rose-200 text-rose-900"
    : status === "planned" || status === "ready"
    ? "bg-amber-50 border-amber-200 text-amber-900"
    : "bg-muted/40 border-border text-muted-foreground";
  const StatusIcon = done ? CheckCircle2 : outForDel ? Truck : Circle;
  const statusText = done ? "Delivered" : outForDel ? "Out for delivery" : status === "ready" ? "Ready" : status === "planned" ? "Being packed" : undelivered ? "Undelivered" : "No tiffin today";
  return (
    <div className={`rounded-xl border px-2.5 py-2 ${tone}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        <span className="text-[10px] tracking-overline uppercase font-bold">{label}</span>
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        <StatusIcon className="h-3 w-3" />
        <span className="text-xs font-bold">{statusText}</span>
      </div>
      {item?.pref_start && (
        <p className="text-[10px] font-semibold mt-0.5 tabular-nums opacity-90">
          {item.pref_start} – {item.pref_end}
        </p>
      )}
    </div>
  );
}

function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}
