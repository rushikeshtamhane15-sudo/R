import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Loader2, Package, Plus, AlertTriangle, History, Settings as SettingsIcon } from "lucide-react";

export default function AdminTiffinStock() {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [topupQty, setTopupQty] = useState(50);
  const [topupNote, setTopupNote] = useState("");
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");
  const [threshold, setThreshold] = useState(20);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        api.get("/admin/tiffin-stock"),
        api.get("/admin/tiffin-stock/history?limit=50"),
      ]);
      setState(s.data);
      setThreshold(s.data?.low_threshold ?? 20);
      setHistory(h.data?.rows || []);
    } catch (e) { toast.error("Load failed"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const topup = async () => {
    if (!topupQty || topupQty < 1) { toast.error("Quantity must be >= 1"); return; }
    setSubmitting(true);
    try {
      await api.post("/admin/tiffin-stock/topup", { qty: Number(topupQty), note: topupNote });
      toast.success(`Added ${topupQty} tiffins`);
      setTopupQty(50); setTopupNote("");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Topup failed"); }
    finally { setSubmitting(false); }
  };

  const adjust = async () => {
    if (!Number.isFinite(Number(adjustDelta)) || Number(adjustDelta) === 0) { toast.error("Enter a non-zero delta"); return; }
    if (!adjustReason.trim()) { toast.error("Reason required"); return; }
    setSubmitting(true);
    try {
      await api.post("/admin/tiffin-stock/adjust", { delta: Number(adjustDelta), reason: adjustReason });
      toast.success("Adjusted");
      setAdjustDelta(0); setAdjustReason("");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Adjust failed"); }
    finally { setSubmitting(false); }
  };

  const saveThreshold = async () => {
    try {
      await api.put("/admin/tiffin-stock/threshold", { threshold: Number(threshold) });
      toast.success("Threshold updated");
      load();
    } catch (e) { toast.error("Threshold save failed"); }
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-tiffin-stock">
      <div>
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Operations</p>
        <h1 className="font-display font-extrabold text-3xl mt-1">Physical tiffin stock</h1>
        <p className="text-sm text-muted-foreground mt-1">Track raw tiffin inventory. Auto-decrements on each delivery; top up when stock arrives.</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="In stock" value={state?.quantity ?? 0} icon={Package} tone={state?.low_stock ? "warn" : "ok"} testid="stock-quantity" />
        <Stat label="Active tiffin subs" value={state?.active_tiffin_subs ?? 0} icon={Package} />
        <Stat label="Daily expected use" value={state?.expected_daily_use ?? 0} icon={Package} />
        <Stat label="Last top-up" value={state?.last_topup_qty ? `+${state.last_topup_qty}` : "—"} sub={state?.last_topup_at?.slice(0, 10) || ""} icon={History} />
      </div>

      {state?.low_stock && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-center gap-3" data-testid="low-stock-banner">
          <AlertTriangle className="h-5 w-5 text-amber-700" />
          <p className="text-sm text-amber-900"><span className="font-bold">Low stock:</span> {state.quantity} remaining · threshold {state.low_threshold}. Plan a stock top-up before tomorrow's dispatch.</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Topup */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><Plus className="h-4 w-4" /> Add stock</h2>
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Quantity</label>
          <Input type="number" min={1} value={topupQty} onChange={(e) => setTopupQty(e.target.value)} className="rounded-xl" data-testid="topup-qty" />
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Note (optional)</label>
          <Input value={topupNote} onChange={(e) => setTopupNote(e.target.value)} className="rounded-xl" placeholder="e.g. Mehta supplier · 50 new" data-testid="topup-note" />
          <Button onClick={topup} disabled={submitting} className="w-full rounded-full" data-testid="topup-submit">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add stock"}</Button>
        </div>

        {/* Adjust */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><SettingsIcon className="h-4 w-4" /> Manual adjust</h2>
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Delta (negative = remove)</label>
          <Input type="number" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} className="rounded-xl" data-testid="adjust-delta" />
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Reason</label>
          <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="rounded-xl" placeholder="e.g. 3 broken in transit" data-testid="adjust-reason" />
          <Button onClick={adjust} disabled={submitting} variant="outline" className="w-full rounded-full" data-testid="adjust-submit">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Adjust"}</Button>

          <div className="border-t border-border pt-3 mt-3 flex items-center gap-2">
            <label className="text-[11px] tracking-overline uppercase font-bold text-muted-foreground">Low threshold</label>
            <Input type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="rounded-xl w-24 h-9" data-testid="threshold-input" />
            <Button size="sm" variant="ghost" onClick={saveThreshold} data-testid="threshold-save">Save</Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2"><History className="h-4 w-4" /> Recent movements</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No movements yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {history.map((row, i) => (
              <div key={`${row.ts || 'r'}-${i}`} className="py-2 flex items-center justify-between gap-3 text-sm" data-testid={`hist-row-${i}`}>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{row.reason}</p>
                  <p className="text-[11px] text-muted-foreground">{row.ts?.slice(0, 19).replace("T", " ")} · {row.source}</p>
                </div>
                <span className={`font-display font-bold tabular-nums ${row.delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>{row.delta > 0 ? "+" : ""}{row.delta}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, tone, testid }) {
  const ring = tone === "warn" ? "border-amber-300 bg-amber-50" : "border-border bg-card";
  return (
    <div className={`rounded-2xl border ${ring} p-4`} data-testid={testid}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <p className="font-display font-extrabold text-3xl tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}
