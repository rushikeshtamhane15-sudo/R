import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ChefHat, Sun, Moon, Sunrise } from "lucide-react";

/**
 * TodayMessMenuFlash — iter-62 #8
 *
 * Reads /api/mess-menu/today and renders a compact card showing today's
 * lunch + dinner. Between midnight and 7 AM IST it also flashes tomorrow's
 * preview ("Coming tomorrow") so the user can plan ahead.
 *
 * Mounted on the user dashboard AND above the restaurant menu list.
 */
export default function TodayMessMenuFlash({ compact = false }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try { const r = await api.get("/mess-menu/today"); setData(r.data); }
      catch { setData(null); }
    })();
  }, []);
  if (!data) return null;
  const today = data.current;
  const next = data.next;
  if (!today && !next) return null;

  return (
    <div className={compact ? "" : "mt-4"} data-testid="mess-menu-flash">
      {today && (
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
              <ChefHat className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[9px] tracking-[0.18em] uppercase font-extrabold text-emerald-100/85">Today's mess menu · {new Date(today.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</p>
            </div>
          </div>
          <div className="mt-2 grid sm:grid-cols-2 gap-2 z-10 relative">
            {today.lunch && (
              <div className="flex items-start gap-1.5 bg-white/8 rounded-xl px-2.5 py-2">
                <Sun className="h-3.5 w-3.5 text-amber-200 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] tracking-[0.16em] uppercase font-bold text-emerald-100/75">Lunch</p>
                  <p className="text-[12px] sm:text-[13px] font-bold leading-snug">{today.lunch}</p>
                </div>
              </div>
            )}
            {today.dinner && (
              <div className="flex items-start gap-1.5 bg-white/8 rounded-xl px-2.5 py-2">
                <Moon className="h-3.5 w-3.5 text-blue-200 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] tracking-[0.16em] uppercase font-bold text-emerald-100/75">Dinner</p>
                  <p className="text-[12px] sm:text-[13px] font-bold leading-snug">{today.dinner}</p>
                </div>
              </div>
            )}
          </div>
          {today.note && (
            <p className="mt-2 text-[10px] sm:text-[11px] italic text-emerald-100/85 z-10 relative">★ {today.note}</p>
          )}
        </div>
      )}

      {next && data.early_bird && (
        <div className="mt-2 rounded-xl p-3 border border-amber-200 bg-amber-50 text-amber-900" data-testid="mess-menu-tomorrow">
          <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold flex items-center gap-1.5"><Sunrise className="h-3 w-3" /> Coming tomorrow</p>
          <p className="text-[12px] mt-1 leading-snug">
            {next.lunch && <><b>Lunch:</b> {next.lunch}</>}
            {next.lunch && next.dinner && <span className="opacity-50"> · </span>}
            {next.dinner && <><b>Dinner:</b> {next.dinner}</>}
          </p>
        </div>
      )}
    </div>
  );
}
