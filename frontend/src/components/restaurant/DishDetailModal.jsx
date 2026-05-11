import React, { useEffect, useMemo, useState } from "react";
import { X, Plus, Minus, ArrowRight, Sparkles, Wheat, Soup, Salad, Flame, Leaf } from "lucide-react";
import { Button } from "../ui/button";

/**
 * Dish detail modal — opens when a user taps a dish image on /restaurant.
 *
 * Shows:
 *   • Big hero image + category chip
 *   • Full name + freshness pill
 *   • Long description (vs. the 1-line teaser on the card)
 *   • Ingredient highlights (derived from name/category keywords — best-effort
 *     since menu items don't carry an explicit ingredients list yet)
 *   • Portion-size selector (Regular / Large = 2 portions / Family = 4 portions).
 *     Selected portion drives the qty added to cart.
 *   • Final Add-to-cart + Buy-now CTAs
 *
 * Stays purely presentational; cart mutation flows back through onAdd / onBuy
 * so the parent owns state.
 */
const PORTION_MULTIPLIERS = [
  { id: "regular", label: "Regular", portions: 1, sub: "1 person" },
  { id: "large",   label: "Large",   portions: 2, sub: "2 portions"  },
  { id: "family",  label: "Family",  portions: 4, sub: "4 portions"  },
];

// Best-effort ingredient hints based on category + name keywords. Until we
// add a real ingredients field on menu items this surfaces something useful
// instead of an empty section.
function deriveIngredients(it) {
  const s = `${it.name || ""} ${it.category || ""} ${it.description || ""}`.toLowerCase();
  const hints = [];
  if (/biryani|pulao|rice/.test(s)) hints.push({ icon: Wheat,  label: "Premium aged basmati" });
  if (/roti|naan|bread|paratha/.test(s)) hints.push({ icon: Wheat,  label: "Chakki atta · stone-ground" });
  if (/paneer/.test(s)) hints.push({ icon: Leaf,   label: "Fresh-set paneer" });
  if (/butter|makhani|cream/.test(s)) hints.push({ icon: Soup,   label: "Slow-simmered tomato cream" });
  if (/dal|lentil|tadka/.test(s)) hints.push({ icon: Soup,   label: "Unpolished toor / urad dal" });
  if (/tandoor|tikka|kebab|grill/.test(s)) hints.push({ icon: Flame,  label: "Tandoor-charred · smoky" });
  if (/salad|raita|chutney/.test(s)) hints.push({ icon: Salad,  label: "Fresh-cut daily" });
  if (/sweet|halwa|gulab|jamun|kheer/.test(s)) hints.push({ icon: Sparkles, label: "Khoya · cardamom syrup" });
  if (/spice|masala|curry/.test(s) && hints.length < 3) hints.push({ icon: Soup, label: "Real ghar-style spices" });
  // Always finish with a brand promise
  hints.push({ icon: Leaf, label: "Filter / cold-pressed oil" });
  // Dedup labels
  const seen = new Set();
  return hints.filter((h) => (seen.has(h.label) ? false : seen.add(h.label))).slice(0, 5);
}

export default function DishDetailModal({ open, item, onClose, onAdd, onBuy }) {
  const [portion, setPortion] = useState("regular");
  // Reset portion choice when a new item is opened
  useEffect(() => { if (open) setPortion("regular"); }, [open, item?.id]);

  // Close on Escape key for keyboard users
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const ingredients = useMemo(() => (item ? deriveIngredients(item) : []), [item]);
  if (!open || !item) return null;

  const unit = item.discounted_price ?? item.price;
  const selected = PORTION_MULTIPLIERS.find((p) => p.id === portion) || PORTION_MULTIPLIERS[0];
  const totalPrice = unit * selected.portions;

  const handleAdd = () => {
    // Add a single line of the selected variant. cart.bumpQty handles the
    // variant-aware composite key — Regular + Large coexist as separate lines.
    onAdd(item, selected.id);
    onClose();
  };
  const handleBuy = () => {
    // Skip cart — go straight to checkout with the chosen variant so the
    // receipt shows "Butter Chicken · Large" and pricing is correct.
    onBuy(item, selected.id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
      data-testid="dish-detail-modal"
      onClick={onClose}
    >
      <div
        className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl border border-border animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
      >
        {/* Image hero */}
        <div className="relative aspect-[16/9] w-full bg-muted">
          <img src={item.image_url} alt={item.name} className="absolute inset-0 w-full h-full object-cover" />
          <button
            type="button"
            onClick={onClose}
            className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/95 hover:bg-background shadow-md flex items-center justify-center"
            aria-label="Close"
            data-testid="dish-modal-close"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/95 text-emerald-700 text-[10px] font-extrabold tracking-overline uppercase shadow">
            {item.category}
          </span>
        </div>

        <div className="px-4 sm:px-5 py-4 sm:py-5 space-y-4">
          {/* Title + freshness */}
          <div>
            <h2
              className="font-display font-extrabold text-xl sm:text-2xl tracking-tight leading-tight"
              data-testid="dish-modal-title"
            >
              {item.name}
            </h2>
            <p className="mt-1 text-xs font-extrabold text-emerald-700 inline-flex items-center gap-1">
              ⏱ 90-min fresh delivery
            </p>
          </div>

          {/* Full description */}
          <p className="text-sm text-foreground/85 leading-relaxed" data-testid="dish-modal-description">
            {item.description || `Freshly prepared ${(item.name || "").toLowerCase()} · made daily in our kitchen with real ghar-style spices and no shortcuts.`}
          </p>

          {/* Ingredient highlights */}
          <section data-testid="dish-modal-ingredients">
            <p className="text-[10px] tracking-overline uppercase font-bold text-secondary mb-1.5">Ingredient highlights</p>
            <ul className="grid grid-cols-2 gap-1.5">
              {ingredients.map((ing, i) => (
                <li
                  key={ing.label}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1.5 text-[11px] font-semibold text-emerald-900 dark:text-emerald-200"
                  data-testid={`dish-ingredient-${i}`}
                >
                  <ing.icon className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300 flex-shrink-0" />
                  <span className="truncate">{ing.label}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Portion-size selector */}
          <section data-testid="dish-modal-portions">
            <p className="text-[10px] tracking-overline uppercase font-bold text-secondary mb-1.5">Portion size</p>
            <div className="grid grid-cols-3 gap-1.5">
              {PORTION_MULTIPLIERS.map((p) => {
                const active = portion === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPortion(p.id)}
                    className={`rounded-xl border px-2 py-2 text-center transition-all ${active ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "border-border bg-background hover:border-primary/40"}`}
                    data-testid={`dish-portion-${p.id}`}
                    aria-pressed={active}
                  >
                    <p className={`text-xs font-extrabold ${active ? "text-primary" : "text-foreground"}`}>{p.label}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{p.sub}</p>
                    <p className={`text-[11px] tabular-nums font-bold mt-0.5 ${active ? "text-primary" : "text-foreground"}`}>
                      ₹{unit * p.portions}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Bottom CTA — sticky-ish, full width */}
          <div className="flex items-center gap-2 pt-1">
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground leading-none">Total</p>
              <p className="font-display font-extrabold text-xl text-primary tabular-nums leading-tight" data-testid="dish-modal-total">
                ₹{totalPrice}
              </p>
            </div>
            <Button
              onClick={handleAdd}
              variant="outline"
              className="rounded-full"
              data-testid="dish-modal-add"
            >
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
            <Button
              onClick={handleBuy}
              className="rounded-full bg-primary hover:bg-primary/90"
              data-testid="dish-modal-buy"
            >
              Buy now <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
