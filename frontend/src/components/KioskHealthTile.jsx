/* iter-138.h · Compact wall-kiosk health tile for the admin dashboard.
 * Polls /admin/kiosk/health every 20 s and shows camera + voice state +
 * "last face check-in N min ago". Green ring = camera up, amber = stale
 * (> 90 s no heartbeat), red = camera reported down. One glance = confidence. */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { ScanFace, Loader2 } from "lucide-react";

function agoLabel(iso) {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!t) return "unknown";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function KioskHealthTile() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const r = await api.get("/admin/kiosk/health"); setData(r.data); } catch { setData(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  const hb = (data?.kiosks && data.kiosks[0]) || null;
  const hbAgeMs = hb?.ts ? Date.now() - Date.parse(hb.ts) : Infinity;
  const camOk = !!(hb?.camera_ok) && hbAgeMs < 90_000;
  const stale = hb && hbAgeMs >= 90_000;
  const tone = camOk ? "bg-emerald-500" : stale ? "bg-amber-500" : "bg-red-500";
  const status = camOk ? "Connected" : stale ? "Stale · no heartbeat > 90s" : hb ? "Camera reported down" : "Not seen · enable Voice on wall";

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm" data-testid="kiosk-health-tile">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-white ${tone}`}>
          <ScanFace className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.16em] uppercase font-bold text-muted-foreground">Wall kiosk · face scanner</p>
          <p className="font-display font-extrabold text-sm truncate" data-testid="kiosk-health-status">{status}</p>
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
          <p className="text-[9px] tracking-widest uppercase font-bold text-muted-foreground">Heartbeat</p>
          <p className="font-extrabold tabular-nums">{hb ? agoLabel(hb.ts) : "—"}</p>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-1.5" data-testid="kiosk-health-last-scan">
          <p className="text-[9px] tracking-widest uppercase font-bold text-muted-foreground">Last face check-in</p>
          <p className="font-extrabold tabular-nums">{agoLabel(data?.last_face_checkin_at)}</p>
        </div>
      </div>
    </div>
  );
}
