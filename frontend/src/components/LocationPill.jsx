import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
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
  const [detecting, setDetecting] = useState(false);
  const [pinPrompt, setPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState("");
  // iter-173 · bump anon-geo key to invalidate stale Shegaon coords cached
  // during pre-fix sessions where GPS/IP triangulation was fuzzy.
  const ANON_GEO_KEY = "ef_anon_geo_v2";
  const ANON_LABEL_KEY = "ef_anon_label_v1"; // iter-174 · pincode override
  const [anonLatLng, setAnonLatLng] = useState(() => {
    try {
      const c = JSON.parse(window.sessionStorage.getItem(ANON_GEO_KEY) || "null");
      if (c && typeof c.lat === "number") return c;
    } catch { /* ignore */ }
    return null;
  });
  const [pinLabel, setPinLabel] = useState(() => {
    try { return window.sessionStorage.getItem(ANON_LABEL_KEY) || null; } catch { return null; }
  });

  // iter-174 · Manual pincode override — user types their pincode when
  // GPS/IP mis-identifies the city. India Post is authoritative for postal
  // geography; we call the same backend endpoint that /geo/reverse uses.
  const submitPincode = async () => {
    const pin = (pinInput || "").replace(/\D/g, "").slice(0, 6);
    if (pin.length !== 6) { return; }
    setDetecting(true);
    try {
      const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const j = await r.json();
      const first = Array.isArray(j) && j[0]?.Status === "Success" ? (j[0].PostOffice?.[0] || {}) : {};
      const district = (first.District || "").trim();
      const area = (first.Name || "").trim();
      const newLabel = [area, district, pin].filter(Boolean).join(", ") || `PIN ${pin}`;
      setPinLabel(newLabel);
      setLabel(newLabel);
      try { window.sessionStorage.setItem(ANON_LABEL_KEY, newLabel); } catch { /* ignore */ }
      setPinPrompt(false);
      setPinInput("");
    } catch { /* silently ignore — user can retry */ }
    finally { setDetecting(false); }
  };

  const requestGps = React.useCallback((force = false) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const obj = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try { window.sessionStorage.setItem(ANON_GEO_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
        setAnonLatLng(obj);
        setDetecting(false);
      },
      () => { setDetecting(false); },
      { maximumAge: force ? 0 : 60000, timeout: 15000, enableHighAccuracy: true }
    );
  }, []);

  // Auto-detect for anonymous (no user or user without lat/lng) — best-effort.
  useEffect(() => {
    const haveOwn = user && user.lat != null && user.lng != null;
    if (haveOwn || anonLatLng || pinLabel) return;
    requestGps(false);
  }, [user, anonLatLng, requestGps, pinLabel]);

  // Resolve which lat/lng to reverse-geocode
  const lat = user?.lat ?? anonLatLng?.lat;
  const lng = user?.lng ?? anonLatLng?.lng;

  useEffect(() => {
    if (lat == null || lng == null) { setLabel(null); return; }
    // iter-173 · cache key v3 forces a full re-fetch after this ship.
    const key = `geo:v3:${lat.toFixed(3)},${lng.toFixed(3)}`;
    const cached = sessionStorage.getItem(key);
    if (cached) { setLabel(cached); return; }
    let cancel = false;
    (async () => {
      // iter-169 · Use the backend /api/geo/reverse proxy. It does
      // Nominatim + India Post PIN verification and prefers the postal
      // District as the canonical city — fixes the "Shegaon vs Amravati"
      // mismatch that pure browser-side Nominatim was returning.
      try {
        const r = await api.get(`/geo/reverse?lat=${lat}&lng=${lng}`);
        const d = r?.data || {};
        const area = d.area || "";
        const city = d.city || "";
        const pin = d.pincode || "";
        const built = [area, city, pin].filter(Boolean).join(", ");
        const final = d.label || built || city || "your area";
        if (!cancel) { sessionStorage.setItem(key, final); setLabel(final); }
      } catch {
        if (!cancel) setLabel("your area");
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

  // iter-174 · when a manual pincode override is set, it wins over GPS.
  const effectiveLabel = pinLabel || label;
  if (pinPrompt) {
    return (
      <div className={`${cls} ${className} !w-auto !max-w-none`} data-testid="location-pill-pincode">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <input
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => { if (e.key === "Enter") submitPincode(); if (e.key === "Escape") setPinPrompt(false); }}
          placeholder="6-digit PIN"
          inputMode="numeric"
          className="bg-transparent outline-none w-20 text-inherit placeholder:text-inherit/60"
          autoFocus
          data-testid="location-pill-pin-input"
        />
        <button onClick={submitPincode} className="text-[10px] font-bold underline" data-testid="location-pill-pin-submit">Set</button>
      </div>
    );
  }

  if (lat == null || lng == null) {
    // No lat/lng available — show a CTA so user knows location is missing.
    const ctaLabel = detecting ? "Detecting…" : (user ? "Pin your location" : "Locate me");
    return (
      <button
        type="button"
        onClick={() => { if (user) { window.location.href = "/profile?pickLocation=1"; } else { requestGps(true); } }}
        onDoubleClick={() => setPinPrompt(true)}
        className={`${cls} ${className}`}
        data-testid={`location-pill-cta${variant === "strip" ? "-strip" : variant === "drawer" ? "-drawer" : ""}`}
      >
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{effectiveLabel || ctaLabel}</span>
      </button>
    );
  }

  // iter-174 · single tap re-detects GPS (anonymous) or opens profile picker
  // (logged in). Double tap opens the manual PIN input — a reliable escape
  // hatch when GPS/IP triangulation returns the wrong nearby town.
  const handleClick = (e) => {
    if (user) return; // let default anchor navigation run
    e.preventDefault();
    try {
      const stale = `geo:v3:${lat.toFixed(3)},${lng.toFixed(3)}`;
      sessionStorage.removeItem(stale);
    } catch { /* ignore */ }
    setLabel(null);
    requestGps(true);
  };

  return (
    <a
      href={user ? "/profile?pickLocation=1" : "#"}
      onClick={handleClick}
      onDoubleClick={(e) => { e.preventDefault(); setPinPrompt(true); }}
      className={`${cls} ${className}`}
      data-testid={`location-pill${variant === "strip" ? "-strip" : variant === "drawer" ? "-drawer" : ""}`}
      title={user ? "Your delivery location · double-tap to enter PIN" : "Tap to redetect · double-tap to enter PIN"}
    >
      <MapPin className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{detecting ? "Detecting…" : (effectiveLabel || "Locating…")}</span>
    </a>
  );
}
