import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";

/**
 * PendingCashOtpFlash — iter-54 #8 / #1 (iter-61 #7: user-cancel button)
 * Persistent floating banner on /dashboard that flashes the active cash-OTP
 * until staff verify. Polls /my/pending-cash-otp every 8s; auto-vanishes
 * when the order moves out of pending_cash. iter-61: user can cancel their
 * own pending_cash entry if they raised it by mistake — order vanishes from
 * admin dashboard in real time too.
 */
export default function PendingCashOtpFlash() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [otpStyles, setOtpStyles] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/dashboard-styles");
        if (r.data?.otp_bg) setOtpStyles({ background: r.data.otp_bg, color: r.data.otp_text || undefined });
      } catch { /* defaults */ }
    })();
  }, []);

  const poll = async () => {
    try {
      const r = await api.get("/my/pending-cash-otp");
      setItems(r.data.items || []);
    } catch {/* silent */}
    finally { setLoading(false); }
  };
  useEffect(() => {
    let cancel = false;
    const tick = async () => { if (!cancel) await poll(); };
    tick();
    const id = setInterval(tick, 8000);
    return () => { cancel = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = async () => {
    if (!confirmCancel) return;
    setCancelling(true);
    try {
      await api.post("/payments/cash-cancel", { order_id: confirmCancel.order_id });
      toast.success("Cash entry deleted — staff have been notified");
      setItems((prev) => prev.filter((p) => p.order_id !== confirmCancel.order_id));
      setConfirmCancel(null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel");
    } finally { setCancelling(false); }
  };

  if (loading || items.length === 0) return null;

  return (
    <>
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
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display font-extrabold text-xl tracking-[0.25em] tabular-nums text-primary leading-none">{it.cash_otp}</p>
                      <p className="text-[10px] mt-0.5 opacity-70">
                        ₹{Number(it.amount).toFixed(0)} · {it.plan_name?.slice(0, 24)}
                        {it.is_partial_clear && <span className="ml-1 inline-block px-1 py-0 rounded-full bg-amber-100 text-amber-900 text-[8px] font-bold">DUES</span>}
                        {it.is_mix_cash_leg && <span className="ml-1 inline-block px-1 py-0 rounded-full bg-blue-100 text-blue-900 text-[8px] font-bold">MIX</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmCancel(it)}
                      className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                      title="Cancel this cash entry"
                      aria-label="Cancel cash entry"
                      data-testid={`cash-otp-cancel-${it.order_id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {confirmCancel && (
        <div
          className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4"
          onClick={() => !cancelling && setConfirmCancel(null)}
          data-testid="cash-cancel-modal"
        >
          <div className="bg-card rounded-3xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="inline-flex h-10 w-10 rounded-xl bg-destructive/10 text-destructive items-center justify-center"><Trash2 className="h-5 w-5" /></div>
            <h3 className="font-display font-extrabold text-lg mt-3">Cancel this cash payment?</h3>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              Removes the <b>₹{Number(confirmCancel.amount).toFixed(0)}</b> entry from your dashboard and from admin's pending list. Use this only if you raised it by mistake.
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmCancel(null)}
                disabled={cancelling}
                className="px-4 py-2 rounded-full text-xs font-bold border border-border hover:bg-muted/60"
              >Keep</button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="px-4 py-2 rounded-full text-xs font-bold bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="cash-cancel-confirm"
              >{cancelling ? "Cancelling…" : "Yes, delete entry"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
