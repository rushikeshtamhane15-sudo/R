import React from "react";
import { Plus, Minus, Tag } from "lucide-react";
import { CATEGORY_ICON } from "./CategoryStrip";

/**
 * Compact menu item card — tuned so a phone shows 3 cards per row and a
 * desktop shows up to 6, maximising at-a-glance discoverability.
 *
 * Design rules:
 *   • Square image keeps the rhythm visually predictable.
 *   • Title is single-line, ellipsised — full name is in the alt attribute.
 *   • Price + tiny round +/− pill stack inside one row.
 *   • Description is hidden on this tiny card; user can tap "Buy" or tap
 *     the cart to open a future detail sheet.
 */
export default function DishCard({ it, qty, theme, idx, onAdd, onSub, onBuy }) {
  const hasDiscount = it.discounted_price != null && it.discounted_price < it.price;
  const CatIcon = CATEGORY_ICON(it.category);
  const price = it.discounted_price ?? it.price;
  return (
    <li
      className="dish-card-3d dish-rise rounded-xl border border-border bg-card overflow-hidden flex flex-col"
      style={{ animationDelay: `${Math.min(idx, 12) * 30}ms` }}
      data-testid={`item-${it.id}`}
      title={it.name}
    >
      <div className="dish-image-3d relative aspect-square w-full bg-muted">
        <img
          src={it.image_url}
          alt={it.name}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
        <span
          className="absolute top-1 right-1 z-[3] inline-flex h-5 w-5 items-center justify-center rounded-full backdrop-blur bg-white/55 border border-white/60 text-emerald-700 shadow-sm dark:bg-black/35 dark:text-emerald-200 dark:border-white/15"
          aria-hidden
          data-testid={`item-cat-icon-${it.id}`}
        >
          <CatIcon className="h-2.5 w-2.5" strokeWidth={2.6} />
        </span>
        {hasDiscount && (
          <span className="absolute top-1 left-1 z-[3] inline-flex items-center gap-0.5 px-1 py-[1px] rounded-full bg-emerald-600 text-white text-[8px] font-bold tracking-wide uppercase shadow">
            <Tag className="h-2 w-2" />{Math.round(((it.price - it.discounted_price) / it.price) * 100)}%
          </span>
        )}
        {/* Price overlay — bottom-left, glassmorphism */}
        <span
          className="absolute bottom-1 left-1 z-[3] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md backdrop-blur bg-white/85 dark:bg-black/55 text-foreground font-display font-extrabold text-[11px] sm:text-xs tabular-nums shadow-sm"
          data-testid={`item-price-${it.id}`}
        >
          ₹{price}
          {hasDiscount && (
            <span className="text-[8px] line-through text-muted-foreground tabular-nums font-normal">₹{it.price}</span>
          )}
        </span>
      </div>

      {/* Body — kept intentionally tiny */}
      <div className="px-1.5 py-1.5 sm:px-2 sm:py-2 flex flex-col gap-1">
        <h3
          className="font-display font-bold text-[11px] sm:text-xs leading-tight line-clamp-1"
          data-testid={`item-name-${it.id}`}
        >
          {it.name}
        </h3>

        <div className="flex items-center justify-between gap-1.5">
          <span
            className="text-[8px] font-extrabold tracking-wide uppercase rounded px-1 py-[1px]"
            style={{
              color: theme?.item_promise_text_color || "#065f46",
              backgroundColor: theme?.item_promise_bg_color || "#d1fae5",
            }}
            data-testid={`item-90min-${it.id}`}
          >
            ⏱ {theme?.item_promise_label || "90-min"}
          </span>
          {qty === 0 ? (
            <button
              type="button"
              onClick={() => onAdd(it)}
              data-testid={`add-${it.id}`}
              className="inline-flex items-center gap-0.5 rounded-full h-6 px-2 text-[10px] font-bold bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition"
              aria-label={`Add ${it.name}`}
            >
              <Plus className="h-2.5 w-2.5" /> Add
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background h-6 overflow-hidden"
              data-testid={`qty-controls-${it.id}`}
            >
              <button
                type="button"
                className="h-6 w-6 flex items-center justify-center hover:bg-muted"
                onClick={() => onSub(it)}
                aria-label="Decrease"
                data-testid={`dec-${it.id}`}
              >
                <Minus className="h-2.5 w-2.5" />
              </button>
              <span
                className="min-w-[1.1rem] text-center text-[10px] font-bold tabular-nums"
                data-testid={`qty-${it.id}`}
              >
                {qty}
              </span>
              <button
                type="button"
                className="h-6 w-6 flex items-center justify-center hover:bg-muted"
                onClick={() => onAdd(it)}
                aria-label="Increase"
                data-testid={`inc-${it.id}`}
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onBuy(it)}
          data-testid={`buy-now-${it.id}`}
          className="text-[9px] font-bold uppercase tracking-wide text-primary hover:underline self-start"
        >
          Buy now →
        </button>
      </div>
    </li>
  );
}
