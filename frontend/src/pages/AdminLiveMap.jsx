import React, { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "../components/delivery-map.css";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Loader2, RefreshCw, Truck, MapPin, Settings as SettingsIcon, Bike, ChefHat } from "lucide-react";
import { Link } from "react-router-dom";
import { haversineKm, etaMinutes } from "../lib/geo";

const REFRESH_MS = 10000;
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> · CARTO';

function makePinIcon({ color, label }) {
  const html = `
    <div style="position:relative;">
      <div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);box-shadow:0 2px 4px rgba(0,0,0,0.3);border:2px solid white;"></div>
      <div style="position:absolute;left:0;top:3px;width:30px;text-align:center;font-size:11px;font-weight:800;color:white;font-family:system-ui;">${label}</div>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [30, 34], iconAnchor: [15, 30], popupAnchor: [0, -28] });
}

function makeAnimatedBoyIcon() {
  const html = `
    <div class="efc-boy-marker">
      <span class="efc-boy-ring"></span>
      <span class="efc-boy-ring efc-boy-ring--delay"></span>
      <span class="efc-boy-pin">🛵</span>
    </div>`;
  return L.divIcon({ html, className: "efc-boy-icon", iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -20] });
}

function makeDispatchIcon() {
  const html = `<div class="efc-dispatch-marker"><span>🍱</span></div>`;
  return L.divIcon({ html, className: "efc-dispatch-icon", iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18] });
}

const ICON_BOY_ON = makeAnimatedBoyIcon();
const ICON_BOY_OFF = makePinIcon({ color: "#6b7280", label: "🛵" });
const ICON_DISPATCH = makeDispatchIcon();
const ICON_PENDING = makePinIcon({ color: "#a02323", label: "•" });
const ICON_DELIVERED = makePinIcon({ color: "#10b981", label: "✓" });

function makeRiderIcon() {
  // Restaurant rider — red pulse, distinct from the green delivery boy
  const html = `
    <div class="efc-rider-marker" style="position:relative;width:44px;height:44px">
      <span style="position:absolute;inset:0;border-radius:50%;background:#a02323;opacity:0.22;animation:efc-rider-pulse 1.4s ease-out infinite"></span>
      <span style="position:absolute;inset:6px;border-radius:50%;background:linear-gradient(135deg,#c92929,#7a1818);display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;box-shadow:0 4px 10px rgba(160,35,35,0.5)">🛵</span>
    </div>
    <style>@keyframes efc-rider-pulse{0%{transform:scale(0.8);opacity:0.5}100%{transform:scale(1.7);opacity:0}}</style>`;
  return L.divIcon({ html, className: "efc-rider-icon", iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -20] });
}

function makeRestaurantOrderIcon() {
  // Restaurant order customer pin — red home outline
  const html = `<div style="width:32px;height:32px;border-radius:50%;background:#fff;border:3px solid #a02323;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 8px rgba(160,35,35,0.4);font-size:14px">🍽️</div>`;
  return L.divIcon({ html, className: "", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16] });
}

const ICON_RIDER = makeRiderIcon();
const ICON_RESTAURANT_CUSTOMER = makeRestaurantOrderIcon();

function FitAll({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 14 });
  }, [points, map]);
  return null;
}

function ApplyBounds({ center, radiusKm }) {
  const map = useMap();
  useEffect(() => {
    if (!center || !radiusKm) return;
    const c = L.latLng(center[0], center[1]);
    const b = c.toBounds(radiusKm * 1000 * 2);
    map.setMaxBounds(b.pad(0.1));
    map.setMinZoom(10);
  }, [center, radiusKm, map]);
  return null;
}

export default function AdminLiveMap() {
  const [data, setData] = useState(null);
  const [restaurantData, setRestaurantData] = useState({ orders: [], riders: [] });
  const [loading, setLoading] = useState(true);
  const [selectedBoy, setSelectedBoy] = useState(null);

  const load = async () => {
    try {
      const [tiffin, restaurant] = await Promise.all([
        api.get("/admin/delivery/live"),
        api.get("/admin/live/restaurant").catch(() => ({ data: { orders: [], riders: [] } })),
      ]);
      setData(tiffin.data);
      setRestaurantData(restaurant.data || { orders: [], riders: [] });
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const dispatch = data?.dispatch;
  const radiusKm = dispatch?.radius_km || 15;
  const hasDispatch = !!(dispatch?.lat && dispatch?.lng);

  const boys = useMemo(() => data?.boys || [], [data]);
  const items = useMemo(() => data?.items || [], [data]);

  // Only show boys who are on a trip + have a recent ping (per user spec: "only visible with animated delivery boy")
  const liveBoys = useMemo(() => boys.filter((b) => b.on_trip && b.current_lat), [boys]);

  const liveRiders = useMemo(() => restaurantData.riders.filter((r) => r.is_live && r.lat && r.lng), [restaurantData.riders]);
  const restaurantOrders = useMemo(() => restaurantData.orders || [], [restaurantData]);

  // For each in-flight order with a customer pin, compute the closest live rider
  // (or its already-assigned rider) and the projected ETA.
  const orderEta = useMemo(() => {
    const map = {};
    restaurantOrders.forEach((o) => {
      if (!o.customer_lat || !o.customer_lng) return;
      // Prefer the rider currently assigned + on the order doc
      let from = null;
      let nearestRider = null;
      if (o.rider_lat && o.rider_lng) {
        from = { lat: o.rider_lat, lng: o.rider_lng };
      } else if (liveRiders.length > 0) {
        // Pick nearest live rider by haversine
        let bestKm = Infinity;
        for (const r of liveRiders) {
          const km = haversineKm({ lat: r.lat, lng: r.lng }, { lat: o.customer_lat, lng: o.customer_lng });
          if (km != null && km < bestKm) { bestKm = km; nearestRider = r; from = { lat: r.lat, lng: r.lng }; }
        }
      }
      if (!from) return;
      const km = haversineKm(from, { lat: o.customer_lat, lng: o.customer_lng });
      const min = etaMinutes(km);
      map[o.order_id] = { km, min, nearestRider, sourceLabel: o.rider_lat ? "assigned" : "nearest" };
    });
    return map;
  }, [restaurantOrders, liveRiders]);

  const points = useMemo(() => {
    const arr = [];
    if (hasDispatch) arr.push([dispatch.lat, dispatch.lng]);
    liveBoys.forEach((b) => arr.push([b.current_lat, b.current_lng]));
    items.forEach((it) => { if (it.customer_lat) arr.push([it.customer_lat, it.customer_lng]); });
    liveRiders.forEach((r) => arr.push([r.lat, r.lng]));
    restaurantOrders.forEach((o) => { if (o.customer_lat) arr.push([o.customer_lat, o.customer_lng]); });
    return arr;
  }, [hasDispatch, dispatch, liveBoys, items, liveRiders, restaurantOrders]);

  const activeBoys = liveBoys;
  const totalPending = items.filter((i) => i.status === "planned" || i.status === "out").length;
  const totalDelivered = items.filter((i) => i.status === "delivered").length;

  const boyRoute = useMemo(() => {
    if (!selectedBoy) return null;
    const boy = boys.find((b) => b.boy_id === selectedBoy);
    if (!boy?.current_lat) return null;
    const stops = items.filter((i) => i.delivery_boy_id === selectedBoy && i.customer_lat && i.status !== "delivered");
    return [
      [boy.current_lat, boy.current_lng],
      ...stops.map((s) => [s.customer_lat, s.customer_lng]),
    ];
  }, [selectedBoy, boys, items]);

  if (loading) {
    return <div className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading live map…</div>;
  }

  return (
    <div className="space-y-5" data-testid="admin-live-map">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Operations</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-1">Live tracking</h1>
          <p className="text-sm text-muted-foreground mt-2">
            All live deliveries — <span className="font-bold text-emerald-700">tiffin boys</span> + <span className="font-bold text-rose-700">restaurant riders</span> + customer pins on one map. Auto-refreshes every {REFRESH_MS / 1000}s.
          </p>
        </div>
        <Button onClick={load} variant="outline" className="rounded-full" data-testid="live-refresh">
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {!hasDispatch && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center gap-3" data-testid="dispatch-needed">
          <MapPin className="h-5 w-5 text-amber-600" />
          <div className="flex-1 min-w-0 text-xs text-amber-900">
            Dispatch (kitchen) location isn't set yet — set it to lock the map within a {radiusKm} km service zone and show the kitchen pin.
          </div>
          <Link to="/admin/delivery">
            <Button size="sm" className="rounded-full bg-amber-600 hover:bg-amber-700 text-white" data-testid="set-dispatch-cta">
              <SettingsIcon className="h-3.5 w-3.5 mr-1.5" /> Set dispatch
            </Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Tiffin boys" value={activeBoys.length} hint={`of ${boys.length} on trip`} />
        <Stat label="Restaurant riders" value={liveRiders.length} hint="live now" />
        <Stat label="Restaurant orders" value={restaurantOrders.length} hint="in flight" />
        <Stat label="Tiffin pending" value={totalPending} hint="planned + out" />
      </div>

      <div className="grid lg:grid-cols-[1fr_280px] gap-5">
        <div className="rounded-2xl overflow-hidden border border-border bg-card shadow-sm" style={{ height: 540 }}>
          {points.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-sm text-muted-foreground">
              <MapPin className="h-8 w-8 mb-2" />
              No live boys yet — dispatch + active runs will appear here.
            </div>
          ) : (
            <MapContainer center={hasDispatch ? [dispatch.lat, dispatch.lng] : points[0]} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
              <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains="abcd" />
              {hasDispatch && <ApplyBounds center={[dispatch.lat, dispatch.lng]} radiusKm={radiusKm} />}
              <FitAll points={points} />
              {hasDispatch && (
                <>
                  <Circle
                    center={[dispatch.lat, dispatch.lng]}
                    radius={radiusKm * 1000}
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
              {boyRoute && <Polyline positions={boyRoute} pathOptions={{ color: "#1e3a8a", weight: 4, opacity: 0.65, dashArray: "6,8" }} />}
              {/* Only render boys when they have animated state (on_trip + GPS) */}
              {liveBoys.map((b) => (
                <Marker
                  key={b.boy_id}
                  position={[b.current_lat, b.current_lng]}
                  icon={ICON_BOY_ON}
                  eventHandlers={{ click: () => setSelectedBoy(b.boy_id) }}
                >
                  <Popup>
                    <div className="font-display font-bold text-sm">{b.name}</div>
                    <div className="text-xs text-gray-600">{b.phone}</div>
                    {b.last_ping_at && <div className="text-xs text-gray-500 mt-1">Last ping: {new Date(b.last_ping_at).toLocaleTimeString()}</div>}
                    <div className="text-xs mt-1 font-semibold text-emerald-600">On trip</div>
                  </Popup>
                </Marker>
              ))}
              {items.map((it) => it.customer_lat ? (
                <Marker
                  key={it.roster_id}
                  position={[it.customer_lat, it.customer_lng]}
                  icon={it.status === "delivered" ? ICON_DELIVERED : ICON_PENDING}
                >
                  <Popup>
                    <div className="font-display font-bold text-sm">{it.name}</div>
                    <div className="text-xs text-gray-600 capitalize">{it.tiffin_size} · {it.meal_type}</div>
                    <div className="text-xs text-gray-500 mt-1 capitalize">Status: {it.status}</div>
                    {it.tiffin_balance > 0 && (
                      <div className="text-xs text-amber-700 font-bold mt-1">⚠ {it.tiffin_balance} empty tiffin{it.tiffin_balance !== 1 ? "s" : ""} held</div>
                    )}
                  </Popup>
                </Marker>
              ) : null)}
              {/* Restaurant riders — animated red bike pulse */}
              {liveRiders.map((r) => (
                <Marker key={`rider-${r.rider_id}`} position={[r.lat, r.lng]} icon={ICON_RIDER}>
                  <Popup>
                    <div className="font-display font-bold text-sm">{r.name || "Rider"}</div>
                    <div className="text-xs text-gray-600">{r.phone}</div>
                    <div className="text-xs mt-1 font-semibold text-rose-700">🛵 Restaurant rider · live</div>
                  </Popup>
                </Marker>
              ))}
              {/* Restaurant order customer pins + rider route polyline */}
              {restaurantOrders.map((o) => {
                if (!o.customer_lat || !o.customer_lng) return null;
                const eta = orderEta[o.order_id];
                const from = eta?.nearestRider
                  ? [eta.nearestRider.lat, eta.nearestRider.lng]
                  : (o.rider_lat && o.rider_lng ? [o.rider_lat, o.rider_lng] : null);
                return (
                  <React.Fragment key={`rorder-${o.order_id}`}>
                    {from && (
                      <Polyline
                        positions={[from, [o.customer_lat, o.customer_lng]]}
                        pathOptions={{ color: "#a02323", weight: 3, opacity: 0.55, dashArray: "4,6" }}
                      />
                    )}
                    <Marker position={[o.customer_lat, o.customer_lng]} icon={ICON_RESTAURANT_CUSTOMER}>
                      <Popup>
                        <div className="font-display font-bold text-sm">{o.name || "Customer"}</div>
                        <div className="text-xs text-gray-600 capitalize">🍽️ Restaurant · {o.status.replace(/_/g, " ")}</div>
                        {o.address && <div className="text-xs text-gray-500 mt-1 truncate" style={{maxWidth:"180px"}}>{o.address}</div>}
                        <div className="text-xs mt-1 font-semibold">₹{Number(o.total||0).toFixed(0)}</div>
                        {eta && (
                          <div className="text-xs mt-1.5 px-2 py-1 rounded-md bg-rose-50 text-rose-800 font-bold">
                            🛵 {eta.km?.toFixed(1)} km · ~{eta.min} min
                            <span className="text-[10px] font-normal block text-rose-700 mt-0.5">{eta.sourceLabel} rider{eta.nearestRider?.name ? ` · ${eta.nearestRider.name}` : ""}</span>
                          </div>
                        )}
                      </Popup>
                    </Marker>
                  </React.Fragment>
                );
              })}
            </MapContainer>
          )}
        </div>

        <aside className="space-y-2" data-testid="boys-sidebar">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground px-1">Delivery boys</p>
          {boys.length === 0 && <p className="text-sm text-muted-foreground px-1">No delivery boys yet.</p>}
          {boys.map((b) => {
            const isLive = !!b.current_lat;
            const isOnTrip = !!b.on_trip;
            const isVisibleOnMap = isLive && isOnTrip;
            const isSel = selectedBoy === b.boy_id;
            return (
              <button
                key={b.boy_id}
                onClick={() => setSelectedBoy(isSel ? null : b.boy_id)}
                className={`w-full text-left rounded-2xl border p-3 transition-colors ${isSel ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50"}`}
                data-testid={`boy-pill-${b.boy_id}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-2 w-2 rounded-full ${isVisibleOnMap ? "bg-emerald-500 animate-pulse" : isLive ? "bg-amber-400" : "bg-muted-foreground"}`} />
                  <span className="font-semibold text-sm truncate flex-1">{b.name}</span>
                  <Truck className={`h-3.5 w-3.5 ${isOnTrip ? "text-emerald-600" : "text-muted-foreground"}`} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{b.phone} · {b.assigned_pincodes?.join(", ") || "no pincode"}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {isVisibleOnMap ? "Animated on map" : isOnTrip ? "On trip · waiting for GPS" : isLive ? "Idle · last seen" : "Offline"}
                </p>
              </button>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4" data-testid={`live-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p>
      <p className="font-display font-extrabold text-3xl mt-2">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
