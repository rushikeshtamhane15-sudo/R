import React from "react";
import { Link } from "react-router-dom";
import { Plus, Minus, Trash2, Pencil } from "lucide-react";
import { PORTION_LABEL, PORTION_MULTIPLIER } from "../../lib/cart";

/**
 * CheckoutCartLine — single row inside the cart panel on /restaurant/checkout.
 *
 * Pure presentational: parent owns cart state and passes onAdd / onSub /
 * onChangeQty / onRemove / onChangeVariant handlers. Variant-edit popover is
 * controlled by `variantEditOpen` (line-key string) + `setVariantEditOpen`.
 *
 * Extracted from RestaurantCheckout.jsx to keep that page under 400 lines.
 */
export default function CheckoutCartLine({
  line, lk, variantEditOpen, setVariantEditOpen,
  onAdd, onSub, onChangeQty, onRemove, onChangeVariant,
}) {
  const l = line;
  const showVariant = l.variant && l.variant !== "regular";
  return (
    <li className="p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:items-center" data-testid={`checkout-line-${lk}`}>
      <div className="flex gap-3 items-center flex-1 min-w-0">
        <img src={l.image_url} alt={l.name} className="h-14 w-14 rounded-xl object-cover flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-tight truncate text-sm flex items-center gap-1.5" data-testid={`checkout-line-name-${lk}`}>
            <span className="truncate">{l.name}</span>
            {showVariant && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-extrabold tracking-wide uppercase bg-primary/10 text-primary align-middle flex-shrink-0">
                {l.variant_label || l.variant} · {l.portion_multiplier}×
              </span>
            )}
            <span className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setVariantEditOpen((cur) => (cur === lk ? null : lk))}
                className="inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10"
                aria-label="Edit portion"
                data-testid={`co-edit-variant-${lk}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
              {variantEditOpen === lk && (
                <div
                  className="absolute z-30 top-7 left-0 surface-3d bg-card border border-border rounded-xl p-1.5 flex flex-col gap-0.5 min-w-[140px]"
                  data-testid={`co-variant-popover-${lk}`}
                >
                  {Object.keys(PORTION_LABEL).map((v) => {
                    const active = l.variant === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          onChangeVariant(l, v);
                          setVariantEditOpen(null);
                        }}
                        className={`text-left px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-between gap-2 ${active ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}
                        data-testid={`co-variant-option-${lk}-${v}`}
                      >
                        <span>{PORTION_LABEL[v]}</span>
                        <span className="text-[10px] tabular-nums opacity-70">{PORTION_MULTIPLIER[v]}×</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">₹{l.unit} × {l.qty} = <span className="font-bold tabular-nums text-foreground">₹{l.line_total.toFixed(0)}</span></p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 sm:gap-3 sm:justify-end flex-shrink-0">
        <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background overflow-hidden">
          <button type="button" className="h-8 w-8 flex items-center justify-center hover:bg-muted" onClick={() => onSub(l)} aria-label="Decrease" data-testid={`co-dec-${lk}`}>
            <Minus className="h-3.5 w-3.5" />
          </button>
          <input
            type="number"
            value={l.qty}
            onChange={(e) => onChangeQty(l, e.target.value)}
            className="w-9 h-8 text-center bg-transparent text-xs font-bold focus:outline-none tabular-nums"
            data-testid={`co-qty-${lk}`}
            min={0}
            max={50}
          />
          <button type="button" className="h-8 w-8 flex items-center justify-center hover:bg-muted" onClick={() => onAdd(l)} aria-label="Increase" data-testid={`co-inc-${lk}`}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <button type="button" onClick={() => onRemove(l)} className="text-muted-foreground hover:text-destructive p-1.5" aria-label="Remove" data-testid={`co-remove-${lk}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

/** Empty-cart placeholder shown when `priced.lines.length === 0`. */
export function CheckoutEmptyCart() {
  return (
    <div className="p-8 text-center text-muted-foreground text-sm">
      Cart is empty. <Link to="/" className="text-primary font-semibold underline-offset-2 hover:underline">Browse the menu</Link>.
    </div>
  );
}
