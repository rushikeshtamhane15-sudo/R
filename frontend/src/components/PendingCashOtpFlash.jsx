import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { KeyRound, X, Loader2 } from "lucide-react";

/**
 * PendingCashOtpFlash — iter-54 #8 / #1
 * Persistent floating banner on /dashboard that flashes the active cash-OTP
 * until staff verify. Polls /my/pending-cash-otp every 8s; auto-vanishes
 * when the order moves out of pending_cash. Cannot be dismissed (per user
 * requirement: stay until staff verify).
 */
export default function PendingCashOtpFlash() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    const poll = async () => {
      try {
        const r = await api.get("/my/pending-cash-otp");
        if (cancel) return;
        setItems(r.data.items || []);
      } catch {/* silent */}
      finally { if (!cancel) setLoading(false); }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  if (loading || items.length === 0) return null;

  return (
    <div className="rounded-2xl border-2 border-primary bg-primary/5 p-5 animate-pulse-slow" data-testid="cash-otp-flash">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] tracking-overline uppercase font-bold text-primary flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" /> Cash payment OTP {items.length > 1 ? `(${items.length})` : ""}
          </p>
          <p className="text-sm mt-1 text-foreground">Share with staff <span className="font-bold">in person</span> after handing over cash:</p>
          <div className="mt-3 space-y-2">
            {items.map((it) => (
              <div key={it.order_id} className="rounded-xl bg-card border border-border p-3" data-testid={`cash-otp-row-${it.order_id}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-display font-extrabold text-3xl tracking-[0.3em] tabular-nums text-primary">{it.cash_otp}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {it.plan_name} · ₹{Number(it.amount).toFixed(0)} · order {it.order_id?.slice(0, 14)}
                      {it.is_partial_clear && <span className="ml-1 inline-block px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[9px] font-bold">DUES TOP-UP</span>}
                    </p>
                  </div>
                  {it.assigned_staff_name && (
                    <p className="text-[11px] text-muted-foreground">Assigned: <b>{it.assigned_staff_name}</b></p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">This OTP stays here until staff or admin verify it. Don't share it with anyone other than our staff at the time of cash hand-over.</p>
        </div>
      </div>
    </div>
  );
}
