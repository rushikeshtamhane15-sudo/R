import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { MapPin, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

/**
 * GeoServiceabilityBanner — auto-detects the visitor's location via
 * browser GPS on /restaurant mount, compares against the kitchen's
 * dispatch pin (+ radius), and shows one of three states:
 *   • detecting     — spinner
 *   • in-range      — green pill "X km away · we deliver here"
 *   • out-of-range  — amber banner with override option
 *   • denied/error  — silent (no banner so we don't badger first-time users)
 *
 * The detected coords are stashed in sessionStorage so the checkout page
 * can re-use them without re-prompting.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function GeoServiceabilityBanner() {
  const [state, setState] = useState("detecting");
  const [info, setInfo] = useState(null); // {km, radius}

  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const r = await api.get("/restaurant/serviceable-area");
        const dispatch_lat = r.data?.dispatch_lat;
        const dispatch_lng = r.data?.dispatch_lng;
        const radius = Number(r.data?.dispatch_radius_km || 15);
        if (!dispatch_lat || !dispatch_lng) { setState("hidden"); return; }
        if (!("geolocation" in navigator)) { setState("hidden"); return; }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (done) return;
            const km = haversineKm(pos.coords.latitude, pos.coords.longitude, dispatch_lat, dispatch_lng);
            try { sessionStorage.setItem("efc_user_geo_v1", JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, km })); } catch {}
            setInfo({ km: Number(km.toFixed(1)), radius });
            setState(km <= radius ? "in-range" : "out-of-range");
          },
          () => { if (!done) setState("hidden"); },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 60 * 1000 }
        );
      } catch {
        setState("hidden");
      }
    })();
    return () => { done = true; };
  }, []);

  if (state === "hidden") return null;

  if (state === "detecting") {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-5 pt-3" data-testid="geo-banner-detecting">
        <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Detecting your location to confirm we deliver here…
        </p>
      </div>
    );
  }

  if (state === "in-range") {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-5 pt-3" data-testid="geo-banner-in-range">
        <p className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-900/40 dark:text-emerald-200 px-3 py-1.5 rounded-full border border-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" /> We deliver here · {info.km} km away
        </p>
      </div>
    );
  }

  // out-of-range
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 pt-3" data-testid="geo-banner-out-of-range">
      <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="text-xs">
          <p className="font-bold">Sorry, you're {info.km} km away — outside our {info.radius} km delivery range.</p>
          <p className="text-amber-700/90 dark:text-amber-200/80 mt-0.5">
            You can still browse the menu. Tap an address at checkout to override if your office/family is closer.
            <MapPin className="inline h-3 w-3 ml-1" />
          </p>
        </div>
      </div>
    </div>
  );
}
