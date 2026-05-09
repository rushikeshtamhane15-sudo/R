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
