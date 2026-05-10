import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Phone, MapPin, RefreshCw, Package, CheckCircle2, Clock, Plus, X } from "lucide-react";

export default function AdminRestaurantTakeaway() {
  const [rows, setRows] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending"); // pending | collected | all
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", tiffin_count: 1, notes: "" });
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = filter === "all" ? {} : { collected: filter === "collected" };
      const r = await api.get("/admin/restaurant/takeaway-pendency", { params });
      setRows(r.data?.rows || []);
      setPendingCount(r.data?.pending_count || 0);
    } catch { toast.error("Could not load pendency"); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const collect = async (pendency_id) => {
    if (!window.confirm("Mark this customer's tiffin(s) as collected? This decrements their tiffin balance.")) return;
    try {
      await api.post("/admin/restaurant/takeaway-pendency/collect", { pendency_id });
      toast.success("Marked collected");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const submitManual = async () => {
    if (!form.name.trim() || !form.phone.trim()) return toast.error("Name and phone are required");
    if (!form.tiffin_count || form.tiffin_count < 1) return toast.error("Tiffin count must be at least 1");
    setAdding(true);
    try {
      await api.post("/admin/restaurant/takeaway-pendency/manual", {
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        tiffin_count: Number(form.tiffin_count),
        notes: form.notes.trim(),
      });
      toast.success("Walk-in pendency added");
      setForm({ name: "", phone: "", address: "", tiffin_count: 1, notes: "" });
      setShowAdd(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Add failed"); }
    finally { setAdding(false); }
  };

  return (
    <div className="space-y-5" data-testid="admin-takeaway-pendency">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" /> Take-away tiffin pendency
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Customers who got returnable steel tiffins via /restaurant orders. Call them to schedule pickup.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} className="rounded-full" data-testid="takeaway-refresh">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button onClick={() => setShowAdd((s) => !s)} className="rounded-full bg-primary hover:bg-primary/90" data-testid="takeaway-add-manual">
            {showAdd ? <X className="h-4 w-4 mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
            {showAdd ? "Cancel" : "Manual entry"}
          </Button>
        </div>
      </div>

      {/* Manual walk-in entry — for unknown customer who took a steel tiffin */}
      {showAdd && (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3" data-testid="takeaway-manual-form">
          <p className="font-display font-extrabold flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /> Walk-in tiffin pendency</p>
          <p className="text-xs text-muted-foreground">Capture an unknown customer's details so the kitchen can call them back to collect the steel tiffin.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label>
              <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Name *</span>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Customer name" className="mt-1" data-testid="manual-name" />
            </label>
            <label>
              <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Phone *</span>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9XXXXXXXXX" className="mt-1" data-testid="manual-phone" />
            </label>
            <label className="sm:col-span-2">
              <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Address</span>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Optional · landmark / area" className="mt-1" data-testid="manual-address" />
            </label>
            <label>
              <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Tiffin count *</span>
              <Input type="number" min={1} max={20} value={form.tiffin_count} onChange={(e) => setForm({ ...form, tiffin_count: e.target.value })} className="mt-1" data-testid="manual-count" />
            </label>
            <label className="sm:col-span-2">
              <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Notes</span>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional · what dish, expected return date, etc." className="mt-1" data-testid="manual-notes" />
            </label>
          </div>
          <div className="flex justify-end">
            <Button onClick={submitManual} disabled={adding} className="rounded-full bg-emerald-600 hover:bg-emerald-700" data-testid="manual-submit">
              {adding ? "Adding…" : "Add walk-in pendency"}
            </Button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900/50 p-4" data-testid="stat-pending">
          <p className="text-[10px] tracking-overline uppercase font-bold text-rose-700">Pending tiffins</p>
          <p className="font-display font-extrabold text-3xl mt-1 text-rose-800 tabular-nums">{pendingCount}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Total entries</p>
          <p className="font-display font-extrabold text-3xl mt-1 tabular-nums">{rows.length}</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap" data-testid="takeaway-filter">
        {[
          { key: "pending", label: "Pending" },
          { key: "collected", label: "Collected" },
          { key: "all", label: "All" },
        ].map((f) => (
          <Button key={f.key} variant={filter === f.key ? "default" : "outline"} size="sm" className="rounded-full" onClick={() => setFilter(f.key)} data-testid={`filter-${f.key}`}>
            {f.label}
          </Button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">No records.</div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.pendency_id} className="p-4 flex flex-wrap items-center gap-3" data-testid={`row-${r.pendency_id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-display font-extrabold">{r.name || "—"}</p>
                    <span className="text-[10px] tracking-overline uppercase font-bold rounded-full px-2 py-0.5 bg-rose-100 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
                      {r.tiffin_count} tiffin{r.tiffin_count > 1 ? "s" : ""}
                    </span>
                    {r.collected ? (
                      <span className="text-[10px] tracking-overline uppercase font-bold rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200 inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Collected
                      </span>
                    ) : (
                      <span className="text-[10px] tracking-overline uppercase font-bold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800 inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Pending
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                    <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:text-primary" data-testid={`call-${r.pendency_id}`}>
                      <Phone className="h-3 w-3" /> {r.phone || "no phone"}
                    </a>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 truncate max-w-[300px]"><MapPin className="h-3 w-3" /> {r.address || "no address"}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">Order {r.order_id} · delivered {new Date(r.delivered_at).toLocaleString("en-IN")}</p>
                </div>
                {!r.collected && (
                  <Button size="sm" onClick={() => collect(r.pendency_id)} className="rounded-full bg-emerald-600 hover:bg-emerald-700" data-testid={`collect-${r.pendency_id}`}>
                    <CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark collected
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
