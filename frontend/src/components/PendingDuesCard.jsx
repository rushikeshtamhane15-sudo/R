import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";
import { CreditCard, Banknote, Loader2, AlertCircle, X } from "lucide-react";

/**
 * PendingDuesCard — iter-54 #1 + #9
 * Subscriber-facing card on /dashboard. Shows each subscription that still
 * has a `pending_amount > 0`. User can:
 *   - Pay online (Razorpay) for the full or partial dues
 *   - Generate cash-payment OTP for staff to verify
 * After payment, the card auto-refreshes; when balance reaches 0, the row
 * vanishes everywhere (admin /admin/partial-payments included).
 */
export default function PendingDuesCard({ onRefreshUser }) {
  const [items, setItems] = useState([]);
  const [totalPending, setTotalPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);   // sub_id being interacted with
  const [mode, setMode] = useState("online");   // "online" | "cash"
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cashOtp, setCashOtp] = useState(null); // {order_id, amount, dev_otp}

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/my/partial-balance");
      setItems(r.data.items || []);
      setTotalPending(r.data.total_pending || 0);
    } catch (e) {/*silent*/}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (loading || items.length === 0) return null;

  const handleOnline = async (sub) => {
    const pay = Math.max(1, Math.min(Number(amount) || sub.pending_amount, sub.pending_amount));
    setSubmitting(true);
    try {
      const r = await api.post("/payments/clear-partial-balance", { sub_id: sub.sub_id, amount: pay });
      const order = r.data;
      if (order.mock) {
        await api.post("/payments/verify", {
          order_id: order.order_id, razorpay_payment_id: "pay_mock", razorpay_signature: "sig",
        });
        toast.success("Dues paid · subscription updated");
        setActive(null); setAmount("");
        onRefreshUser?.(); load();
      } else {
        await loadRazorpay();
        const rzp = new window.Razorpay({
          key: order.key_id, amount: order.amount_paise, currency: "INR",
          order_id: order.order_id, name: "efoodcare",
          description: "Clear pending dues",
          theme: { color: "#a02323" },
          handler: async (res) => {
            try {
              await api.post("/payments/verify", {
                order_id: res.razorpay_order_id,
                razorpay_payment_id: res.razorpay_payment_id,
                razorpay_signature: res.razorpay_signature,
              });
              toast.success("Dues paid · subscription updated");
              setActive(null); setAmount("");
              onRefreshUser?.(); load();
            } catch (e) { toast.error("Verify failed"); }
          },
        });
        rzp.open();
      }
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not initiate payment"); }
    finally { setSubmitting(false); }
  };

  const handleCash = async (sub) => {
    const pay = Math.max(1, Math.min(Number(amount) || sub.pending_amount, sub.pending_amount));
    setSubmitting(true);
    try {
      const r = await api.post("/payments/clear-partial-balance-cash", { sub_id: sub.sub_id, amount: pay });
      setCashOtp({ order_id: r.data.order_id, amount: r.data.amount, dev_otp: r.data.dev_otp });
      toast.success("Cash payment requested · share OTP with staff");
      setActive(null); setAmount("");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not request cash payment"); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="rounded-2xl card-3d card-3d-amber p-5 space-y-3" data-testid="pending-dues-card">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] tracking-overline uppercase font-bold text-amber-700 flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Pending balance</p>
          <p className="font-display font-extrabold text-2xl mt-1 text-amber-900 tabular-nums">₹{totalPending.toFixed(0)} due</p>
          <p className="text-xs text-amber-800 mt-1">Clear it now to avoid service interruption when wallet runs out.</p>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((sub) => (
          <div key={sub.sub_id} className="rounded-xl bg-white border border-amber-200 p-3" data-testid={`dues-row-${sub.sub_id}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{sub.plan_name}</p>
                <p className="text-[11px] text-muted-foreground">Sub {sub.sub_id} · ends {sub.end_date?.slice(0, 10)}</p>
              </div>
              <span className="font-display font-bold text-lg tabular-nums text-amber-900">₹{Number(sub.pending_amount).toFixed(0)}</span>
            </div>
            {active === sub.sub_id ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input type="number" min={1} max={sub.pending_amount} value={amount}
                         onChange={(e) => setAmount(e.target.value)}
                         placeholder={`Up to ₹${Number(sub.pending_amount).toFixed(0)}`}
                         className="h-9 rounded-xl" data-testid={`dues-amount-${sub.sub_id}`} />
                  <select className="h-9 rounded-xl border border-input bg-background px-2 text-sm"
                          value={mode} onChange={(e) => setMode(e.target.value)} data-testid={`dues-mode-${sub.sub_id}`}>
                    <option value="online">Online</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => mode === "online" ? handleOnline(sub) : handleCash(sub)} disabled={submitting} className="rounded-full" data-testid={`dues-pay-${sub.sub_id}`}>
                    {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : (mode === "online" ? <CreditCard className="h-3 w-3 mr-1" /> : <Banknote className="h-3 w-3 mr-1" />)}
                    {mode === "online" ? "Pay online" : "Generate cash OTP"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setActive(null); setAmount(""); }} className="rounded-full" data-testid={`dues-cancel-${sub.sub_id}`}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" onClick={() => { setActive(sub.sub_id); setAmount(sub.pending_amount); setMode("online"); }} className="mt-2 rounded-full" data-testid={`dues-clear-${sub.sub_id}`}>
                Clear dues
              </Button>
            )}
          </div>
        ))}
      </div>

      {cashOtp && (
        <div className="rounded-xl bg-white border border-primary p-4 mt-3" data-testid="dues-cash-otp-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] tracking-overline uppercase font-bold text-primary">Cash OTP — share with staff</p>
              <p className="font-display font-extrabold text-3xl tracking-widest tabular-nums mt-1" data-testid="dues-cash-otp">{cashOtp.dev_otp || "Sent via WhatsApp / SMS"}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Order {cashOtp.order_id} · ₹{Number(cashOtp.amount).toFixed(0)}</p>
            </div>
            <button onClick={() => setCashOtp(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve; s.onerror = reject;
    document.body.appendChild(s);
  });
}
