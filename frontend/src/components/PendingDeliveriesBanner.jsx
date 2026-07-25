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
      <div className="rounded-2xl bg-primary/5 border border-primary/30 p-4 mb-3" data-testid="pending-delivery-banner">
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
    <div
      className="relative rounded-2xl overflow-hidden mb-3"
      style={{
        background: "linear-gradient(135deg, #fef2f2 0%, #ffffff 55%, #f0fdf4 100%)",
        boxShadow: "0 12px 28px -18px rgba(15,23,42,0.18), 0 3px 8px -3px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
      }}
      data-testid="tiffin-tracking-info"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full opacity-50"
        style={{ background: "radial-gradient(circle at center, rgba(160,35,35,0.18) 0%, transparent 65%)" }}
      />
      <div className="relative p-4 md:p-5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white items-center justify-center shadow-md">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[9px] tracking-[0.16em] uppercase font-extrabold text-secondary">Tiffin tracking</p>
            <h3 className="font-display font-extrabold text-base md:text-lg leading-tight">
              How your tiffin reaches you
            </h3>
          </div>
        </div>

        <ol className="mt-3.5 grid gap-2">
          <StepRow n={1} icon={Sparkles} title="Dispatched daily" desc="Lunch + dinner set from your active plan" />
          <StepRow n={2} icon={MapPin} title="Doorstep verified" desc={"Only marked delivered when the boy's phone is at your door"} />
          <StepRow n={3} icon={CheckCircle2} title={'Or tap "I got my tiffin"'} desc="Button appears here the moment delivery is out" />
        </ol>

        {!hasLocation ? (
          <button
            type="button"
            onClick={pinLocation}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-xs h-10 flex items-center justify-center gap-1.5 shadow-md"
            data-testid="pin-location-btn-info"
          >
            <MapPin className="h-3.5 w-3.5" /> Pin your home location to enable doorstep verification
          </button>
        ) : (
          <div className="mt-4 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2 flex items-center gap-2 text-xs" data-testid="location-pinned-badge">
            <span className="inline-flex h-5 w-5 rounded-full bg-emerald-600 text-white items-center justify-center shrink-0">
              <CheckCircle2 className="h-3 w-3" />
            </span>
            <span className="font-bold text-emerald-900 flex-1">Home pinned · doorstep verification live</span>
            <button onClick={pinLocation} className="text-[10px] tracking-overline uppercase font-bold text-emerald-700 hover:text-emerald-900 underline-offset-2 hover:underline">Re-pin</button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepRow({ n, icon: Icon, title, desc }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="relative shrink-0 h-6 w-6 rounded-lg bg-white ring-1 ring-black/5 flex items-center justify-center shadow-sm">
        <Icon className="h-3 w-3 text-primary" strokeWidth={2.5} />
        <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-white text-[8px] font-extrabold flex items-center justify-center leading-none">{n}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-foreground leading-tight">{title}</p>
        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{desc}</p>
      </div>
    </li>
  );
}
