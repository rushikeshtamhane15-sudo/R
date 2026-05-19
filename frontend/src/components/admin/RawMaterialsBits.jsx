import React, { useState } from "react";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toast } from "sonner";
import { Loader2, Save, X, Plus } from "lucide-react";

/**
 * Small reusable bits for /admin/raw-materials. Extracted from
 * AdminRawMaterials.jsx to keep that page focused on data flow.
 */
export function Stat({ label, value, hint, icon: Icon, accent }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "bg-primary/5 border-primary/20" : "border-border bg-card"}`} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <p className="font-display font-extrabold text-2xl sm:text-3xl mt-2">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

/** Per-row stock-remaining display + inline "Top up" form. */
export function StockTopupCell({ row, onSaved }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const n = Number(qty);
    if (!n || n <= 0) return toast.error("Enter a positive quantity");
    setSaving(true);
    try {
      await api.post("/admin/raw-materials/stock-topup", { key: row.key, qty: n });
      toast.success(`Topped up ${row.label}: ${n} ${row.unit}`);
      setOpen(false); setQty("");
      onSaved?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Topup failed"); }
    finally { setSaving(false); }
  };
  const pct = row.pct_remaining;
  const tone = row.low_stock
    ? "text-rose-700 font-extrabold"
    : (pct != null && pct < 30 ? "text-amber-700 font-bold" : "text-emerald-700 font-bold");
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="text-right">
        <p className={`text-xs tabular-nums ${tone}`} data-testid={`stock-remain-${row.key}`}>
          {row.stock_remaining ?? 0} {row.unit}
        </p>
        {pct != null && <p className="text-[10px] text-muted-foreground tabular-nums">{pct}% left</p>}
      </div>
      {open ? (
        <div className="flex items-center gap-1">
          <Input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`+${row.unit}`} className="h-7 w-20 text-xs" autoFocus data-testid={`topup-input-${row.key}`} />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={submit} disabled={saving} data-testid={`topup-save-${row.key}`}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 text-primary" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setOpen(false); setQty(""); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="rounded-full h-7 text-[11px] px-3" onClick={() => setOpen(true)} data-testid={`topup-btn-${row.key}`}>
          <Plus className="h-3 w-3 mr-1" /> Top up
        </Button>
      )}
    </div>
  );
}
