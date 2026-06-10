import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Clock, AlertTriangle, X } from "lucide-react";

/**
 * RestaurantClosedBanner — iter-79 Batch B #4
 *
 * Polls GET /api/restaurant/status every 60s. When the restaurant is closed
 * (outside hours / manual_off / capacity_full), surfaces:
 *
 *   1. A one-time popup the FIRST time the user lands on the restaurant
 *      page in this session, with the configured `closed_message` —
 *      defaults to "We only deliver between our standard working hours".
 *
 *   2. A persistent sticky countdown chip at the top of the restaurant
 *      page that reads "Kitchen opens in 2h 14m" — auto-tick every 30s.
 *
 *   3. Disables the parent's Buy/Add buttons by setting a CSS variable
 *      on documentElement so the restaurant page can grey out the menu
 *      grid (the actual blocker is the backend 423 — this is UX glue).
 *
 * The popup auto-dismisses (sessionStorage flag) so it doesn't reappear
 * on every navigation back to the restaurant page within one session.
 */
const SS_DISMISS_KEY = "efc_closed_popup_dismissed";

function formatCountdown(mins) {
  if (mins == null || mins < 0) return "";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function reasonHeadline(reason) {
  // iter-82 #3: friendlier copy across all 3 reasons. "Kitchen will open soon"
  // reads more reassuring than "Kitchen is currently closed" and matches the
  // countdown chip tone.
  if (reason === "manual_off") return "Kitchen is closed today";
  if (reason === "capacity_full") return "Kitchen is at full capacity";
  return "Kitchen will open soon";
}

export default function RestaurantClosedBanner() {
  const [status, setStatus] = useState(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const popupSeenRef = useRef(false);

  // Fetch + auto-refresh every 60s. The status fetch also drives the
  // first-visit popup (handled inline here, not in a separate effect, to
  // avoid an extra setState-in-effect lint trigger).
  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const r = await api.get("/restaurant/status");
        if (cancelled) return;
        setStatus(r.data);
        // Show popup on first closed status received in this session.
        if (!r.data.open && !popupSeenRef.current) {
          popupSeenRef.current = true;
          if (!sessionStorage.getItem(SS_DISMISS_KEY)) setPopupOpen(true);
        }
        if (r.data.open) setPopupOpen(false);
        // DOM-side hint so other components can grey out when closed.
        document.documentElement.dataset.kitchenOpen = r.data.open ? "1" : "0";
      } catch { /* ignore */ }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      delete document.documentElement.dataset.kitchenOpen;
    };
  }, []);

  // Tick countdown locally every 30s so the chip stays fresh between
  // status fetches (no extra backend load).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // Recompute minutes from `next_open_at` using current wall clock so the
  // chip stays accurate even between server polls.
  const liveMinutes = (() => {
    if (!status || status.open || !status.next_open_at) return null;
    const diffMs = new Date(status.next_open_at) - new Date();
    return Math.max(0, Math.floor(diffMs / 60_000));
  })();
  void tick; // keep dep — re-renders chip every 30s

  if (!status || status.open) return null;

  const closeMessage = status.closed_message || "We only deliver between our standard working hours";
  const countdown = formatCountdown(liveMinutes);

  const dismissPopup = () => {
    sessionStorage.setItem(SS_DISMISS_KEY, "1");
    setPopupOpen(false);
  };

  return (
    <>
      {/* iter-81 #2: tiny single-row closed chip — no headline, only the
          clock icon + countdown so it doesn't overlap the location pill
          above and takes minimal vertical space. Tap → opens the popup
          for full details. */}
      <button
        type="button"
        onClick={() => setPopupOpen(true)}
        className="sticky top-0 z-40 -mx-3 sm:-mx-6 mb-2 w-screen sm:w-auto block py-1.5 bg-amber-50 border-y border-amber-300 hover:bg-amber-100 transition-colors"
        data-testid="restaurant-closed-chip"
        aria-label="Kitchen closed details"
      >
        <div className="flex items-center gap-2 max-w-5xl mx-auto px-3 sm:px-6">
          <Clock className="h-3.5 w-3.5 text-amber-700 shrink-0" />
          <p className="text-[11px] sm:text-xs font-extrabold text-amber-900 truncate flex-1 text-left">
            {countdown ? `Kitchen opens in ${countdown}` : "Kitchen reopens soon"}
            {status.open_time && status.close_time && (
              <span className="hidden sm:inline ml-2 text-amber-800/80 font-semibold tracking-wide">
                · Daily {status.open_time}–{status.close_time}
              </span>
            )}
          </p>
          <span className="shrink-0 rounded-full bg-amber-600 text-white text-[10px] font-extrabold px-2 h-5 inline-flex items-center" data-testid="restaurant-closed-info-btn">
            Info
          </span>
        </div>
      </button>

      {/* First-visit popup */}
      {popupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          onClick={dismissPopup}
          data-testid="restaurant-closed-popup"
        >
          <div
            className="bg-card rounded-3xl max-w-md w-full p-6 relative animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={dismissPopup}
              className="absolute top-3 right-3 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60"
              aria-label="Close"
              data-testid="restaurant-closed-popup-dismiss"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="inline-flex h-11 w-11 rounded-xl bg-amber-100 text-amber-700 items-center justify-center">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h3 className="font-display font-extrabold text-2xl mt-4 tracking-tight" data-testid="restaurant-closed-popup-title">
              {reasonHeadline(status.reason)}
            </h3>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed" data-testid="restaurant-closed-popup-message">
              {closeMessage}
            </p>
            {countdown && (
              <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-3">
                <Clock className="h-4 w-4 text-amber-700 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] tracking-[0.18em] uppercase font-extrabold text-amber-800">Opens in</p>
                  <p className="font-display font-extrabold text-xl text-amber-900 leading-none mt-0.5" data-testid="restaurant-closed-popup-countdown">
                    {countdown}
                  </p>
                </div>
              </div>
            )}
            {status.open_time && status.close_time && (
              <p className="text-xs text-muted-foreground mt-4">
                <span className="font-bold text-foreground">Working hours:</span> Daily {status.open_time} – {status.close_time}
              </p>
            )}
            <button
              type="button"
              onClick={dismissPopup}
              className="mt-6 w-full rounded-full bg-primary text-primary-foreground h-10 text-sm font-extrabold hover:bg-primary/90"
              data-testid="restaurant-closed-popup-ok"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
