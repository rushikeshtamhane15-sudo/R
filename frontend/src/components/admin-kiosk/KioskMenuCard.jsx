// AdminKiosk — BOTTOM left: today/tomorrow lunch+dinner mess-menu card.
// iter-131.28: redesigned to mirror the restaurant TodayMessMenuFlash card
// (emerald gradient, chef-hat header, amber/blue meal tiles with bulleted
// item list) so the kiosk mess-menu matches the customer-facing look.
import React from "react";
import { Sun, Moon, ChefHat, Sunrise } from "lucide-react";

// Split a comma / "+" separated menu string into individual items for a
// pretty bullet list rendering. Matches the helper in TodayMessMenuFlash.
function splitMenuItems(str) {
  if (!str) return [];
  return String(str)
    .split(/[,+]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function KioskMenuCard({ active, activeDate, tab }) {
  const dateLabel = activeDate
    ? new Date(activeDate).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })
    : "";
  const cardLabel = `${tab === "today" ? "Today’s mess menu" : "Tomorrow’s preview"} · ${dateLabel}`;

  if (!active) {
    return (
      <div className="rounded-2xl p-5 bg-[hsl(140,8%,10%)] border border-[hsl(140,8%,20%)]" data-testid="kiosk-menu-card">
        <div className="h-full flex items-center justify-center text-center px-4">
          <p className="text-sm opacity-80 text-[hsl(40,15%,70%)]">
            No {tab === "today" ? "menu" : "preview"} published — try the other tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-2xl px-3 py-2.5 overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-600 to-emerald-800 text-white"
      style={{
        boxShadow:
          "0 12px 24px -10px rgba(5,95,70,0.5), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 2px rgba(0,0,0,0.2)",
      }}
      data-testid="kiosk-menu-card"
    >
      {/* Subtle radial dot texture — same accent as TodayMessMenuFlash */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08] bg-[radial-gradient(circle_at_20%_20%,_white_2px,_transparent_2px),radial-gradient(circle_at_80%_60%,_white_1.5px,_transparent_1.5px)] bg-[length:36px_36px,_54px_54px]"
      />

      {/* Header row: chef-hat + date */}
      <div className="flex items-center gap-2 z-10 relative">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/22 shrink-0">
          {tab === "today" ? <ChefHat className="h-3.5 w-3.5" /> : <Sunrise className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="font-display font-extrabold text-[13px] sm:text-[15px] leading-tight tracking-tight"
            data-testid="kiosk-mess-card-heading"
          >
            {cardLabel}
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase font-bold opacity-80 bg-white/15 rounded-full px-2 py-0.5">
          Today’s Special
        </span>
      </div>

      {/* LUNCH tile (amber) */}
      <div
        className="mt-2.5 rounded-xl bg-amber-500/12 ring-1 ring-amber-300/25 px-3 py-2 relative z-10"
        data-testid="kiosk-mess-lunch"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/25 ring-1 ring-amber-300/45 flex-shrink-0">
              <Sun className="h-3 w-3 text-amber-200" />
            </span>
            <span className="text-[10px] tracking-[0.22em] uppercase font-extrabold text-amber-200 truncate">
              Lunch
            </span>
          </div>
          <span className="text-[9px] uppercase tracking-[0.12em] text-amber-100/70 font-bold whitespace-nowrap">
            12 – 3 pm
          </span>
        </div>
        {active.lunch ? (
          <ul className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-0.5">
            {splitMenuItems(active.lunch).map((it, i) => (
              <li
                key={`lunch-${it}-${i}`}
                className="flex items-center gap-1.5 text-[13px] leading-tight font-semibold min-w-0"
              >
                <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-amber-300/80 shrink-0" />
                <span className="truncate">{it}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[11px] opacity-70 italic block mt-0.5">Off today</span>
        )}
      </div>

      {/* Mid seam — gold diamond separator */}
      <div className="flex items-center gap-2 opacity-55 my-1.5 relative z-10" aria-hidden>
        <span className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-300/60 to-amber-300/60" />
        <span className="w-1 h-1 rotate-45 bg-amber-300/70" />
        <span className="flex-1 h-px bg-gradient-to-l from-transparent via-amber-300/60 to-amber-300/60" />
      </div>

      {/* DINNER tile (blue) */}
      <div
        className="rounded-xl bg-blue-500/12 ring-1 ring-blue-300/25 px-3 py-2 relative z-10"
        data-testid="kiosk-mess-dinner"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-400/25 ring-1 ring-blue-300/45 flex-shrink-0">
              <Moon className="h-3 w-3 text-blue-200" />
            </span>
            <span className="text-[10px] tracking-[0.22em] uppercase font-extrabold text-blue-200 truncate">
              Dinner
            </span>
          </div>
          <span className="text-[9px] uppercase tracking-[0.12em] text-blue-100/70 font-bold whitespace-nowrap">
            7 – 10 pm
          </span>
        </div>
        {active.dinner ? (
          <ul className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-0.5">
            {splitMenuItems(active.dinner).map((it, i) => (
              <li
                key={`dinner-${it}-${i}`}
                className="flex items-center gap-1.5 text-[13px] leading-tight font-semibold min-w-0"
              >
                <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-blue-300/80 shrink-0" />
                <span className="truncate">{it}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[11px] opacity-70 italic block mt-0.5">Off today</span>
        )}
      </div>

      {active.note && (
        <p className="mt-2 text-[11px] italic opacity-90 relative z-10">★ {active.note}</p>
      )}
    </div>
  );
}
