import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { MapPin } from "lucide-react";

/**
 * LocationPill — iter-55 #12
 * 3D-styled compact pill in the top nav that shows "Area, City — PIN" derived
 * from the user's saved lat/lng. Falls back to a "Set location" CTA if the
 * user hasn't pinned. Uses OSM Nominatim once per session (cached in
 * sessionStorage by lat/lng key).
 */
export default function LocationPill({ className = "" }) {
  const { user } = useAuth();
  const [label, setLabel] = useState(null);

  useEffect(() => {
    const lat = user?.lat, lng = user?.lng;
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
        const city = a.city || a.county || a.state_district || a.state || "";
        const pin = a.postcode || "";
        const built = [area, city, pin].filter(Boolean).join(", ");
        const final = built || (j?.display_name?.split(",").slice(0, 2).join(", ")) || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
        if (!cancel) { sessionStorage.setItem(key, final); setLabel(final); }
      } catch {
        if (!cancel) setLabel(`${lat.toFixed(2)}, ${lng.toFixed(2)}`);
      }
    })();
    return () => { cancel = true; };
  }, [user?.lat, user?.lng]);

  if (!user) {
    return (
      <a href="/login" className={`hidden md:inline-flex items-center gap-1.5 rounded-full px-3 h-9 text-xs font-semibold bg-primary/5 text-primary border border-primary/15 shadow-[0_2px_0_rgba(160,35,35,0.12),inset_0_1px_0_rgba(255,255,255,0.5)] ${className}`} data-testid="location-pill-cta">
        <MapPin className="h-3.5 w-3.5" /> Set delivery location
      </a>
    );
  }
  if (!user.lat || !user.lng) {
    return (
      <a href="/profile?pickLocation=1" className={`inline-flex items-center gap-1.5 rounded-full px-3 h-9 text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-300 shadow-[0_2px_0_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.6)] ${className}`} data-testid="location-pill-needs-pin">
        <MapPin className="h-3.5 w-3.5" /> Pin your location
      </a>
    );
  }
  return (
    <a
      href="/profile?pickLocation=1"
      className={`inline-flex items-center gap-1.5 rounded-full pl-2 pr-3 h-9 text-xs font-semibold bg-card text-foreground border border-border max-w-[200px] sm:max-w-[280px] shadow-[0_2px_0_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.6)] hover:shadow-[0_3px_0_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.6)] transition-shadow ${className}`}
      data-testid="location-pill"
      title={label || "Your delivery location"}
    >
      <span className="inline-flex h-6 w-6 rounded-full bg-primary/10 text-primary items-center justify-center shrink-0">
        <MapPin className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">{label || "Locating…"}</span>
    </a>
  );
}
