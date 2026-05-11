import React from "react";
import { Plus, Minus, Tag, ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { CATEGORY_ICON } from "./CategoryStrip";

/**
 * Menu item card — 2-column layout, vertically compact.
 * Layout rules requested by user:
 *   • Two cards per row (parent grid handles this).
 *   • Card is shorter vertically — short image, tight gaps, all info still visible.
 *   • Price sits on the LEFT of the card.
 *   • Add + Buy buttons sit centered horizontally on a row of their own.
 */
export default function DishCard({ it, qty, theme, idx, onAdd, onSub, onBuy }) {
  const hasDiscount = it.discounted_price != null && it.discounted_price < it.price;
  const CatIcon = CATEGORY_ICON(it.category);
  const price = it.discounted_price ?? it.price;
  return (
    <li
      className="dish-card-3d dish-rise rounded-2xl border border-border bg-card overflow-hidden flex flex-col"
      style={{ animationDelay: `${Math.min(idx, 12) * 35}ms` }}
      data-testid={`item-${it.id}`}
      title={it.name}
    >
      {/* Shorter wide image — 5:2 keeps the rhythm but cuts ~30% vertical height */}
      <div className="dish-image-3d relative aspect-[5/2] w-full bg-muted">
        <img
          src={it.image_url}
          alt={it.name}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
        <span
          className="absolute top-1 right-1 z-[3] inline-flex h-6 w-6 items-center justify-center rounded-full backdrop-blur bg-white/55 border border-white/60 text-emerald-700 shadow-md dark:bg-black/35 dark:text-emerald-200 dark:border-white/15"
          aria-hidden
          data-testid={`item-cat-icon-${it.id}`}
        >
          <CatIcon className="h-3 w-3" strokeWidth={2.4} />
        </span>
        {hasDiscount && (
          <span className="absolute top-1 left-1 z-[3] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold tracking-overline uppercase shadow">
            <Tag className="h-2.5 w-2.5" /> {Math.round(((it.price - it.discounted_price) / it.price) * 100)}%
          </span>
        )}
      </div>

      {/* Body — tight vertical rhythm */}
      <div className="px-2.5 pt-2 pb-2.5 sm:px-3 sm:pt-2.5 sm:pb-3 flex flex-col gap-1">
        {/* Title + 90-min chip on the same line to save vertical space */}
        <div className="flex items-center gap-1.5">
          <h3
            className="font-display font-extrabold text-sm leading-tight line-clamp-1 flex-1 min-w-0"
            data-testid={`item-name-${it.id}`}
          >
            {it.name}
          </h3>
          <span
            className="inline-flex items-center gap-0.5 text-[8px] sm:text-[9px] font-extrabold tracking-wide uppercase rounded px-1 py-[1px] flex-shrink-0"
            style={{
              color: theme?.item_promise_text_color || "#065f46",
              backgroundColor: theme?.item_promise_bg_color || "#d1fae5",
            }}
            data-testid={`item-90min-${it.id}`}
          >
            ⏱ {theme?.item_promise_label || "90-min"}
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground line-clamp-1 leading-snug">
          {it.description || `Freshly prepared ${(it.name || "").toLowerCase()}.`}
        </p>

        {/* Price — LEFT-aligned on its own row */}
        <p
          className="font-display font-extrabold text-base text-primary tabular-nums leading-none mt-1 self-start"
          data-testid={`item-price-${it.id}`}
        >
          ₹{price}
          {hasDiscount && (
            <span className="ml-1.5 text-[10px] line-through text-muted-foreground tabular-nums font-normal">₹{it.price}</span>
          )}
        </p>

        {/* Action row — Add + Buy centered horizontally */}
        <div className="flex items-center justify-center gap-1.5 mt-1.5">
          {qty === 0 ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAdd(it)}
                data-testid={`add-${it.id}`}
                className="rounded-full h-7 text-[11px] px-3"
              >
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
              <Button
                size="sm"
                onClick={() => onBuy(it)}
                data-testid={`buy-now-${it.id}`}
                className="rounded-full h-7 text-[11px] px-3 bg-primary hover:bg-primary/90"
              >
                Buy <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </>
          ) : (
            <div
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background overflow-hidden h-7"
              data-testid={`qty-controls-${it.id}`}
            >
              <button
                type="button"
                className="h-7 w-7 flex items-center justify-center hover:bg-muted"
                onClick={() => onSub(it)}
                aria-label="Decrease"
                data-testid={`dec-${it.id}`}
              >
                <Minus className="h-3 w-3" />
              </button>
              <span
                className="min-w-[1.4rem] text-center text-[11px] font-bold tabular-nums"
                data-testid={`qty-${it.id}`}
              >
                {qty}
              </span>
              <button
                type="button"
                className="h-7 w-7 flex items-center justify-center hover:bg-muted"
                onClick={() => onAdd(it)}
                aria-label="Increase"
                data-testid={`inc-${it.id}`}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
