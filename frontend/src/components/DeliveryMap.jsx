import React, { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./delivery-map.css";

// CartoDB Voyager — clean, polished, free, no API key
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = '';
const KM = 1000;

function makeIcon({ color = "#a02323", text = "" } = {}) {
  const html = `
    <div style="position:relative;">
      <div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);box-shadow:0 2px 4px rgba(0,0,0,0.25);border:2px solid white;"></div>
      <div style="position:absolute;left:5px;top:3px;width:18px;height:18px;text-align:center;line-height:18px;font-size:10px;font-weight:700;color:white;font-family:system-ui;">${text}</div>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [28, 32], iconAnchor: [14, 28], popupAnchor: [0, -28] });
}

// Animated delivery boy — pulsing ring + bobbing scooter emoji
function makeAnimatedBoyIcon() {
  const html = `
    <div class="efc-boy-marker">
      <span class="efc-boy-ring"></span>
      <span class="efc-boy-ring efc-boy-ring--delay"></span>
      <span class="efc-boy-pin">🛵</span>
    </div>`;
  return L.divIcon({ html, className: "efc-boy-icon", iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -20] });
}

// Dispatch / kitchen marker — solid badge with chef emoji
function makeDispatchIcon() {
  const html = `<div class="efc-dispatch-marker"><span>🍱</span></div>`;
  return L.divIcon({ html, className: "efc-dispatch-icon", iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18] });
}

const ICON_BOY_ANIM = makeAnimatedBoyIcon();
const ICON_DISPATCH = makeDispatchIcon();
const ICON_FULL = makeIcon({ color: "#a02323", text: "F" });
const ICON_HALF = makeIcon({ color: "#d97706", text: "H" });
const ICON_DELIVERED = makeIcon({ color: "#10b981", text: "✓" });
const ICON_CUSTOMER = makeIcon({ color: "#a02323", text: "🏠" });

function FitBounds({ points, padding = [40, 40] }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const b = L.latLngBounds(points);
    map.fitBounds(b, { padding, maxZoom: 15 });
  }, [points, map, padding]);
  return null;
}

function ApplyMaxBounds({ center, radiusKm }) {
  const map = useMap();
  useEffect(() => {
    if (!center || !radiusKm) return;
    // Convert km to degrees roughly (latitude only — close enough at small radii)
    const c = L.latLng(center[0], center[1]);
    const b = c.toBounds(radiusKm * 1000 * 2); // toBounds takes diameter in metres
    map.setMaxBounds(b.pad(0.1));
    map.setMinZoom(10);
    map.options.maxBoundsViscosity = 0.9;
  }, [center, radiusKm, map]);
  return null;
}

/**
 * <DeliveryMap />
 *   - boy:        { lat, lng, name, last_ping_at } | null   (animated)
 *   - customer:   { lat, lng } | null
 *   - items:      [{ customer_lat, customer_lng, name, tiffin_size, status }] | null
 *   - dispatch:   { lat, lng, radius_km } | null
 *   - showRoute:  bool — draw polyline boy → items in order
 *   - bounded:    bool — clamp the map to dispatch + radius_km (default true if dispatch given)
 */
export default function DeliveryMap({
  boy,
  customer,
  items,
  dispatch,
  showRoute = false,
  bounded,
  height = 400,
}) {
  const points = useMemo(() => {
    const arr = [];
    if (boy?.lat && boy?.lng) arr.push([boy.lat, boy.lng]);
    if (customer?.lat && customer?.lng) arr.push([customer.lat, customer.lng]);
    if (dispatch?.lat && dispatch?.lng) arr.push([dispatch.lat, dispatch.lng]);
    (items || []).forEach((it) => {
      if (it.customer_lat && it.customer_lng) arr.push([it.customer_lat, it.customer_lng]);
    });
    return arr;
  }, [boy, customer, items, dispatch]);

  const routeLine = useMemo(() => {
    if (!showRoute || !boy?.lat || !items?.length) return null;
    return [
      [boy.lat, boy.lng],
      ...items.filter((i) => i.customer_lat && i.customer_lng).map((i) => [i.customer_lat, i.customer_lng]),
    ];
  }, [boy, items, showRoute]);

  const radiusKm = dispatch?.radius_km || 15;
  const shouldBound = bounded !== false && dispatch?.lat && dispatch?.lng;

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No locations to show yet — pin yours or wait for the boy to share GPS.
      </div>
    );
  }

  const center = boy?.lat
    ? [boy.lat, boy.lng]
    : dispatch?.lat
    ? [dispatch.lat, dispatch.lng]
    : points[0];

  return (
    <div className="rounded-2xl overflow-hidden border border-border shadow-sm" style={{ height }} data-testid="delivery-map">
      <MapContainer center={center} zoom={13} scrollWheelZoom style={{ height: "100%", width: "100%" }} attributionControl={false}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains="abcd" />
        {shouldBound && <ApplyMaxBounds center={[dispatch.lat, dispatch.lng]} radiusKm={radiusKm} />}
        <FitBounds points={points} />
        {routeLine && (
          <Polyline
            positions={routeLine}
            pathOptions={{ color: "#a02323", weight: 4, opacity: 0.7, dashArray: "6,8" }}
          />
        )}
        {/* Dispatch (kitchen) — only renders when admin has set coordinates */}
        {dispatch?.lat && (
          <>
            <Circle
              center={[dispatch.lat, dispatch.lng]}
              radius={radiusKm * KM}
              pathOptions={{ color: "#a02323", weight: 1.5, opacity: 0.45, fillOpacity: 0.04, dashArray: "4,6" }}
            />
            <Marker position={[dispatch.lat, dispatch.lng]} icon={ICON_DISPATCH}>
              <Popup>
                <div className="font-display font-bold text-sm">Dispatch · kitchen</div>
                <div className="text-xs text-gray-600 mt-0.5">{radiusKm} km service zone</div>
              </Popup>
            </Marker>
          </>
        )}
        {boy?.lat && (
          <Marker position={[boy.lat, boy.lng]} icon={ICON_BOY_ANIM}>
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
                {it.tiffin_balance > 0 && (
                  <div className="text-xs text-amber-700 font-bold mt-1">⚠ {it.tiffin_balance} empty tiffin{it.tiffin_balance !== 1 ? "s" : ""} to collect</div>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
