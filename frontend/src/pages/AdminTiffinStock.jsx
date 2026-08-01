import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Loader2, Package, Plus, AlertTriangle, History, Settings as SettingsIcon, ChevronDown, ChevronUp, Phone, MessageCircle, RotateCcw, RefreshCcw } from "lucide-react";

export default function AdminTiffinStock() {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [topupQty, setTopupQty] = useState(50);
  const [topupNote, setTopupNote] = useState("");
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");
  const [brokenCount, setBrokenCount] = useState(1);
  const [brokenReason, setBrokenReason] = useState("");
  const [collectCount, setCollectCount] = useState(0);
  const [collectSlot, setCollectSlot] = useState("lunch");
  const [collectNote, setCollectNote] = useState("");
  const [threshold, setThreshold] = useState(20);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // iter-134.d — expandable "who is holding tiffins" list under the engaged tile.
  const [engagedOpen, setEngagedOpen] = useState(false);
  const [engagedRows, setEngagedRows] = useState([]);
  const [engagedLoading, setEngagedLoading] = useState(false);

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

  const loadEngaged = async () => {
    setEngagedLoading(true);
    try {
      const r = await api.get("/admin/restaurant/takeaway-pendency");
      const rows = (r.data?.rows || []).filter((x) => !x.collected);
      setEngagedRows(rows);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load holders");
    } finally {
      setEngagedLoading(false);
    }
  };
  const toggleEngaged = async () => {
    const next = !engagedOpen;
    setEngagedOpen(next);
    if (next && engagedRows.length === 0) await loadEngaged();
  };

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

  const markBroken = async () => {
    const n = Number(brokenCount);
    if (!Number.isFinite(n) || n < 1) { toast.error("Enter a positive count"); return; }
    if (!brokenReason.trim()) { toast.error("Reason required for the audit trail"); return; }
    setSubmitting(true);
    try {
      await api.post("/admin/tiffin-stock/broken", { count: n, reason: brokenReason });
      toast.success(`Marked ${n} tiffin${n > 1 ? "s" : ""} as broken`);
      setBrokenCount(1); setBrokenReason("");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to mark broken"); }
    finally { setSubmitting(false); }
  };

  const collectEmpties = async () => {
    const n = Number(collectCount);
    if (!Number.isFinite(n) || n < 1) { toast.error("Enter a positive count"); return; }
    setSubmitting(true);
    try {
      await api.post("/admin/tiffin-stock/collect-empties", {
        count: n,
        slot: collectSlot || undefined,
        note: (collectNote || "").trim() || undefined,
      });
      toast.success(`Logged ${n} empty tiffin${n > 1 ? "s" : ""} returned to kitchen`);
      setCollectCount(0); setCollectNote("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to log return");
    } finally { setSubmitting(false); }
  };

  const resetData = async () => {
    const ok = window.confirm(
      "⚠️ Reset ALL tiffin-stock data for this branch?\n\n" +
      "This will:\n" +
      "  • Zero the in-hand count\n" +
      "  • Wipe the top-up / broken / adjust movement log\n" +
      "  • Preserve engaged (already-delivered) pendencies\n\n" +
      "This cannot be undone. Continue?"
    );
    if (!ok) return;
    setSubmitting(true);
    try {
      await api.post("/admin/tiffin-stock/reset");
      toast.success("Tiffin stock reset");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Reset failed"); }
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
        <p className="text-sm text-muted-foreground mt-1">Raw = total owned. Engaged = out with customers (subs on delivery + takeaway pending). In-hand = clean tiffins at kitchen. Shortage = what you'll need to buy before the next slot.</p>
      </div>

      {/* iter-137.b — four tiles matching the operator's mental model. */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Stat
          label="Raw tiffins"
          value={state?.raw_tiffins ?? (state?.lifetime_purchases ?? 0)}
          sub="Total inventory owned"
          icon={Package}
          testid="stock-raw"
        />
        <Stat
          label="In-hand (kitchen)"
          value={state?.quantity ?? 0}
          sub="Clean · ready to fill"
          icon={Package}
          tone={state?.low_stock ? "warn" : "ok"}
          testid="stock-inhand"
        />
        <button
          type="button"
          onClick={toggleEngaged}
          data-testid="stock-engaged-tile"
          className="text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/50 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-primary group-hover:scale-105 transition-transform">
              <Package className="h-4 w-4" />
              <span className="text-[10px] tracking-[0.18em] uppercase font-bold">Engaged</span>
            </div>
            {engagedOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
          <p className="mt-2 text-3xl font-extrabold tabular-nums text-foreground" data-testid="stock-engaged">{state?.engaged ?? 0}</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            <span className="font-mono">{state?.on_delivery ?? 0}</span> on delivery
            {' '}·{' '}<span className="font-mono">{state?.takeaway_pending ?? 0}</span> takeaway
          </p>
        </button>
        <Stat
          label={`Shortage · next ${state?.next_slot || "run"}`}
          value={state?.shortage_for_next_run ?? 0}
          sub={`Need ${state?.next_slot_required ?? 0} · have ${state?.quantity ?? 0}`}
          icon={AlertTriangle}
          tone={(state?.shortage_for_next_run ?? 0) > 0 ? "warn" : "ok"}
          testid="stock-shortage"
        />
      </div>

      {engagedOpen && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-2 animate-in fade-in slide-in-from-top-2" data-testid="stock-engaged-holders">
          <div className="flex items-center justify-between">
            <p className="text-sm font-extrabold text-foreground">Customers currently holding tiffins</p>
            <Button size="sm" variant="ghost" onClick={loadEngaged} disabled={engagedLoading} data-testid="stock-engaged-refresh">
              {engagedLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            </Button>
          </div>
          {engagedLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
          ) : engagedRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No tiffins are out with customers right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {engagedRows.map((r) => {
                const digits = String(r.phone || "").replace(/\D/g, "").replace(/^0+/, "");
                const waPhone = /^\d{10}$/.test(digits) ? `91${digits}` : digits;
                const nudge = encodeURIComponent(
                  `Hi ${r.name || "there"}, this is efoodcare 👋. ${r.tiffin_count} steel tiffin${r.tiffin_count > 1 ? "s are" : " is"} still with you. Please keep them ready — we'll pick up on the next round. Thanks ♻️`
                );
                return (
                  <li key={r.pendency_id} className="py-3 flex items-center gap-3 flex-wrap" data-testid={`engaged-row-${r.pendency_id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-extrabold text-foreground truncate">{r.name || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.phone ? (<a href={`tel:${digits}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone className="h-3 w-3" />{r.phone}</a>) : "No phone"}
                        {r.address ? <span> · {r.address}</span> : null}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2.5 h-7 text-xs font-extrabold">
                      <Package className="h-3.5 w-3.5" />
                      {r.tiffin_count} tiffin{r.tiffin_count > 1 ? "s" : ""}
                    </span>
                    {r.phone && (
                      <a
                        href={`https://wa.me/${waPhone}?text=${nudge}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold px-3 h-8"
                        data-testid={`engaged-wa-${r.pendency_id}`}
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Secondary row — context stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Active tiffin subs" value={state?.active_tiffin_subs ?? 0} icon={Package} />
        <Stat label={`Need for ${state?.next_slot || "next"}`} value={state?.next_slot_required ?? 0} sub="Active subs · that meal" icon={Package} />
        <Stat label="Last top-up" value={state?.last_topup_qty ? `+${state.last_topup_qty}` : "—"} sub={state?.last_topup_at?.slice(0, 10) || ""} icon={History} />
        <Stat
          label="Broken / lost"
          value={state?.broken_total ?? 0}
          sub="Written off · lifetime"
          icon={AlertTriangle}
          tone={(state?.broken_total ?? 0) > 0 ? "warn" : "ok"}
          testid="stock-broken"
        />
      </div>

      {/* iter-137.b — reconciliation hint */}
      {state && (
        <p className="text-[11px] text-muted-foreground -mt-2" data-testid="stock-reconcile-hint">
          Reconciliation: <span className="font-mono">{state.raw_tiffins ?? 0}</span> raw
          {' '}−{' '}<span className="font-mono">{state.engaged ?? 0}</span> engaged
          {' '}={' '}<span className="font-mono font-extrabold text-foreground">{state.expected_in_hand ?? 0}</span> expected in-hand
          {' '}(actual <span className="font-mono">{state.quantity ?? 0}</span>){' '}
          {state.expected_in_hand === state.quantity ? <span className="text-emerald-600 font-bold">✓ matches</span> : <span className="text-amber-700 font-bold">⚠ drift — adjust to reconcile</span>}
        </p>
      )}

      {state?.low_stock && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-center gap-3" data-testid="low-stock-banner">
          <AlertTriangle className="h-5 w-5 text-amber-700" />
          <p className="text-sm text-amber-900"><span className="font-bold">Low stock:</span> {state.quantity} remaining · threshold {state.low_threshold}. Plan a stock top-up before tomorrow's dispatch.</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Topup */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><Plus className="h-4 w-4" /> Add raw stock</h2>
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Quantity</label>
          <Input type="number" min={1} value={topupQty} onChange={(e) => setTopupQty(e.target.value)} className="rounded-xl" data-testid="topup-qty" />
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Note (optional)</label>
          <Input value={topupNote} onChange={(e) => setTopupNote(e.target.value)} className="rounded-xl" placeholder="e.g. Mehta supplier · 50 new" data-testid="topup-note" />
          <Button onClick={topup} disabled={submitting} className="w-full rounded-full" data-testid="topup-submit">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add stock"}</Button>
        </div>

        {/* iter-137.b — Collect empties (post-delivery empty returns) */}
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/50 p-6 space-y-3" data-testid="collect-empties-form">
          <h2 className="font-display font-bold text-lg flex items-center gap-2 text-emerald-900"><RefreshCcw className="h-4 w-4" /> Log empty return</h2>
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Empties collected</label>
          <Input type="number" min={1} value={collectCount} onChange={(e) => setCollectCount(e.target.value)} className="rounded-xl" data-testid="collect-count" />
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Slot</label>
          <div className="inline-flex bg-white rounded-full p-1 gap-1 ring-1 ring-emerald-300 w-full" data-testid="collect-slot">
            {["lunch", "dinner"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setCollectSlot(s)}
                className={`flex-1 h-9 rounded-full text-xs font-extrabold uppercase tracking-wide ${collectSlot === s ? "bg-emerald-600 text-white" : "text-emerald-800"}`}
                data-testid={`collect-slot-${s}`}
              >{s}</button>
            ))}
          </div>
          <Input value={collectNote} onChange={(e) => setCollectNote(e.target.value)} className="rounded-xl" placeholder="Optional note" data-testid="collect-note" />
          <Button onClick={collectEmpties} disabled={submitting} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="collect-submit">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log empties returned"}
          </Button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Adds to in-hand, drops engaged. Log this once your delivery driver returns with empty tiffins.
          </p>
        </div>

        {/* Broken / lost */}
        <div className="rounded-2xl border border-red-200 bg-red-50/40 p-6 space-y-3" data-testid="broken-form">
          <h2 className="font-display font-bold text-lg flex items-center gap-2 text-red-800"><AlertTriangle className="h-4 w-4" /> Mark broken / lost</h2>
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Quantity</label>
          <Input type="number" min={1} value={brokenCount} onChange={(e) => setBrokenCount(e.target.value)} className="rounded-xl" data-testid="broken-count" />
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Reason</label>
          <Input value={brokenReason} onChange={(e) => setBrokenReason(e.target.value)} className="rounded-xl" placeholder="e.g. 3 dents, 2 lost on route" data-testid="broken-reason" />
          <Button onClick={markBroken} disabled={submitting} variant="outline" className="w-full rounded-full border-red-300 text-red-800 hover:bg-red-100" data-testid="broken-submit">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark broken"}
          </Button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Reduces in-hand + raw. Broken tiffins stay in the ledger so the reconciliation math holds.
          </p>
        </div>

        {/* Adjust */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><SettingsIcon className="h-4 w-4" /> Manual adjust</h2>
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Delta (negative = remove)</label>
          <Input type="number" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} className="rounded-xl" data-testid="adjust-delta" />
          <label className="block text-xs tracking-overline uppercase font-bold text-muted-foreground">Reason</label>
          <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="rounded-xl" placeholder="e.g. count-off after audit" data-testid="adjust-reason" />
          <Button onClick={adjust} disabled={submitting} variant="outline" className="w-full rounded-full" data-testid="adjust-submit">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Adjust"}</Button>

          <div className="border-t border-border pt-3 mt-3 flex items-center gap-2">
            <label className="text-[11px] tracking-overline uppercase font-bold text-muted-foreground">Low threshold</label>
            <Input type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="rounded-xl w-24 h-9" data-testid="threshold-input" />
            <Button size="sm" variant="ghost" onClick={saveThreshold} data-testid="threshold-save">Save</Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-red-300 bg-red-50/40 p-5" data-testid="stock-reset-card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-lg flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-5 w-5" /> Reset tiffin-stock data
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-lg">
              Zeros the in-hand count and wipes the top-up / broken / adjust movement log for this branch. Engaged tiffins (already-delivered pendencies) are preserved so nothing is lost from customer records. This action is logged and cannot be undone.
            </p>
          </div>
          <Button
            onClick={resetData}
            disabled={submitting}
            variant="outline"
            className="rounded-full border-red-400 text-red-800 hover:bg-red-100 font-bold h-11 px-5"
            data-testid="stock-reset-btn"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RotateCcw className="h-4 w-4 mr-1.5" /> Reset all data</>}
          </Button>
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
