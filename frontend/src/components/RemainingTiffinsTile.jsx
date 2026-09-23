import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Truck, CheckCircle2, AlertTriangle, ArrowRight, Loader2 } from "lucide-react";

const POLL_MS = 30000;

/**
 * iter-185 · Live 'Remaining tiffins to deliver' tile.
 * Polls /api/admin/delivery-routes/summary every 30s.
 *   remaining > 0 → red (out for delivery)
 *   remaining == 0 && total > 0 → green (all delivered)
 *   total == 0 → subdued grey (nobody assigned yet)
 */
export default function RemainingTiffinsTile() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/admin/delivery-routes/summary");
      setData(r.data);
    } catch {
      // Silent — tile is a nice-to-have on the dashboard.
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-3 text-sm text-muted-foreground" data-testid="remaining-tiffins-tile-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading delivery status…
      </div>
    );
  }

  const total = data?.total || 0;
  const remaining = data?.remaining || 0;
  const delivered = data?.delivered || 0;
  const anyDispatched = data?.any_dispatched;
  const isEmpty = total === 0;
  const allDone = !isEmpty && remaining === 0;
  const outForDelivery = remaining > 0 && anyDispatched;

  const tone = isEmpty
    ? { bg: "bg-slate-50 border-slate-200", ic: "bg-slate-400 text-white", label: "text-slate-600", Icon: Truck }
    : allDone
      ? { bg: "bg-emerald-50 border-emerald-300", ic: "bg-emerald-500 text-white", label: "text-emerald-700", Icon: CheckCircle2 }
      : outForDelivery
        ? { bg: "bg-red-50 border-red-300", ic: "bg-red-500 text-white", label: "text-red-700", Icon: AlertTriangle }
        : { bg: "bg-amber-50 border-amber-300", ic: "bg-amber-500 text-white", label: "text-amber-700", Icon: Truck };

  return (
    <Link
      to="/admin/tiffin-delivery"
      className={`block rounded-2xl border-2 p-5 transition hover:shadow-md ${tone.bg}`}
      data-testid="remaining-tiffins-tile"
    >
      <div className="flex items-center gap-4">
        <span className={`inline-flex h-12 w-12 rounded-xl items-center justify-center ${tone.ic}`}>
          <tone.Icon className="h-6 w-6" />
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] tracking-overline uppercase font-bold ${tone.label}`}>
            {isEmpty ? "Delivery routes · manual" : allDone ? "All tiffins delivered" : outForDelivery ? "Out for delivery" : "Ready to dispatch"}
          </p>
          <h2 className="font-display font-extrabold text-2xl mt-0.5" data-testid="remaining-tiffins-value">
            {isEmpty ? "No routes yet" : (
              <>
                {remaining} <span className="text-base font-semibold text-muted-foreground">/ {total} remaining</span>
              </>
            )}
          </h2>
          {!isEmpty && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{delivered} delivered · updates every 30s</p>
          )}
        </div>
        <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}
