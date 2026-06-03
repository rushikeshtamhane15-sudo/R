import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { MapPin } from "lucide-react";

/**
 * LocationPill — iter-55 / iter-56 #5
 * 3D-styled pill that shows "Area, City — PIN".
 * Variants:
 *   - default (legacy): for in-row placement (now unused)
 *   - strip: thin row above the main header, light-on-primary background
 *   - drawer: full-width pill inside the hamburger drawer, on dark bg
 *
 * Auto-detect for anonymous users (#5): if no user.lat/lng we ask the
 * browser geolocation API (one-shot, low-accuracy) and cache the result.
 */
export default function LocationPill({ className = "", variant = "default" }) {
  const { user } = useAuth();
  const [label, setLabel] = useState(null);
  const [anonLatLng, setAnonLatLng] = useState(() => {
    try {
      const c = JSON.parse(window.sessionStorage.getItem("ef_anon_geo") || "null");
      if (c && typeof c.lat === "number") return c;
    } catch { /* ignore */ }
    return null;
  });

  // Auto-detect for anonymous (no user or user without lat/lng) — best-effort.
  useEffect(() => {
    const haveOwn = user && user.lat != null && user.lng != null;
    if (haveOwn || anonLatLng) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const obj = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try { window.sessionStorage.setItem("ef_anon_geo", JSON.stringify(obj)); } catch { /* ignore */ }
        setAnonLatLng(obj);
      },
      () => { /* user denied / unavailable — silently keep CTA */ },
      { maximumAge: 600000, timeout: 6000, enableHighAccuracy: false }
    );
  }, [user, anonLatLng]);

  // Resolve which lat/lng to reverse-geocode
  const lat = user?.lat ?? anonLatLng?.lat;
  const lng = user?.lng ?? anonLatLng?.lng;

  useEffect(() => {
    if (lat == null || lng == null) { setLabel(null); return; }
    const key = `geo:${lat.toFixed(3)},${lng.toFixed(3)}`;
    const cached = sessionStorage.getItem(key);
    if (cached) { setLabel(cached); return; }
    let cancel = false;
    (async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
        const r = await fetch(url, { headers: { "Accept-Language": "en" } });
        const j = await r.json();
        const a = j?.address || {};
        const area = a.suburb || a.neighbourhood || a.locality || a.village || a.town || "";
        const city = a.city || a.county || a.state_district || "";
        const pin = a.postcode || "";
        const built = [area, city, pin].filter(Boolean).join(", ");
        const final = built || (j?.display_name?.split(",").slice(0, 2).join(", ")) || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
        if (!cancel) { sessionStorage.setItem(key, final); setLabel(final); }
      } catch {
        if (!cancel) setLabel(`${lat.toFixed(2)}, ${lng.toFixed(2)}`);
      }
    })();
    return () => { cancel = true; };
  }, [lat, lng]);

  // ---- Styling per variant ----
  const baseShared = "inline-flex items-center gap-1.5 rounded-full text-[11px] font-semibold transition-shadow truncate";
  let cls = "";
  if (variant === "strip") {
    cls = `${baseShared} h-7 px-2.5 max-w-[260px] sm:max-w-[420px] bg-white/15 text-primary-foreground/95 border border-white/20 shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_2px_4px_rgba(0,0,0,0.18)] hover:bg-white/20`;
  } else if (variant === "drawer") {
    cls = `${baseShared} h-9 px-3 w-full justify-start bg-white/15 text-primary-foreground border border-white/25 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_2px_6px_rgba(0,0,0,0.25)]`;
  } else {
    cls = `${baseShared} h-9 pl-2 pr-3 max-w-[200px] sm:max-w-[280px] bg-card text-foreground border border-border shadow-[0_2px_0_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.6)]`;
  }

  if (lat == null || lng == null) {
    // No lat/lng available — show a CTA so user knows location is missing.
    const ctaHref = user ? "/profile?pickLocation=1" : "/login";
    const ctaLabel = user ? "Pin your location" : "Locate me";
    return (
      <a href={ctaHref} className={`${cls} ${className}`} data-testid={`location-pill-cta${variant === "strip" ? "-strip" : variant === "drawer" ? "-drawer" : ""}`}>
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{ctaLabel}</span>
      </a>
    );
  }

  return (
    <a
      href={user ? "/profile?pickLocation=1" : "/login"}
      className={`${cls} ${className}`}
      data-testid={`location-pill${variant === "strip" ? "-strip" : variant === "drawer" ? "-drawer" : ""}`}
      title={label || "Your delivery location"}
    >
      <MapPin className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label || "Locating…"}</span>
    </a>
  );
}
