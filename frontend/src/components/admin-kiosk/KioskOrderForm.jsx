// AdminKiosk — BOTTOM right: order form (meal/service/qty/payment/total/place).
// iter-133b: `isFullscreen` prop scales typography + control sizes so the
// order form is legible on a wall-mounted 27" portrait tablet viewed from ~5ft.
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
  isFullscreen = false,
}) {
  // Size-scale utility bundles — one for the phone-sized admin view, one for
  // the wall-kiosk fullscreen route where everything must be readable at ~5ft.
  const S = isFullscreen
    ? {
        wrap: "rounded-3xl bg-white border border-black/8 p-6 flex flex-col gap-4 shadow-md text-foreground h-full",
        mealBtn: "px-8 h-14 rounded-full text-xl font-extrabold",
        svcBtn: "rounded-2xl px-3 py-5 text-2xl font-extrabold border-2 gap-2",
        svcIcon: "h-8 w-8",
        svcPrice: "text-base",
        qtyLabel: "text-base tracking-[0.18em] uppercase font-bold text-muted-foreground",
        qtyBtn: "h-16 w-16 text-3xl",
        qtyIcon: "h-7 w-7",
        qtyNum: "px-8 text-5xl font-extrabold tabular-nums text-foreground",
        payBtn: "rounded-2xl px-3 py-4 text-lg font-extrabold border-2 gap-2",
        payIcon: "h-6 w-6",
        mixedLbl: "text-xs tracking-[0.18em] uppercase font-bold text-muted-foreground",
        mixedInput: "h-14 text-2xl bg-white border-black/15 text-foreground",
        totalLbl: "text-lg tracking-[0.18em] uppercase font-bold text-muted-foreground",
        totalVal: "font-display font-extrabold text-6xl tabular-nums text-primary",
        placeBtn: "h-20 rounded-full bg-primary hover:bg-primary/90 text-white font-extrabold text-3xl",
        placeIcon: "h-8 w-8 mr-3",
        resetBtn: "text-muted-foreground hover:text-primary text-base h-12",
      }
    : {
        wrap: "rounded-2xl bg-white border border-black/8 p-4 flex flex-col gap-3 shadow-sm text-foreground",
        mealBtn: "px-5 h-10 rounded-full text-sm font-extrabold",
        svcBtn: "rounded-xl px-2 py-3 text-sm font-extrabold border-2 gap-1",
        svcIcon: "h-5 w-5",
        svcPrice: "text-xs",
        qtyLabel: "text-xs tracking-[0.18em] uppercase font-bold text-muted-foreground",
        qtyBtn: "h-11 w-11",
        qtyIcon: "h-5 w-5",
        qtyNum: "px-5 text-2xl font-extrabold tabular-nums text-foreground",
        payBtn: "rounded-xl px-2 py-3 text-xs font-extrabold border-2 gap-1",
        payIcon: "h-4 w-4",
        mixedLbl: "text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground",
        mixedInput: "h-10 bg-white border-black/15 text-foreground",
        totalLbl: "text-sm tracking-[0.18em] uppercase font-bold text-muted-foreground",
        totalVal: "font-display font-extrabold text-4xl tabular-nums text-primary",
        placeBtn: "h-14 rounded-full bg-primary hover:bg-primary/90 text-white font-extrabold text-lg",
        placeIcon: "h-5 w-5 mr-2",
        resetBtn: "text-muted-foreground hover:text-primary text-sm h-9",
      };

  if (!active) {
    return (
      <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-6 text-sm text-[hsl(40,15%,70%)] text-center">
        Menu not published yet — switch days or check back shortly.
      </div>
    );
  }

  return (
    <div className={S.wrap} data-testid="kiosk-order-form">
      {active.lunch && active.dinner && (
        <div className="inline-flex rounded-full bg-muted p-1 gap-1 self-start">
          <button type="button" onClick={() => setOrderMeal("lunch")} data-testid="kiosk-order-meal-lunch"
            className={`${S.mealBtn} ${orderMeal === "lunch" ? "bg-amber-500 text-white" : "text-muted-foreground"}`}>Lunch</button>
          <button type="button" onClick={() => setOrderMeal("dinner")} data-testid="kiosk-order-meal-dinner"
            className={`${S.mealBtn} ${orderMeal === "dinner" ? "bg-blue-600 text-white" : "text-muted-foreground"}`}>Dinner</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {SERVICE_TABS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setServiceSafe(s.id)}
            data-testid={`kiosk-svc-${s.id}`}
            className={`${S.svcBtn} inline-flex flex-col items-center tracking-wide transition-colors ${service === s.id ? "bg-primary text-white border-primary" : "bg-muted/60 border-black/10 text-foreground hover:border-primary/40"}`}
          >
            <s.icon className={S.svcIcon} />
            {s.label}
            <span className={`tabular-nums opacity-90 ${S.svcPrice}`}>₹{priceFor(s.id)}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-2xl bg-muted/60 px-4 py-3">
        <span className={S.qtyLabel}>Quantity</span>
        <div className="inline-flex items-center rounded-full bg-white ring-1 ring-black/10">
          <button type="button" onClick={() => setQtySafe((q) => Math.max(1, q - 1))} className={`${S.qtyBtn} inline-flex items-center justify-center text-foreground`} data-testid="kiosk-qty-dec"><Minus className={S.qtyIcon} /></button>
          <span className={S.qtyNum} data-testid="kiosk-qty">{qty}</span>
          <button type="button" onClick={() => setQtySafe((q) => Math.min(20, q + 1))} className={`${S.qtyBtn} inline-flex items-center justify-center text-foreground`} data-testid="kiosk-qty-inc"><Plus className={S.qtyIcon} /></button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {PAY_TABS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPaymentMethod(p.id)}
            data-testid={`kiosk-pay-${p.id}`}
            className={`${S.payBtn} inline-flex flex-col items-center justify-center tracking-wide transition-colors ${paymentMethod === p.id ? "bg-primary text-white border-primary" : "bg-muted/60 border-black/10 text-foreground hover:border-primary/40"}`}
          >
            <p.icon className={S.payIcon} /> {p.label}
          </button>
        ))}
      </div>

      {paymentMethod === "mixed" && (
        <div className="grid grid-cols-2 gap-2" data-testid="kiosk-mixed-amounts">
          <label className="flex flex-col gap-0.5">
            <span className={S.mixedLbl}>Cash ₹</span>
            <Input
              type="number" min={0} max={total} value={cashAmount}
              onChange={(e) => setCash(e.target.value)}
              data-testid="kiosk-mixed-cash"
              className={S.mixedInput}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className={S.mixedLbl}>Online ₹</span>
            <Input
              type="number" readOnly value={onlineAmount}
              data-testid="kiosk-mixed-online"
              className={S.mixedInput}
            />
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-1">
        <span className={S.totalLbl}>Total</span>
        <span className={S.totalVal} data-testid="kiosk-total">₹{total}</span>
      </div>
      <Button
        onClick={onPlaceOrder}
        disabled={placing || !!pendingOrder}
        className={S.placeBtn}
        data-testid="kiosk-place-order"
      >
        {placing ? <Loader2 className={`${S.placeIcon} animate-spin`} /> : <ShoppingCart className={S.placeIcon} />}
        Place order
      </Button>
      <Button onClick={onResetForm} variant="ghost" className={S.resetBtn} data-testid="kiosk-order-reset">
        <RotateCcw className={`${isFullscreen ? "h-5 w-5 mr-2" : "h-4 w-4 mr-1.5"}`} /> Reset
      </Button>

      {lastOrder && !pendingOrder && (
        <div className="rounded-xl border border-emerald-500 bg-emerald-50 px-3 py-2 text-emerald-900" data-testid="kiosk-last-order">
          <p className={isFullscreen ? "text-xs tracking-[0.18em] uppercase font-bold" : "text-[10px] tracking-[0.18em] uppercase font-bold"}>Last order</p>
          <p className={`${isFullscreen ? "text-sm" : "text-xs"} mt-0.5 font-mono break-all`}>{lastOrder.order_id}</p>
          <p className={isFullscreen ? "text-base" : "text-sm"}>{lastOrder.qty} × {lastOrder.menu_text?.slice(0, 60)}{lastOrder.menu_text?.length > 60 ? "…" : ""} · ₹{lastOrder.total}</p>
          {receipt && (
            <button type="button" onClick={onReopenReceipt}
              className={`mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white ${isFullscreen ? "px-4 h-9 text-sm" : "px-3 h-7 text-[11px]"} font-extrabold hover:bg-emerald-500`}
              data-testid="kiosk-reprint">Re-open receipt</button>
          )}
        </div>
      )}
    </div>
  );
}
