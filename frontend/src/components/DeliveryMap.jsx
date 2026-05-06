import React, { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Leaflet markers' default icons don't load via React bundling. Build them inline.
 */
function makeIcon({ color = "#a02323", text = "" } = {}) {
  const html = `
    <div style="position:relative;">
      <div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);box-shadow:0 2px 4px rgba(0,0,0,0.25);border:2px solid white;"></div>
      <div style="position:absolute;left:5px;top:3px;width:18px;height:18px;text-align:center;line-height:18px;font-size:10px;font-weight:700;color:white;font-family:system-ui;">${text}</div>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [28, 32], iconAnchor: [14, 28], popupAnchor: [0, -28] });
}

const ICON_BOY = makeIcon({ color: "#1e3a8a", text: "🛵" });
const ICON_FULL = makeIcon({ color: "#a02323", text: "F" });
const ICON_HALF = makeIcon({ color: "#d97706", text: "H" });
const ICON_DELIVERED = makeIcon({ color: "#10b981", text: "✓" });
const ICON_CUSTOMER = makeIcon({ color: "#a02323", text: "🏠" });

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const b = L.latLngBounds(points);
    map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
  }, [points, map]);
  return null;
}

/**
 * <DeliveryMap />
 *   - boy: { lat, lng, name } | null
 *   - customer: { lat, lng } | null  (optional; for customer-track view)
 *   - items: [{ customer_lat, customer_lng, name, tiffin_size, status }] | null
 *   - showRoute: bool — draw polyline from boy → items in order
 */
export default function DeliveryMap({ boy, customer, items, showRoute = false, height = 400 }) {
  const points = useMemo(() => {
    const arr = [];
    if (boy?.lat && boy?.lng) arr.push([boy.lat, boy.lng]);
    if (customer?.lat && customer?.lng) arr.push([customer.lat, customer.lng]);
    (items || []).forEach((it) => {
      if (it.customer_lat && it.customer_lng) arr.push([it.customer_lat, it.customer_lng]);
    });
    return arr;
  }, [boy, customer, items]);

  const routeLine = useMemo(() => {
    if (!showRoute || !boy?.lat || !items?.length) return null;
    return [
      [boy.lat, boy.lng],
      ...items.filter((i) => i.customer_lat && i.customer_lng).map((i) => [i.customer_lat, i.customer_lng]),
    ];
  }, [boy, items, showRoute]);

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No locations to show yet — pin yours or wait for the boy to share GPS.
      </div>
    );
  }

  const center = points[0];

  return (
    <div className="rounded-2xl overflow-hidden border border-border" style={{ height }} data-testid="delivery-map">
      <MapContainer center={center} zoom={14} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
        <FitBounds points={points} />
        {routeLine && <Polyline positions={routeLine} pathOptions={{ color: "#a02323", weight: 4, opacity: 0.7, dashArray: "6,8" }} />}
        {boy?.lat && (
          <Marker position={[boy.lat, boy.lng]} icon={ICON_BOY}>
            <Popup>
              <div className="font-display font-bold text-sm">{boy.name || "Delivery boy"}</div>
              {boy.last_ping_at && <div className="text-xs text-gray-600">Last ping: {new Date(boy.last_ping_at).toLocaleTimeString()}</div>}
            </Popup>
          </Marker>
        )}
        {customer?.lat && (
          <Marker position={[customer.lat, customer.lng]} icon={ICON_CUSTOMER}>
            <Popup><div className="font-semibold text-sm">Your home</div></Popup>
          </Marker>
        )}
        {(items || []).map((it, i) => {
          if (!it.customer_lat || !it.customer_lng) return null;
          const icon = it.status === "delivered" ? ICON_DELIVERED : it.tiffin_size === "half" ? ICON_HALF : ICON_FULL;
          return (
            <Marker key={it.roster_id || i} position={[it.customer_lat, it.customer_lng]} icon={icon}>
              <Popup>
                <div className="font-display font-bold text-sm">#{i + 1} · {it.name}</div>
                <div className="text-xs text-gray-600 capitalize">{it.tiffin_size} tiffin · {it.meal_type}</div>
                <div className="text-xs text-gray-500 mt-1">{it.address}</div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
