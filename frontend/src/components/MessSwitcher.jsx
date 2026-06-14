/**
 * MessSwitcher — iter-76 #3 · iter-97 #1.
 *
 * Silently auto-picks the closest active mess on mount (browser geo +
 * /messes/nearby) and shows a READ-ONLY pill in the header.
 *
 * iter-97: the consumer no longer manually picks a branch — we auto-detect
 * and lock to the nearest. The pill is now display-only; the old
 * "Pick your branch" sheet was removed. Cached location (localStorage) is
 * used for instant first-paint so the pill never flashes "Pick branch".
 *
 * Storage:
 *   • localStorage('efc_user_mess_v1') — quick read for SSR/first paint
 *   • POST /api/me/mess (server-side persistence for logged-in users)
 */
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { MapPin } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const STORAGE_KEY = "efc_user_mess_v1";
const LOC_KEY = "efc_user_geo_v1";  // iter-97: cached lat/lng for instant resolves

export default function MessSwitcher({ variant = "pill" }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
  });

  /* === Hydrate from server if logged in ============================== */
  useEffect(() => {
    let alive = true;
    if (!user) return undefined;
    (async () => {
      try {
        const r = await api.get("/me/mess");
        if (!alive) return;
        if (r.data?.mess) {
          setCurrent(r.data.mess);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r.data.mess)); } catch { /* no-op */ }
        }
      } catch { /* fall back to localStorage */ }
    })();
    return () => { alive = false; };
  }, [user]);

  /* === Auto-pick by location — iter-97 fastest path ==================
     1. Use cached lat/lng (localStorage) to resolve nearest INSTANTLY.
     2. In parallel kick off a fresh, low-accuracy geo lookup (1.5s) —
        if it returns a different branch, swap silently.
     3. If we have no current and no cache, fall back to default mess. */
  useEffect(() => {
    let alive = true;

    const resolveAndSet = async (lat, lng) => {
      try {
        const r = await api.get(`/messes/nearby?lat=${lat}&lng=${lng}`);
        const closest = r.data?.messes?.[0];
        if (closest && alive) {
          setCurrent(closest);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(closest)); } catch { /* no-op */ }
          try { localStorage.setItem(LOC_KEY, JSON.stringify({ lat, lng, ts: Date.now() })); } catch { /* no-op */ }
          if (user) { try { await api.post("/me/mess", { mess_id: closest.mess_id }); } catch { /* no-op */ } }
        }
      } catch { /* keep current */ }
    };

    // Step 1: try the cached lat/lng for INSTANT branch resolution.
    let usedCache = false;
    try {
      const cached = JSON.parse(localStorage.getItem(LOC_KEY) || "null");
      if (cached?.lat != null && cached?.lng != null && (Date.now() - (cached.ts || 0) < 24 * 60 * 60 * 1000)) {
        usedCache = true;
        resolveAndSet(cached.lat, cached.lng);
      }
    } catch { /* ignore */ }

    // Step 2: get a fresh GPS fix in the background (fast / low-accuracy).
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolveAndSet(pos.coords.latitude, pos.coords.longitude),
        () => {
          // Denied or unavailable AND we have no cache → fall to default mess.
          if (!current && !usedCache) {
            api.get("/messes").then((r) => {
              if (!alive) return;
              const def = (r.data?.messes || []).find((m) => m.mess_id === r.data?.default_mess_id) || r.data?.messes?.[0];
              if (def) {
                setCurrent(def);
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(def)); } catch { /* no-op */ }
              }
            }).catch(() => {});
          }
        },
        // iter-97: prioritise SPEED. Low-accuracy fix usually returns in
        // <1s on cellular & under 100ms with WiFi-positioning cache.
        { enableHighAccuracy: false, timeout: 1500, maximumAge: 10 * 60 * 1000 },
      );
    } else if (!current) {
      // No geo at all — load default
      api.get("/messes").then((r) => {
        if (!alive) return;
        const def = (r.data?.messes || []).find((m) => m.mess_id === r.data?.default_mess_id) || r.data?.messes?.[0];
        if (def) {
          setCurrent(def);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(def)); } catch { /* no-op */ }
        }
      }).catch(() => {});
    }

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!current && variant === "pill") {
    return null; // hidden until we resolve
  }

  // iter-97: pill is now display-only (no Sheet, no click, no manual switch).
  if (variant === "pill") {
    return (
      <div
        className="inline-flex items-center gap-1 rounded-full bg-white/15 text-white px-2 h-7 text-[10px] font-extrabold tracking-wide max-w-[110px] sm:max-w-[160px] select-none"
        data-testid="mess-switcher-pill"
        title={current?.name}
        aria-label={`Branch ${current?.city || current?.name}`}
      >
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">{current?.city || current?.name?.split("·")?.[1]?.trim() || current?.name}</span>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground"
      data-testid="mess-switcher-btn"
    >
      <MapPin className="h-4 w-4 text-primary" /> {current?.name}
    </div>
  );
}
