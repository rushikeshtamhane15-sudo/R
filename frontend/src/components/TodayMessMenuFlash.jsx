import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ChefHat, Sun, Moon, Sunrise } from "lucide-react";

/**
 * TodayMessMenuFlash — iter-62 #8, iter-63 #7 (Today/Tomorrow toggle)
 *
 * Reads /api/mess-menu/today?include_next=1 so users can flip between
 * today's and tomorrow's menu via a 2-tab toggle. Mounted on the user
 * dashboard AND above the restaurant menu list.
 */
export default function TodayMessMenuFlash({ compact = false }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("today"); // today | tomorrow

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/mess-menu/today?include_next=1"); setData(r.data); }
      catch { setData(null); }
    })();
  }, []);
  if (!data) return null;
  const today = data.current;
  const next = data.next;
  // Hide the entire surface if BOTH days are empty
  if (!today && !next) return null;

  const active = tab === "today" ? today : next;
  const activeDate = tab === "today" ? data.today : data.tomorrow;
  const cardLabel = tab === "today"
    ? `Today's mess menu · ${new Date(activeDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`
    : `Tomorrow's preview · ${new Date(activeDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`;

  return (
    <div className={compact ? "" : "mt-4"} data-testid="mess-menu-flash">
      {/* iter-63 #7: Today / Tomorrow horizontal toggle tabs */}
      <div className="inline-flex flex-row bg-muted/50 rounded-full p-1 gap-1 mb-2" data-testid="menu-tab-group">
        <button
          type="button" onClick={() => setTab("today")}
          className={`px-4 sm:px-5 h-8 rounded-full text-xs font-bold transition-colors ${tab === "today" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="menu-tab-today"
        >Today's menu</button>
        <button
          type="button" onClick={() => setTab("tomorrow")}
          className={`px-4 sm:px-5 h-8 rounded-full text-xs font-bold transition-colors ${tab === "tomorrow" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="menu-tab-tomorrow"
        >Tomorrow's menu</button>
      </div>

      {active ? (
        <div
          className="rounded-2xl p-3.5 sm:p-4 text-emerald-50 overflow-hidden relative"
          style={{
            background: "linear-gradient(145deg, #047857 0%, #059669 45%, #065f46 100%)",
            boxShadow: "0 10px 24px -10px rgba(5,95,70,0.45), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 2px rgba(0,0,0,0.18)",
          }}
        >
          <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(transparent_50%,_rgba(255,255,255,1)_50%)] bg-[length:100%_3px]" />
          <div className="flex items-center gap-2 z-10 relative">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/22 shrink-0">
              {tab === "today" ? <ChefHat className="h-3.5 w-3.5" /> : <Sunrise className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0">
              <p className="text-[9px] tracking-[0.18em] uppercase font-extrabold text-emerald-100/85">{cardLabel}</p>
            </div>
          </div>
          <div className="mt-2 grid sm:grid-cols-2 gap-2 z-10 relative">
            {active.lunch && (
              <div className="flex items-start gap-1.5 bg-white/8 rounded-xl px-2.5 py-2">
                <Sun className="h-3.5 w-3.5 text-amber-200 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] tracking-[0.16em] uppercase font-bold text-emerald-100/75">Lunch</p>
                  <p className="text-[12px] sm:text-[13px] font-bold leading-snug">{active.lunch}</p>
                </div>
              </div>
            )}
            {active.dinner && (
              <div className="flex items-start gap-1.5 bg-white/8 rounded-xl px-2.5 py-2">
                <Moon className="h-3.5 w-3.5 text-blue-200 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] tracking-[0.16em] uppercase font-bold text-emerald-100/75">Dinner</p>
                  <p className="text-[12px] sm:text-[13px] font-bold leading-snug">{active.dinner}</p>
                </div>
              </div>
            )}
          </div>
          {active.note && (
            <p className="mt-2 text-[10px] sm:text-[11px] italic text-emerald-100/85 z-10 relative">★ {active.note}</p>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-5 text-center" data-testid="menu-empty">
          <p className="text-xs text-muted-foreground">
            {tab === "today"
              ? "Today's menu hasn't been published yet — check back soon."
              : "Tomorrow's menu hasn't been planned yet. Try again later."}
          </p>
        </div>
      )}
    </div>
  );
}
