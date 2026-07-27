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
  { id: "online", label: "UPI QR",    icon: ScanLine },
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
    <div className="rounded-2xl bg-white border border-black/8 p-4 flex flex-col gap-3 shadow-sm text-foreground" data-testid="kiosk-order-form">
      {active.lunch && active.dinner && (
        <div className="inline-flex rounded-full bg-muted p-1 gap-1 self-start">
          <button type="button" onClick={() => setOrderMeal("lunch")} data-testid="kiosk-order-meal-lunch"
            className={`px-5 h-10 rounded-full text-sm font-extrabold ${orderMeal === "lunch" ? "bg-amber-500 text-white" : "text-muted-foreground"}`}>Lunch</button>
          <button type="button" onClick={() => setOrderMeal("dinner")} data-testid="kiosk-order-meal-dinner"
            className={`px-5 h-10 rounded-full text-sm font-extrabold ${orderMeal === "dinner" ? "bg-blue-600 text-white" : "text-muted-foreground"}`}>Dinner</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {SERVICE_TABS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setServiceSafe(s.id)}
            data-testid={`kiosk-svc-${s.id}`}
            className={`rounded-xl px-2 py-3 inline-flex flex-col items-center gap-1 text-sm font-extrabold tracking-wide border-2 transition-colors ${service === s.id ? "bg-primary text-white border-primary" : "bg-muted/60 border-black/10 text-foreground hover:border-primary/40"}`}
          >
            <s.icon className="h-5 w-5" />
            {s.label}
            <span className="tabular-nums text-xs opacity-90">₹{priceFor(s.id)}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2">
        <span className="text-xs tracking-[0.18em] uppercase font-bold text-muted-foreground">Quantity</span>
        <div className="inline-flex items-center rounded-full bg-white ring-1 ring-black/10">
          <button type="button" onClick={() => setQtySafe((q) => Math.max(1, q - 1))} className="h-11 w-11 inline-flex items-center justify-center text-foreground" data-testid="kiosk-qty-dec"><Minus className="h-5 w-5" /></button>
          <span className="px-5 text-2xl font-extrabold tabular-nums text-foreground" data-testid="kiosk-qty">{qty}</span>
          <button type="button" onClick={() => setQtySafe((q) => Math.min(20, q + 1))} className="h-11 w-11 inline-flex items-center justify-center text-foreground" data-testid="kiosk-qty-inc"><Plus className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {PAY_TABS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPaymentMethod(p.id)}
            data-testid={`kiosk-pay-${p.id}`}
            className={`rounded-xl px-2 py-3 inline-flex flex-col items-center justify-center gap-1 text-xs font-extrabold tracking-wide border-2 transition-colors ${paymentMethod === p.id ? "bg-primary text-white border-primary" : "bg-muted/60 border-black/10 text-foreground hover:border-primary/40"}`}
          >
            <p.icon className="h-4 w-4" /> {p.label}
          </button>
        ))}
      </div>

      {paymentMethod === "mixed" && (
        <div className="grid grid-cols-2 gap-2" data-testid="kiosk-mixed-amounts">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Cash ₹</span>
            <Input
              type="number" min={0} max={total} value={cashAmount}
              onChange={(e) => setCash(e.target.value)}
              data-testid="kiosk-mixed-cash"
              className="h-10 bg-white border-black/15 text-foreground"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Online ₹</span>
            <Input
              type="number" readOnly value={onlineAmount}
              data-testid="kiosk-mixed-online"
              className="h-10 bg-white border-black/15 text-foreground"
            />
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-sm tracking-[0.18em] uppercase font-bold text-muted-foreground">Total</span>
        <span className="font-display font-extrabold text-4xl tabular-nums text-primary" data-testid="kiosk-total">₹{total}</span>
      </div>
      <Button
        onClick={onPlaceOrder}
        disabled={placing || !!pendingOrder}
        className="h-14 rounded-full bg-primary hover:bg-primary/90 text-white font-extrabold text-lg"
        data-testid="kiosk-place-order"
      >
        {placing ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <ShoppingCart className="h-5 w-5 mr-2" />}
        Place order
      </Button>
      <Button onClick={onResetForm} variant="ghost" className="text-muted-foreground hover:text-primary text-sm h-9" data-testid="kiosk-order-reset">
        <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
      </Button>

      {lastOrder && !pendingOrder && (
        <div className="rounded-xl border border-emerald-500 bg-emerald-50 px-3 py-2 text-emerald-900" data-testid="kiosk-last-order">
          <p className="text-[10px] tracking-[0.18em] uppercase font-bold">Last order</p>
          <p className="text-xs mt-0.5 font-mono break-all">{lastOrder.order_id}</p>
          <p className="text-sm">{lastOrder.qty} × {lastOrder.menu_text?.slice(0, 60)}{lastOrder.menu_text?.length > 60 ? "…" : ""} · ₹{lastOrder.total}</p>
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
