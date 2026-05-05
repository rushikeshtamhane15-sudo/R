import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { Truck, BellRing, CheckCircle2, Loader2, MapPin } from "lucide-react";

/**
 * Banner that lists today's pending tiffin deliveries for the current subscriber and
 * lets them confirm receipt with a single tap (replaces the OTP-shouting flow).
 *
 * Polls /my/deliveries/pending every 30s so a status flip from "out" → confirmed by
 * delivery boy quietly disappears the card.
 */
export default function PendingDeliveriesBanner() {
  const [items, setItems] = useState([]);
  const [confirming, setConfirming] = useState(null);
  const [loading, setLoading] = useState(true);
  const [askLocation, setAskLocation] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/my/deliveries/pending");
      setItems(r.data.pending || []);
    } catch {
      // silently ignore — no pending UI is the right fallback
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const confirm = async (rosterId) => {
    setConfirming(rosterId);
    try {
      await api.post(`/my/deliveries/${rosterId}/confirm`);
      toast.success("Tiffin delivery confirmed — bon appétit!");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not confirm");
    } finally { setConfirming(null); }
  };

  // Pin location once: nudge when there are pending items + we don't yet know if location was set
  useEffect(() => {
    if (items.length > 0 && !askLocation && navigator.geolocation && !window.__efc_location_pinged) {
      window.__efc_location_pinged = true;
      setAskLocation(true);
    }
  }, [items, askLocation]);

  const pinLocation = async () => {
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api.post("/auth/location", { lat: pos.coords.latitude, lng: pos.coords.longitude });
          toast.success("Location saved — your delivery boy will be verified at your door");
          setAskLocation(false);
        } catch { toast.error("Could not save location"); }
      },
      () => toast.error("Allow location access to enable doorstep verification"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (loading || items.length === 0) return null;

  return (
    <div className="rounded-3xl bg-primary/5 border border-primary/30 p-5 md:p-6 mb-8" data-testid="pending-delivery-banner">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 rounded-xl bg-primary/15 text-primary items-center justify-center shrink-0">
            <BellRing className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold text-primary">Tiffin tracking</p>
            <h3 className="font-display font-extrabold text-xl md:text-2xl mt-1 leading-tight">
              {items.length} tiffin{items.length !== 1 ? "s" : ""} headed your way today
            </h3>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              Tap "I got my tiffin" the moment it lands — no need to read out an OTP.
            </p>
          </div>
        </div>
      </div>

      {askLocation && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-card border border-border px-4 py-3" data-testid="pin-location-prompt">
          <MapPin className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs text-muted-foreground flex-1">Pin your delivery location once for accurate doorstep verification.</span>
          <Button onClick={pinLocation} size="sm" variant="outline" className="rounded-full" data-testid="pin-location-btn">Pin location</Button>
          <button onClick={() => setAskLocation(false)} className="text-xs text-muted-foreground hover:text-foreground" data-testid="pin-location-skip">skip</button>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {items.map((it) => (
          <li
            key={it.roster_id}
            className="flex flex-wrap items-center gap-3 rounded-2xl bg-card border border-border px-4 py-3"
            data-testid={`pending-item-${it.roster_id}`}
          >
            <span className="inline-flex h-8 w-8 rounded-full bg-primary/10 text-primary items-center justify-center shrink-0">
              <Truck className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold capitalize text-sm">{it.meal_type} · {it.tiffin_size} tiffin</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {it.status === "out" ? "Out for delivery" : "Scheduled"}
              </p>
            </div>
            <Button
              onClick={() => confirm(it.roster_id)}
              disabled={confirming === it.roster_id}
              size="sm"
              className="rounded-full bg-primary hover:bg-primary/90 font-semibold"
              data-testid={`confirm-delivery-${it.roster_id}`}
            >
              {confirming === it.roster_id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
              I got my tiffin
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
