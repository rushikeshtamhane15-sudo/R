// AdminKiosk — BOTTOM right: order form (meal/service/qty/payment/total/place).
import React from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  ShoppingCart, Loader2, Minus, Plus, RotateCcw, Banknote, ScanLine,
  Wallet as WalletIcon, Utensils, Package,
} from "lucide-react";

const SERVICE_TABS = [
  { id: "takeaway", label: "Takeaway", icon: Package },
  { id: "dining",   label: "Dining",   icon: Utensils },
];
const PAY_TABS = [
  { id: "cash",   label: "Cash",        icon: Banknote },
  { id: "online", label: "Paytm QR",    icon: ScanLine },
  { id: "mixed",  label: "Cash + UPI",  icon: WalletIcon },
];

export default function KioskOrderForm({
  active,
  orderMeal, setOrderMeal,
  service, setServiceSafe,
  priceFor,
  qty, setQtySafe,
  paymentMethod, setPaymentMethod,
  cashAmount, onlineAmount, setCash,
  total, placing, pendingOrder,
  onPlaceOrder, onResetForm,
  lastOrder, receipt, onReopenReceipt,
}) {
  if (!active) {
    return (
      <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-6 text-sm text-[hsl(40,15%,70%)] text-center">
        Menu not published yet — switch days or check back shortly.
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-4 flex flex-col gap-2.5" data-testid="kiosk-order-form">
      {active.lunch && active.dinner && (
        <div className="inline-flex rounded-full bg-[hsl(140,8%,12%)] p-1 gap-1 self-start">
          <button type="button" onClick={() => setOrderMeal("lunch")} data-testid="kiosk-order-meal-lunch"
            className={`px-4 h-9 rounded-full text-xs font-extrabold ${orderMeal === "lunch" ? "bg-[hsl(26,43%,57%)] text-white" : "text-[hsl(40,15%,70%)]"}`}>Lunch</button>
          <button type="button" onClick={() => setOrderMeal("dinner")} data-testid="kiosk-order-meal-dinner"
            className={`px-4 h-9 rounded-full text-xs font-extrabold ${orderMeal === "dinner" ? "bg-[hsl(220,55%,55%)] text-white" : "text-[hsl(40,15%,70%)]"}`}>Dinner</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {SERVICE_TABS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setServiceSafe(s.id)}
            data-testid={`kiosk-svc-${s.id}`}
            className={`rounded-xl px-2 py-2 inline-flex flex-col items-center gap-0.5 text-[11px] font-extrabold tracking-wide border ${service === s.id ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)] border-transparent" : "bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,15%,80%)]"}`}
          >
            <s.icon className="h-4 w-4" />
            {s.label}
            <span className="tabular-nums text-[10px] opacity-80">₹{priceFor(s.id)}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl bg-[hsl(140,8%,12%)] px-2 py-1.5">
        <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)] pl-2">Quantity</span>
        <div className="inline-flex items-center rounded-full bg-[hsl(140,8%,8%)]">
          <button type="button" onClick={() => setQtySafe((q) => Math.max(1, q - 1))} className="h-10 w-10 inline-flex items-center justify-center" data-testid="kiosk-qty-dec"><Minus className="h-4 w-4" /></button>
          <span className="px-4 text-lg font-extrabold tabular-nums" data-testid="kiosk-qty">{qty}</span>
          <button type="button" onClick={() => setQtySafe((q) => Math.min(20, q + 1))} className="h-10 w-10 inline-flex items-center justify-center" data-testid="kiosk-qty-inc"><Plus className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {PAY_TABS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPaymentMethod(p.id)}
            data-testid={`kiosk-pay-${p.id}`}
            className={`rounded-xl px-2 py-2 inline-flex flex-col items-center justify-center gap-0.5 text-[10px] font-extrabold tracking-wide border ${paymentMethod === p.id ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)] border-transparent" : "bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,15%,80%)]"}`}
          >
            <p.icon className="h-3.5 w-3.5" /> {p.label}
          </button>
        ))}
      </div>

      {paymentMethod === "mixed" && (
        <div className="grid grid-cols-2 gap-2" data-testid="kiosk-mixed-amounts">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)]">Cash ₹</span>
            <Input
              type="number" min={0} max={total} value={cashAmount}
              onChange={(e) => setCash(e.target.value)}
              data-testid="kiosk-mixed-cash"
              className="h-9 bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,25%,94%)]"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)]">Online ₹</span>
            <Input
              type="number" readOnly value={onlineAmount}
              data-testid="kiosk-mixed-online"
              className="h-9 bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,25%,94%)]"
            />
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-[11px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)]">Total</span>
        <span className="font-display font-extrabold text-2xl tabular-nums" data-testid="kiosk-total">₹{total}</span>
      </div>
      <Button
        onClick={onPlaceOrder}
        disabled={placing || !!pendingOrder}
        className="h-11 rounded-full bg-[hsl(26,43%,57%)] hover:bg-[hsl(26,43%,62%)] text-white font-extrabold text-base"
        data-testid="kiosk-place-order"
      >
        {placing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShoppingCart className="h-4 w-4 mr-2" />}
        Place order
      </Button>
      <Button onClick={onResetForm} variant="ghost" className="text-[hsl(40,15%,70%)] hover:text-white text-xs h-8" data-testid="kiosk-order-reset">
        <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
      </Button>

      {lastOrder && !pendingOrder && (
        <div className="rounded-xl border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-emerald-100" data-testid="kiosk-last-order">
          <p className="text-[10px] tracking-[0.18em] uppercase font-bold opacity-85">Last order</p>
          <p className="text-xs mt-0.5 font-mono break-all">{lastOrder.order_id}</p>
          <p className="text-xs">{lastOrder.qty} × {lastOrder.menu_text?.slice(0, 60)}{lastOrder.menu_text?.length > 60 ? "…" : ""} · ₹{lastOrder.total}</p>
          {receipt && (
            <button type="button" onClick={onReopenReceipt}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white px-3 h-7 text-[11px] font-extrabold hover:bg-emerald-500"
              data-testid="kiosk-reprint">Re-open receipt</button>
          )}
        </div>
      )}
    </div>
  );
}
