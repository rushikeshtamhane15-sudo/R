// AdminKiosk — BOTTOM left: menu card showing today/tomorrow lunch+dinner.
import React from "react";
import { Sun, Moon } from "lucide-react";

export default function KioskMenuCard({ active, activeDate, tab, cfg }) {
  return (
    <div
      className="rounded-2xl p-4 sm:p-5 relative overflow-hidden"
      style={cfg ? {
        background: `linear-gradient(145deg, ${cfg.bg_gradient_from} 0%, ${cfg.bg_gradient_mid} 45%, ${cfg.bg_gradient_to} 100%)`,
        color: cfg.text_color,
      } : { background: "#0c1a14" }}
      data-testid="kiosk-menu-card"
    >
      {active ? (
        <>
          <p className="text-[10px] tracking-[0.2em] uppercase font-extrabold opacity-85">
            {tab === "today" ? "Today's mess menu" : "Tomorrow's preview"} · {new Date(activeDate).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
          </p>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            {active.lunch && (
              <div className="rounded-xl bg-white/10 px-3 py-2.5">
                <p className="text-[10px] tracking-[0.18em] uppercase font-bold opacity-80 flex items-center gap-1"><Sun className="h-3 w-3" /> Lunch</p>
                <p className="text-[14px] sm:text-base font-bold leading-snug mt-0.5">{active.lunch}</p>
              </div>
            )}
            {active.dinner && (
              <div className="rounded-xl bg-white/10 px-3 py-2.5">
                <p className="text-[10px] tracking-[0.18em] uppercase font-bold opacity-80 flex items-center gap-1"><Moon className="h-3 w-3" /> Dinner</p>
                <p className="text-[14px] sm:text-base font-bold leading-snug mt-0.5">{active.dinner}</p>
              </div>
            )}
          </div>
          {active.note && <p className="mt-3 text-[11px] italic opacity-85">★ {active.note}</p>}
        </>
      ) : (
        <div className="h-full flex items-center justify-center text-center px-4">
          <p className="text-sm opacity-80">No {tab === "today" ? "menu" : "preview"} published — try the other tab.</p>
        </div>
      )}
    </div>
  );
}
