import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Loader2, SplitSquareHorizontal, RefreshCw, AlertCircle } from "lucide-react";

export default function AdminPartialPayments() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [totalPending, setTotalPending] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/payments/pending-partials");
      setRows(r.data.rows || []);
      setCount(r.data.count || 0);
      setTotalPending(r.data.total_pending || 0);
    } catch (e) { toast.error("Load failed"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-partial-payments">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Payments</p>
          <h1 className="font-display font-extrabold text-3xl mt-1 flex items-center gap-2"><SplitSquareHorizontal className="h-7 w-7" /> Pending partial payments</h1>
          <p className="text-sm text-muted-foreground mt-1">Subscriptions where the subscriber paid 50%+ upfront and still owes a balance.</p>
        </div>
        <Button variant="outline" onClick={load} className="rounded-full" data-testid="refresh-btn"><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4" data-testid="stat-count">
          <p className="text-[11px] tracking-overline uppercase font-bold text-muted-foreground">Open subscriptions</p>
          <p className="font-display font-extrabold text-3xl tabular-nums mt-1">{count}</p>
        </div>
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4" data-testid="stat-total">
          <p className="text-[11px] tracking-overline uppercase font-bold text-amber-700">Total dues</p>
          <p className="font-display font-extrabold text-3xl tabular-nums mt-1 text-amber-900">₹{(totalPending || 0).toFixed(0)}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center text-muted-foreground py-10" data-testid="empty">No pending partial payments.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.sub_id} className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between gap-3 flex-wrap" data-testid={`partial-row-${r.sub_id}`}>
              <div className="min-w-0">
                <p className="font-display font-bold">{r.plan_name}</p>
                <p className="text-sm text-muted-foreground">{r.customer_name} · <a href={`tel:${r.customer_phone}`} className="underline">{r.customer_phone}</a></p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Sub {r.sub_id} · Paid ₹{Number(r.amount_paid || 0).toFixed(0)} · Ends {r.end_date?.slice(0, 10)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-3 py-1.5 text-sm font-bold">
                  <AlertCircle className="h-3.5 w-3.5" /> ₹{Number(r.pending_amount).toFixed(0)} due
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
