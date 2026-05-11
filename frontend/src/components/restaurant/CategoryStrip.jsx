import React from "react";

// Map a free-form menu category string → a vivid food emoji rendered at a
// chunky size, wrapped in our 3D pill (.cat-icon-3d). Falls back to the All
// emoji 🍽 when nothing matches.
//
// Why emojis over Lucide icons? They ship native colour glyphs across every
// modern OS (Apple emoji, Segoe, Noto) — which gives the icons a genuine
// "3D plate" feel for free, no asset pipeline required. Combined with the
// .cat-icon-3d-img treatment (chunky drop-shadow + tilt + reflection), the
// overall strip reads as a row of small floating plates.
export const CATEGORY_EMOJI = (cat) => {
  const s = (cat || "").toLowerCase();
  if (s === "all") return "🍽️";
  if (/(rice|biryani|pulao|pulav)/.test(s)) return "🍚";
  if (/(roti|naan|bread|paratha|kulcha)/.test(s)) return "🫓";
  if (/(dal|curry|sabzi|gravy)/.test(s)) return "🍲";
  if (/(main)/.test(s)) return "🍛";
  if (/(salad|raita)/.test(s)) return "🥗";
  if (/(sweet|dessert|halwa|kheer|gulab|jamun)/.test(s)) return "🍰";
  if (/(ice)/.test(s)) return "🍨";
  if (/(drink|juice|lassi|water|beverage|soda)/.test(s)) return "🥤";
  if (/(tea|coffee|chai)/.test(s)) return "☕";
  if (/(snack|chaat|starter|appet|kebab|tikka)/.test(s)) return "🥟";
  if (/(thali|combo|special|meal|tiffin)/.test(s)) return "🍱";
  if (/(pizza)/.test(s)) return "🍕";
  if (/(fruit)/.test(s)) return "🍎";
  if (/(veg)/.test(s)) return "🥦";
  return "🍽️";
};

// Legacy Lucide export kept for callers (DishCard imports CATEGORY_ICON to
// render the small glassmorphism badge on each dish image). We map it onto
// the emoji-aware Lucide-fallback used previously so existing imports still
// work without churning the rest of the codebase.
import {
  UtensilsCrossed, Soup, IceCream, Wheat, CupSoda, Cookie, Salad, Coffee, Pizza, Apple, Sandwich,
} from "lucide-react";
export const CATEGORY_ICON = (cat) => {
  const s = (cat || "").toLowerCase();
  if (s === "all") return UtensilsCrossed;
  if (/(rice|biryani|pulao|pulav)/.test(s)) return Wheat;
  if (/(roti|naan|bread|paratha|kulcha)/.test(s)) return Sandwich;
  if (/(dal|curry|sabzi|gravy|main)/.test(s)) return Soup;
  if (/(salad|raita|veg)/.test(s)) return Salad;
  if (/(sweet|dessert|kheer|halwa|ice)/.test(s)) return IceCream;
  if (/(drink|juice|lassi|water|beverage|soda)/.test(s)) return CupSoda;
  if (/(snack|chaat|starter|appet)/.test(s)) return Cookie;
  if (/(tea|coffee|chai)/.test(s)) return Coffee;
  if (/(thali|combo|special|meal)/.test(s)) return UtensilsCrossed;
  if (/(pizza)/.test(s)) return Pizza;
  if (/(fruit)/.test(s)) return Apple;
  return UtensilsCrossed;
};

/**
 * Sticky horizontal category navigation. Each chip pairs a big floating
 * "3D plate" emoji with a small label below. Active state lifts + tints
 * the plate.
 */
export default function CategoryStrip({ categories, activeCat, onChange }) {
  return (
    <div
      className="sticky top-[58px] z-10 -mx-3 sm:-mx-5 px-3 sm:px-5 pt-3 pb-3 bg-background/95 backdrop-blur border-b border-border overflow-x-auto no-scrollbar"
      data-testid="restaurant-categories"
    >
      <ul className="flex items-end gap-4 min-w-max">
        {categories.map((c) => {
          const isActive = activeCat === c;
          return (
            <li key={c} className="flex-shrink-0">
              <button
                onClick={() => onChange(c)}
                className="cat-chip-3d group flex flex-col items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl px-1 pt-1 pb-1"
                data-active={isActive}
                data-testid={`cat-${c.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <span
                  className="cat-icon-3d cat-icon-3d-img"
                  aria-hidden
                  data-testid={`cat-icon-${c.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <span className="cat-emoji-3d">{CATEGORY_EMOJI(c)}</span>
                </span>
                <span
                  className={`text-[10px] sm:text-[11px] font-bold tracking-overline uppercase whitespace-nowrap leading-none ${
                    isActive ? "text-primary" : "text-foreground/80 group-hover:text-foreground"
                  }`}
                >
                  {c}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
