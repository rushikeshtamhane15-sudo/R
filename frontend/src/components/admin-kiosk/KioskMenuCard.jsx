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

export default function KioskMenuCard({ active, activeDate, tab, isFullscreen = false, mealSlots }) {
  // iter-138.l — parse the ISO date as a LOCAL date (not UTC) so the
  // weekday/day label always matches the intended calendar day. The prior
  // `new Date("2026-08-13")` treated the string as UTC midnight, which on a
  // wall-kiosk with a slightly-off system clock or non-IST timezone rendered
  // as the previous day (e.g. "Wednesday 12 Aug" on Aug 13).
  let localDate = null;
  if (activeDate && /^\d{4}-\d{2}-\d{2}$/.test(activeDate)) {
    const [y, m, d] = activeDate.split("-").map(Number);
    localDate = new Date(y, m - 1, d);
  }
  const dateLabel = localDate
    ? localDate.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })
    : "";
  const cardLabel = `${tab === "today" ? "Today’s mess menu" : "Tomorrow’s preview"} · ${dateLabel}`;
  // iter-134.k: display the admin-configured meal windows in the tile pill.
  // Falls back to sensible defaults if the fetch hasn't landed yet.
  const fmt12 = (hhmm) => {
    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const ampm = h >= 12 ? "pm" : "am";
    const hh = ((h + 11) % 12) + 1;
    return m === 0 ? `${hh}${ampm}` : `${hh}:${String(m).padStart(2, "0")}${ampm}`;
  };
  const lunchLabel = mealSlots?.lunch ? `${fmt12(mealSlots.lunch.start)} – ${fmt12(mealSlots.lunch.end)}` : "12 – 3 pm";
  const dinnerLabel = mealSlots?.dinner ? `${fmt12(mealSlots.dinner.start)} – ${fmt12(mealSlots.dinner.end)}` : "7 – 10 pm";

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
      className={`relative rounded-2xl overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-600 to-emerald-800 text-white flex flex-col ${isFullscreen ? "px-6 py-4" : "self-start px-3 py-2.5"}`}
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
      <div className={`flex items-center gap-2 z-10 relative ${isFullscreen ? "gap-3" : ""}`}>
        <span className={`inline-flex items-center justify-center rounded-lg bg-white/22 shrink-0 ${isFullscreen ? "h-10 w-10" : "h-6 w-6"}`}>
          {tab === "today" ? <ChefHat className={isFullscreen ? "h-5 w-5" : "h-3.5 w-3.5"} /> : <Sunrise className={isFullscreen ? "h-5 w-5" : "h-3.5 w-3.5"} />}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`font-display font-extrabold leading-tight tracking-tight ${isFullscreen ? "text-2xl sm:text-3xl" : "text-[13px] sm:text-[15px]"}`}
            data-testid="kiosk-mess-card-heading"
          >
            {cardLabel}
          </p>
        </div>
        <span className={`hidden sm:inline-flex items-center gap-1 tracking-[0.18em] uppercase font-bold opacity-80 bg-white/15 rounded-full ${isFullscreen ? "text-xs px-3 py-1" : "text-[9px] px-2 py-0.5"}`}>
          Today’s Special
        </span>
      </div>

      {/* iter-131.30: side-by-side LUNCH + DINNER tiles — mirrors the
          restaurant TodayMessMenuFlash mobile layout the user showed. */}
      <div className={`grid grid-cols-2 relative z-10 ${isFullscreen ? "mt-3 gap-4" : "mt-2.5 gap-2"}`}>
        {/* LUNCH tile (amber) */}
        <div
          className={`rounded-xl bg-amber-500/12 ring-1 ring-amber-300/25 ${isFullscreen ? "px-4 py-3" : "px-3 py-2"}`}
          data-testid="kiosk-mess-lunch"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`inline-flex items-center justify-center rounded-full bg-amber-400/25 ring-1 ring-amber-300/45 flex-shrink-0 ${isFullscreen ? "h-6 w-6" : "h-5 w-5"}`}>
                <Sun className={`${isFullscreen ? "h-3.5 w-3.5" : "h-3 w-3"} text-amber-200`} />
              </span>
              <span className={`tracking-[0.22em] uppercase font-extrabold text-amber-200 truncate ${isFullscreen ? "text-base" : "text-[10px]"}`}>
                Lunch
              </span>
            </div>
            <span className={`uppercase tracking-[0.12em] text-amber-100/70 font-bold whitespace-nowrap ${isFullscreen ? "text-xs" : "text-[9px]"}`}>
              {lunchLabel}
            </span>
          </div>
          {active.lunch ? (
            isFullscreen ? (
              <p
                className="mt-2 leading-tight font-semibold text-amber-50 break-words text-base"
                data-testid="kiosk-mess-lunch-items"
              >
                {splitMenuItems(active.lunch).join(" · ")}
              </p>
            ) : (
              <ul className="flex flex-col mt-1.5 gap-0.5">
                {splitMenuItems(active.lunch).map((it, i) => (
                  <li
                    key={`lunch-${it}-${i}`}
                    className="flex items-start gap-2 leading-tight font-semibold min-w-0 text-[13px]"
                  >
                    <span aria-hidden className="inline-block rounded-full bg-amber-300/80 shrink-0 h-1 w-1 mt-1.5" />
                    <span className="truncate">{it}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <span className={`italic block opacity-70 ${isFullscreen ? "text-base mt-1.5" : "text-[11px] mt-0.5"}`}>Off today</span>
          )}
        </div>

        {/* DINNER tile (blue) */}
        <div
          className={`rounded-xl bg-blue-500/12 ring-1 ring-blue-300/25 ${isFullscreen ? "px-4 py-3" : "px-3 py-2"}`}
          data-testid="kiosk-mess-dinner"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`inline-flex items-center justify-center rounded-full bg-blue-400/25 ring-1 ring-blue-300/45 flex-shrink-0 ${isFullscreen ? "h-6 w-6" : "h-5 w-5"}`}>
                <Moon className={`${isFullscreen ? "h-3.5 w-3.5" : "h-3 w-3"} text-blue-200`} />
              </span>
              <span className={`tracking-[0.22em] uppercase font-extrabold text-blue-200 truncate ${isFullscreen ? "text-base" : "text-[10px]"}`}>
                Dinner
              </span>
            </div>
            <span className={`uppercase tracking-[0.12em] text-blue-100/70 font-bold whitespace-nowrap ${isFullscreen ? "text-xs" : "text-[9px]"}`}>
              {dinnerLabel}
            </span>
          </div>
          {active.dinner ? (
            isFullscreen ? (
              <p
                className="mt-2 leading-tight font-semibold text-blue-50 break-words text-base"
                data-testid="kiosk-mess-dinner-items"
              >
                {splitMenuItems(active.dinner).join(" · ")}
              </p>
            ) : (
              <ul className="flex flex-col mt-1.5 gap-0.5">
                {splitMenuItems(active.dinner).map((it, i) => (
                  <li
                    key={`dinner-${it}-${i}`}
                    className="flex items-start gap-2 leading-tight font-semibold min-w-0 text-[13px]"
                  >
                    <span aria-hidden className="inline-block rounded-full bg-blue-300/80 shrink-0 h-1 w-1 mt-1.5" />
                    <span className="truncate">{it}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <span className={`italic block opacity-70 ${isFullscreen ? "text-base mt-1.5" : "text-[11px] mt-0.5"}`}>Off today</span>
          )}
        </div>
      </div>

      {active.note && (
        <p className={`italic opacity-90 relative z-10 ${isFullscreen ? "mt-3 text-base" : "mt-2 text-[11px]"}`}>★ {active.note}</p>
      )}
    </div>
  );
}
