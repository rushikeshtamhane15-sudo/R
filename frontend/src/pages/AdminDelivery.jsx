import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import {
  Truck, RefreshCw, MapPin, AlertTriangle, CheckCircle2, Clock,
  Plus, Trash2, Save, Settings as SettingsIcon, Phone, KeyRound, Package, Loader2, ArrowRight, X,
} from "lucide-react";

const TABS = [
  { id: "today", label: "Today" },
  { id: "boys", label: "Delivery Boys" },
  { id: "settings", label: "Settings" },
];

export default function AdminDelivery() {
  const [tab, setTab] = useState("today");
  return (
    <div data-testid="admin-delivery-page">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 rounded-xl bg-primary/10 text-primary items-center justify-center"><Truck className="h-5 w-5" /></span>
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Operations</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight leading-tight">Tiffin delivery</h1>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-3 max-w-2xl">
        Auto-generated daily roster of tiffins to deliver, grouped by pincode. Hand off to delivery boys with exact tiffin counts, verify each delivery via OTP, and reconcile at the end of the trip — losses are flagged automatically.
      </p>

      <div className="mt-7 inline-flex bg-muted/50 rounded-full p-1" role="tablist" data-testid="delivery-tabs">
        {TABS.map((t) => (
          <button
            key={t.id} type="button" onClick={() => setTab(t.id)}
            data-testid={`tab-${t.id}`}
            className={`px-5 h-9 rounded-full text-sm font-semibold transition-colors ${tab === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >{t.label}</button>
        ))}
      </div>

      <div className="mt-7">
        {tab === "today" && <TodayPanel />}
        {tab === "boys" && <BoysPanel />}
        {tab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}

// =================== TODAY ===================
function TodayPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date] = useState(""); // future: date picker
  const [activeHandoff, setActiveHandoff] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/admin/delivery/today${date ? `?date=${date}` : ""}`);
      setData(r.data);
    } catch (e) { toast.error("Could not load roster"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading roster…</div>;
  if (!data) return null;

  const totalToday = (data.lunch?.total || 0) + (data.dinner?.total || 0);
  const totalFull = (data.lunch?.full || 0) + (data.dinner?.full || 0);
  const totalHalf = (data.lunch?.half || 0) + (data.dinner?.half || 0);
  const outsideTotal = (data.lunch?.outside_count || 0) + (data.dinner?.outside_count || 0);

  return (
    <div className="space-y-6" data-testid="today-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Roster for</p>
          <p className="font-display font-extrabold text-2xl mt-1">{new Date(data.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <Button onClick={load} variant="outline" className="rounded-full"><RefreshCw className="h-4 w-4 mr-2" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total tiffins" value={totalToday} icon={Package} />
        <Stat label="Full tiffins" value={totalFull} icon={Package} accent />
        <Stat label="Half tiffins" value={totalHalf} icon={Package} accent />
        <Stat label="Outside service" value={outsideTotal} icon={AlertTriangle} warn={outsideTotal > 0} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <MealCard meal="lunch" bucket={data.lunch} cutoff={data.settings?.lunch_cutoff} onHandoff={setActiveHandoff} />
        <MealCard meal="dinner" bucket={data.dinner} cutoff={data.settings?.dinner_cutoff} onHandoff={setActiveHandoff} />
      </div>

      {data.handoffs?.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today's handoffs</p>
          {data.handoffs.map((h) => <HandoffCard key={h.handoff_id} handoff={h} onChange={load} />)}
        </div>
      )}

      {activeHandoff && (
        <HandoffSheet
          ctx={activeHandoff}
          onClose={() => setActiveHandoff(null)}
          onCreated={async () => { setActiveHandoff(null); await load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, accent, warn }) {
  return (
    <div className={`rounded-2xl p-4 ${warn ? "bg-destructive/10 border border-destructive/30" : accent ? "bg-primary/5 border border-primary/15" : "bg-card border border-border"}`} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${warn ? "text-destructive" : "text-muted-foreground"}`} />
      </div>
      <p className={`font-display font-extrabold text-3xl mt-2 ${warn ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function MealCard({ meal, bucket, cutoff, onHandoff }) {
  const Title = meal === "lunch" ? "Lunch" : "Dinner";
  return (
    <div className="rounded-2xl border border-border bg-card p-5" data-testid={`meal-card-${meal}`}>
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">{meal === "lunch" ? "Mid-day" : "Evening"}</p>
          <h3 className="font-display font-extrabold text-2xl">{Title} · {bucket.total} tiffin{bucket.total !== 1 ? "s" : ""}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {bucket.full} full · {bucket.half} half
            {cutoff && <> · cut-off <Clock className="inline h-3 w-3 ml-1 -mt-0.5" /> {cutoff}</>}
          </p>
        </div>
      </div>

      {bucket.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-4">No deliveries scheduled.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {bucket.groups.map((g) => (
            <details key={g.pincode} className="rounded-xl border border-border bg-background open:shadow-sm" data-testid={`pincode-group-${meal}-${g.pincode}`}>
              <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className={`h-4 w-4 shrink-0 ${g.is_outside ? "text-destructive" : "text-primary"}`} />
                  <span className="font-semibold truncate">
                    {g.pincode === "unknown" ? "Pincode missing" : g.pincode}
                  </span>
                  {g.is_outside && <span className="text-[10px] tracking-overline uppercase font-bold bg-destructive/10 text-destructive px-2 py-0.5 rounded-full">Outside</span>}
                  {g.pincode === "unknown" && <span className="text-[10px] tracking-overline uppercase font-bold bg-secondary/15 text-secondary px-2 py-0.5 rounded-full">Update address</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold tabular-nums">{g.count}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{g.full}F · {g.half}H</span>
                </div>
              </summary>
              <ul className="border-t border-border divide-y divide-border">
                {g.items.map((it) => <ItemRow key={it.roster_id} item={it} />)}
                <li className="px-4 py-3 bg-muted/30">
                  <Button
                    size="sm"
                    onClick={() => onHandoff({ meal, pincode: g.pincode, items: g.items, full: g.full, half: g.half })}
                    className="rounded-full bg-primary hover:bg-primary/90"
                    data-testid={`handoff-${meal}-${g.pincode}`}
                  >
                    <Truck className="h-3.5 w-3.5 mr-2" /> Hand over to delivery boy
                  </Button>
                </li>
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemRow({ item }) {
  const statusBadge = {
    planned: "bg-muted text-muted-foreground",
    out: "bg-secondary/15 text-secondary",
    delivered: "bg-emerald-100 text-emerald-700",
    undelivered: "bg-amber-100 text-amber-700",
    returned: "bg-amber-100 text-amber-700",
  }[item.status] || "bg-muted text-muted-foreground";
  return (
    <li className="px-4 py-3 flex items-start gap-3 text-sm" data-testid={`item-${item.roster_id}`}>
      <span className={`text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full ${item.tiffin_size === "full" ? "bg-primary/10 text-primary" : "bg-secondary/15 text-secondary"}`}>
        {item.tiffin_size}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold truncate">{item.name}</p>
        <p className="text-xs text-muted-foreground truncate flex items-center gap-1"><Phone className="h-3 w-3" /> {item.phone}</p>
        <p className="text-xs text-muted-foreground line-clamp-2">{item.address}</p>
      </div>
      <span className={`text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full ${statusBadge}`}>{item.status}</span>
    </li>
  );
}

// Handoff modal
function HandoffSheet({ ctx, onClose, onCreated }) {
  const [boys, setBoys] = useState([]);
  const [boyId, setBoyId] = useState("");
  const [takenFull, setTakenFull] = useState(ctx.full);
  const [takenHalf, setTakenHalf] = useState(ctx.half);
  const [selected, setSelected] = useState(new Set(ctx.items.filter((i) => !i.handoff_id).map((i) => i.roster_id)));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { (async () => {
    try { const r = await api.get("/admin/delivery/boys"); setBoys((r.data.boys || []).filter((b) => b.active !== false)); } catch {}
  })(); }, []);

  const items = ctx.items;
  const expectedFull = items.filter((i) => selected.has(i.roster_id) && i.tiffin_size === "full").length;
  const expectedHalf = items.filter((i) => selected.has(i.roster_id) && i.tiffin_size === "half").length;
  const extra = Math.max(0, takenFull - expectedFull) + Math.max(0, takenHalf - expectedHalf);

  const submit = async () => {
    if (!boyId) { toast.error("Pick a delivery boy"); return; }
    if (selected.size === 0) { toast.error("Pick at least one tiffin"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/admin/delivery/handoff", {
        meal_type: ctx.meal,
        delivery_boy_id: boyId,
        roster_ids: Array.from(selected),
        tiffins_taken_full: Number(takenFull),
        tiffins_taken_half: Number(takenHalf),
      });
      toast.success(`Handoff created · ${r.data.tiffins_taken_total} tiffins out`);
      onCreated();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={onClose} data-testid="handoff-sheet">
      <div className="bg-card w-full md:max-w-lg md:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-border flex items-start justify-between sticky top-0 bg-card z-10">
          <div>
            <p className="text-xs tracking-overline uppercase font-bold text-secondary">Hand over · {ctx.meal}</p>
            <h3 className="font-display font-extrabold text-xl mt-1">Pincode {ctx.pincode}</h3>
            <p className="text-xs text-muted-foreground mt-1">{selected.size} tiffins selected</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="handoff-close"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Delivery boy</label>
            <select value={boyId} onChange={(e) => setBoyId(e.target.value)} className="mt-2 w-full h-11 rounded-xl border border-input bg-background px-3 text-sm" data-testid="handoff-boy">
              <option value="">— select —</option>
              {boys.map((b) => <option key={b.boy_id} value={b.boy_id}>{b.name} · {b.phone}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Items in this handoff</label>
            <ul className="mt-2 space-y-2 max-h-64 overflow-y-auto border border-border rounded-xl">
              {items.map((it) => {
                const isSel = selected.has(it.roster_id);
                const taken = !!it.handoff_id;
                return (
                  <li key={it.roster_id} className={`flex items-center gap-3 px-3 py-2 ${taken ? "opacity-50" : ""}`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={isSel} disabled={taken}
                      onChange={() => {
                        const n = new Set(selected);
                        n.has(it.roster_id) ? n.delete(it.roster_id) : n.add(it.roster_id);
                        setSelected(n);
                      }}
                    />
                    <span className={`text-[10px] tracking-overline uppercase font-bold px-1.5 py-0.5 rounded-full ${it.tiffin_size === "full" ? "bg-primary/10 text-primary" : "bg-secondary/15 text-secondary"}`}>{it.tiffin_size?.[0] || "?"}</span>
                    <span className="text-sm flex-1 truncate">{it.name} · {it.phone}</span>
                    {taken && <span className="text-[10px] uppercase font-bold text-muted-foreground">already taken</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Boy taking (full)</label>
              <Input type="number" value={takenFull} onChange={(e) => setTakenFull(Number(e.target.value || 0))} min={0} className="mt-2 h-11" data-testid="handoff-taken-full" />
              <p className="text-[10px] text-muted-foreground mt-1">Expected: {expectedFull}</p>
            </div>
            <div>
              <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Boy taking (half)</label>
              <Input type="number" value={takenHalf} onChange={(e) => setTakenHalf(Number(e.target.value || 0))} min={0} className="mt-2 h-11" data-testid="handoff-taken-half" />
              <p className="text-[10px] text-muted-foreground mt-1">Expected: {expectedHalf}</p>
            </div>
          </div>

          {extra > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2" data-testid="handoff-extra-warning">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">{extra} extra tiffin{extra !== 1 ? "s" : ""} compared to roster</p>
                <p className="opacity-80 mt-0.5">Recorded in the handoff. If they aren't returned at end-of-trip, marked as loss.</p>
              </div>
            </div>
          )}

          <Button onClick={submit} disabled={submitting} className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 font-semibold" data-testid="handoff-confirm">
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…</> : <>Hand over {Number(takenFull) + Number(takenHalf)} tiffins <ArrowRight className="h-4 w-4 ml-2" /></>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Existing handoff card (with mark-delivered + reconcile)
function HandoffCard({ handoff, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState([]);
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    if (expanded) (async () => {
      try { const r = await api.get(`/admin/delivery/handoff/${handoff.handoff_id}`); setItems(r.data.items || []); } catch {}
    })();
  }, [expanded, handoff.handoff_id]);

  const mark = async (rosterId, status) => {
    try {
      let extra = {};
      if (status === "delivered") {
        if (!navigator.geolocation) {
          toast.error("This device can't share GPS — open delivery on a phone with location enabled.");
          return;
        }
        toast.message("Getting your location…");
        try {
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
          );
          extra = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          toast.error("Allow location access in your browser to mark deliveries.");
          return;
        }
      }
      await api.post(`/admin/delivery/roster/${rosterId}/mark`, { status, ...extra });
      toast.success(status === "delivered" ? "Geo-verified · delivered" : status);
      const r = await api.get(`/admin/delivery/handoff/${handoff.handoff_id}`);
      setItems(r.data.items || []);
      onChange?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const reconcile = async () => {
    setReconciling(true);
    try {
      await api.post(`/admin/delivery/handoff/${handoff.handoff_id}/reconcile`, {});
      toast.success("Reconciled");
      onChange?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setReconciling(false); }
  };

  const isDone = handoff.status === "reconciled";

  return (
    <div className="rounded-2xl border border-border bg-card p-5" data-testid={`handoff-card-${handoff.handoff_id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">{handoff.meal_type} · handoff</p>
          <h4 className="font-display font-bold text-lg mt-1">{handoff.delivery_boy_name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Took {handoff.tiffins_taken_total} ({handoff.tiffins_taken_full}F + {handoff.tiffins_taken_half}H) · expected {handoff.expected_total}
          </p>
        </div>
        <div className="text-right">
          {isDone ? (
            <div className="flex flex-wrap items-center gap-2 justify-end">
              {handoff.loss_count > 0
                ? <span className="text-xs font-bold bg-destructive/10 text-destructive px-2 py-1 rounded-full" data-testid="loss-badge">⚠ {handoff.loss_count} LOSS</span>
                : <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full"><CheckCircle2 className="inline h-3 w-3" /> All accounted</span>}
              <span className="text-[10px] text-muted-foreground">{handoff.delivered_count} delivered · {handoff.returned_count} returned</span>
            </div>
          ) : (
            <span className="text-xs font-bold bg-secondary/15 text-secondary px-2 py-1 rounded-full">OUT</span>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => setExpanded((e) => !e)} variant="outline" size="sm" className="rounded-full" data-testid={`expand-${handoff.handoff_id}`}>
          {expanded ? "Hide items" : "Show items"}
        </Button>
        {!isDone && (
          <Button onClick={reconcile} disabled={reconciling} size="sm" className="rounded-full bg-primary hover:bg-primary/90" data-testid={`reconcile-${handoff.handoff_id}`}>
            {reconciling ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1.5" />} End trip & reconcile
          </Button>
        )}
      </div>

      {expanded && (
        <ul className="mt-4 border-t border-border divide-y divide-border">
          {items.map((it) => (
            <li key={it.roster_id} className="py-3 flex flex-wrap items-center gap-3 text-sm" data-testid={`handoff-item-${it.roster_id}`}>
              <span className={`text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full ${it.tiffin_size === "full" ? "bg-primary/10 text-primary" : "bg-secondary/15 text-secondary"}`}>{it.tiffin_size}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate">{it.name}</p>
                <p className="text-xs text-muted-foreground truncate">{it.phone} · {it.address}</p>
              </div>
              {it.status === "delivered" ? (
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      it.confirmed_by === "customer"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-emerald-100 text-emerald-700"
                    }`}
                    data-testid={`confirmed-by-${it.roster_id}`}
                  >
                    {it.confirmed_by === "customer" ? "Customer confirmed" : "Geo-verified"}
                  </span>
                  {it.distance_m !== undefined && (
                    <span className="text-[10px] text-muted-foreground" title="Distance from customer">
                      {Math.round(it.distance_m)}m
                    </span>
                  )}
                </div>
              ) : it.status === "returned" || it.status === "undelivered" ? (
                <span className="text-[10px] uppercase font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{it.status}</span>
              ) : !isDone ? (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" onClick={() => mark(it.roster_id, "delivered")} className="h-8 rounded-full bg-primary hover:bg-primary/90" data-testid={`mark-delivered-${it.roster_id}`}>
                    <KeyRound className="h-3 w-3 mr-1" /> Mark delivered
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => mark(it.roster_id, "returned")} className="h-8 rounded-full" data-testid={`mark-returned-${it.roster_id}`}>Return</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =================== BOYS ===================
function BoysPanel() {
  const [boys, setBoys] = useState([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pins, setPins] = useState("");

  const load = async () => { try { const r = await api.get("/admin/delivery/boys"); setBoys(r.data.boys || []); } catch {} };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim() || !phone.trim()) { toast.error("Name & phone required"); return; }
    try {
      await api.post("/admin/delivery/boys", {
        name: name.trim(), phone: phone.trim(),
        assigned_pincodes: pins.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setName(""); setPhone(""); setPins("");
      toast.success("Delivery boy added");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const update = async (b, patch) => {
    try { await api.patch(`/admin/delivery/boys/${b.boy_id}`, patch); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const remove = async (b) => {
    if (!window.confirm(`Delete ${b.name}?`)) return;
    try { await api.delete(`/admin/delivery/boys/${b.boy_id}`); load(); toast.success("Deleted"); } catch {}
  };

  return (
    <div className="space-y-6" data-testid="boys-panel">
      <div className="bg-card rounded-2xl border border-border p-5">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Add delivery boy</p>
        <div className="mt-3 grid md:grid-cols-3 gap-3">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" data-testid="boy-name" />
          <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" data-testid="boy-phone" />
          <Input placeholder="Assigned pincodes (comma-separated)" value={pins} onChange={(e) => setPins(e.target.value)} className="h-11" data-testid="boy-pins" />
        </div>
        <Button onClick={create} className="mt-3 rounded-full bg-primary hover:bg-primary/90" data-testid="add-boy"><Plus className="h-4 w-4 mr-1" /> Add</Button>
      </div>

      <div className="space-y-2">
        {boys.length === 0 && <p className="text-sm text-muted-foreground">No delivery boys yet.</p>}
        {boys.map((b) => (
          <div key={b.boy_id} className="bg-card rounded-2xl border border-border p-4 flex flex-wrap items-center gap-3" data-testid={`boy-${b.boy_id}`}>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{b.name} <span className="text-xs text-muted-foreground font-normal">· {b.phone}</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">Pincodes: {b.assigned_pincodes?.join(", ") || "—"}</p>
            </div>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={b.active !== false} onChange={(e) => update(b, { active: e.target.checked })} className="h-4 w-4 accent-primary" /> Active</label>
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-full text-destructive" onClick={() => remove(b)} data-testid={`del-boy-${b.boy_id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// =================== SETTINGS ===================
function SettingsPanel() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState(null);

  useEffect(() => { (async () => {
    try {
      const [sr, hr] = await Promise.all([
        api.get("/admin/delivery/settings"),
        api.get("/admin/delivery/health"),
      ]);
      setS(sr.data);
      setHealth(hr.data);
    } catch {}
  })(); }, []);

  if (!s) return <div className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading settings…</div>;

  const upd = (patch) => setS({ ...s, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/admin/delivery/settings", {
        ...s,
        service_pincodes: typeof s.service_pincodes === "string"
          ? s.service_pincodes.split(",").map((p) => p.trim()).filter(Boolean)
          : s.service_pincodes,
      });
      toast.success("Settings saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const applySuggested = () => {
    if (health?.suggested_geofence_m) upd({ geofence_meters: health.suggested_geofence_m });
  };

  return (
    <div className="space-y-6" data-testid="settings-panel">
      {health?.show_hint && (
        <div className="rounded-2xl bg-amber-50 border border-amber-300 p-4 md:p-5 flex flex-wrap items-start gap-3" data-testid="geofence-hint">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-900">Geofence may be too tight</p>
            <p className="text-xs text-amber-900/80 mt-1">
              In the last 7 days, <b>{health.rejected_too_far}</b> of <b>{health.total_attempts}</b> delivery attempts were rejected as "too far"
              {" "}({Math.round(health.rejection_rate * 100)}%). Your delivery boys may be at the door but their phone GPS reads off.
              {health.suggested_geofence_m && (
                <> Try raising the radius to <b>{health.suggested_geofence_m}m</b> — that would have admitted ~95% of those.</>
              )}
            </p>
            {health.suggested_geofence_m && (
              <Button onClick={applySuggested} size="sm" className="mt-3 rounded-full bg-amber-600 hover:bg-amber-700 text-white" data-testid="apply-suggested-geofence">
                Use {health.suggested_geofence_m}m
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Lunch cut-off"><Input value={s.lunch_cutoff || ""} onChange={(e) => upd({ lunch_cutoff: e.target.value })} placeholder="HH:MM" data-testid="lunch-cutoff" /></Field>
          <Field label="Dinner cut-off"><Input value={s.dinner_cutoff || ""} onChange={(e) => upd({ dinner_cutoff: e.target.value })} placeholder="HH:MM" data-testid="dinner-cutoff" /></Field>
        </div>
        <Field label="Service pincodes (comma-separated · empty = all areas allowed)">
          <Textarea
            rows={3}
            value={Array.isArray(s.service_pincodes) ? s.service_pincodes.join(", ") : (s.service_pincodes || "")}
            onChange={(e) => upd({ service_pincodes: e.target.value })}
            data-testid="service-pincodes"
          />
        </Field>
        <Field label="Geofence radius (metres) — delivery rejected if boy is farther than this">
          <Input
            type="number"
            value={s.geofence_meters ?? 250}
            onChange={(e) => upd({ geofence_meters: Number(e.target.value || 0) })}
            min={50} max={2000}
            data-testid="geofence-meters"
          />
        </Field>
        <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="save-settings">
          <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{label}</label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
