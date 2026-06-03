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
  // iter-56 #1: admin-editable tile colors
  const [otpStyles, setOtpStyles] = useState({});
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/dashboard-styles");
        if (r.data?.otp_bg) setOtpStyles({ background: r.data.otp_bg, color: r.data.otp_text || undefined });
      } catch { /* defaults */ }
    })();
  }, []);

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
    <div className="rounded-xl card-3d card-3d-primary p-3 animate-pulse-slow" data-testid="cash-otp-flash" style={otpStyles}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] tracking-overline uppercase font-bold flex items-center gap-1.5 opacity-80">
            <KeyRound className="h-3 w-3" /> Cash payment OTP{items.length > 1 ? ` (${items.length})` : ""}
          </p>
          <p className="text-xs mt-0.5 opacity-90">Share with staff in person:</p>
          <div className="mt-2 space-y-1.5">
            {items.map((it) => (
              <div key={it.order_id} className="rounded-md bg-card/80 border border-border/70 p-2" data-testid={`cash-otp-row-${it.order_id}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-display font-extrabold text-xl tracking-[0.25em] tabular-nums text-primary leading-none">{it.cash_otp}</p>
                    <p className="text-[10px] mt-0.5 opacity-70">
                      ₹{Number(it.amount).toFixed(0)} · {it.plan_name?.slice(0, 24)}
                      {it.is_partial_clear && <span className="ml-1 inline-block px-1 py-0 rounded-full bg-amber-100 text-amber-900 text-[8px] font-bold">DUES</span>}
                      {it.is_mix_cash_leg && <span className="ml-1 inline-block px-1 py-0 rounded-full bg-blue-100 text-blue-900 text-[8px] font-bold">MIX</span>}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
