import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import { loadCart, saveCart, setQty } from "../lib/cart";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import {
  ChevronLeft, Phone, CheckCircle2, ChefHat, Bike, MapPin, PackageCheck, Hourglass, Clock, RefreshCw, Receipt,
} from "lucide-react";

const POLL_MS = 15_000;

// Animated rider marker — pulse + small bike SVG.
const riderIcon = L.divIcon({
  className: "rider-marker",
  html: `
    <div style="position:relative;width:42px;height:42px">
      <span style="position:absolute;inset:0;border-radius:50%;background:#a02323;opacity:0.25;animation:rider-pulse 1.6s ease-out infinite"></span>
      <span style="position:absolute;inset:6px;border-radius:50%;background:#a02323;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 4px 10px rgba(0,0,0,0.25)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h-3l-3 9h3l3-6h2.5l-1.5-3z"/></svg>
      </span>
    </div>
    <style>@keyframes rider-pulse{0%{transform:scale(0.8);opacity:0.6}100%{transform:scale(1.6);opacity:0}}</style>`,
  iconSize: [42, 42],
  iconAnchor: [21, 21],
});

const STATUSES = [
  { key: "paid",             label: "Order placed",     icon: CheckCircle2 },
  { key: "preparing",        label: "Kitchen preparing", icon: ChefHat },
  { key: "ready_for_pickup", label: "Ready for pickup", icon: PackageCheck },
  { key: "out_for_delivery", label: "On the way",       icon: Bike },
  { key: "delivered",        label: "Delivered",        icon: CheckCircle2 },
];

function statusIndex(status) {
  // Map "created" → step 0 (pre-paid pending) so it renders Order placed lit.
  if (status === "created") return 0;
  const i = STATUSES.findIndex((s) => s.key === status);
  return i < 0 ? 0 : i;
}

export default function OrderTrack() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState("");
  const polling = useRef(null);

  const load = async () => {
    try {
      const r = await api.get(`/restaurant/orders/${orderId}/track`);
      setOrder(r.data); setErr("");
    } catch (e) { setErr(e?.response?.data?.detail || "Could not load order"); }
  };

  useEffect(() => { load(); }, [orderId]);
  useEffect(() => {
    polling.current = setInterval(load, POLL_MS);
    return () => clearInterval(polling.current);
  }, [orderId]);

  const reorder = async () => {
    if (!order?.items?.length) return;
    let liveIds = new Set();
    try {
      const r = await api.get("/restaurant/menu");
      liveIds = new Set((r.data?.items || []).map((m) => m.id));
    } catch {
      toast.error("Menu unavailable, cannot reorder right now");
      return;
    }
    let next = { ...loadCart() };
    let added = 0;
    let skipped = 0;
    for (const line of order.items) {
      if (!liveIds.has(line.id)) { skipped += 1; continue; }
      const cur = next[line.id]?.qty || 0;
      next = setQty(next, line.id, cur + (line.qty || 1));
      added += 1;
    }
    saveCart(next);
    if (added === 0) { toast.error("None of the items are available right now"); return; }
    if (skipped > 0) toast.warning(`${skipped} item(s) no longer available — skipped`);
    toast.success(`Added ${added} item${added > 1 ? "s" : ""} to cart`);
    navigate("/restaurant/checkout");
  };

  const idx = useMemo(() => order ? statusIndex(order.status) : 0, [order]);

  if (err) return <div className="min-h-screen flex items-center justify-center text-destructive p-8 text-center">{err}</div>;
  if (!order) return <div className="min-h-screen flex items-center justify-center text-muted-foreground"><Hourglass className="h-5 w-5 mr-2 animate-spin" /> Loading order…</div>;

  const showMap = order.status === "out_for_delivery" && order.rider_lat && order.rider_lng;
  const eta = order.eta_at ? new Date(order.eta_at) : null;

  return (
    <div className="min-h-screen bg-background pb-24" data-testid="order-track">
      <header className="bg-primary text-primary-foreground">
        <div className="max-w-3xl mx-auto px-5 py-5">
          <Link to="/restaurant" className="inline-flex items-center text-primary-foreground/85 hover:text-primary-foreground text-xs font-bold uppercase tracking-overline">
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back to menu
          </Link>
          <h1 className="font-display font-extrabold text-2xl tracking-tight mt-2">Track your order</h1>
          <p className="text-sm opacity-90 mt-0.5 font-mono">{order.order_id}</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-6 space-y-6">
        {/* Status timeline */}
        <section className="rounded-2xl border border-border bg-card p-5" data-testid="track-timeline">
          <ol className="space-y-3.5">
            {STATUSES.map((s, i) => {
              const Icon = s.icon;
              const done = i <= idx;
              const active = i === idx;
              return (
                <li key={s.key} className="flex items-center gap-3" data-testid={`step-${s.key}`}>
                  <span className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"} ${active ? "ring-4 ring-primary/20 animate-pulse" : ""}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={`text-sm font-bold ${done ? "" : "text-muted-foreground"}`}>{s.label}</p>
                    {active && <p className="text-xs text-muted-foreground">in progress…</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {eta && order.status !== "delivered" && (
            <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Estimated delivery by {eta.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </section>

        {/* Live map (when rider is out for delivery) */}
        {showMap && (
          <section className="rounded-2xl border border-border bg-card overflow-hidden" data-testid="track-map">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Bike className="h-4 w-4 text-primary" />
              <p className="font-display font-extrabold text-sm">Rider live location</p>
              {order.rider?.name && <span className="text-xs text-muted-foreground ml-2">· {order.rider.name}</span>}
              {order.rider?.phone && (
                <a href={`tel:${order.rider.phone}`} className="ml-auto text-xs font-bold text-primary hover:underline flex items-center gap-1" data-testid="track-call-rider">
                  <Phone className="h-3 w-3" /> Call
                </a>
              )}
            </div>
            <div className="h-72 w-full">
              <MapContainer center={[order.rider_lat, order.rider_lng]} zoom={15} className="h-full w-full">
                <TileLayer
                  url="https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap · &copy; CARTO'
                />
                <Marker position={[order.rider_lat, order.rider_lng]} icon={riderIcon}>
                  <Popup>{order.rider?.name || "Rider"} on the way</Popup>
                </Marker>
              </MapContainer>
            </div>
          </section>
        )}

        {/* Items summary */}
        <section className="rounded-2xl border border-border bg-card p-5" data-testid="track-items">
          <p className="font-display font-extrabold mb-3">Order summary</p>
          <ul className="space-y-2 text-sm">
            {order.items?.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span>{i.name} × {i.qty}</span>
                <span className="tabular-nums">₹{i.line_total?.toFixed(0) || (i.unit_price * i.qty).toFixed(0)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border mt-3 pt-3 flex justify-between text-xs text-muted-foreground">
            <span>Subtotal</span><span className="tabular-nums">₹{order.subtotal?.toFixed(0)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Delivery</span><span className="tabular-nums">{order.delivery_fee === 0 ? "FREE" : `₹${order.delivery_fee?.toFixed(0)}`}</span>
          </div>
          <div className="flex justify-between font-display font-extrabold text-lg mt-2">
            <span>Total</span><span className="tabular-nums text-primary">₹{order.total?.toFixed(0)}</span>
          </div>

          <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-border">
            <button
              type="button"
              onClick={reorder}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition"
              data-testid="track-reorder-btn"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reorder these items
            </button>
            <Link
              to="/restaurant/orders"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-border text-xs font-bold hover:bg-muted transition"
              data-testid="track-history-link"
            >
              <Receipt className="h-3.5 w-3.5" /> Order history
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
