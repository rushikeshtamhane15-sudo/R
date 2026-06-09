/**
 * lib/serviceability.js — iter-61 #5
 *
 * Gate that runs ONLY when user hits Subscribe / Add-to-Cart / Buy now.
 * Tries to detect location silently; if denied or unavailable, shows the
 * compulsory permission popup. Resolves with {ok: true, lat, lng} only when
 * we have a fresh in-range fix; otherwise resolves {ok: false, reason}.
 */
import { api } from "./api";

const SS_KEY = "efc_user_geo_v2";

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function readCached() {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// iter-78 #2: strip raw lat/lng coords from old session caches so we never
// show "20.892, 77.764" to a user — only real reverse-geocoded addresses.
const COORD_LABEL_RE = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/;
function safeLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (COORD_LABEL_RE.test(s)) return "";
  return s;
}

/**
 * Request a serviceability fix. Returns:
 *   { ok: true, lat, lng, km, label }    — got a fresh in-range fix
 *   { ok: false, reason }                — denied / out-of-range / no GPS / timeout
 */
export async function ensureServiceableFix({ persistToUser = true } = {}) {
  // 1) Read kitchen dispatch + radius
  let kitchen;
  try {
    const r = await api.get("/restaurant/serviceable-area");
    kitchen = { lat: r.data?.dispatch_lat, lng: r.data?.dispatch_lng, radius: Number(r.data?.dispatch_radius_km || 15) };
    if (!kitchen.lat || !kitchen.lng) return { ok: false, reason: "kitchen-unknown" };
  } catch { return { ok: false, reason: "kitchen-fetch-failed" }; }

  // 2) Try a cached fix first (10 min freshness for action-time gate)
  const cached = readCached();
  if (cached && cached.lat && cached.lng) {
    const km = haversineKm(cached.lat, cached.lng, kitchen.lat, kitchen.lng);
    if (km <= kitchen.radius) return { ok: true, lat: cached.lat, lng: cached.lng, km: +km.toFixed(1), label: safeLabel(cached.label) };
    return { ok: false, reason: "out-of-range", km: +km.toFixed(1), radius: kitchen.radius, label: safeLabel(cached.label) };
  }

  // 3) No cache → request a fresh GPS fix
  if (!("geolocation" in navigator)) return { ok: false, reason: "no-gps" };
  const pos = await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      (err) => resolve({ _err: err }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
  if (pos._err) {
    const code = pos._err.code;
    return { ok: false, reason: code === 1 ? "permission-denied" : "gps-error" };
  }
  const { latitude: lat, longitude: lng } = pos.coords;
  const km = haversineKm(lat, lng, kitchen.lat, kitchen.lng);

  let label = "";
  try {
    const g = await api.get(`/geo/reverse?lat=${lat}&lng=${lng}`);
    label = g.data.label || "";
  } catch { /* ignore */ }

  try { sessionStorage.setItem(SS_KEY, JSON.stringify({ lat, lng, km, label })); } catch {}

  if (km > kitchen.radius) return { ok: false, reason: "out-of-range", km: +km.toFixed(1), radius: kitchen.radius, label };

  if (persistToUser) {
    try { await api.post("/auth/location", { lat, lng }); } catch { /* ignore */ }
  }

  return { ok: true, lat, lng, km: +km.toFixed(1), label };
}
