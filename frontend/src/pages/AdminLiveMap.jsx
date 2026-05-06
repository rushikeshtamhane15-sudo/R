import React, { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Loader2, RefreshCw, Truck, MapPin } from "lucide-react";

const REFRESH_MS = 10000;

function makeIcon({ color, label }) {
  const html = `
    <div style="position:relative;">
      <div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);box-shadow:0 2px 4px rgba(0,0,0,0.3);border:2px solid white;"></div>
      <div style="position:absolute;left:0;top:3px;width:30px;text-align:center;font-size:11px;font-weight:800;color:white;font-family:system-ui;">${label}</div>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [30, 34], iconAnchor: [15, 30], popupAnchor: [0, -28] });
}

const ICON_BOY_ON = makeIcon({ color: "#1e3a8a", label: "🛵" });
const ICON_BOY_OFF = makeIcon({ color: "#6b7280", label: "🛵" });
const ICON_PENDING = makeIcon({ color: "#a02323", label: "•" });
const ICON_DELIVERED = makeIcon({ color: "#10b981", label: "✓" });

function FitAll({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 14 });
  }, [points, map]);
  return null;
}

export default function AdminLiveMap() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedBoy, setSelectedBoy] = useState(null);

  const load = async () => {
    try {
      const r = await api.get("/admin/delivery/live");
      setData(r.data);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const points = useMemo(() => {
    const arr = [];
    (data?.boys || []).forEach((b) => { if (b.current_lat) arr.push([b.current_lat, b.current_lng]); });
    (data?.items || []).forEach((it) => { if (it.customer_lat) arr.push([it.customer_lat, it.customer_lng]); });
    return arr;
  }, [data]);

  const boys = data?.boys || [];
  const items = data?.items || [];
  const activeBoys = boys.filter((b) => b.current_lat && b.last_ping_at);
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
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-1">Live tracking</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Real-time positions of every delivery boy on a trip — auto-refreshes every {REFRESH_MS / 1000}s.
          </p>
        </div>
        <Button onClick={load} variant="outline" className="rounded-full" data-testid="live-refresh">
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Boys live" value={activeBoys.length} hint={`of ${boys.length} active`} />
        <Stat label="Pending" value={totalPending} hint="planned + out" />
        <Stat label="Delivered" value={totalDelivered} hint="today" />
        <Stat label="Tiffins total" value={items.length} hint="rostered today" />
      </div>

      <div className="grid lg:grid-cols-[1fr_280px] gap-5">
        <div className="rounded-2xl overflow-hidden border border-border bg-card" style={{ height: 540 }}>
          {points.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-sm text-muted-foreground">
              <MapPin className="h-8 w-8 mb-2" />
              No live boys yet — they'll appear here the moment they start a trip.
            </div>
          ) : (
            <MapContainer center={points[0]} zoom={13} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
              <FitAll points={points} />
              {boyRoute && <Polyline positions={boyRoute} pathOptions={{ color: "#1e3a8a", weight: 4, opacity: 0.65, dashArray: "6,8" }} />}
              {boys.map((b) => b.current_lat ? (
                <Marker
                  key={b.boy_id}
                  position={[b.current_lat, b.current_lng]}
                  icon={b.on_trip ? ICON_BOY_ON : ICON_BOY_OFF}
                  eventHandlers={{ click: () => setSelectedBoy(b.boy_id) }}
                >
                  <Popup>
                    <div className="font-display font-bold text-sm">{b.name}</div>
                    <div className="text-xs text-gray-600">{b.phone}</div>
                    {b.last_ping_at && <div className="text-xs text-gray-500 mt-1">Last ping: {new Date(b.last_ping_at).toLocaleTimeString()}</div>}
                    <div className="text-xs mt-1 font-semibold" style={{ color: b.on_trip ? "#059669" : "#9ca3af" }}>
                      {b.on_trip ? "On trip" : "Idle"}
                    </div>
                  </Popup>
                </Marker>
              ) : null)}
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
                  </Popup>
                </Marker>
              ) : null)}
            </MapContainer>
          )}
        </div>

        <aside className="space-y-2" data-testid="boys-sidebar">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground px-1">Delivery boys</p>
          {boys.length === 0 && <p className="text-sm text-muted-foreground px-1">No delivery boys yet.</p>}
          {boys.map((b) => {
            const isLive = !!b.current_lat;
            const isOnTrip = b.on_trip;
            const isSel = selectedBoy === b.boy_id;
            return (
              <button
                key={b.boy_id}
                onClick={() => setSelectedBoy(isSel ? null : b.boy_id)}
                className={`w-full text-left rounded-2xl border p-3 transition-colors ${isSel ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50"}`}
                data-testid={`boy-pill-${b.boy_id}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-2 w-2 rounded-full ${isOnTrip ? "bg-emerald-500 animate-pulse" : isLive ? "bg-amber-400" : "bg-muted-foreground"}`} />
                  <span className="font-semibold text-sm truncate flex-1">{b.name}</span>
                  <Truck className={`h-3.5 w-3.5 ${isOnTrip ? "text-emerald-600" : "text-muted-foreground"}`} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{b.phone} · {b.assigned_pincodes?.join(", ") || "no pincode"}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {b.last_ping_at ? `Last ping ${new Date(b.last_ping_at).toLocaleTimeString()}` : "No ping yet"}
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
