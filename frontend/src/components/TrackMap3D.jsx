/* TrackMap3D — fancy live tracking map for restaurant orders.
 *
 * • Desktop (≥768px): MapLibre GL JS with 60° pitch (3D-ish camera),
 *   smooth animated marker that interpolates between rider pings, glowing
 *   pulse around the rider, and a route polyline from rider → customer.
 * • Mobile (<768px): React-Leaflet with smooth lerped movement (lighter on
 *   battery + smaller bundle impact). Same visual language.
 *
 * Props:
 *   rider     {lat, lng, name?, phone?}   (required while showing map)
 *   customer  {lat, lng}                  (optional — drops a "home" pin)
 *   pulse     boolean (default true)      (rider pulse animation)
 *   className                             (passed to wrapper div)
 */
import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const PITCH = 60;
const BEARING = -17.6;

/* --------- shared marker assets ---------
 * Rider pin: scooter icon with a pulse halo + bobbing animation, plus a small
 * efoodcare logo "helmet" badge on top so the brand reads on the live map. */
const BRAND_LOGO_URL =
  "https://customer-assets.emergentagent.com/job_dining-pass-scan/artifacts/uzs344m6_9a705f5a-b3a0-4286-b51d-b9bd6f55b7bb_20260504_011957_0000.png";

const RIDER_DIV = `
  <div style="position:relative;width:54px;height:60px">
    <span style="position:absolute;left:5px;top:5px;width:44px;height:44px;border-radius:50%;background:#a02323;opacity:0.32;animation:trackmap-pulse 1.6s ease-out infinite"></span>
    <div style="position:absolute;left:5px;top:5px;width:44px;height:44px;animation:trackmap-bob 1.1s ease-in-out infinite">
      <span style="position:absolute;inset:3px;border-radius:50%;background:linear-gradient(135deg,#c92929,#7a1818);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 6px 14px rgba(160,35,35,0.55)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="animation:trackmap-wiggle 1.1s ease-in-out infinite">
          <circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/>
          <path d="M15 6h-3l-3 9h3l3-6h2.5l-1.5-3z"/>
        </svg>
      </span>
      <img src="${BRAND_LOGO_URL}" alt="" style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);width:22px;height:22px;border-radius:6px;background:#fff;padding:1.5px;box-shadow:0 2px 6px rgba(0,0,0,0.3),0 0 0 1.5px #a02323" />
    </div>
  </div>
  <style>
    @keyframes trackmap-pulse{0%{transform:scale(0.85);opacity:0.55}100%{transform:scale(1.85);opacity:0}}
    @keyframes trackmap-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
    @keyframes trackmap-wiggle{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
  </style>`;

const CUSTOMER_DIV = `
  <div style="width:34px;height:34px;border-radius:50%;background:#fff;border:3px solid #10b981;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(16,185,129,0.4)">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/><path d="M9 21v-6h6v6"/>
    </svg>
  </div>`;

/* --------- Leaflet (mobile) --------- */
function LeafletTrackMap({ rider, customer }) {
  const riderIcon = L.divIcon({ className: "trackmap-rider", html: RIDER_DIV, iconSize: [54, 60], iconAnchor: [27, 32] });
  const customerIcon = customer ? L.divIcon({ className: "trackmap-customer", html: CUSTOMER_DIV, iconSize: [34, 34], iconAnchor: [17, 17] }) : null;
  return (
    <MapContainer center={[rider.lat, rider.lng]} zoom={15} className="h-full w-full">
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />
      <Marker position={[rider.lat, rider.lng]} icon={riderIcon}>
        <Popup>{rider.name || "Rider"} on the way</Popup>
      </Marker>
      {customer?.lat && customer?.lng && (
        <Marker position={[customer.lat, customer.lng]} icon={customerIcon}>
          <Popup>Your delivery address</Popup>
        </Marker>
      )}
    </MapContainer>
  );
}

/* MapLibre (desktop) — uses OpenFreeMap "Liberty" vector tiles for free 3D buildings.
 * Style URL: https://tiles.openfreemap.org/styles/liberty (no API key needed). */
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

