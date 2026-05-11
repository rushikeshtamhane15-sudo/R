import React from "react";
import {
  UtensilsCrossed, Soup, IceCream, Wheat, CupSoda, Cookie, Salad, Coffee, Pizza, Apple, Sandwich,
} from "lucide-react";

// Map a free-form menu category string → a crisp Lucide icon. Falls back to a
// generic utensil icon. Lowercased + simple regex match keeps it forgiving to
// admin-typed category names ("Mains", "main course", "Curry & Dal", etc.).
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
 * Sticky horizontal category navigation — each chip pairs a crisp Lucide
 * line icon (inside our 3D pill) with a small label below.
 */
export default function CategoryStrip({ categories, activeCat, onChange }) {
  return (
    <div
      className="sticky top-[58px] z-10 -mx-3 sm:-mx-5 px-3 sm:px-5 pt-3 pb-3 bg-background/95 backdrop-blur border-b border-border overflow-x-auto no-scrollbar"
      data-testid="restaurant-categories"
    >
      <ul className="flex items-end gap-3 min-w-max">
        {categories.map((c) => {
          const Icon = CATEGORY_ICON(c);
          const isActive = activeCat === c;
          return (
            <li key={c} className="flex-shrink-0">
              <button
                onClick={() => onChange(c)}
                className="cat-chip-3d group flex flex-col items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl px-1.5 pt-1 pb-1"
                data-active={isActive}
                data-testid={`cat-${c.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <span
                  className="cat-icon-3d"
                  aria-hidden
                  data-testid={`cat-icon-${c.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
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
