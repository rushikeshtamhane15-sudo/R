import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { MapPin, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

/**
 * ServiceabilityPill — iter-58 #1
 *
 * Compact 3D-digital pill that lives UNDER the restaurant hero. Combines
 * geolocation, accurate reverse-geocode (Nominatim + India Post PIN
 * verification), and serviceability check against the kitchen dispatch pin.
 *
 * Three states:
 *   • detecting   — animated loader with "detecting your location…"
 *   • in-range    — green pill "We deliver here · X km · Area, City – PIN"
 *   • out-of-range — amber pill "Sorry, X km away · outside Y km zone"
 *   • permission-needed — red CTA "Enable location to continue"
 *
 * Detected coords are stashed in sessionStorage so checkout can reuse them.
 * This is ONLY for serviceability — actual delivery address is still pinned
 * separately at checkout / subscription.
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
  const [state, setState] = useState("detecting"); // detecting | in-range | out-of-range | permission-needed | error
  const [info, setInfo] = useState(null); // {km, radius, label, pincode, area, city, pincodeVerified}
  const [retryNonce, setRetryNonce] = useState(0);

  const detect = () => {
    setState("detecting");
    setRetryNonce((n) => n + 1);
  };

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

            // Resolve human-readable label with India Post PIN verification
            let label = `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
            let pincode = "";
            let area = "";
            let city = "";
            let pincodeVerified = false;
            try {
              const g = await api.get(`/geo/reverse?lat=${lat}&lng=${lng}`);
              label = g.data.label || label;
              pincode = g.data.pincode || "";
              area = g.data.area || "";
              city = g.data.city || "";
              pincodeVerified = !!g.data.pincode_verified;
            } catch {/* fall through to coord label */}

            try {
              sessionStorage.setItem(SS_KEY, JSON.stringify({ lat, lng, km, label, pincode, pincodeVerified }));
            } catch {/* ignore */}

            if (done) return;
            setInfo({ km: Number(km.toFixed(1)), radius, label, pincode, area, city, pincodeVerified });
            setState(km <= radius ? "in-range" : "out-of-range");
          },
          (err) => {
            if (done) return;
            if (err && err.code === err.PERMISSION_DENIED) {
              setState("permission-needed");
            } else {
              setState("error");
            }
          },
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 5 * 60 * 1000 }
        );
      } catch {
        setState("error");
      }
    })();
    return () => { done = true; };
  }, [retryNonce]);

  const wrap = "max-w-6xl mx-auto px-3 sm:px-5 pt-3";

  if (state === "detecting") {
    return (
      <div className={wrap} data-testid="serviceability-pill-detecting">
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl border border-border bg-card text-xs text-muted-foreground shadow-[0_2px_0_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.6)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Detecting your location to confirm we deliver here…
        </div>
      </div>
    );
  }

  if (state === "permission-needed" || state === "error") {
    return (
      <div className={wrap} data-testid="serviceability-pill-permission">
        <button
          type="button"
          onClick={detect}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 border-red-300 bg-gradient-to-r from-red-50 to-rose-50 text-left shadow-[0_8px_22px_-12px_rgba(220,38,38,0.45)]"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-red-600 text-white shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_10px_rgba(220,38,38,0.4)]">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[10px] tracking-[0.18em] uppercase font-extrabold text-red-700">Location required</span>
            <span className="block text-sm font-bold text-red-900 leading-tight">
              {state === "permission-needed"
                ? "Enable location access — we need it to confirm delivery in your area."
                : "Couldn't read your location. Tap to retry."}
            </span>
          </span>
        </button>
      </div>
    );
  }

  if (state === "in-range") {
    return (
      <div className={wrap} data-testid="serviceability-pill-in-range">
        <div
          className="relative w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-emerald-300 text-emerald-50 overflow-hidden"
          style={{
            background: "linear-gradient(145deg, #047857 0%, #059669 45%, #065f46 100%)",
            boxShadow:
              "0 12px 28px -10px rgba(5, 95, 70, 0.55)," +
              " 0 4px 10px rgba(0, 0, 0, 0.18)," +
              " inset 0 1px 0 rgba(255,255,255,0.35)," +
              " inset 0 -2px 4px rgba(0,0,0,0.18)",
          }}
        >
          {/* subtle digital scan-line overlay */}
          <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] bg-[linear-gradient(transparent_50%,_rgba(255,255,255,1)_50%)] bg-[length:100%_4px]" />
          <span
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white shrink-0 z-10"
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 3px 8px rgba(0,0,0,0.25)" }}
          >
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0 z-10">
            <p className="text-[10px] tracking-[0.18em] uppercase font-extrabold text-emerald-200/95">We deliver here</p>
            <p className="font-display font-extrabold text-sm sm:text-base leading-snug tabular-nums truncate">
              <span className="inline-block">{info.km} km</span>
              {info.label && (
                <>
                  <span className="opacity-70 mx-1.5">·</span>
                  <span className="opacity-95">{info.label}</span>
                </>
              )}
            </p>
            {info.pincode && !info.pincodeVerified && (
              <p className="text-[10px] text-amber-100/80 mt-0.5">PIN approximate — re-pin at checkout for exact delivery</p>
            )}
          </div>
          <MapPin className="h-4 w-4 text-emerald-100/70 z-10 shrink-0" />
        </div>
      </div>
    );
  }

  // out-of-range
  return (
    <div className={wrap} data-testid="serviceability-pill-out-of-range">
      <div
        className="relative w-full flex items-start gap-3 px-4 py-3 rounded-2xl border border-amber-300 text-amber-50 overflow-hidden"
        style={{
          background: "linear-gradient(145deg, #b45309 0%, #d97706 45%, #92400e 100%)",
          boxShadow:
            "0 12px 28px -10px rgba(146, 64, 14, 0.55)," +
            " 0 4px 10px rgba(0, 0, 0, 0.18)," +
            " inset 0 1px 0 rgba(255,255,255,0.35)," +
            " inset 0 -2px 4px rgba(0,0,0,0.18)",
        }}
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] bg-[linear-gradient(transparent_50%,_rgba(255,255,255,1)_50%)] bg-[length:100%_4px]" />
        <span
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white shrink-0 z-10"
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 3px 8px rgba(0,0,0,0.25)" }}
        >
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0 z-10">
          <p className="text-[10px] tracking-[0.18em] uppercase font-extrabold text-amber-200/95">Outside delivery zone</p>
          <p className="font-display font-extrabold text-sm sm:text-base leading-snug tabular-nums truncate">
            <span className="inline-block">{info.km} km</span>
            <span className="opacity-70 mx-1.5">·</span>
            <span className="opacity-95">{info.label}</span>
          </p>
          <p className="text-[11px] text-amber-100/85 mt-0.5">You're {info.km - info.radius > 0 ? `${(info.km - info.radius).toFixed(1)} km` : ""} outside our {info.radius} km zone — you can still browse the menu.</p>
        </div>
      </div>
    </div>
  );
}
