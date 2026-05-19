import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Wheat, Loader2, Save, RotateCcw, Sun, Moon, Calculator, Edit3, X,
  TrendingUp, Users, IndianRupee, Sparkles, FileDown, History, Plus, Trash2,
} from "lucide-react";
import { Stat, StockTopupCell } from "../components/admin/RawMaterialsBits";

export default function AdminRawMaterials() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generatingPO, setGeneratingPO] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/admin/raw-materials"); setData(r.data); }
    catch { toast.error("Could not load raw materials data"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const beginEdit = () => {
    setDraft(data.items.map((i) => ({ ...i })));
    setEditing(true);
  };

  const setField = (idx, k, v) => {
    setDraft((arr) => arr.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  };

  const addRow = () => {
    // Same formula as Cylinder/Vegetables — "₹ X / person / month → /60 = per-meal cost"
    const key = `custom_${Date.now().toString(36)}`;
    const blank = {
      key,
      label: "",
      unit: "₹",
      is_amount_based: true,
      amount_per_person_month: 0,
    };
    if (!editing) {
      // Open edit mode and seed draft from existing items
      setDraft([...(data?.items || []).map((i) => ({ ...i })), blank]);
      setEditing(true);
    } else {
      setDraft((arr) => [...arr, blank]);
    }
  };

  const removeRow = (idx) => {
    setDraft((arr) => arr.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = draft.filter((it) => (it.label || "").trim() !== "");
      const payload = {
        items: cleaned.map((it) => ({
          key: it.key,
          label: it.label.trim(),
          unit: it.unit || "₹",
          is_amount_based: !!it.is_amount_based,
          ...(it.is_amount_based
            ? { amount_per_person_month: Number(it.amount_per_person_month || 0) }
            : { qty_per_person_month: Number(it.qty_per_person_month || 0), price_per_unit: Number(it.price_per_unit || 0) }),
        })),
      };
      const r = await api.put("/admin/raw-materials", payload);
      setData(r.data);
      toast.success("Raw material rates updated");
      setEditing(false);
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset all rates to defaults?")) return;
    try {
      const r = await api.post("/admin/raw-materials/reset");
      setData(r.data);
      toast.success("Reset to defaults");
      setEditing(false);
    } catch { toast.error("Reset failed"); }
  };

  const generatePO = async () => {
    setGeneratingPO(true);
    try {
      const supplier = window.prompt("Supplier name (optional — leave blank to skip):", "") || null;
      const r = await api.post(
        "/admin/purchase-orders/generate",
        { supplier_name: supplier },
        { responseType: "blob" }
      );
      const poNumber = r.headers["x-po-number"] || `PO-${Date.now()}`;
      const blob = new Blob([r.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${poNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Purchase order ${poNumber} generated`);
      // refresh history if it's open
      if (showHistory) loadHistory();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not generate PO");
    } finally { setGeneratingPO(false); }
  };

  const loadHistory = async () => {
    try {
      const r = await api.get("/admin/purchase-orders");
      setHistory(r.data.purchase_orders || []);
    } catch {}
  };

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) loadHistory();
  };

  const redownload = async (poNumber) => {
    try {
      const r = await api.get(`/admin/purchase-orders/${poNumber}/download`, { responseType: "blob" });
      const blob = new Blob([r.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${poNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to download"); }
  };

  if (loading || !data) {
    return <div className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Crunching today's requirements…</div>;
  }

  const counts = data.counts || {};
  const totals = data.totals || {};
  const breakdown = data.breakdown || [];

  return (
    <div className="space-y-6" data-testid="admin-raw-materials">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><Wheat className="h-3.5 w-3.5" /> Kitchen procurement</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-1">Today's raw material need</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Calculated live from active subscribers — full tiffin / dining = 1 person, half tiffin = 0.5. Each meal needs <b>1/60th</b> of one person's monthly allocation. Update rates anytime; numbers update across lunch + dinner.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={generatePO} disabled={generatingPO} className="rounded-full bg-primary hover:bg-primary/90 font-semibold" data-testid="generate-po">
            {generatingPO ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
            Generate PO PDF
          </Button>
          <Button onClick={toggleHistory} variant="outline" className="rounded-full" data-testid="toggle-po-history">
            <History className="h-4 w-4 mr-2" /> {showHistory ? "Hide" : "Show"} history
          </Button>
          {!editing && (
            <Button onClick={beginEdit} variant="outline" className="rounded-full" data-testid="edit-rates">
              <Edit3 className="h-4 w-4 mr-2" /> Edit rates
            </Button>
          )}
          <Button onClick={addRow} variant="outline" className="rounded-full" data-testid="add-raw-row">
            <Plus className="h-4 w-4 mr-2" /> Add item
          </Button>
          {editing && (
            <>
              <Button onClick={() => setEditing(false)} variant="outline" className="rounded-full" data-testid="cancel-edit">
                <X className="h-4 w-4 mr-2" /> Cancel
              </Button>
              <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90 font-semibold" data-testid="save-rates">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save
              </Button>
            </>
          )}
          <Button onClick={reset} variant="outline" className="rounded-full text-destructive" data-testid="reset-rates" title="Reset to default rates">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Top-line counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active subs" value={counts.active_subs || 0} icon={Users} />
        <Stat label="Persons (weighted)" value={counts.persons || 0} icon={Users} hint={`${counts.full || 0} full + ${counts.half || 0} half`} />
        <Stat label="Lunch cost" value={`₹${Math.round(totals.lunch_cost || 0).toLocaleString("en-IN")}`} icon={Sun} accent />
        <Stat label="Dinner cost" value={`₹${Math.round(totals.dinner_cost || 0).toLocaleString("en-IN")}`} icon={Moon} accent />
      </div>

      {/* Low-stock alert popup — flashes red when any item is below threshold */}
      {data?.low_stock_alerts?.length > 0 && (
        <div className="rounded-2xl border-2 border-rose-500 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-700 p-4 sm:p-5 animate-pulse" data-testid="low-stock-alert">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-600 text-white font-extrabold flex-shrink-0">!</span>
            <div className="flex-1">
              <p className="font-display font-extrabold text-rose-800 dark:text-rose-200">⚠️ Stock low — {data.low_stock_alerts.length} item(s) below 10%</p>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">An auto-PO has been generated. Top up stock below or check Purchase Orders.</p>
              <ul className="mt-2 text-xs space-y-1 font-mono">
                {data.low_stock_alerts.map((a) => (
                  <li key={a.key} className="text-rose-900 dark:text-rose-100" data-testid={`alert-${a.key}`}>
                    <b>{a.label}</b> — only {a.stock_remaining}{a.unit} left ({a.pct_remaining}% of monthly need)
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-primary text-primary-foreground p-5 flex items-center gap-4" data-testid="day-cost-banner">
        <Calculator className="h-7 w-7" />
        <div className="flex-1">
          <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">Today's procurement bill</p>
          <p className="font-display font-extrabold text-3xl mt-1 flex items-baseline">
            <IndianRupee className="h-6 w-6" />
            <span data-testid="day-total">{Math.round(totals.day_cost || 0).toLocaleString("en-IN")}</span>
          </p>
        </div>
        <div className="text-right text-xs text-primary-foreground/80">
          <p>Lunch ₹{Math.round(totals.lunch_cost || 0).toLocaleString("en-IN")}</p>
          <p className="mt-0.5">Dinner ₹{Math.round(totals.dinner_cost || 0).toLocaleString("en-IN")}</p>
        </div>
      </div>

      {/* Breakdown table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <p className="font-display font-extrabold">Per-item breakdown</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="materials-table">
            <thead className="bg-muted/40 text-[10px] tracking-overline uppercase font-bold text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-right px-4 py-3">Per person<br />(month)</th>
                <th className="text-right px-4 py-3">Rate</th>
                <th className="text-right px-4 py-3">Lunch qty</th>
                <th className="text-right px-4 py-3">Lunch ₹</th>
                <th className="text-right px-4 py-3">Dinner qty</th>
                <th className="text-right px-4 py-3">Dinner ₹</th>
                <th className="text-right px-4 py-3">Day ₹</th>
                <th className="text-right px-4 py-3">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {breakdown.map((row, idx) => {
                const drow = editing ? draft[idx] : row;
                return (
                  <tr key={row.key} className="hover:bg-muted/30" data-testid={`row-${row.key}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{row.label}</p>
                      <p className="text-[11px] text-muted-foreground">{row.is_amount_based ? "₹ tracked" : `${row.unit}`}</p>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {row.is_amount_based ? (
                        editing ? (
                          <Input type="number" step="0.01" value={drow.amount_per_person_month ?? ""} onChange={(e) => setField(idx, "amount_per_person_month", e.target.value)} className="h-8 text-sm text-right w-28 ml-auto" data-testid={`edit-amount-${row.key}`} />
                        ) : (
                          <span>₹{(row.amount_per_person_month || 0).toFixed(0)}</span>
                        )
                      ) : (
                        editing ? (
                          <Input type="number" step="0.01" value={drow.qty_per_person_month ?? ""} onChange={(e) => setField(idx, "qty_per_person_month", e.target.value)} className="h-8 text-sm text-right w-24 ml-auto" data-testid={`edit-qty-${row.key}`} />
                        ) : (
                          <span>{(row.qty_per_person_month || 0).toFixed(2)} {row.unit}</span>
                        )
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {row.is_amount_based ? <span className="text-muted-foreground">—</span> : (
                        editing ? (
                          <Input type="number" step="0.01" value={drow.price_per_unit ?? ""} onChange={(e) => setField(idx, "price_per_unit", e.target.value)} className="h-8 text-sm text-right w-24 ml-auto" data-testid={`edit-price-${row.key}`} />
                        ) : (
                          <span>₹{Number(row.price_per_unit || 0).toFixed(0)}/{row.unit}</span>
                        )
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono">{row.lunch_qty == null ? "—" : `${row.lunch_qty.toFixed(3)} ${row.unit}`}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono">₹{(row.lunch_cost || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono">{row.dinner_qty == null ? "—" : `${row.dinner_qty.toFixed(3)} ${row.unit}`}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono">₹{(row.dinner_cost || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono font-bold">₹{(row.day_cost || 0).toFixed(2)}</td>
                    {/* Stock tracking column: physical qty available + topup CTA */}
                    <td className="px-4 py-3 text-right whitespace-nowrap" data-testid={`stock-cell-${row.key}`}>
                      {row.is_amount_based ? <span className="text-muted-foreground text-xs">—</span> : (
                        <StockTopupCell row={row} onSaved={load} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Newly-added draft rows (visible only while editing, before save) */}
            {editing && draft.length > breakdown.length && (
              <tbody className="divide-y divide-border bg-secondary/5" data-testid="draft-new-rows">
                {draft.slice(breakdown.length).map((drow, j) => {
                  const idx = breakdown.length + j;
                  return (
                    <tr key={drow.key} data-testid={`new-row-${drow.key}`}>
                      <td className="px-4 py-3" colSpan={2}>
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="Item name (e.g. Sugar, Milk, Gas)"
                            value={drow.label || ""}
                            onChange={(e) => setField(idx, "label", e.target.value)}
                            className="h-8 text-sm"
                            data-testid={`new-row-label-${drow.key}`}
                          />
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="₹/person/month"
                            value={drow.amount_per_person_month ?? ""}
                            onChange={(e) => setField(idx, "amount_per_person_month", e.target.value)}
                            className="h-8 text-sm w-32"
                            data-testid={`new-row-amount-${drow.key}`}
                          />
                          <Button size="icon" variant="ghost" onClick={() => removeRow(idx)} className="h-8 w-8" data-testid={`new-row-remove-${drow.key}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground" colSpan={6}>
                        Save to compute lunch / dinner / day cost
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
            <tfoot className="bg-muted/40 font-bold">
              <tr>
                <td className="px-4 py-3" colSpan={4}>Total</td>
                <td className="px-4 py-3 text-right whitespace-nowrap font-mono">₹{(totals.lunch_cost || 0).toFixed(2)}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right whitespace-nowrap font-mono">₹{(totals.dinner_cost || 0).toFixed(2)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap font-mono">₹{(totals.day_cost || 0).toFixed(2)}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {showHistory && (
        <div className="rounded-2xl border border-border bg-card p-5" data-testid="po-history-panel">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" /> Past purchase orders · {history.length}
          </p>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">No purchase orders generated yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 max-h-72 overflow-auto">
              {history.map((po) => (
                <li key={po.po_number} className="rounded-xl bg-muted/30 px-4 py-3 flex flex-wrap items-center gap-3" data-testid={`po-row-${po.po_number}`}>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold font-mono text-sm">{po.po_number}</p>
                    <p className="text-xs text-muted-foreground">
                      For {po.for_date} · ₹{(po.totals?.day_cost || 0).toFixed(2)} · by {po.generated_by_name || po.generated_by_email}
                    </p>
                    {po.supplier_name && <p className="text-[11px] text-muted-foreground">Supplier: {po.supplier_name}</p>}
                  </div>
                  <span className="text-[11px] text-muted-foreground">{po.generated_at_local}</span>
                  <Button onClick={() => redownload(po.po_number)} size="sm" variant="outline" className="rounded-full" data-testid={`redownload-${po.po_number}`}>
                    <FileDown className="h-3.5 w-3.5 mr-1.5" /> Re-download
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-muted/40 border border-border p-4 flex items-start gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div>
          {(data.notes || []).map((n, i) => <p key={i}>{n}</p>)}
          <p className="mt-1 text-[11px]">Last computed: {new Date(data.computed_at).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
