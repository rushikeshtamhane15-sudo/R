/**
 * ContactMap — iter-115
 *
 * Lightweight Leaflet map for the public `/contact` page. Renders:
 *   • One marker at the branch kitchen (chef-hat icon)
 *   • One marker at the user's current GPS (blue pulse)
 *   • A dotted blue polyline tracing the OSRM driving route between them
 *   • Auto-fit bounds so both markers + the route are visible
 *
 * The route polyline is decoded from the GeoJSON `LineString` we get back
 * from OSRM via `overview=full&geometries=geojson`. We pass it in as the
 * `routeCoords` prop — Contact.jsx already fetches OSRM for the distance
 * pill, so this is the same single API call. Zero extra network.
 */
import React, { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Custom branch icon — small red chef-hat pin. Matches the rest of the brand.
const branchIcon = L.divIcon({
  className: "",
  iconSize: [40, 40],
  iconAnchor: [20, 36],
  html: `
    <div style="position:relative;width:40px;height:40px;">
      <div style="position:absolute;inset:0;background:#dc2626;border-radius:9999px;border:3px solid white;box-shadow:0 4px 12px rgba(0,0,0,.25);"></div>
      <svg viewBox="0 0 24 24" width="20" height="20"
           style="position:absolute;top:9px;left:10px;fill:white;">
        <path d="M6 14h12v6H6zM8 4a4 4 0 0 1 8 0 4 4 0 0 1 0 8v0H8a4 4 0 0 1 0-8Z"/>
      </svg>
    </div>`,
});

const meIcon = L.divIcon({
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `
    <div style="position:relative;width:22px;height:22px;">
      <div style="position:absolute;inset:0;background:#2563eb;border-radius:9999px;border:3px solid white;box-shadow:0 0 0 4px rgba(37,99,235,.25);"></div>
    </div>`,
});

function FitBounds({ a, b, route }) {
  const map = useMap();
  useEffect(() => {
    if (!a) return;
    const points = [a];
    if (b) points.push(b);
    if (route && route.length > 1) points.push(...route);
    if (points.length < 2) {
      map.setView(a, 15);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [a, b, route, map]);
  return null;
}

export default function ContactMap({ branchLat, branchLng, meLat, meLng, routeCoords }) {
  const branchPos = (branchLat && branchLng) ? [branchLat, branchLng] : null;
  const mePos = (meLat && meLng) ? [meLat, meLng] : null;
  if (!branchPos) return null;
  return (
    <MapContainer
      center={branchPos}
      zoom={15}
      scrollWheelZoom={false}
      zoomControl
      className="absolute inset-0 z-[1]"
      data-testid="contact-leaflet-map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={branchPos} icon={branchIcon} />
      {mePos && <Marker position={mePos} icon={meIcon} />}
      {routeCoords && routeCoords.length > 1 && (
        <Polyline
          positions={routeCoords}
          pathOptions={{
            color: "#2563eb",
            weight: 4,
            opacity: 0.9,
            dashArray: "8 8",
          }}
        />
      )}
      <FitBounds a={branchPos} b={mePos} route={routeCoords} />
    </MapContainer>
  );
}
