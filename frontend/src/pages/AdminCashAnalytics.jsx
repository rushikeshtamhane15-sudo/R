import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Loader2, Banknote, Building2, RefreshCw, Check } from "lucide-react";

/**
 * AdminCashAnalytics — iter-55 #11
 * Today / Month / Year totals + pending-bank-deposit tile + list of collected
 * cash that hasn't yet been deposited in the company's bank account. Admin
 * batch-marks rows as deposited (with optional bank-ref).
 */
export default function AdminCashAnalytics() {
  const [totals, setTotals] = useState(null);
  const [pending, setPending] = useState([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [selected, setSelected] = useState({});  // {order_id: true}
  const [bankRef, setBankRef] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [t, p] = await Promise.all([
        api.get("/admin/payments/cash-totals"),
        api.get("/admin/payments/cash-pending-deposit"),
      ]);
      setTotals(t.data);
      setPending(p.data.rows || []);
      setPendingTotal(p.data.total_amount || 0);
    } catch (e) { toast.error("Load failed"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = (oid) => setSelected({ ...selected, [oid]: !selected[oid] });
  const selectAll = () => {
    if (Object.keys(selected).length === pending.length) setSelected({});
    else setSelected(Object.fromEntries(pending.map((r) => [r.order_id, true])));
  };
  const selectedSum = pending.filter((r) => selected[r.order_id]).reduce((s, r) => s + Number(r.amount || 0), 0);

  const markDeposited = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (ids.length === 0) { toast.error("Select at least one row"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/admin/payments/mark-deposited", { order_ids: ids, bank_ref: bankRef || null });
      toast.success(`Marked ${r.data.updated} as deposited`);
      setSelected({}); setBankRef("");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Mark failed"); }
    setSubmitting(false);
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-cash-analytics">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Payments</p>
          <h1 className="font-display font-extrabold text-3xl mt-1">Cash analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Daily / monthly / yearly cash collected · pending bank deposits.</p>
        </div>
        <Button variant="outline" onClick={load} className="rounded-full" data-testid="refresh-btn"><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Today" value={totals?.today} testid="cash-today" />
        <Stat label="This month" value={totals?.month} testid="cash-month" />
        <Stat label="This year" value={totals?.year} testid="cash-year" />
        <Stat label="Pending bank deposit" value={totals?.pending_bank_deposit} sub={`${totals?.pending_bank_deposit_count || 0} orders`} testid="cash-pending-bank" tone="warn" icon={Building2} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><Banknote className="h-4 w-4" /> Cash to deposit ({pending.length})</h2>
          {pending.length > 0 && (
            <Button size="sm" variant="ghost" onClick={selectAll}>{Object.keys(selected).length === pending.length ? "Clear all" : "Select all"}</Button>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3">No pending bank deposits. All collected cash is reconciled.</p>
        ) : (
          <>
            <div className="divide-y divide-border">
              {pending.map((r) => (
                <label key={r.order_id} className="py-2 flex items-center gap-3 cursor-pointer" data-testid={`pending-deposit-${r.order_id}`}>
                  <input type="checkbox" checked={!!selected[r.order_id]} onChange={() => toggle(r.order_id)} className="h-4 w-4" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{r.plan_name}</p>
                    <p className="text-[11px] text-muted-foreground">{r.customer_name} · {r.customer_phone} · slip {r.deposit_slip_no || "—"} · {r.collected_at?.slice(0, 10)}</p>
                  </div>
                  <span className="font-display font-bold tabular-nums whitespace-nowrap">₹{Number(r.amount).toFixed(0)}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-3 flex items-end gap-2 flex-wrap">
              <label className="flex-1 min-w-[180px]">
                <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Bank ref / slip # (optional)</span>
                <Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} className="mt-1 h-9 rounded-xl" placeholder="e.g. UTR1234..." data-testid="bank-ref" />
              </label>
              <div className="text-right">
                <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Selected total</p>
                <p className="font-display font-bold tabular-nums text-lg">₹{selectedSum.toFixed(0)}</p>
              </div>
              <Button onClick={markDeposited} disabled={submitting} className="rounded-full" data-testid="mark-deposited">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />} Mark deposited
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, tone, testid }) {
  const ring = tone === "warn" ? "card-3d card-3d-amber" : "card-3d";
  return (
    <div className={`p-4 ${ring}`} data-testid={testid}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <p className="font-display font-extrabold text-3xl tabular-nums mt-1">₹{Number(value || 0).toFixed(0)}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}
