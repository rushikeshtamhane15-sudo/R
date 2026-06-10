import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { MapPin, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

/**
 * ServiceabilityPill — iter-60 #1 redesign
 *
 * Compact 3D-digital pill UNDER the restaurant hero. Smaller vertical
 * footprint, marquee-style scrolling text inside (think "100% pure veg"
 * ticker) so long labels stay readable on narrow screens.
 *
 * In-range pill height shrunk to py-1.5 + 10/11px label & 12px digital text.
 * The scroll-animation is CSS-driven so it stays smooth on low-end Androids.
 *
 * On successful in-range detection we BOTH cache to sessionStorage AND
 * persist {lat,lng} to the user record via /auth/location — that way the
 * subscribe flow's _enforce_serviceable_area passes without forcing the user
 * to re-pin in Profile.
 */
const SS_KEY = "efc_user_geo_v2";

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function ServiceabilityPill() {
  const { user } = useAuth();
  const [state, setState] = useState("detecting");
  const [info, setInfo] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const detect = () => { setState("detecting"); setRetryNonce((n) => n + 1); };

  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const r = await api.get("/restaurant/serviceable-area");
        const dispatch_lat = r.data?.dispatch_lat;
        const dispatch_lng = r.data?.dispatch_lng;
        const radius = Number(r.data?.dispatch_radius_km || 15);
        if (!dispatch_lat || !dispatch_lng) { setState("error"); return; }
        if (!("geolocation" in navigator)) { setState("permission-needed"); return; }

        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            if (done) return;
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const km = haversineKm(lat, lng, dispatch_lat, dispatch_lng);

            let label = "";
            let pincode = ""; let area = ""; let city = ""; let pincodeVerified = false;
            try {
              const g = await api.get(`/geo/reverse?lat=${lat}&lng=${lng}`);
              label = g.data.label || "";
              pincode = g.data.pincode || "";
              area = g.data.area || "";
              city = g.data.city || "";
              pincodeVerified = !!g.data.pincode_verified;
            } catch {/* fall through */}

            try { sessionStorage.setItem(SS_KEY, JSON.stringify({ lat, lng, km, label, pincode, pincodeVerified })); } catch {}

            // iter-60 #2 fix: persist lat/lng to the user record so the
            // subscribe /payments endpoints don't fire the "pin your delivery
            // location first" error after a successful in-range detection.
            if (user && km <= radius) {
              try { await api.post("/auth/location", { lat, lng }); } catch {/* ignore */}
            }

            if (done) return;
            setInfo({ km: Number(km.toFixed(1)), radius, label, pincode, area, city, pincodeVerified });
            setState(km <= radius ? "in-range" : "out-of-range");
          },
          (err) => {
            if (done) return;
            setState(err && err.code === err.PERMISSION_DENIED ? "permission-needed" : "error");
          },
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 5 * 60 * 1000 }
        );
      } catch { setState("error"); }
    })();
    return () => { done = true; };
  }, [retryNonce, user]);

  // iter-83 #2 / iter-84 #3: zero outer padding + rectangular inner pill so
  // the location strip is TRUE edge-to-edge full bleed, matching the
  // amber kitchen chip directly above it.
  const wrap = "w-full";

  if (state === "detecting") {
    return (
      <div className={wrap} data-testid="serviceability-pill-detecting">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-border bg-card text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Detecting location…
        </div>
      </div>
    );
  }

  if (state === "permission-needed" || state === "error") {
    return (
      <div className={wrap} data-testid="serviceability-pill-permission">
        <button
          type="button" onClick={detect}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-red-300 bg-gradient-to-r from-red-50 to-rose-50 text-left"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-red-600 text-white shrink-0">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[9px] tracking-[0.18em] uppercase font-extrabold text-red-700">Location required</span>
            <span className="block text-[11px] font-bold text-red-900 leading-tight">
              {state === "permission-needed" ? "Enable location to confirm we deliver here. Tap to retry." : "Couldn't read location. Tap to retry."}
            </span>
          </span>
        </button>
      </div>
    );
  }

  const isIn = state === "in-range";
  const gradient = isIn
    ? "linear-gradient(145deg, #047857 0%, #059669 45%, #065f46 100%)"
    : "linear-gradient(145deg, #b45309 0%, #d97706 45%, #92400e 100%)";
  const shadow = isIn
    ? "0 6px 16px -6px rgba(5,95,70,0.45), 0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 2px rgba(0,0,0,0.18)"
    : "0 6px 16px -6px rgba(146,64,14,0.45), 0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 2px rgba(0,0,0,0.18)";

  // iter-60 #1: marquee ticker — repeat the content twice so the loop is seamless.
  // iter-78 #2: never expose raw lat/lng to the user — fall back to a friendly
  // generic label when reverse-geocode hasn't returned an address yet.
  const safeLabel = (info.label || "").trim() || "your area";
  const tickerText = isIn
    ? `WE DELIVER HERE  ·  ${info.km} km from kitchen  ·  ${safeLabel}`
    : `OUTSIDE DELIVERY ZONE  ·  ${info.km} km away  ·  ${(info.km - info.radius).toFixed(1)} km past our ${info.radius} km radius`;

  return (
    <div className={wrap} data-testid={isIn ? "serviceability-pill-in-range" : "serviceability-pill-out-of-range"}>
      <div
        className="relative w-full flex items-center gap-1.5 px-3 sm:px-4 py-1 overflow-hidden text-white"
        style={{ background: gradient, boxShadow: shadow }}
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(transparent_50%,_rgba(255,255,255,1)_50%)] bg-[length:100%_3px]" />
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-md bg-white/22 shrink-0 z-10"
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 4px rgba(0,0,0,0.22)" }}
        >
          {isIn ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
        </span>
        {/* Marquee ticker */}
        <div className="relative flex-1 min-w-0 overflow-hidden z-10">
          <div className="efc-pill-marquee flex whitespace-nowrap will-change-transform">
            <span className="text-[10px] sm:text-[11px] font-bold tracking-wide tabular-nums opacity-95 mr-10">{tickerText}</span>
            <span className="text-[10px] sm:text-[11px] font-bold tracking-wide tabular-nums opacity-95 mr-10" aria-hidden="true">{tickerText}</span>
          </div>
          {/* fade edges so text doesn't visually clip */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-3" style={{ background: `linear-gradient(to right, ${isIn ? "#065f46" : "#92400e"} 0%, transparent 100%)` }} />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-3" style={{ background: `linear-gradient(to left, ${isIn ? "#065f46" : "#92400e"} 0%, transparent 100%)` }} />
        </div>
        <MapPin className="h-2.5 w-2.5 opacity-70 z-10 shrink-0" />
      </div>
      {/* Marquee CSS — scoped via global keyframes class. Kept inline so the
          component is self-contained and doesn't bloat tailwind config. */}
      <style>{`
        @keyframes efc-pill-marquee-kf { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .efc-pill-marquee { animation: efc-pill-marquee-kf 18s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .efc-pill-marquee { animation: none; } }
      `}</style>
    </div>
  );
}
