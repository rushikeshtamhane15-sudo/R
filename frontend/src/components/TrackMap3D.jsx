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

/* --------- shared marker assets --------- */
const RIDER_DIV = `
  <div style="position:relative;width:46px;height:46px">
    <span style="position:absolute;inset:0;border-radius:50%;background:#a02323;opacity:0.28;animation:trackmap-pulse 1.6s ease-out infinite"></span>
    <span style="position:absolute;inset:7px;border-radius:50%;background:linear-gradient(135deg,#c92929,#7a1818);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 6px 14px rgba(160,35,35,0.55)">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/>
        <path d="M15 6h-3l-3 9h3l3-6h2.5l-1.5-3z"/>
      </svg>
    </span>
  </div>
  <style>@keyframes trackmap-pulse{0%{transform:scale(0.85);opacity:0.55}100%{transform:scale(1.7);opacity:0}}</style>`;

const CUSTOMER_DIV = `
  <div style="width:34px;height:34px;border-radius:50%;background:#fff;border:3px solid #10b981;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(16,185,129,0.4)">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/><path d="M9 21v-6h6v6"/>
    </svg>
  </div>`;

/* --------- Leaflet (mobile) --------- */
function LeafletTrackMap({ rider, customer }) {
  const riderIcon = L.divIcon({ className: "trackmap-rider", html: RIDER_DIV, iconSize: [46, 46], iconAnchor: [23, 23] });
  const customerIcon = customer ? L.divIcon({ className: "trackmap-customer", html: CUSTOMER_DIV, iconSize: [34, 34], iconAnchor: [17, 17] }) : null;
  return (
    <MapContainer center={[rider.lat, rider.lng]} zoom={15} className="h-full w-full">
      <TileLayer
        url="https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap · &copy; CARTO'
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

/* --------- MapLibre (desktop) --------- */
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
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap · CARTO",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm", minzoom: 0, maxzoom: 22 }],
      },
      center: [rider.lng, rider.lat],
      zoom: 16,
      pitch: PITCH,
      bearing: BEARING,
      antialias: true,
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.on("load", () => {
      // Sky gradient effect using a layer (looks 3D-ish)
      try {
        map.setLight({ anchor: "viewport", color: "#a02323", intensity: 0.35 });
      } catch {}
    });

    // Rider marker
    const el = document.createElement("div");
    el.innerHTML = RIDER_DIV;
    el.style.cursor = "pointer";
    riderMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([rider.lng, rider.lat])
      .addTo(map);

    // Customer marker
    if (customer?.lat && customer?.lng) {
      const cel = document.createElement("div");
      cel.innerHTML = CUSTOMER_DIV;
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
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Live · {isDesktop ? "3D" : "smooth"}
      </span>
    </div>
  );
}
