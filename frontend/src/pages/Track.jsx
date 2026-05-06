import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import DeliveryMap from "../components/DeliveryMap";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Truck, Clock, MapPin, Phone, CheckCircle2, Loader2, ArrowLeft } from "lucide-react";

const POLL_MS = 10000;

export default function Track() {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [rosterId, setRosterId] = useState(null);

  const load = async () => {
    try {
      const [t, p] = await Promise.all([
        api.get("/my/deliveries/track"),
        api.get("/my/deliveries/pending"),
      ]);
      setData(t.data);
      setRosterId(p.data.pending?.[0]?.roster_id || null);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const confirm = async () => {
    if (!rosterId) return;
    setConfirming(true);
    try {
      await api.post(`/my/deliveries/${rosterId}/confirm`);
      toast.success("Tiffin confirmed — bon appétit!");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not confirm"); }
    finally { setConfirming(false); }
  };

  if (authLoading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  if (loading) {
    return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Tracking your tiffin…</div>;
  }

  const isTracking = !!data?.tracking;
  const boyPos = data?.boy_position;
  const myPos = data?.your_position;

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 pb-28 md:pb-12 space-y-5" data-testid="track-page">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="track-back">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div>
        <p className="text-[10px] tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5" /> Live tracking
        </p>
        <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-1">
          {isTracking ? "Your tiffin is on the way" : "No active delivery"}
        </h1>
        <p className="text-sm text-muted-foreground mt-2 italic">ghar se achha khana</p>
      </div>

      {!isTracking && (
        <div className="rounded-3xl border border-dashed border-border bg-muted/40 p-8 text-center" data-testid="no-tracking">
          <Truck className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="font-display font-bold text-lg mt-3">Nothing in dispatch right now</p>
          <p className="text-sm text-muted-foreground mt-1">
            Live tracking turns on the moment a delivery boy starts your meal slot. Check back closer to lunch / dinner.
          </p>
        </div>
      )}

      {isTracking && (
        <>
          <div className="rounded-3xl border border-border bg-card p-5 md:p-6 space-y-4" data-testid="track-summary">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground capitalize">{data.meal_type} · {data.tiffin_size} tiffin</p>
                <h2 className="font-display font-extrabold text-2xl mt-1">{data.boy_name || "Delivery boy"}</h2>
                {data.boy_phone && (
                  <a href={`tel:${data.boy_phone}`} className="inline-flex items-center gap-1.5 text-sm text-primary mt-1" data-testid="call-boy">
                    <Phone className="h-3.5 w-3.5" /> {data.boy_phone}
                  </a>
                )}
              </div>
              <div className="text-right">
                {data.eta_minutes !== null && data.eta_minutes !== undefined ? (
                  <>
                    <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">ETA</p>
                    <p className="font-display font-extrabold text-3xl flex items-center gap-1.5 justify-end" data-testid="eta">
                      <Clock className="h-5 w-5" />
                      {data.eta_minutes < 1 ? "<1 min" : `${Math.round(data.eta_minutes)} min`}
                    </p>
                    {data.distance_m !== null && data.distance_m !== undefined && (
                      <p className="text-xs text-muted-foreground mt-1" data-testid="distance">
                        {data.distance_m < 1000 ? `${Math.round(data.distance_m)}m away` : `${(data.distance_m / 1000).toFixed(1)} km away`}
                      </p>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground italic">Waiting for GPS lock…</span>
                )}
              </div>
            </div>

            {!myPos?.lat && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900 flex items-center gap-2" data-testid="pin-prompt">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>Pin your home location from the dashboard so we can show ETA + verify delivery.</span>
              </div>
            )}
          </div>

          <DeliveryMap
            boy={boyPos ? { lat: boyPos.lat, lng: boyPos.lng, name: data.boy_name, last_ping_at: boyPos.last_ping_at } : null}
            customer={myPos?.lat ? { lat: myPos.lat, lng: myPos.lng } : null}
            dispatch={data?.dispatch}
            showRoute={!!(boyPos && myPos?.lat)}
            items={(boyPos && myPos?.lat) ? [{ customer_lat: myPos.lat, customer_lng: myPos.lng, name: "You", tiffin_size: data.tiffin_size, meal_type: data.meal_type, address: "Home", status: "out", tiffin_balance: data.tiffin_balance }] : null}
            height={380}
          />

          {data.tiffin_balance > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3" data-testid="empty-reminder">
              <span className="inline-flex h-9 w-9 rounded-full bg-amber-200 text-amber-800 items-center justify-center shrink-0">♻️</span>
              <div className="text-sm text-amber-900">
                <p className="font-display font-bold">Please return {data.tiffin_balance} empty tiffin{data.tiffin_balance !== 1 ? "s" : ""}</p>
                <p className="text-xs mt-1">When today's delivery arrives, hand over your previous empty tiffin so we can keep your meals coming on time.</p>
              </div>
            </div>
          )}

          {rosterId && (
            <Button
              onClick={confirm}
              disabled={confirming}
              className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 font-bold text-base"
              data-testid="confirm-received"
            >
              {confirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              I got my tiffin
            </Button>
          )}
        </>
      )}
    </div>
  );
}
