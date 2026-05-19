import React from "react";
import { Truck, Wallet } from "lucide-react";

/**
 * BillSummary — totals breakdown shown above the sticky pay bar.
 * Pure presentational; parent owns the math.
 *
 * Extracted from RestaurantCheckout.jsx for readability.
 */
export default function BillSummary({ subtotal, deliveryFee, walletApplied, payable, freeOver }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5" data-testid="checkout-summary">
      <p className="font-display font-extrabold mb-3">Bill summary</p>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums" data-testid="sum-subtotal">₹{subtotal.toFixed(0)}</dd></div>
        <div className="flex justify-between text-muted-foreground">
          <dt className="flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" /> Delivery fee</dt>
          <dd className="tabular-nums" data-testid="sum-delivery">{deliveryFee === 0 ? "FREE" : `₹${deliveryFee.toFixed(0)}`}</dd>
        </div>
        {deliveryFee > 0 && (
          <p className="text-[11px] text-muted-foreground italic">
            Add ₹{(freeOver - subtotal).toFixed(0)} more for free delivery
          </p>
        )}
        {walletApplied > 0 && (
          <div className="flex justify-between text-emerald-700 dark:text-emerald-300" data-testid="sum-wallet-applied">
            <dt className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Wallet credit</dt>
            <dd className="tabular-nums">− ₹{walletApplied.toFixed(0)}</dd>
          </div>
        )}
        <div className="border-t border-border pt-2 mt-2 flex justify-between font-display font-extrabold text-lg">
          <dt>{walletApplied > 0 ? "Payable" : "Total"}</dt>
          <dd className="tabular-nums text-primary" data-testid="sum-total">₹{payable.toFixed(0)}</dd>
        </div>
      </dl>
    </section>
  );
}
