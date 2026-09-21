import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { MapPin } from "lucide-react";

/**
 * LocationPill — iter-55 / iter-56 / iter-177
 *
 * Shows a compact "Area, City — PIN" pill in the header (and drawer).
 *
 * iter-177 · Priority order for the label:
 *   1. Logged-in user whose profile stores lat/lng → reverse-geocode.
 *   2. Logged-in user with a mess_id but no personal GPS → show the
 *      MESS's city + pincode (fetched via /messes/by-id/{mess_id}).
 *   3. Anonymous with GPS cached → reverse-geocode via /geo/reverse.
 *   4. Anonymous with a manual PIN override → India Post lookup.
 *   5. Anonymous fallback → **"Amravati"** (efoodtech HQ) so the header
 *      never renders empty. Users can double-tap to override with a PIN.
 */
const DEFAULT_ANON_LABEL = "Amravati";
// iter-180 · Cross-instance sync event. Header + Login + Plans + Drawer can
// all render a LocationPill at the same time; when the user updates the
// location (PIN or GPS) on ONE pill, all others must re-read from storage.
const LOC_EVENT = "ef:location-updated";

export default function LocationPill({ className = "", variant = "default" }) {
  const { user } = useAuth();
  const [label, setLabel] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [pinPrompt, setPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState("");
  // iter-173 · bump anon-geo key to invalidate stale coords cached in older
  // sessions where GPS/IP triangulation was fuzzy.
  const ANON_GEO_KEY = "ef_anon_geo_v2";
  const ANON_LABEL_KEY = "ef_anon_label_v1";
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

  // iter-177 · Logged-in user's mess city (fallback when they have no
  // personal lat/lng). Fetched once per mess_id change.
  const [messLabel, setMessLabel] = useState(null);

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
      try {
        window.sessionStorage.setItem(ANON_LABEL_KEY, newLabel);
        // iter-180 · flush stale reverse-geocode entries so other pills that
        // used GPS won't keep rendering the old locality.
        for (const k of Object.keys(window.sessionStorage)) {
          if (k.startsWith("geo:v3:")) window.sessionStorage.removeItem(k);
        }
        window.sessionStorage.removeItem(ANON_GEO_KEY);
        setAnonLatLng(null);
        window.dispatchEvent(new CustomEvent(LOC_EVENT, { detail: { label: newLabel } }));
      } catch { /* ignore */ }
      setPinPrompt(false);
      setPinInput("");
    } catch { /* silently ignore */ }
    finally { setDetecting(false); }
  };

  const requestGps = React.useCallback((force = false) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const obj = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try {
          window.sessionStorage.setItem(ANON_GEO_KEY, JSON.stringify(obj));
          // iter-180 · a fresh GPS supersedes the last PIN override.
          window.sessionStorage.removeItem(ANON_LABEL_KEY);
        } catch { /* ignore */ }
        setPinLabel(null);
        setAnonLatLng(obj);
        setDetecting(false);
        try { window.dispatchEvent(new CustomEvent(LOC_EVENT, { detail: { lat: obj.lat, lng: obj.lng } })); } catch { /* ignore */ }
      },
      () => { setDetecting(false); },
      { maximumAge: force ? 0 : 60000, timeout: 15000, enableHighAccuracy: true }
    );
  }, []);

  // iter-180 · Listen for cross-instance updates from any OTHER LocationPill
  // on the page (Header vs Login-body vs Drawer). Re-read the freshest state
  // from sessionStorage.
  useEffect(() => {
    const onSync = () => {
      try {
        const pl = window.sessionStorage.getItem(ANON_LABEL_KEY) || null;
        const gs = JSON.parse(window.sessionStorage.getItem(ANON_GEO_KEY) || "null");
        setPinLabel(pl);
        setAnonLatLng(pl ? null : (gs && typeof gs.lat === "number" ? gs : null));
        if (pl) setLabel(pl);
      } catch { /* ignore */ }
    };
    window.addEventListener(LOC_EVENT, onSync);
    return () => window.removeEventListener(LOC_EVENT, onSync);
  }, []);

  // iter-177 · For logged-in users w/ a mess_id but no personal lat/lng,
  // fetch the MESS's city+pincode so the pill reflects their chosen mess.
  useEffect(() => {
    if (!user?.mess_id) { setMessLabel(null); return; }
    if (user.lat != null && user.lng != null) return; // profile GPS wins
    let cancel = false;
    (async () => {
      try {
        const r = await api.get(`/messes/by-id/${encodeURIComponent(user.mess_id)}`);
        const d = r?.data || {};
        const parts = [d.city, d.pincode].filter(Boolean);
        if (!cancel && parts.length) setMessLabel(parts.join(" · "));
      } catch { /* silently keep fallback */ }
    })();
    return () => { cancel = true; };
  }, [user?.mess_id, user?.lat, user?.lng]);

  // Auto-detect GPS for anonymous users — best-effort only.
  useEffect(() => {
    const haveOwn = user && user.lat != null && user.lng != null;
    if (haveOwn || anonLatLng || pinLabel) return;
    if (user) return; // logged-in without GPS falls back to messLabel, not GPS
    requestGps(false);
  }, [user, anonLatLng, requestGps, pinLabel]);

  const lat = user?.lat ?? anonLatLng?.lat;
  const lng = user?.lng ?? anonLatLng?.lng;

  useEffect(() => {
    if (lat == null || lng == null) { setLabel(null); return; }
    const key = `geo:v3:${lat.toFixed(3)},${lng.toFixed(3)}`;
    const cached = sessionStorage.getItem(key);
    if (cached) { setLabel(cached); return; }
    let cancel = false;
    (async () => {
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

  // iter-177 · Effective label priority. Personal PIN override > GPS reverse
  // > messLabel (logged-in) > anonymous default.
  const effectiveLabel = pinLabel || label || messLabel || (!user ? DEFAULT_ANON_LABEL : null);

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

  // Case: no lat/lng and no cached labels — anonymous falls to DEFAULT_ANON_LABEL,
  // logged-in with a resolved messLabel falls to that; both variants below render
  // a tappable pill that lets the user override.
  if (lat == null || lng == null) {
    const shownLabel = effectiveLabel || (detecting ? "Detecting…" : (user ? "Pin your location" : DEFAULT_ANON_LABEL));
    return (
      <button
        type="button"
        onClick={() => { if (user) { window.location.href = "/profile?pickLocation=1"; } else { requestGps(true); } }}
        onDoubleClick={() => setPinPrompt(true)}
        className={`${cls} ${className}`}
        data-testid={`location-pill-cta${variant === "strip" ? "-strip" : variant === "drawer" ? "-drawer" : ""}`}
        title={user ? "Tap to pin exact location · double-tap for PIN" : "Tap to detect location · double-tap to enter PIN"}
      >
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{shownLabel}</span>
      </button>
    );
  }

  const handleClick = (e) => {
    if (user) return;
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
