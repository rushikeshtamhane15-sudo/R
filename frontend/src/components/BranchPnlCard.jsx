import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { IndianRupee, TrendingUp, TrendingDown, Target, Receipt, Save, Pencil, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";

/**
 * BranchPnlCard — iter-86 #5.
 *
 * Branch scoreboard for the franchise console (and HQ admin overview).
 *   • Today's revenue + window revenue (30d default)
 *   • Fixed daily cost (admin-editable)
 *   • Gross margin
 *   • % target hit chip
 *
 * Backend: routes/branch_pnl.py
 */
export default function BranchPnlCard({ days = 30 }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [fixedCost, setFixedCost] = useState("");
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/admin/branch-pnl?days=${days}`);
        if (!cancelled) {
          setData(r.data);
          setFixedCost(String(r.data.fixed_daily_cost ?? ""));
          setTarget(String(r.data.monthly_target ?? ""));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [days]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/admin/branch-pnl/config", {
        fixed_daily_cost: Number(fixedCost) || 0,
        monthly_target: Number(target) || 0,
      });
      toast.success("Saved");
      // reload P&L with new costs
      const r2 = await api.get(`/admin/branch-pnl?days=${days}`);
      setData(r2.data);
      setEditing(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  if (!data) return null;

  const pct = data.pct_target_hit || 0;
  const targetTone = pct >= 100 ? "emerald" : pct >= 70 ? "amber" : "destructive";
  const marginTone = data.gross_margin >= 0 ? "emerald" : "destructive";

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="branch-pnl-card">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Receipt className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.18em] uppercase font-extrabold text-muted-foreground">Branch P&amp;L · last {data.days}d</p>
          <h3 className="font-display font-extrabold text-base sm:text-lg leading-tight" data-testid="pnl-headline">
            {data.scope === "branch" ? "Your scoreboard" : "Global scoreboard"}
          </h3>
        </div>
        <button type="button" onClick={() => setEditing((e) => !e)} className="text-[11px] font-bold text-primary inline-flex items-center gap-1 hover:underline" data-testid="pnl-edit-toggle">
          <Pencil className="h-3 w-3" /> {editing ? "Cancel" : "Edit costs"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <Kpi icon={IndianRupee} label="Today" value={`₹${Number(data.today_revenue).toLocaleString("en-IN")}`} testid="pnl-today" />
        <Kpi icon={IndianRupee} label={`Window · ${data.days}d`} value={`₹${Number(data.total_revenue_window).toLocaleString("en-IN")}`} testid="pnl-window" />
        <Kpi icon={Receipt} label="Period cost" value={`₹${Number(data.period_cost).toLocaleString("en-IN")}`} testid="pnl-cost" sub={`₹${data.fixed_daily_cost}/day × ${data.days}d`} />
        <Kpi
          icon={data.gross_margin >= 0 ? TrendingUp : TrendingDown}
          label="Gross margin"
          value={`${data.gross_margin >= 0 ? "+" : "−"}₹${Math.abs(Number(data.gross_margin)).toLocaleString("en-IN")}`}
          testid="pnl-margin"
          tone={marginTone}
          sub={`${data.gross_margin_pct}% of revenue`}
        />
      </div>

      <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2">
        <Target className={`h-4 w-4 ${targetTone === "emerald" ? "text-emerald-600" : targetTone === "amber" ? "text-amber-600" : "text-destructive"} shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold text-muted-foreground">% Target hit</p>
          <p className="text-xs sm:text-sm font-bold leading-tight">
            <span className={`tabular-nums font-display ${targetTone === "emerald" ? "text-emerald-700" : targetTone === "amber" ? "text-amber-700" : "text-destructive"}`} data-testid="pnl-target-pct">{pct}%</span>
            <span className="text-muted-foreground font-semibold ml-1">of ₹{Number(data.monthly_target).toLocaleString("en-IN")}/mo target</span>
          </p>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid sm:grid-cols-2 gap-2.5 rounded-xl border border-dashed border-border p-3" data-testid="pnl-edit-form">
          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Fixed daily cost (₹)</p>
            <Input type="number" min={0} step="1" value={fixedCost} onChange={(e) => setFixedCost(e.target.value)} className="mt-1 rounded-xl" data-testid="pnl-cost-input" />
          </div>
          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Monthly revenue target (₹)</p>
            <Input type="number" min={0} step="1" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 rounded-xl" data-testid="pnl-target-input" />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={save} disabled={saving} className="rounded-full bg-primary h-9 text-xs" data-testid="pnl-save">
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Save className="h-3 w-3 mr-1.5" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, testid, tone }) {
  const toneCls = tone === "emerald" ? "text-emerald-700" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-xl bg-muted/40 p-2.5" data-testid={testid}>
      <p className="text-[9.5px] tracking-[0.16em] uppercase font-extrabold text-muted-foreground inline-flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className={`font-display font-extrabold text-base sm:text-lg tabular-nums mt-0.5 leading-tight ${toneCls}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
