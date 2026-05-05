import React, { useEffect, useState, useCallback } from "react";
import { api, API } from "../lib/api";
import { useTheme } from "../context/ThemeContext";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Sun, Moon, Download, Maximize2, Copy } from "lucide-react";

const LOCATION = "main";

export default function AdminCounter() {
  const { theme } = useTheme();
  const brandName = theme?.brand_name || "eFoodCare";
  const [meal, setMeal] = useState(currentMeal());
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get(`/counter/qr?meal=${meal}&location=${LOCATION}`);
      setData(r.data);
      setSecondsLeft(Math.max(1, r.data.rotates_at - Math.floor(Date.now() / 1000)));
    } catch { toast.error("Could not load counter QR"); }
  }, [meal]);

  const loadStats = useCallback(async () => {
    try { const r = await api.get("/stats/today"); setStats(r.data); } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { loadStats(); const id = setInterval(loadStats, 15000); return () => clearInterval(id); }, [loadStats]);
  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => { if (s <= 1) { refresh(); return 300; } return s - 1; });
    }, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const publicUrl = `${window.location.origin}/k/${LOCATION}?meal=${meal}`;
  const downloadUrl = `${API}/counter/poster?meal=${meal}&location=${LOCATION}`;
  const copyPublic = async () => { await navigator.clipboard.writeText(publicUrl); toast.success("Kiosk URL copied"); };
  const openKiosk = () => window.open(publicUrl, "_blank");

  return (
    <div data-testid="admin-counter-page">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Counter</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">{brandName} counter · main</h1>
          <p className="text-muted-foreground mt-2 text-sm">QR rotates every 5 minutes for security. One code per meal slot.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={openKiosk} variant="outline" className="rounded-full" data-testid="open-kiosk-button">
            <Maximize2 className="h-4 w-4 mr-2" /> Kiosk mode
          </Button>
          <a href={downloadUrl} download data-testid="download-poster-button">
            <Button variant="outline" className="rounded-full">
              <Download className="h-4 w-4 mr-2" /> Poster
            </Button>
          </a>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 bg-card rounded-3xl border border-border shadow-sm p-8" data-testid="counter-qr">
          <div className="flex gap-2 mb-6">
            <Button onClick={() => setMeal("lunch")} data-testid="counter-meal-lunch"
              className={`rounded-full ${meal === "lunch" ? "bg-secondary hover:bg-secondary/90" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
              <Sun className="h-4 w-4 mr-2" /> Lunch
            </Button>
            <Button onClick={() => setMeal("dinner")} data-testid="counter-meal-dinner"
              className={`rounded-full ${meal === "dinner" ? "bg-primary hover:bg-primary/90" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
              <Moon className="h-4 w-4 mr-2" /> Dinner
            </Button>
          </div>

          <div className="flex justify-center" data-testid="counter-qr-image">
            {data ? (
              <div className="bg-white p-6 rounded-2xl border-2 border-primary/20">
                <QRCodeSVG value={data.counter_code} size={300} level="M" fgColor={`hsl(${theme?.tokens?.primary || "142 45% 38%"})`} />
              </div>
            ) : (
              <div className="h-[348px] w-[348px] flex items-center justify-center text-muted-foreground">Loading…</div>
            )}
          </div>
          <div className="mt-6 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Rotates in <span className="font-mono font-bold text-foreground">{secondsLeft}s</span></span>
            <span className="text-[10px] tracking-overline uppercase font-bold text-primary capitalize">{meal} slot</span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground mt-3 break-all">{data?.counter_code}</p>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card rounded-2xl border border-border p-6" data-testid="public-url-card">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Public kiosk URL</p>
            <p className="text-sm mt-3 break-all font-mono bg-muted/60 rounded-lg p-3">{publicUrl}</p>
            <div className="mt-3 flex gap-2">
              <Button onClick={copyPublic} variant="outline" size="sm" className="rounded-full flex-1" data-testid="copy-kiosk-url">
                <Copy className="h-3.5 w-3.5 mr-2" /> Copy
              </Button>
              <Button onClick={openKiosk} size="sm" className="rounded-full flex-1 bg-primary hover:bg-primary/90" data-testid="open-kiosk-link">
                Open
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">No login needed. Display this on your counter screen.</p>
          </div>

          <div className="bg-primary text-primary-foreground rounded-2xl p-6" data-testid="live-counter-card">
            <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">Today so far</p>
            <p className="font-display font-extrabold text-5xl mt-3 leading-none">{stats?.total ?? "—"}</p>
            <p className="text-sm text-primary-foreground/80 mt-2">check-ins</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="bg-white/10 rounded-lg p-3">
                <p className="text-[10px] tracking-overline uppercase font-bold opacity-70">Lunch</p>
                <p className="font-display font-extrabold text-xl mt-1">{stats?.lunch ?? 0}</p>
              </div>
              <div className="bg-white/10 rounded-lg p-3">
                <p className="text-[10px] tracking-overline uppercase font-bold opacity-70">Dinner</p>
                <p className="font-display font-extrabold text-xl mt-1">{stats?.dinner ?? 0}</p>
              </div>
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
