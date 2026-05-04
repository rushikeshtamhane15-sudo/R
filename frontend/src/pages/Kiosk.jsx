import React, { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { QRCodeSVG } from "qrcode.react";
import { Sun, Moon, UtensilsCrossed } from "lucide-react";

export default function Kiosk() {
  const { locationId = "main" } = useParams();
  const [params] = useSearchParams();
  const [meal, setMeal] = useState(params.get("meal") || currentMeal());
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [now, setNow] = useState(new Date());
  const [secondsLeft, setSecondsLeft] = useState(300);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get(`/counter/qr/public?meal=${meal}&location=${locationId}`);
      setData(r.data);
      setSecondsLeft(Math.max(1, r.data.rotates_at - Math.floor(Date.now() / 1000)));
    } catch {}
  }, [meal, locationId]);

  const loadStats = useCallback(async () => {
    try { const r = await api.get("/stats/today"); setStats(r.data); } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { loadStats(); const id = setInterval(loadStats, 10000); return () => clearInterval(id); }, [loadStats]);

  // Auto-switch meal based on time of day
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
      const auto = currentMeal();
      if (!params.get("meal") && auto !== meal) setMeal(auto);
    }, 1000);
    return () => clearInterval(id);
  }, [meal, params]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { refresh(); return 300; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const isLunch = meal === "lunch";
  const accent = isLunch ? "hsl(26,43%,57%)" : "hsl(135,11%,33%)";

  return (
    <div
      className="fixed inset-0 bg-[hsl(40,25%,96%)] overflow-auto"
      data-testid="kiosk-page"
    >
      <div className="min-h-screen flex flex-col">
        {/* Top strip */}
        <div className="flex items-center justify-between px-8 md:px-12 py-6 border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <UtensilsCrossed className="h-5 w-5 text-primary-foreground" strokeWidth={1.75} />
            </div>
            <div>
              <p className="font-display font-extrabold text-lg leading-none">MESSPASS</p>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground mt-1">Counter · {locationId}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono font-bold text-2xl md:text-3xl tabular-nums">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground mt-1">{now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</p>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 grid lg:grid-cols-3 gap-8 px-8 md:px-12 py-10 items-center">
          <div className="lg:col-span-2 flex flex-col items-center justify-center text-center">
            <div className="flex items-center gap-2 mb-6">
              {isLunch ? (
                <Sun className="h-6 w-6" strokeWidth={1.75} style={{ color: accent }} />
              ) : (
                <Moon className="h-6 w-6" strokeWidth={1.75} style={{ color: accent }} />
              )}
              <span
                className="text-xs tracking-overline uppercase font-bold"
                style={{ color: accent }}
                data-testid="kiosk-meal-label"
              >
                {meal} slot
              </span>
            </div>

            <h2 className="font-display font-extrabold text-4xl md:text-5xl lg:text-6xl tracking-tight leading-[1] max-w-xl">
              Scan with your meal pass app to check in.
            </h2>

            <div
              className="mt-10 bg-white p-8 rounded-3xl border border-black/5 shadow-2xl"
              style={{ borderTop: `6px solid ${accent}` }}
              data-testid="kiosk-qr"
            >
              {data ? (
                <QRCodeSVG value={data.counter_code} size={340} level="M" fgColor="#4b5c4a" />
              ) : (
                <div className="h-[340px] w-[340px] flex items-center justify-center text-muted-foreground">Loading…</div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-6 font-mono">
              auto-rotates in {secondsLeft}s · valid for current {meal}
            </p>
          </div>

          {/* Side stats */}
          <div className="space-y-5">
            <div className="rounded-3xl p-8 bg-primary text-primary-foreground" data-testid="kiosk-live-stats">
              <p className="text-[10px] tracking-overline uppercase font-bold opacity-70">Today's check-ins</p>
              <p className="font-display font-extrabold text-7xl mt-3 leading-none tabular-nums">{stats?.total ?? "—"}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-card border border-black/5 p-5">
                <div className="flex items-center gap-1.5 text-secondary"><Sun className="h-3.5 w-3.5" strokeWidth={1.75} /><span className="text-[10px] tracking-overline uppercase font-bold">Lunch</span></div>
                <p className="font-display font-extrabold text-3xl mt-2 tabular-nums">{stats?.lunch ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-card border border-black/5 p-5">
                <div className="flex items-center gap-1.5 text-primary"><Moon className="h-3.5 w-3.5" strokeWidth={1.75} /><span className="text-[10px] tracking-overline uppercase font-bold">Dinner</span></div>
                <p className="font-display font-extrabold text-3xl mt-2 tabular-nums">{stats?.dinner ?? 0}</p>
              </div>
            </div>
            <div className="rounded-2xl bg-accent border border-black/5 p-5">
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">How to check in</p>
              <ol className="text-sm mt-2 space-y-1 list-decimal pl-4 text-foreground/80">
                <li>Open MessPass on your phone</li>
                <li>Tap "Scan counter QR"</li>
                <li>Point at this screen — done.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function currentMeal() {
  const h = new Date().getHours();
  return h < 16 ? "lunch" : "dinner";
}
