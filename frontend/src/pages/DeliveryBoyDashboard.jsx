import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import DeliveryMap from "../components/DeliveryMap";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import {
  Truck, Sun, Moon, Play, MapPin, CheckCircle2, Phone, Loader2,
  Navigation, Wifi, WifiOff, RefreshCw, AlertTriangle, Lock, Recycle, ChevronDown,
} from "lucide-react";

const PING_MS = 15000;

export default function DeliveryBoyDashboard() {
  const { user } = useAuth();
  const [boy, setBoy] = useState(null);
  const [data, setData] = useState(null);
  const [slots, setSlots] = useState(null);
  const [empties, setEmpties] = useState({ users: [], count: 0 });
  const [dispatch, setDispatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [meal, setMeal] = useState("lunch");
  const [starting, setStarting] = useState(false);
  const [marking, setMarking] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [pos, setPos] = useState(null);
  const [gpsErr, setGpsErr] = useState(null);
  const [showEmpties, setShowEmpties] = useState(false);
  const watchRef = useRef(null);
  const pingRef = useRef(null);
  const slotsTimerRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const [meRes, todayRes, slotsRes, emptiesRes, liveRes] = await Promise.all([
        api.get("/boy/me"),
        api.get("/boy/today"),
        api.get("/boy/slots"),
        api.get("/boy/empties"),
        // boys aren't admin — but the dispatch is also embedded on /boy/today via settings.
        // We piggyback off /admin/delivery/live? No — boy is not admin. So expose dispatch via /boy/slots? simpler: just fetch via /boy/today response if added. Skip for now.
        Promise.resolve({ data: null }),
      ]);
      setBoy(meRes.data);
      setData(todayRes.data);
      setSlots(slotsRes.data?.slots || null);
      setEmpties(emptiesRes.data || { users: [], count: 0 });
      setDispatch(todayRes.data?.dispatch || null);
      // pick the meal slot that's open right now
      const s = slotsRes.data?.slots || {};
      if (s.lunch?.open) setMeal("lunch");
      else if (s.dinner?.open) setMeal("dinner");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load assignments");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    // re-fetch slot status every minute so the lock auto-opens at the window
    slotsTimerRef.current = setInterval(async () => {
      try { const r = await api.get("/boy/slots"); setSlots(r.data?.slots || null); } catch {}
    }, 60000);
    return () => { if (slotsTimerRef.current) clearInterval(slotsTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!boy?.on_trip) { stopGps(); return; }
    startGps();
    return () => stopGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boy?.on_trip]);

  const startGps = () => {
    if (!navigator.geolocation) { setGpsErr("Geolocation not supported on this device"); return; }
    if (watchRef.current != null) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => { setGpsErr(null); setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
      (err) => setGpsErr(err.message || "GPS unavailable — check phone settings"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    pingRef.current = setInterval(async () => {
      if (!pos) return;
      try { await api.post("/boy/location", { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }); } catch {}
    }, PING_MS);
  };

  const stopGps = () => {
    if (watchRef.current != null) { navigator.geolocation?.clearWatch(watchRef.current); watchRef.current = null; }
    if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
  };

  useEffect(() => {
    if (!pos || !boy?.on_trip) return;
    api.post("/boy/location", { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!pos) { toast.error("Waiting for GPS — make sure location is enabled."); return; }
    setMarking(item.roster_id);
    try {
      await api.post(`/admin/delivery/roster/${item.roster_id}/mark`, { status: "delivered", lat: pos.lat, lng: pos.lng });
      toast.success("Geo-verified · delivered");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setMarking(null); }
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

  const collectEmpty = async (userId, count = 1) => {
    setCollecting(userId);
    try {
      await api.post("/boy/empty/collect", { user_id: userId, count });
      toast.success("Empty tiffin collected · ledger updated");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setCollecting(null); }
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
  const slotInfo = slots?.[meal] || { open: true, reason: "", window: {} };
  const lunchOpen = !!slots?.lunch?.open;
  const dinnerOpen = !!slots?.dinner?.open;
  // Per-meal stop counts so the boy sees only this slot's stops
  const filteredItems = onTrip ? items : items.filter((i) => i.meal_type === meal);

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

      {/* Outstanding empty tiffins — biggest priority before next slot */}
      {empties.count > 0 && (
        <div className="rounded-3xl border border-amber-300 bg-amber-50 p-5" data-testid="empties-banner">
          <button onClick={() => setShowEmpties((s) => !s)} className="w-full flex items-start gap-3 text-left">
            <span className="inline-flex h-10 w-10 rounded-xl bg-amber-200 text-amber-800 items-center justify-center shrink-0">
              <Recycle className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] tracking-overline uppercase font-bold text-amber-700">Empty tiffins outstanding</p>
              <h3 className="font-display font-extrabold text-lg md:text-xl text-amber-900 mt-0.5">
                Collect {empties.users.reduce((a, u) => a + (u.tiffin_balance || 0), 0)} empt{empties.users.reduce((a, u) => a + (u.tiffin_balance || 0), 0) === 1 ? "y" : "ies"} · {empties.count} customer{empties.count !== 1 ? "s" : ""}
              </h3>
              <p className="text-xs text-amber-900/80 mt-1">When delivering today, ask these customers for their empty lunch tiffin too.</p>
            </div>
            <ChevronDown className={`h-5 w-5 text-amber-700 transition-transform ${showEmpties ? "rotate-180" : ""}`} />
          </button>
          {showEmpties && (
            <ul className="mt-4 space-y-2" data-testid="empties-list">
              {empties.users.map((u) => (
                <li key={u.user_id} className="rounded-2xl bg-white border border-amber-200 p-3 flex flex-wrap items-center gap-3" data-testid={`empty-row-${u.user_id}`}>
                  <span className="inline-flex h-8 min-w-8 px-2 rounded-full bg-amber-600 text-white items-center justify-center text-xs font-bold">×{u.tiffin_balance}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.phone} · pin {u.pincode || "?"} · {u.address?.slice(0, 60) || "no address"}</p>
                  </div>
                  {u.phone && <a href={`tel:${u.phone}`} className="inline-flex items-center gap-1 h-9 px-3 rounded-full bg-muted text-sm font-semibold"><Phone className="h-3.5 w-3.5" /> Call</a>}
                  <Button
                    size="sm"
                    onClick={() => collectEmpty(u.user_id, 1)}
                    disabled={collecting === u.user_id}
                    className="h-9 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                    data-testid={`collect-empty-${u.user_id}`}
                  >
                    {collecting === u.user_id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Recycle className="h-3.5 w-3.5 mr-1.5" />}
                    Collected 1
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
          {onTrip && pos && <span>GPS live · accuracy {Math.round(pos.accuracy || 0)}m · pinging every {PING_MS / 1000}s</span>}
          {onTrip && !pos && <span>{gpsErr || "Waiting for GPS lock — open the door for the sky :)"}</span>}
        </div>
      </div>

      {!onTrip ? (
        <div className="rounded-3xl border border-border bg-card p-5 md:p-6 space-y-4" data-testid="dispatch-card">
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today's run</p>
              <h2 className="font-display font-extrabold text-2xl mt-1" data-testid="meal-totals">
                {filteredItems.length} {meal} stop{filteredItems.length !== 1 ? "s" : ""} · {filteredItems.filter((i) => i.tiffin_size === "full").length}F + {filteredItems.filter((i) => i.tiffin_size === "half").length}H
              </h2>
            </div>
            <div className="inline-flex bg-muted rounded-full p-1" role="tablist">
              <SlotTab id="lunch" current={meal} setCurrent={setMeal} open={lunchOpen} icon={Sun} label="Lunch" reason={slots?.lunch?.reason} window={slots?.lunch?.window} />
              <SlotTab id="dinner" current={meal} setCurrent={setMeal} open={dinnerOpen} icon={Moon} label="Dinner" reason={slots?.dinner?.reason} window={slots?.dinner?.window} />
            </div>
          </div>
          <Button
            onClick={startDispatch}
            disabled={starting || !slotInfo.open}
            className={`w-full h-12 rounded-full font-bold text-base ${slotInfo.open ? "bg-primary hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed"}`}
            data-testid="start-dispatch"
          >
            {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : slotInfo.open ? <Play className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
            {slotInfo.open
              ? `Start ${meal} dispatch`
              : (slotInfo.reason || `${meal} slot is closed right now`)}
          </Button>
          <p className="text-xs text-muted-foreground" data-testid="slot-window-hint">
            {slotInfo.open
              ? `${meal} window open until ${slotInfo.window?.close_at || "—"}.`
              : `${meal} window: ${slotInfo.window?.open_at || "—"} – ${slotInfo.window?.close_at || "—"}.`}
          </p>
        </div>
      ) : (
        <div className="rounded-3xl bg-primary text-primary-foreground p-5 md:p-6 flex flex-wrap items-center gap-4" data-testid="trip-active">
          <Truck className="h-7 w-7" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">On trip</p>
            <p className="font-display font-extrabold text-xl">{totals.delivered || 0} of {totals.total || 0} delivered</p>
            {next && <p className="text-xs text-primary-foreground/80 mt-1 truncate">Next stop: <b>{next.name}</b> · {next.address?.slice(0, 60)}</p>}
          </div>
          <Button onClick={endDispatch} variant="outline" size="sm" className="rounded-full bg-white/10 border-white/20 text-primary-foreground hover:bg-white/20" data-testid="end-dispatch">End trip</Button>
        </div>
      )}

      <DeliveryMap
        boy={pos ? { lat: pos.lat, lng: pos.lng, name: boy.name } : (boy.current_lat ? { lat: boy.current_lat, lng: boy.current_lng, name: boy.name, last_ping_at: boy.last_ping_at } : null)}
        items={filteredItems}
        dispatch={dispatch}
        showRoute
        height={320}
      />

      <div className="space-y-3">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Stops in route order</p>
        {filteredItems.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-8 text-center text-sm text-muted-foreground">
            Nothing on your route yet. Tap "Start dispatch" once tiffins are ready.
          </div>
        )}
        <ol className="space-y-2">
          {filteredItems.map((it, idx) => (
            <StopRow
              key={it.roster_id}
              idx={idx + 1}
              item={it}
              marking={marking}
              collecting={collecting}
              onDelivered={() => markDelivered(it)}
              onReturned={() => markReturned(it)}
              onCollectEmpty={() => collectEmpty(it.user_id, 1)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function SlotTab({ id, current, setCurrent, open, icon: Icon, label, reason, window: w }) {
  const isActive = current === id;
  return (
    <button
      onClick={() => setCurrent(id)}
      data-testid={`meal-tab-${id}`}
      title={open ? `${label} window: ${w?.open_at} – ${w?.close_at}` : reason}
      className={`px-4 h-9 rounded-full text-xs font-bold uppercase tracking-overline transition-colors flex items-center gap-1.5 ${isActive ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"} ${open ? "" : "opacity-60"}`}
    >
      <Icon className="h-3.5 w-3.5" /> {label} {!open && <Lock className="h-3 w-3 ml-0.5" />}
    </button>
  );
}

function StopRow({ idx, item, marking, collecting, onDelivered, onReturned, onCollectEmpty }) {
  const isDone = item.status === "delivered";
  const isLocked = marking === item.roster_id;
  const isCollecting = collecting === item.user_id;
  const callHref = item.phone ? `tel:${item.phone}` : null;
  const mapHref = item.customer_lat && item.customer_lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${item.customer_lat},${item.customer_lng}&travelmode=driving`
    : null;
  const owesEmpties = (item.tiffin_balance || 0) > 0;
  return (
    <li
      className={`rounded-2xl border bg-card p-4 ${isDone ? "border-emerald-200 bg-emerald-50/40" : owesEmpties ? "border-amber-200" : "border-border"}`}
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
            {item.customer_pincode && <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">PIN {item.customer_pincode}</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.address}</p>
          {owesEmpties && !isDone && (
            <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1 font-semibold">
              <Recycle className="h-3 w-3" /> Customer holds {item.tiffin_balance} empty tiffin{item.tiffin_balance !== 1 ? "s" : ""} — collect now.
            </p>
          )}
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
        {owesEmpties && (
          <Button
            onClick={onCollectEmpty}
            disabled={isCollecting}
            size="sm"
            variant="outline"
            className="h-9 rounded-full border-amber-400 text-amber-800"
            data-testid={`collect-stop-${item.roster_id}`}
          >
            {isCollecting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Recycle className="h-3.5 w-3.5 mr-1.5" />}
            Collected empty
          </Button>
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
