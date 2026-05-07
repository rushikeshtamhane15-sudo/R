import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import { loadCart, saveCart, setQty } from "../lib/cart";
import {
  ChevronLeft, Package, Clock, CheckCircle2, Bike, ChefHat, RefreshCw, Hourglass, ArrowRight, XCircle,
} from "lucide-react";

/**
 * Customer-side restaurant order history.
 * Lists past orders newest-first with a "Reorder" button that pushes the items
 * back into the cart and routes to checkout.
 */
const STATUS_META = {
  created:          { label: "Pending payment", color: "bg-muted text-muted-foreground", icon: Clock },
  paid:             { label: "Order placed",     color: "bg-blue-100 text-blue-800",      icon: CheckCircle2 },
  preparing:        { label: "Preparing",        color: "bg-amber-100 text-amber-800",    icon: ChefHat },
  ready_for_pickup: { label: "Ready for pickup", color: "bg-purple-100 text-purple-800",  icon: Package },
  out_for_delivery: { label: "Out for delivery", color: "bg-indigo-100 text-indigo-800",  icon: Bike },
  delivered:        { label: "Delivered",        color: "bg-emerald-100 text-emerald-800",icon: CheckCircle2 },
  cancelled:        { label: "Cancelled",        color: "bg-rose-100 text-rose-800",      icon: Clock },
  rejected:         { label: "Rejected",         color: "bg-rose-100 text-rose-800",      icon: Clock },
};

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function RestaurantOrderHistory() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState(null);
  const [err, setErr] = useState("");
  const [cancellingId, setCancellingId] = useState(null);

  const load = async () => {
    try {
      const r = await api.get("/restaurant/orders?limit=50");
      setOrders(r.data?.orders || []);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not load orders");
    }
  };

  useEffect(() => { load(); }, []);

  const cancelOrder = async (order) => {
    if (!window.confirm(`Cancel order ${order.order_id}? ₹${Number(order.total).toFixed(0)} will be refunded to your smart wallet instantly.`)) {
      return;
    }
    setCancellingId(order.order_id);
    try {
      const r = await api.post(`/restaurant/orders/${order.order_id}/cancel`);
      toast.success(`Order cancelled · ₹${Number(r.data.refund_amount).toFixed(0)} refunded to wallet`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel order");
    } finally {
      setCancellingId(null);
    }
  };

  const reorder = async (order) => {
    // Pull live menu so we only re-add still-available items.
    let menu = [];
    try {
      const r = await api.get("/restaurant/menu");
      menu = r.data?.items || [];
    } catch {
      toast.error("Menu unavailable, cannot reorder right now");
      return;
    }
    const liveIds = new Set(menu.map((m) => m.id));
    const cart = loadCart();
    let next = { ...cart };
    let added = 0;
    let skipped = 0;
    for (const line of order.items || []) {
      if (!liveIds.has(line.id)) { skipped += 1; continue; }
      const curQty = next[line.id]?.qty || 0;
      next = setQty(next, line.id, curQty + (line.qty || 1));
      added += 1;
    }
    saveCart(next);
    if (added === 0) {
      toast.error("None of the items are available right now");
      return;
    }
    if (skipped > 0) toast.warning(`${skipped} item(s) no longer available — skipped`);
    toast.success(`Added ${added} item${added > 1 ? "s" : ""} to cart`);
    navigate("/restaurant/checkout");
  };

  return (
    <div className="min-h-screen bg-background pb-24" data-testid="restaurant-order-history">
      <header className="bg-primary text-primary-foreground">
        <div className="max-w-3xl mx-auto px-5 py-5">
          <Link
            to="/restaurant"
            className="inline-flex items-center text-primary-foreground/85 hover:text-primary-foreground text-xs font-bold uppercase tracking-overline"
            data-testid="orders-back-link"
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back to menu
          </Link>
          <h1 className="font-display font-extrabold text-2xl tracking-tight mt-2">My orders</h1>
          <p className="text-sm opacity-90 mt-0.5">Reorder your favourites in one tap</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-6 space-y-4">
        {err && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 text-destructive p-4 text-sm" data-testid="orders-error">
            {err}
          </div>
        )}

        {orders === null && !err && (
          <div className="text-center text-muted-foreground py-16 flex items-center justify-center gap-2">
            <Hourglass className="h-4 w-4 animate-spin" /> Loading your orders…
          </div>
        )}

        {orders && orders.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center" data-testid="orders-empty">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" strokeWidth={1.5} />
            <p className="font-display font-extrabold text-lg">No orders yet</p>
            <p className="text-sm text-muted-foreground mt-1">Place your first restaurant order to see it here.</p>
            <Link
              to="/restaurant"
              className="inline-flex items-center gap-1.5 mt-5 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition"
              data-testid="orders-empty-cta"
            >
              Browse menu <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {orders && orders.map((o) => {
          const meta = STATUS_META[o.status] || STATUS_META.paid;
          const Icon = meta.icon;
          const showTrack = ["paid", "preparing", "ready_for_pickup", "out_for_delivery"].includes(o.status);
          const showReorder = ["delivered", "cancelled", "rejected", "paid", "preparing", "ready_for_pickup", "out_for_delivery"].includes(o.status);
          const canCancel = o.status === "paid";
          const isCancelling = cancellingId === o.order_id;
          return (
            <article
              key={o.order_id}
              className="rounded-2xl border border-border bg-card p-5"
              data-testid={`order-card-${o.order_id}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-mono text-[11px] text-muted-foreground">{o.order_id}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(o.created_at)}</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-overline px-2.5 py-1 rounded-full ${meta.color}`}>
                  <Icon className="h-3 w-3" /> {meta.label}
                </span>
              </div>

              <ul className="mt-3 space-y-1 text-sm">
                {(o.items || []).slice(0, 4).map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span className="text-foreground/90 truncate">{i.name} <span className="text-muted-foreground">× {i.qty}</span></span>
                    <span className="tabular-nums text-muted-foreground">₹{Number(i.line_total ?? (i.unit_price * i.qty)).toFixed(0)}</span>
                  </li>
                ))}
                {(o.items?.length || 0) > 4 && (
                  <li className="text-xs text-muted-foreground">+ {o.items.length - 4} more item(s)</li>
                )}
              </ul>

              <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <p className="font-display font-extrabold text-base">
                  Total <span className="text-primary tabular-nums">₹{Number(o.total || 0).toFixed(0)}</span>
                  {o.status === "cancelled" && o.refund_amount && (
                    <span className="block text-[11px] text-emerald-700 font-bold mt-0.5">
                      ₹{Number(o.refund_amount).toFixed(0)} refunded to wallet
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {canCancel && (
                    <button
                      type="button"
                      disabled={isCancelling}
                      onClick={() => cancelOrder(o)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-full border border-rose-300 text-rose-700 text-xs font-bold hover:bg-rose-50 transition disabled:opacity-50"
                      data-testid={`order-cancel-${o.order_id}`}
                    >
                      <XCircle className="h-3.5 w-3.5" /> {isCancelling ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                  {showTrack && (
                    <Link
                      to={`/restaurant/track/${o.order_id}`}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-full border border-border text-xs font-bold hover:bg-muted transition"
                      data-testid={`order-track-${o.order_id}`}
                    >
                      <Bike className="h-3.5 w-3.5" /> Track
                    </Link>
                  )}
                  {showReorder && (
                    <button
                      type="button"
                      onClick={() => reorder(o)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition"
                      data-testid={`order-reorder-${o.order_id}`}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Reorder
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </main>
    </div>
  );
}
