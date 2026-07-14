/* DeliveryWindowPill — small colored badge showing a stop's delivery window.
 *
 * Colour logic (IST-local, computed against `now`):
 *   • grey   — user hasn&apos;t set a window
 *   • cyan   — delivered already (shows "delivered" or "delivered late by Xm")
 *   • blue   — current time < start (upcoming; will reach in Xm)
 *   • green  — within [start, end]  (on-time to deliver now)
 *   • amber  — within [start-10min, start] (heads-up, deliver soon)
 *   • red    — current time > end   (LATE — deliver ASAP)
 *
 * Used on: staff dispatch list, delivery-boy list, admin today panel, track page.
 */
import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";

function nowIstMinutes() {
  // Local browser clock offset to IST (UTC+5:30). Users in India will see the
  // same as their device clock; users abroad still see the true IST time.
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 330 * 60000);
  return ist.getHours() * 60 + ist.getMinutes();
}

function hhmmToMin(s) {
  if (!s || !/^\d{2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

function fmt(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h < 12 ? "am" : "pm";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")}${ap}`;
}

export default function DeliveryWindowPill({
  start,
  end,
  status,          // 'planned' | 'ready' | 'out' | 'delivered' | 'undelivered' | 'returned'
  deliveredLate,   // bool
  deliveredLateBy, // int minutes
  className = "",
  short = false,
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const s = hhmmToMin(start);
  const e = hhmmToMin(end);

  if (!s || !e) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 ${className}`}
        data-testid="pill-no-window"
        title="User hasn't set a delivery window yet"
      >
        <Clock className="h-2.5 w-2.5" /> No window
      </span>
    );
  }

  if (status === "delivered") {
    const late = deliveredLate;
    const cls = late ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700";
    return (
      <span className={`inline-flex items-center gap-1 rounded-full text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 ${cls} ${className}`} data-testid={late ? "pill-late" : "pill-delivered-ontime"}>
        <Clock className="h-2.5 w-2.5" /> {late ? `Late by ${deliveredLateBy}m` : "Delivered on time"}
      </span>
    );
  }

  const cur = nowIstMinutes();
  // rely on tick to force re-render every minute; referenced for lint
  void tick;

  let color, label;
  if (cur > e) {
    color = "bg-rose-100 text-rose-700 ring-1 ring-rose-300";
    label = `Late · past ${fmt(e)}`;
  } else if (cur >= s) {
    color = "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300";
    label = `Deliver now · by ${fmt(e)}`;
  } else if (s - cur <= 10) {
    color = "bg-amber-100 text-amber-800 ring-1 ring-amber-300";
    label = `In ${s - cur}m · ${fmt(s)}`;
  } else {
    color = "bg-blue-100 text-blue-700 ring-1 ring-blue-300";
    label = short ? `${fmt(s)}` : `${fmt(s)} – ${fmt(e)}`;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 ${color} ${className}`}
      data-testid="pill-window"
      title={`Delivery window ${fmt(s)} – ${fmt(e)}`}
    >
      <Clock className="h-2.5 w-2.5" /> {label}
    </span>
  );
}
