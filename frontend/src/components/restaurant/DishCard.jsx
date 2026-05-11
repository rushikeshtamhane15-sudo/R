import React from "react";
import { Plus, Minus, ArrowRight, Tag } from "lucide-react";
import { Button } from "../ui/button";
import { CATEGORY_ICON } from "./CategoryStrip";

/**
 * Single menu item card — 3D depth, glassmorphism category badge, qty controls.
 * Pure presentational: all interactions (add/sub/buy/setQty) bubble up via
 * the supplied callbacks so the parent owns cart state.
 */
export default function DishCard({ it, qty, theme, idx, onAdd, onSub, onChangeQty, onBuy }) {
  const hasDiscount = it.discounted_price != null && it.discounted_price < it.price;
  const CatIcon = CATEGORY_ICON(it.category);
  return (
    <li
      className="dish-card-3d dish-rise rounded-2xl border border-border bg-card overflow-hidden flex flex-col"
      style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
      data-testid={`item-${it.id}`}
    >
      <div className="dish-image-3d relative aspect-square w-full bg-muted">
        <img src={it.image_url} alt={it.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        <span
          className="absolute top-1.5 right-1.5 z-[3] inline-flex h-7 w-7 items-center justify-center rounded-full backdrop-blur bg-white/55 border border-white/60 text-emerald-700 shadow-md dark:bg-black/35 dark:text-emerald-200 dark:border-white/15"
          aria-hidden
          data-testid={`item-cat-icon-${it.id}`}
        >
          <CatIcon className="h-3.5 w-3.5" strokeWidth={2.4} />
        </span>
        {hasDiscount && (
          <span className="absolute top-1.5 left-1.5 z-[3] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold tracking-overline uppercase shadow">
            <Tag className="h-2.5 w-2.5" /> {Math.round(((it.price - it.discounted_price) / it.price) * 100)}%
          </span>
        )}
      </div>

      <div className="p-2.5 sm:p-3 flex flex-col gap-1.5">
        <p className="text-[9px] tracking-overline uppercase font-bold text-secondary leading-none">{it.category}</p>
        <h3 className="font-display font-extrabold text-sm sm:text-base leading-tight line-clamp-1" data-testid={`item-name-${it.id}`}>
          {it.name}
        </h3>
        <span
          className="inline-flex items-center gap-0.5 text-[8px] sm:text-[9px] font-extrabold tracking-wide uppercase rounded px-1.5 py-0.5"
          style={{
            color: theme?.item_promise_text_color || "#065f46",
            backgroundColor: theme?.item_promise_bg_color || "#d1fae5",
          }}
          data-testid={`item-90min-${it.id}`}
        >
          ⏱ {theme?.item_promise_label || "90-min fresh"}
        </span>
        <p className="text-[12px] sm:text-[13px] text-muted-foreground line-clamp-3 min-h-[3lh] leading-snug">
          {it.description || `Freshly prepared ${(it.name || "").toLowerCase()} · made daily in our kitchen.`}
        </p>

        <div className="flex items-end justify-between gap-2 mt-1">
          {hasDiscount && <p className="text-[10px] line-through text-muted-foreground tabular-nums">₹{it.price}</p>}
          <p
            className="font-display font-extrabold text-base text-primary tabular-nums ml-auto"
            data-testid={`item-price-${it.id}`}
          >
            ₹{it.discounted_price ?? it.price}
          </p>
        </div>

        <div className="flex items-center gap-1.5 mt-1.5">
          {qty === 0 ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onAdd(it)} data-testid={`add-${it.id}`} className="rounded-full h-7 text-[11px] sm:text-xs flex-1 px-2">
                <Plus className="h-3 w-3 mr-0.5" /> Add
              </Button>
              <Button size="sm" onClick={() => onBuy(it)} data-testid={`buy-now-${it.id}`} className="rounded-full h-7 text-[11px] sm:text-xs flex-1 px-2 bg-primary hover:bg-primary/90">
                Buy <ArrowRight className="h-3 w-3 ml-0.5" />
              </Button>
            </>
          ) : (
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background overflow-hidden mx-auto" data-testid={`qty-controls-${it.id}`}>
              <button type="button" className="h-7 w-7 flex items-center justify-center hover:bg-muted" onClick={() => onSub(it)} aria-label="Decrease" data-testid={`dec-${it.id}`}>
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                value={qty}
                onChange={(e) => onChangeQty(it, e.target.value)}
                className="w-8 h-7 text-center bg-transparent text-xs font-bold focus:outline-none tabular-nums"
                data-testid={`qty-${it.id}`}
                min={0}
                max={50}
              />
              <button type="button" className="h-7 w-7 flex items-center justify-center hover:bg-muted" onClick={() => onAdd(it)} aria-label="Increase" data-testid={`inc-${it.id}`}>
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
