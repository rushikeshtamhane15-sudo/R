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
  customerName, setCustomerName,
  isFullscreen = false,
}) {
  // Size-scale utility bundles — one for the phone-sized admin view, one for
  // the wall-kiosk fullscreen route where everything must be readable at ~5ft.
  const S = isFullscreen
    ? {
        // iter-137.g/138.f — tight vertical footprint. Removed the h-full
        // stretch so the card sits at natural height (no whitespace below).
        wrap: "rounded-3xl bg-white border border-black/8 p-3 flex flex-col gap-2 shadow-md text-foreground",
        mealBtn: "px-6 h-11 rounded-full text-base font-extrabold",
        svcBtn: "rounded-2xl px-3 py-4 text-lg font-extrabold border-2 gap-1.5",
        svcIcon: "h-6 w-6",
        svcPrice: "text-sm",
        qtyLabel: "text-sm tracking-[0.18em] uppercase font-bold text-muted-foreground",
        qtyBtn: "h-12 w-12 text-2xl",
        qtyIcon: "h-5 w-5",
        qtyNum: "px-6 text-4xl font-extrabold tabular-nums text-foreground",
        payBtn: "rounded-2xl px-3 py-3 text-base font-extrabold border-2 gap-1.5",
        payIcon: "h-5 w-5",
        mixedLbl: "text-xs tracking-[0.18em] uppercase font-bold text-muted-foreground",
        mixedInput: "h-12 text-xl bg-white border-black/15 text-foreground",
        totalLbl: "text-base tracking-[0.18em] uppercase font-bold text-muted-foreground",
        totalVal: "font-display font-extrabold text-5xl tabular-nums text-primary",
        placeBtn: "h-16 rounded-full bg-primary hover:bg-primary/90 text-white font-extrabold text-2xl",
        placeIcon: "h-6 w-6 mr-2",
        resetBtn: "text-muted-foreground hover:text-primary text-sm h-10",
      }
    : {
        wrap: "rounded-2xl bg-white border border-black/8 p-3 flex flex-col gap-2 shadow-sm text-foreground",
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
      {/* iter-137.g — meal toggle hidden per user request; `orderMeal` still
          syncs automatically with the active IST slot so the correct meal is
          always billed. Left in JSX (hidden) so slot-close logic keeps a
          stable DOM anchor for existing e2e tests. */}
      {active.lunch && active.dinner && (
        <div className="hidden" aria-hidden data-testid="kiosk-order-meal-toggle">
          <button type="button" onClick={() => setOrderMeal("lunch")} data-testid="kiosk-order-meal-lunch" disabled={orderMeal !== "lunch"}>Lunch</button>
          <button type="button" onClick={() => setOrderMeal("dinner")} data-testid="kiosk-order-meal-dinner" disabled={orderMeal !== "dinner"}>Dinner</button>
        </div>
      )}

      <div className={isFullscreen ? "grid grid-cols-2 gap-6 flex-1 min-h-0" : "flex flex-col gap-3"}>
        {/* LEFT COL — Service + Quantity */}
        <div className="flex flex-col gap-3">
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

          {lastOrder && !pendingOrder && isFullscreen && (
            <div className="rounded-xl border border-emerald-500 bg-emerald-50 px-4 py-3 text-emerald-900 mt-auto" data-testid="kiosk-last-order">
              <p className="text-xs tracking-[0.18em] uppercase font-bold">Last order</p>
              <p className="text-sm mt-0.5 font-mono break-all">{lastOrder.order_id}</p>
              <p className="text-base">{lastOrder.qty} × {lastOrder.menu_text?.slice(0, 60)}{lastOrder.menu_text?.length > 60 ? "…" : ""} · ₹{lastOrder.total}</p>
              {receipt && (
                <button type="button" onClick={onReopenReceipt}
                  className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white px-4 h-9 text-sm font-extrabold hover:bg-emerald-500"
                  data-testid="kiosk-reprint">Re-open receipt</button>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COL — Payment + Total + Place order */}
        <div className="flex flex-col gap-3">
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
          {/* iter-137.a — optional customer name printed on the receipt. */}
          <label className="flex flex-col gap-1" data-testid="kiosk-customer-name-wrap">
            <span className={S.mixedLbl}>Customer name <span className="normal-case tracking-normal text-[10px] opacity-70">(optional · shows on receipt)</span></span>
            <Input
              type="text"
              value={customerName || ""}
              onChange={(e) => setCustomerName && setCustomerName(e.target.value)}
              placeholder="e.g. Rushikesh"
              maxLength={40}
              className={S.mixedInput}
              data-testid="kiosk-customer-name"
            />
          </label>
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
        </div>
      </div>

      {lastOrder && !pendingOrder && !isFullscreen && (
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
