/* LocationPicker — leaflet-based address pin picker for restaurant checkout.
 *
 * Behaviour: on mount, requests browser geolocation (one-time prompt). If
 * granted, drops a draggable pin at user's coordinates. User can drag the
 * pin OR tap anywhere on the map to refine. Emits {lat, lng, accuracy?}
 * via onChange.
 *
 * Falls back to a default city center if permission denied.
 */
import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Locate, MapPin, Loader2 } from "lucide-react";
import { Button } from "./ui/button";

const DEFAULT_CENTER = { lat: 18.5204, lng: 73.8567 }; // Pune fallback

const PIN_HTML = `
  <div style="position:relative;width:36px;height:36px">
    <span style="position:absolute;inset:0;border-radius:50%;background:#10b981;opacity:0.18;animation:lp-pulse 1.6s ease-out infinite"></span>
    <span style="position:absolute;inset:5px;border-radius:50%;background:#fff;border:3px solid #10b981;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(16,185,129,0.45)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></svg>
    </span>
  </div>
  <style>@keyframes lp-pulse{0%{transform:scale(0.85);opacity:0.5}100%{transform:scale(1.7);opacity:0}}</style>
`;
const pinIcon = L.divIcon({ className: "lp-pin", html: PIN_HTML, iconSize: [36, 36], iconAnchor: [18, 18] });

function PinDragger({ pos, setPos }) {
  useMapEvents({ click: (e) => setPos({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  const ref = useRef(null);
  return (
    <Marker
      position={[pos.lat, pos.lng]}
      icon={pinIcon}
      draggable
      ref={ref}
      eventHandlers={{
        dragend: () => {
          const m = ref.current;
          if (!m) return;
          const ll = m.getLatLng();
          setPos({ lat: ll.lat, lng: ll.lng });
        },
      }}
    />
  );
}

function FlyTo({ pos }) {
  const map = useMap();
  useEffect(() => {
    if (pos?.lat && pos?.lng) {
      map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
    }
  }, [pos?.lat, pos?.lng, map]);
  return null;
}

export default function LocationPicker({ value, onChange, height = "h-56" }) {
  const [pos, setPos] = useState(value || null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  // Auto-detect on first mount if no value supplied
  useEffect(() => {
    if (value || !navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const next = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPos(next); onChange?.(next); setBusy(false);
      },
      () => {
        setDenied(true); setBusy(false);
        if (!pos) setPos(DEFAULT_CENTER);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSetPos = (next) => { setPos(next); onChange?.(next); };
  const reDetect = () => {
    if (!navigator.geolocation) return;
    setBusy(true); setDenied(false);
    navigator.geolocation.getCurrentPosition(
      (p) => { handleSetPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setBusy(false); },
      () => { setDenied(true); setBusy(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const center = pos || DEFAULT_CENTER;
  return (
    <div className="rounded-xl overflow-hidden border border-border bg-muted relative" data-testid="location-picker">
      <div className={`${height} w-full relative`}>
        <MapContainer center={[center.lat, center.lng]} zoom={pos ? 16 : 13} className="h-full w-full" scrollWheelZoom attributionControl={false}>
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution=''
          />
          {pos && <PinDragger pos={pos} setPos={handleSetPos} />}
          {pos && <FlyTo pos={pos} />}
        </MapContainer>
        {!pos && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm text-center px-5">
            <MapPin className="h-7 w-7 text-primary mb-1.5" />
            <p className="text-sm font-display font-extrabold">Where should we deliver?</p>
            <p className="text-xs text-muted-foreground mt-1">Tap anywhere on the map to drop a pin</p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 p-2.5 bg-card border-t border-border">
        <div className="text-[11px] text-muted-foreground min-w-0 truncate" data-testid="location-coords">
          {pos ? <>📍 <span className="tabular-nums font-mono">{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</span></> : "No pin yet"}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={reDetect}
          disabled={busy}
          className="rounded-full text-xs flex-shrink-0"
          data-testid="location-redetect"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Locate className="h-3.5 w-3.5 mr-1" />}
          {pos ? "Re-detect" : "Use my location"}
        </Button>
      </div>
      {denied && (
        <div className="px-3 py-2 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-200">
          Location permission denied — drag the pin manually instead.
        </div>
      )}
    </div>
  );
}
