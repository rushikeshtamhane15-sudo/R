import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import DeliveryMap from "../components/DeliveryMap";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import {
  Truck, Sun, Moon, Play, MapPin, CheckCircle2, Phone, Loader2,
  Navigation, Wifi, WifiOff, RefreshCw, AlertTriangle,
} from "lucide-react";

const PING_MS = 15000; // 15s GPS pings while on trip

export default function DeliveryBoyDashboard() {
  const { user } = useAuth();
  const [boy, setBoy] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [meal, setMeal] = useState("lunch");
  const [starting, setStarting] = useState(false);
  const [marking, setMarking] = useState(null);
  const [pos, setPos] = useState(null);          // { lat, lng, accuracy }
  const [gpsErr, setGpsErr] = useState(null);
  const watchRef = useRef(null);
  const pingRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const [meRes, todayRes] = await Promise.all([
        api.get("/boy/me"),
        api.get("/boy/today"),
      ]);
      setBoy(meRes.data);
      setData(todayRes.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load assignments");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Auto-pick meal slot based on local time
  useEffect(() => {
    const h = new Date().getHours();
    setMeal(h < 15 ? "lunch" : "dinner");
  }, []);

  // Live GPS watch — runs whenever boy is on trip
  useEffect(() => {
    if (!boy?.on_trip) {
      stopGps();
      return;
    }
    startGps();
    return () => stopGps();
  }, [boy?.on_trip]);

  const startGps = () => {
    if (!navigator.geolocation) { setGpsErr("Geolocation not supported on this device"); return; }
    if (watchRef.current != null) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        setGpsErr(null);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (err) => setGpsErr(err.message || "GPS unavailable — check phone settings"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    // Send pings on a steady cadence
    pingRef.current = setInterval(async () => {
      if (!pos) return;
      try {
        await api.post("/boy/location", { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
      } catch {}
    }, PING_MS);
  };

  const stopGps = () => {
    if (watchRef.current != null) {
      navigator.geolocation?.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
  };

  // Send first ping the moment we get a fresh fix (so admin/customer map updates immediately)
  useEffect(() => {
    if (!pos || !boy?.on_trip) return;
    api.post("/boy/location", { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }).catch(() => {});
  }, [pos?.lat, pos?.lng, boy?.on_trip]);

  const startDispatch = async () => {
    setStarting(true);
    try {
      await api.post("/boy/dispatch/start", { meal_type: meal });
      toast.success(`${meal === "lunch" ? "Lunch" : "Dinner"} dispatch started — drive safe!`);
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not start dispatch"); }
    finally { setStarting(false); }
  };

  const endDispatch = async () => {
    if (!window.confirm("End trip? Make sure you've marked every tiffin first.")) return;
    try {
      await api.post("/boy/dispatch/end");
      toast.success("Trip ended.");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const markDelivered = async (item) => {
    if (!pos) {
      toast.error("Waiting for GPS — make sure location is enabled.");
      return;
    }
    setMarking(item.roster_id);
    try {
      await api.post(`/admin/delivery/roster/${item.roster_id}/mark`, {
        status: "delivered",
        lat: pos.lat,
        lng: pos.lng,
      });
      toast.success("Geo-verified · delivered");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setMarking(null); }
  };

  const markReturned = async (item) => {
    setMarking(item.roster_id);
    try {
      await api.post(`/admin/delivery/roster/${item.roster_id}/mark`, { status: "returned" });
      toast.success("Marked returned");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setMarking(null); }
  };

  if (loading) {
    return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading your run…</div>;
  }

  if (!boy) {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center" data-testid="boy-not-registered">
        <Truck className="h-10 w-10 text-muted-foreground mx-auto" />
        <h1 className="font-display font-extrabold text-2xl mt-4">Not registered as a delivery boy</h1>
        <p className="text-sm text-muted-foreground mt-2">Ask the admin to add your phone number under <i>Delivery → Boys</i> and try again.</p>
      </div>
    );
  }

  const items = data?.items || [];
  const totals = data?.totals || {};
  const onTrip = !!boy.on_trip;
  const next = items.find((i) => i.status !== "delivered");

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 pb-28 md:pb-12 space-y-6" data-testid="boy-dashboard">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" /> Delivery boy
          </p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-1">Hi, {boy.name?.split(" ")[0] || "boss"}</h1>
          <p className="text-xs text-muted-foreground mt-1">Pincodes · {boy.assigned_pincodes?.join(", ") || "none assigned"}</p>
        </div>
        <Button onClick={load} variant="outline" size="sm" className="rounded-full" data-testid="boy-refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* GPS status pill */}
      <div
        className={`rounded-2xl border p-4 flex items-center gap-3 ${
          onTrip
            ? pos
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-amber-50 border-amber-200 text-amber-900"
            : "bg-muted border-border text-muted-foreground"
        }`}
        data-testid="gps-status"
      >
        {onTrip ? (pos ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />) : <Navigation className="h-4 w-4" />}
        <div className="flex-1 min-w-0 text-sm">
          {!onTrip && <span>Tap "Start dispatch" to claim your tiffins for this slot.</span>}
          {onTrip && pos && (
            <span>
              GPS live · accuracy {Math.round(pos.accuracy || 0)}m · pinging every {PING_MS / 1000}s
            </span>
          )}
          {onTrip && !pos && <span>{gpsErr || "Waiting for GPS lock — open the door for the sky :)"}</span>}
        </div>
      </div>

      {/* Dispatch control */}
      {!onTrip ? (
        <div className="rounded-3xl border border-border bg-card p-5 md:p-6 space-y-4" data-testid="dispatch-card">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today's run</p>
              <h2 className="font-display font-extrabold text-2xl mt-1">
                {totals.pending || 0} pending · {totals.full || 0}F + {totals.half || 0}H
              </h2>
            </div>
            <div className="inline-flex bg-muted rounded-full p-1" role="tablist">
              {["lunch", "dinner"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMeal(m)}
                  data-testid={`meal-tab-${m}`}
                  className={`px-4 h-9 rounded-full text-xs font-bold uppercase tracking-overline transition-colors ${meal === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
                >
                  {m === "lunch" ? <span className="flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Lunch</span> : <span className="flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" /> Dinner</span>}
                </button>
              ))}
            </div>
          </div>
          <Button
            onClick={startDispatch}
            disabled={starting}
            className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 font-bold text-base"
            data-testid="start-dispatch"
          >
            {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Start {meal} dispatch
          </Button>
          <p className="text-xs text-muted-foreground">
            This claims every unassigned tiffin in your pincodes for this slot. Make sure your bag is loaded before tapping.
          </p>
        </div>
      ) : (
        <div className="rounded-3xl bg-primary text-primary-foreground p-5 md:p-6 flex flex-wrap items-center gap-4" data-testid="trip-active">
          <Truck className="h-7 w-7" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">On trip</p>
            <p className="font-display font-extrabold text-xl">
              {totals.delivered || 0} of {totals.total || 0} delivered
            </p>
            {next && (
              <p className="text-xs text-primary-foreground/80 mt-1 truncate">
                Next stop: <b>{next.name}</b> · {next.address?.slice(0, 60)}
              </p>
            )}
          </div>
          <Button onClick={endDispatch} variant="outline" size="sm" className="rounded-full bg-white/10 border-white/20 text-primary-foreground hover:bg-white/20" data-testid="end-dispatch">
            End trip
          </Button>
        </div>
      )}

      {/* Live route map */}
      <DeliveryMap
        boy={pos ? { lat: pos.lat, lng: pos.lng, name: boy.name } : (boy.current_lat ? { lat: boy.current_lat, lng: boy.current_lng, name: boy.name, last_ping_at: boy.last_ping_at } : null)}
        items={items}
        showRoute
        height={320}
      />

      {/* Stop list */}
      <div className="space-y-3">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Stops in route order</p>
        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-8 text-center text-sm text-muted-foreground">
            Nothing on your route yet. Tap "Start dispatch" once tiffins are ready.
          </div>
        )}
        <ol className="space-y-2">
          {items.map((it, idx) => <StopRow key={it.roster_id} idx={idx + 1} item={it} marking={marking} onDelivered={() => markDelivered(it)} onReturned={() => markReturned(it)} />)}
        </ol>
      </div>
    </div>
  );
}

function StopRow({ idx, item, marking, onDelivered, onReturned }) {
  const isDone = item.status === "delivered";
  const isLocked = marking === item.roster_id;
  const callHref = item.phone ? `tel:${item.phone}` : null;
  const mapHref = item.customer_lat && item.customer_lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${item.customer_lat},${item.customer_lng}&travelmode=driving`
    : null;
  return (
    <li
      className={`rounded-2xl border bg-card p-4 ${isDone ? "border-emerald-200 bg-emerald-50/40" : "border-border"}`}
      data-testid={`stop-${item.roster_id}`}
    >
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold shrink-0 ${isDone ? "bg-emerald-500 text-white" : "bg-primary/10 text-primary"}`}>
          {isDone ? <CheckCircle2 className="h-4 w-4" /> : idx}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold truncate">{item.name}</p>
            <span className={`text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full ${item.tiffin_size === "full" ? "bg-primary/10 text-primary" : "bg-secondary/15 text-secondary"}`}>{item.tiffin_size}</span>
            <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{item.meal_type}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.address}</p>
          {item.distance_m !== undefined && isDone && (
            <p className="text-[11px] text-emerald-700 mt-1 font-semibold">Verified · {Math.round(item.distance_m)}m from door</p>
          )}
          {(!item.customer_lat || !item.customer_lng) && !isDone && (
            <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Customer hasn't pinned location — they must do it before you can mark delivered.</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {callHref && (
          <a href={callHref} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70" data-testid={`call-${item.roster_id}`}>
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        )}
        {mapHref && (
          <a href={mapHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-muted text-foreground text-sm font-semibold hover:bg-muted/70" data-testid={`navigate-${item.roster_id}`}>
            <MapPin className="h-3.5 w-3.5" /> Navigate
          </a>
        )}
        {!isDone && (
          <>
            <Button onClick={onDelivered} disabled={isLocked} size="sm" className="h-9 rounded-full bg-primary hover:bg-primary/90 font-semibold" data-testid={`deliver-${item.roster_id}`}>
              {isLocked ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />} Mark delivered
            </Button>
            <Button onClick={onReturned} disabled={isLocked} variant="outline" size="sm" className="h-9 rounded-full" data-testid={`return-${item.roster_id}`}>
              Return
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
