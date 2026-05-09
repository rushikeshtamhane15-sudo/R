import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import { loadCart, saveCart, setQty } from "../lib/cart";
import { useAuth } from "../context/AuthContext";
import TrackMap3D from "../components/TrackMap3D";
import { alertWithVoice } from "../lib/notify";
import { haversineKm, etaMinutes, osrmRoute } from "../lib/geo";
import {
  ChevronLeft, Phone, CheckCircle2, ChefHat, Bike, MapPin, PackageCheck, Hourglass, Clock, RefreshCw, Receipt, XCircle,
} from "lucide-react";

const POLL_MS = 15_000;

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
  const { checkAuth } = useAuth();
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState("");
  const [activeOrders, setActiveOrders] = useState([]);
  const polling = useRef(null);
  const lastStatus = useRef(null);

  // Pull other in-flight orders for the multi-order switcher rail
  useEffect(() => {
    api.get("/restaurant/orders?limit=20")
      .then((r) => {
        const live = (r.data?.orders || []).filter((o) =>
          ["paid", "preparing", "ready_for_pickup", "out_for_delivery"].includes(o.status)
        );
        setActiveOrders(live);
      })
      .catch(() => {});
  }, [orderId, order?.status]);

  const load = async () => {
    try {
      const r = await api.get(`/restaurant/orders/${orderId}/track`);
      const next = r.data;
      // Voice + sound when status flips to "out_for_delivery"
      if (
        lastStatus.current && lastStatus.current !== "out_for_delivery" &&
        next.status === "out_for_delivery"
      ) {
        try { alertWithVoice("Your rider is on the way. Please be ready."); } catch {}
        toast.message("🛵 Your rider is on the way!");
      }
      lastStatus.current = next.status;
      setOrder(next); setErr("");
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

  const cancelOrder = async () => {
    if (!order) return;
    if (!window.confirm(`Cancel this order? ₹${Number(order.total).toFixed(0)} will be refunded to your smart wallet instantly.`)) return;
    try {
      const r = await api.post(`/restaurant/orders/${order.order_id}/cancel`);
      toast.success(`Order cancelled · ₹${Number(r.data.refund_amount).toFixed(0)} refunded to wallet`);
      load();
      try { await checkAuth(); } catch {}
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel order");
    }
  };

  const idx = useMemo(() => order ? statusIndex(order.status) : 0, [order]);

  // OSRM road-snapped ETA — must be a top-level hook (no early-return above).
  const showMap = !!(order && order.status === "out_for_delivery" && order.rider_lat && order.rider_lng);
  const [snappedEta, setSnappedEta] = useState(null);
  useEffect(() => {
    if (!showMap || !order?.customer_lat || !order?.customer_lng) { setSnappedEta(null); return; }
    const abort = new AbortController();
    osrmRoute(
      { lat: order.rider_lat, lng: order.rider_lng },
      { lat: order.customer_lat, lng: order.customer_lng },
      { signal: abort.signal },
    ).then((d) => { if (d) setSnappedEta(d); });
    return () => abort.abort();
  }, [showMap, order?.rider_lat, order?.rider_lng, order?.customer_lat, order?.customer_lng]);

  if (err) return <div className="min-h-screen flex items-center justify-center text-destructive p-8 text-center">{err}</div>;
  if (!order) return <div className="min-h-screen flex items-center justify-center text-muted-foreground"><Hourglass className="h-5 w-5 mr-2 animate-spin" /> Loading order…</div>;

  const liveEta = (showMap && order.customer_lat && order.customer_lng)
    ? (() => {
        const km = haversineKm({ lat: order.rider_lat, lng: order.rider_lng }, { lat: order.customer_lat, lng: order.customer_lng });
        return km != null ? { km, min: etaMinutes(km), source: "haversine" } : null;
      })()
    : null;
  const displayEta = snappedEta || liveEta;
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
        {/* Delivery OTP card — show prominently when rider is on the way */}
        {order.delivery_otp && ["out_for_delivery", "ready_for_pickup"].includes(order.status) && (
          <section className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/40 dark:to-emerald-900/40 dark:border-emerald-800 p-5 text-center" data-testid="track-delivery-otp">
            <p className="text-[10px] tracking-overline uppercase font-bold text-emerald-700 dark:text-emerald-300">Share this code with your rider</p>
            <p className="font-mono text-5xl sm:text-6xl tracking-[0.4em] text-emerald-700 dark:text-emerald-100 font-bold mt-2 mb-1" data-testid="otp-code">
              {order.delivery_otp}
            </p>
            <p className="text-xs text-emerald-800 dark:text-emerald-200/90">Rider will ask for this 4-digit code before marking your order delivered.</p>
          </section>
        )}

        {/* Multi-order switcher — only when user has >1 in-flight orders */}
        {activeOrders.length > 1 && (
          <section className="rounded-2xl border border-border bg-card p-3 sm:p-4 overflow-x-auto no-scrollbar" data-testid="track-multi-switcher">
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground px-2 mb-2">
              You have {activeOrders.length} active orders — switch between them
            </p>
            <ul className="flex gap-2 min-w-max">
              {activeOrders.map((o) => {
                const isActive = o.order_id === orderId;
                return (
                  <li key={o.order_id}>
                    <Link
                      to={`/restaurant/track/${o.order_id}`}
                      data-testid={`switch-${o.order_id}`}
                      className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border text-left transition-colors min-w-[150px] ${
                        isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                      }`}
                    >
                      <span className="text-[10px] tracking-overline uppercase font-bold opacity-80">{o.status.replace(/_/g, " ")}</span>
                      <span className="font-mono text-[10px] truncate w-full">{o.order_id}</span>
                      <span className="font-display font-extrabold text-sm tabular-nums">₹{Number(o.total).toFixed(0)} · {o.items?.length || 0} item(s)</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

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
            <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
              <Bike className="h-4 w-4 text-primary" />
              <p className="font-display font-extrabold text-sm">Rider live location</p>
              {order.rider?.name && <span className="text-xs text-muted-foreground">· {order.rider.name}</span>}
              {displayEta && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold uppercase tracking-overline" data-testid="track-eta">
                  🛵 {displayEta.km?.toFixed(1)} km · ~{displayEta.min} min
                  {displayEta.source === "osrm" && <span className="opacity-60">· road</span>}
                </span>
              )}
              {order.rider?.phone && (
                <a href={`tel:${order.rider.phone}`} className="ml-auto text-xs font-bold text-primary hover:underline flex items-center gap-1" data-testid="track-call-rider">
                  <Phone className="h-3 w-3" /> Call
                </a>
              )}
            </div>
            <div className="h-80 md:h-96 w-full">
              <TrackMap3D
                rider={{ lat: order.rider_lat, lng: order.rider_lng, name: order.rider?.name, phone: order.rider?.phone }}
                customer={order.customer_lat && order.customer_lng ? { lat: order.customer_lat, lng: order.customer_lng } : null}
                className="h-full w-full"
              />
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
            {order.status === "paid" && (
              <button
                type="button"
                onClick={cancelOrder}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-rose-300 text-rose-700 text-xs font-bold hover:bg-rose-50 transition"
                data-testid="track-cancel-btn"
              >
                <XCircle className="h-3.5 w-3.5" /> Cancel order
              </button>
            )}
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
