/* SubscriptionTabs — iter-171
 *
 * Active / Expiring / Expired tabs with a customer × plan × meals-left ×
 * renewal × status table. Mounted on the admin dashboard. Scoped
 * server-side by /api/admin/subscriptions/tabs (super-admin sees platform;
 * mess-owner sees their branch).
 */
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const TABS = [
  { id: "active",   label: "Active" },
  { id: "expiring", label: "Expiring" },
  { id: "expired",  label: "Expired" },
];

const STATUS_PILL = {
  Active:    "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
  Expiring:  "bg-amber-100  text-amber-700  ring-1 ring-amber-200",
  Expired:   "bg-rose-100   text-rose-700   ring-1 ring-rose-200",
  Cancelled: "bg-slate-100  text-slate-600  ring-1 ring-slate-200",
};

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch { return "—"; }
}

export default function SubscriptionTabs() {
  const [tab, setTab] = useState("active");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ active: 0, expiring: 0, expired: 0 });

  const load = async (t) => {
    setLoading(true);
    try {
      const r = await api.get(`/admin/subscriptions/tabs?tab=${t}&limit=200`);
      setRows(r.data?.rows || []);
      setCounts((c) => ({ ...c, [t]: r.data?.count || 0 }));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load subscriptions");
      setRows([]);
    } finally { setLoading(false); }
  };

  // Load all three tab counts on mount (small parallel prime)
  useEffect(() => {
    (async () => {
      try {
        const [a, x, e] = await Promise.all([
          api.get("/admin/subscriptions/tabs?tab=active&limit=1"),
          api.get("/admin/subscriptions/tabs?tab=expiring&limit=1"),
          api.get("/admin/subscriptions/tabs?tab=expired&limit=1"),
        ]);
        setCounts({
          active:   a.data?.count || 0,
          expiring: x.data?.count || 0,
          expired:  e.data?.count || 0,
        });
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => { load(tab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm" data-testid="subscriptions-tabs-card">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="font-display font-extrabold text-2xl">Subscriptions</p>
      </div>

      <div className="mt-4 flex items-center gap-6 border-b border-border" data-testid="subscriptions-tabs-strip">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative -mb-px pb-2 text-sm font-semibold ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`subscriptions-tab-${t.id}`}
            >
              {t.label}
              <span className={`ml-1.5 text-[11px] font-bold ${active ? "text-primary" : "text-muted-foreground"}`}>
                ({counts[t.id]})
              </span>
              {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary rounded-t-sm" />}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="subscriptions-table">
            <thead className="bg-muted/40">
              <tr className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Meals Left</th>
                <th className="text-left px-4 py-3">Renewal</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground" data-testid="subscriptions-loading">
                    <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground" data-testid="subscriptions-empty">
                    No {tab} subscriptions.
                  </td>
                </tr>
              )}
              {!loading && rows.map((r) => (
                <tr key={r.sub_id || r.user_id} className="border-t border-border" data-testid={`subscriptions-row-${r.sub_id || r.user_id}`}>
                  <td className="px-4 py-3 font-semibold text-foreground" data-testid={`subscriptions-row-customer-${r.sub_id || r.user_id}`}>{r.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.plan_name}</td>
                  <td className="px-4 py-3 tabular-nums" data-testid={`subscriptions-row-meals-${r.sub_id || r.user_id}`}>{r.meals_left}</td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums" data-testid={`subscriptions-row-renewal-${r.sub_id || r.user_id}`}>{fmtDate(r.renewal_date)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${STATUS_PILL[r.status_label] || STATUS_PILL.Active}`} data-testid={`subscriptions-row-status-${r.sub_id || r.user_id}`}>
                      {r.status_label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
