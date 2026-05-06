import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "./ui/button";
import { toast } from "sonner";
import {
  Truck, BellRing, CheckCircle2, Loader2, MapPin, Sparkles, ShieldCheck, ChevronRight,
} from "lucide-react";

/**
 * Always-visible tiffin tracking widget on the subscriber dashboard.
 * Shows pending deliveries when present; otherwise an info card explaining how the
 * geofence-verified delivery system works and surfacing the location-pin CTA.
 */
export default function PendingDeliveriesBanner() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [confirming, setConfirming] = useState(null);
  const [loading, setLoading] = useState(true);
  const hasLocation = !!(user && user.lat && user.lng);

  const load = async () => {
    try {
      const r = await api.get("/my/deliveries/pending");
      setItems(r.data.pending || []);
    } catch {}
    finally { setLoading(false); }
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

  const pinLocation = () => {
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    toast.message("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await api.post("/auth/location", { lat: pos.coords.latitude, lng: pos.coords.longitude });
          const pin = r.data?.pincode;
          toast.success(pin ? `Location pinned · pin ${pin} detected` : "Location pinned · delivery boy will be verified at your door");
          window.location.reload();
        } catch { toast.error("Could not save location"); }
      },
      () => toast.error("Allow location access to pin your delivery point"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (loading) return null;

  // CASE A — pending tiffins right now
  if (items.length > 0) {
    return (
      <div className="rounded-3xl bg-primary/5 border border-primary/30 p-5 md:p-6 mb-8" data-testid="pending-delivery-banner">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 rounded-xl bg-primary/15 text-primary items-center justify-center shrink-0">
            <BellRing className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-overline uppercase font-bold text-primary">Tiffin tracking · live</p>
            <h3 className="font-display font-extrabold text-xl md:text-2xl mt-1 leading-tight">
              {items.length} tiffin{items.length !== 1 ? "s" : ""} headed your way today
            </h3>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              Tap "I got my tiffin" the moment it lands — or wait, your delivery boy is geo-verified at your doorstep automatically.
            </p>
          </div>
        </div>

        {!hasLocation && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3" data-testid="pin-location-prompt">
            <MapPin className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-xs text-amber-900 flex-1">Pin your exact home location once — protects you from fake "delivered" marks.</span>
            <Button onClick={pinLocation} size="sm" className="rounded-full bg-amber-600 hover:bg-amber-700 text-white" data-testid="pin-location-btn">Pin location</Button>
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

  // CASE B — no pending today; show always-on info + location pin CTA
  return (
    <div className="rounded-3xl bg-card border border-border p-5 md:p-6 mb-8" data-testid="tiffin-tracking-info">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 rounded-xl bg-primary/10 text-primary items-center justify-center shrink-0">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">Tiffin tracking</p>
          <h3 className="font-display font-extrabold text-lg md:text-xl mt-1 leading-tight">
            How your tiffin reaches you
          </h3>
          <ul className="mt-3 space-y-1.5 text-xs md:text-sm text-muted-foreground">
            <li className="flex items-start gap-2"><Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" /> Each day, lunch + dinner are dispatched based on your active plan.</li>
            <li className="flex items-start gap-2"><MapPin className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" /> Delivery boy can mark "delivered" only when their phone is within metres of your pinned home.</li>
            <li className="flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" /> You can also tap "I got my tiffin" yourself — appears here when delivery is out.</li>
          </ul>
        </div>
      </div>

      {!hasLocation ? (
        <div className="mt-5 rounded-2xl bg-amber-50 border border-amber-200 p-4 flex flex-wrap items-center gap-3" data-testid="pin-location-cta">
          <MapPin className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-xs text-amber-900 flex-1 font-semibold">Pin your home location to enable doorstep verification.</span>
          <Button onClick={pinLocation} size="sm" className="rounded-full bg-amber-600 hover:bg-amber-700 text-white" data-testid="pin-location-btn-info">
            <ChevronRight className="h-3.5 w-3.5 mr-1" /> Pin location
          </Button>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl bg-primary/5 border border-primary/15 p-3 flex items-center gap-2 text-xs text-primary" data-testid="location-pinned-badge">
          <CheckCircle2 className="h-4 w-4" /> <span className="font-semibold">Home location pinned · doorstep verification active</span>
          <button onClick={pinLocation} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">re-pin</button>
        </div>
      )}
    </div>
  );
}
