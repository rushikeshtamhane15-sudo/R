import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { alertWithVoice } from "../lib/notify";
import {
  UtensilsCrossed, Loader2, RefreshCw, ChefHat, PackageCheck, Bike, CheckCircle2, XCircle, Phone, MapPin, Clock, Volume2, VolumeX,
} from "lucide-react";

const STATUS_TONE = {
  created:          { label: "Pending payment",  cls: "bg-muted text-muted-foreground" },
  paid:             { label: "Paid · awaiting prep", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200" },
  preparing:        { label: "Preparing",        cls: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
  ready_for_pickup: { label: "Ready for pickup", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" },
  out_for_delivery: { label: "On the way",       cls: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200" },
  delivered:        { label: "Delivered",        cls: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-50" },
  rejected:         { label: "Rejected",         cls: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200" },
};

export default function AdminRestaurantOrders() {
  const [orders, setOrders] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("efc_admin_orders_sound") !== "off");
  const knownPaidIds = useRef(new Set());

  const load = async () => {
    try {
      const r = await api.get("/admin/restaurant/orders?limit=200");
      const next = r.data?.orders || [];
      // Sound + voice on NEW paid orders (skip on first load)
      const fresh = next.filter((o) => o.status === "paid" && !knownPaidIds.current.has(o.order_id));
      if (fresh.length > 0 && soundOn && knownPaidIds.current.size > 0) {
        alertWithVoice(`${fresh.length} new restaurant order${fresh.length > 1 ? "s" : ""}`);
        toast.message(`🔔 ${fresh.length} new paid order(s)`);
      }
      knownPaidIds.current = new Set(next.filter((o) => o.status === "paid").map((o) => o.order_id));
      setOrders(next);
    } catch { toast.error("Could not load orders"); setOrders([]); }
  };

  useEffect(() => { load(); }, []);
  // Auto-poll every 12s for new orders
  useEffect(() => {
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem("efc_admin_orders_sound", next ? "on" : "off");
    if (next) { alertWithVoice("Sound notifications enabled"); }
  };

  const setStatus = async (orderId, status) => {
    if (status === "rejected" && !window.confirm("Reject this order? Customer will be refunded if already paid (manual via wallet).")) return;
    setLoadingId(orderId);
    try {
      await api.post(`/admin/restaurant/orders/${orderId}/status`, { status });
      toast.success(`Order → ${STATUS_TONE[status]?.label || status}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Status update failed"); }
    finally { setLoadingId(null); }
  };

  if (orders === null) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading orders…</div>;
  }

  return (
    <div className="space-y-5" data-testid="admin-restaurant-orders">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><UtensilsCrossed className="h-3.5 w-3.5" /> Kitchen ops</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-1 leading-tight">Restaurant orders</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Move orders through the kitchen pipeline: paid → preparing → ready for pickup. Rider takes it from there.</p>
        </div>
        <Button variant="outline" onClick={load} className="rounded-full" data-testid="orders-refresh-btn">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
        <Button
          variant="outline"
          onClick={toggleSound}
          className="rounded-full"
          data-testid="orders-sound-toggle"
          title={soundOn ? "Mute new-order alerts" : "Enable sound alerts"}
        >
          {soundOn ? <Volume2 className="h-4 w-4 mr-1.5 text-emerald-600" /> : <VolumeX className="h-4 w-4 mr-1.5 text-muted-foreground" />}
          {soundOn ? "Sound on" : "Sound off"}
        </Button>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground" data-testid="orders-empty">
          <UtensilsCrossed className="h-8 w-8 mx-auto mb-3 opacity-50" />
          No orders yet. New orders show up here within seconds of payment.
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => {
            const tone = STATUS_TONE[o.status] || { label: o.status, cls: "bg-muted text-muted-foreground" };
            const canPrepare = o.status === "paid";
            const canReady = o.status === "preparing";
            const canReject = ["paid", "preparing"].includes(o.status);
            return (
              <li key={o.order_id} className="rounded-2xl border border-border bg-card p-5" data-testid={`order-${o.order_id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-xs text-muted-foreground" data-testid={`order-id-${o.order_id}`}>{o.order_id}</p>
                      <span className={`text-[10px] tracking-overline uppercase font-bold px-2.5 py-0.5 rounded-full ${tone.cls}`} data-testid={`order-status-${o.order_id}`}>{tone.label}</span>
                      {o.payment_mode === "cash" && !o.cash_reconciled && o.status === "delivered" && (
                        <span className="text-[10px] tracking-overline uppercase font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900">Cash unreconciled</span>
                      )}
                    </div>
                    <p className="font-display font-extrabold text-lg mt-1.5">₹{o.total} · {o.items?.length || 0} item{(o.items?.length || 0) !== 1 ? "s" : ""}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                      <span><Clock className="h-3 w-3 inline mr-0.5" /> {new Date(o.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <span>{o.name || "—"}</span>
                      {o.phone && <a href={`tel:${o.phone}`} className="text-primary hover:underline"><Phone className="h-3 w-3 inline" /> {o.phone}</a>}
                    </p>
                    {o.address && <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1"><MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" /> {o.address}</p>}
                  </div>
                </div>

                <ul className="text-xs text-muted-foreground space-y-0.5 mb-4 max-w-md">
                  {o.items?.map((it, j) => (
                    <li key={j} className="flex justify-between">
                      <span>{it.name} × {it.qty}</span>
                      <span className="tabular-nums">₹{it.line_total?.toFixed(0) || (it.unit_price * it.qty).toFixed(0)}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!canPrepare || loadingId === o.order_id} onClick={() => setStatus(o.order_id, "preparing")} className="rounded-full" data-testid={`prep-${o.order_id}`}>
                    <ChefHat className="h-3.5 w-3.5 mr-1.5" /> Mark preparing
                  </Button>
                  <Button size="sm" disabled={!canReady || loadingId === o.order_id} onClick={() => setStatus(o.order_id, "ready_for_pickup")} className="rounded-full" data-testid={`ready-${o.order_id}`}>
                    <PackageCheck className="h-3.5 w-3.5 mr-1.5" /> Ready for pickup
                  </Button>
                  <Button size="sm" variant="outline" disabled={!canReject || loadingId === o.order_id} onClick={() => setStatus(o.order_id, "rejected")} className="rounded-full text-destructive hover:bg-destructive/5" data-testid={`reject-${o.order_id}`}>
                    <XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject
                  </Button>
                  {o.status === "out_for_delivery" && (
                    <span className="ml-auto text-xs text-indigo-700 dark:text-indigo-200 inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-full">
                      <Bike className="h-3.5 w-3.5" /> Rider en route
                    </span>
                  )}
                  {o.status === "delivered" && (
                    <span className="ml-auto text-xs text-emerald-700 dark:text-emerald-200 inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-full">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {o.payment_mode === "cash" ? "Cash" : "Online"}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
