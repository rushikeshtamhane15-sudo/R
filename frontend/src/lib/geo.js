/* Geo helpers — haversine distance + naive ETA estimates.
 * Pure functions, no deps, work in browser & node.
 */

/** Haversine distance in kilometers between two {lat, lng} points. */
export function haversineKm(a, b) {
  if (!a || !b) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return +(R * c).toFixed(2);
}

/**
 * Naive ETA estimate.
 * Assumes urban delivery: average 22 km/h base speed, with a "traffic factor"
 * by hour-of-day:
 *   • 8–10am, 12–2pm, 6–9pm: 0.65× (rush)
 *   • else: 1.0×
 * Returns minutes (rounded to nearest int) or null.
 *
 * Returns at minimum 4 min (we don't want "0 min" while a marker is across the road).
 */
export function etaMinutes(km, baseKmh = 22) {
  if (km == null || km < 0) return null;
  const now = new Date();
  const hr = now.getHours();
  const isRush = (hr >= 8 && hr < 10) || (hr >= 12 && hr < 14) || (hr >= 18 && hr < 21);
  const factor = isRush ? 0.65 : 1.0;
  const speed = baseKmh * factor;
  const min = Math.round((km / speed) * 60);
  return Math.max(4, min);
}

/** Convenience: returns a label like "3.4 km · ~12 min" or null. */
export function distEtaLabel(from, to) {
  const km = haversineKm(from, to);
  if (km == null) return null;
  const min = etaMinutes(km);
  return `${km.toFixed(1)} km · ~${min} min`;
}

// ---------------------------------------------------------------------------
// OSRM road-snapped routing (free public demo server).
// Returns { km, min, source: 'osrm' } using actual road network distance
// and OSRM's own duration estimate (which factors in road class).
// Falls back gracefully — caller handles null.
// ---------------------------------------------------------------------------
const _osrmCache = new Map(); // key = "lat1,lng1|lat2,lng2" rounded → {ts, data}
const _OSRM_TTL_MS = 30_000; // 30 s — refreshes when rider pings every 15 s

const _osrmKey = (a, b) =>
  `${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

export async function osrmRoute(from, to, { signal } = {}) {
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) return null;
  const key = _osrmKey(from, to);
  const cached = _osrmCache.get(key);
  if (cached && Date.now() - cached.ts < _OSRM_TTL_MS) return cached.data;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json = await res.json();
    const route = json?.routes?.[0];
    if (!route) return null;
    // Apply rush-hour traffic factor on top of OSRM's free-flow duration.
    const hr = new Date().getHours();
    const isRush = (hr >= 8 && hr < 10) || (hr >= 12 && hr < 14) || (hr >= 18 && hr < 21);
    const trafficMultiplier = isRush ? 1.45 : 1.05;
    const data = {
      km: +(route.distance / 1000).toFixed(2),
      min: Math.max(4, Math.round((route.duration / 60) * trafficMultiplier)),
      source: "osrm",
    };
    _osrmCache.set(key, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

/** distEta with OSRM road-snap + haversine fallback. Async. */
export async function distEtaSmart(from, to) {
  const snapped = await osrmRoute(from, to);
  if (snapped) return snapped;
  const km = haversineKm(from, to);
  if (km == null) return null;
  return { km, min: etaMinutes(km), source: "haversine" };
}