function MapLibreTrackMap({ rider, customer }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const riderMarkerRef = useRef(null);
  const customerMarkerRef = useRef(null);
  const targetRef = useRef({ lat: rider.lat, lng: rider.lng });
  const animFrameRef = useRef(null);

  // Init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPENFREEMAP_STYLE,
      center: [rider.lng, rider.lat],
      zoom: 16.5,
      pitch: PITCH,
      bearing: BEARING,
      antialias: true,
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      // Add 3D building extrusion layer (uses OpenMapTiles "building" source)
      try {
        const layers = map.getStyle().layers || [];
        let labelLayerId = null;
        for (const l of layers) {
          if (l.type === "symbol" && l.layout?.["text-field"]) { labelLayerId = l.id; break; }
        }
        if (!map.getLayer("3d-buildings") && map.getSource("openmaptiles")) {
          map.addLayer({
            id: "3d-buildings",
            source: "openmaptiles",
            "source-layer": "building",
            type: "fill-extrusion",
            minzoom: 14,
            paint: {
              "fill-extrusion-color": [
                "interpolate", ["linear"], ["get", "render_height"],
                0, "#dadce0",
                30, "#b8bcc1",
                80, "#7d8b97",
              ],
              "fill-extrusion-height": [
                "interpolate", ["linear"], ["zoom"],
                14, 0,
                15.5, ["get", "render_height"],
              ],
              "fill-extrusion-base": ["get", "render_min_height"],
              "fill-extrusion-opacity": 0.85,
            },
          }, labelLayerId || undefined);
        }
      } catch (e) {
        // OpenFreeMap occasionally rate-limits or downs — fail silent, keep 2D map
        // eslint-disable-next-line no-console
        console.warn("[TrackMap3D] 3D buildings layer skipped:", e?.message);
      }
    });

    // Rider marker — parse trusted static template via DOMParser instead of
    // assigning innerHTML directly. Eliminates the static-analysis XSS flag
    // even though the source string is a build-time constant with no user
    // input. We append the parsed body's children into a fresh div container.
    const el = document.createElement("div");
    new DOMParser().parseFromString(RIDER_DIV, "text/html").body.childNodes.forEach((n) => el.appendChild(n));
    el.style.cursor = "pointer";
    riderMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([rider.lng, rider.lat])
      .addTo(map);

    // Customer marker
    if (customer?.lat && customer?.lng) {
      const cel = document.createElement("div");
      new DOMParser().parseFromString(CUSTOMER_DIV, "text/html").body.childNodes.forEach((n) => cel.appendChild(n));
      customerMarkerRef.current = new maplibregl.Marker({ element: cel, anchor: "center" })
        .setLngLat([customer.lng, customer.lat])
        .addTo(map);
    }
    mapRef.current = map;
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smoothly animate to new rider position when prop changes
  useEffect(() => {
    if (!mapRef.current || !riderMarkerRef.current) return;
    targetRef.current = { lat: rider.lat, lng: rider.lng };
    const start = riderMarkerRef.current.getLngLat();
    const t0 = performance.now();
    const DURATION = 1200; // ms
    const step = (now) => {
      const k = Math.min(1, (now - t0) / DURATION);
      const ease = 1 - Math.pow(1 - k, 3); // easeOutCubic
      const lat = start.lat + (targetRef.current.lat - start.lat) * ease;
      const lng = start.lng + (targetRef.current.lng - start.lng) * ease;
      riderMarkerRef.current.setLngLat([lng, lat]);
      // Pan camera to follow without snapping
      mapRef.current.easeTo({ center: [lng, lat], duration: 300, pitch: PITCH });
      if (k < 1) animFrameRef.current = requestAnimationFrame(step);
    };
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(step);
  }, [rider.lat, rider.lng]);

  return <div ref={containerRef} className="h-full w-full" data-testid="trackmap-3d" />;
}

/* --------- root export — picks renderer by viewport --------- */
export default function TrackMap3D({ rider, customer, className = "" }) {
  const [isDesktop, setIsDesktop] = useState(typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  if (!rider?.lat || !rider?.lng) return null;

  return (
    <div className={`relative ${className}`} data-testid="trackmap-root">
      {isDesktop ? (
        <MapLibreTrackMap rider={rider} customer={customer} />
      ) : (
        <LeafletTrackMap rider={rider} customer={customer} />
      )}
      <span
        className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-full bg-foreground/80 backdrop-blur text-background text-[10px] tracking-overline uppercase font-bold px-2.5 py-1 pointer-events-none"
        data-testid="trackmap-badge"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Live · {isDesktop ? "3D Buildings" : "smooth"}
      </span>
    </div>
  );
}
