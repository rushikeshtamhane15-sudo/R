import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Switch } from "../components/ui/switch";
import { Plus, Pencil, Trash2, IndianRupee, ShieldCheck, Loader2, AlertTriangle, CheckCircle2, KeyRound, Webhook, RefreshCw, Ban, HelpCircle } from "lucide-react";

const EMPTY = { plan_id: null, name: "", description: "", amount: 0, currency: "INR", duration_days: 30, meals: 60, active: true, sort_order: 100, category: "dining", meal_window: "both" };

const STATUS_LOOKUP = {
  live:        { tone: "ok",   icon: CheckCircle2,  label: "Live",          desc: "Real Razorpay payments enabled. Customers can check out via UPI/cards." },
  mock:        { tone: "warn", icon: KeyRound,      label: "Mock mode",     desc: "RAZORPAY_KEY_ID and/or RAZORPAY_KEY_SECRET are blank in backend/.env. Payments will accept any signature without charging." },
  auth_failed: { tone: "err",  icon: AlertTriangle, label: "Auth failed",   desc: "Razorpay rejected the keys. Likely rotated, revoked, or pasted with extra spaces." },
  error:       { tone: "warn", icon: AlertTriangle, label: "Network error", desc: "Could not reach Razorpay. Check connectivity then retry." },
};

function RazorpayStatusCard() {
  const [state, setState] = React.useState({ loading: true, status: null, detail: "", masked: "" });

  const check = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await api.get("/admin/payments/razorpay-status");
      setState({ loading: false, status: r.data.status, detail: r.data.detail, masked: r.data.key_id_masked || "" });
    } catch (e) {
      setState({ loading: false, status: "error", detail: e?.response?.data?.detail || "Status check failed", masked: "" });
    }
  }, []);

  React.useEffect(() => { check(); }, [check]);

  const meta = STATUS_LOOKUP[state.status] || STATUS_LOOKUP.error;
  const tone = meta.tone;
  const Icon = meta.icon;
  const toneCls = tone === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
    : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
      : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100";

  return (
    <div className={`rounded-2xl border ${toneCls} p-5 mb-6`} data-testid="razorpay-status-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {state.loading ? <Loader2 className="h-5 w-5 mt-0.5 animate-spin flex-shrink-0" /> : <Icon className="h-5 w-5 mt-0.5 flex-shrink-0" strokeWidth={2} />}
          <div className="min-w-0">
            <p className="font-display font-extrabold text-base leading-tight" data-testid="razorpay-status-label">
              Razorpay · {state.loading ? "checking…" : meta.label}
            </p>
            <p className="text-sm opacity-90 mt-1" data-testid="razorpay-status-detail">
              {state.loading ? "Pinging Razorpay to validate the live keys…" : (state.detail || meta.desc)}
            </p>
            {state.masked && (
              <p className="text-xs opacity-70 mt-1 font-mono" data-testid="razorpay-key-masked">
                Key: {state.masked}***
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={check}
          disabled={state.loading}
          className="rounded-full"
          data-testid="razorpay-revalidate-btn"
        >
          {state.loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
          Re-test
        </Button>
      </div>
    </div>
  );
}

function SignatureBadge({ ok }) {
  if (ok === true)  return <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-overline uppercase text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-3 w-3" /> Verified</span>;
  if (ok === false) return <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-overline uppercase text-red-700 bg-red-50 dark:text-red-200 dark:bg-red-950/50 px-2 py-0.5 rounded-full"><Ban className="h-3 w-3" /> Invalid</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-overline uppercase text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/50 px-2 py-0.5 rounded-full"><HelpCircle className="h-3 w-3" /> No secret</span>;
}

function fmtTs(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return iso; }
}

function WebhookEventsPanel() {
  const [data, setData] = React.useState({ loading: true, events: [], counts: null, err: "" });

  const load = React.useCallback(async () => {
    setData((d) => ({ ...d, loading: true, err: "" }));
    try {
      const r = await api.get("/admin/payments/webhook-events?limit=20");
      setData({ loading: false, events: r.data.events || [], counts: r.data.counts || null, err: "" });
    } catch (e) {
      setData({ loading: false, events: [], counts: null, err: e?.response?.data?.detail || "Failed to load webhook events" });
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const counts = data.counts || { total: 0, signature_ok: 0, signature_failed: 0, no_secret: 0 };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6" data-testid="webhook-events-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <Webhook className="h-5 w-5 text-foreground/80" strokeWidth={2} />
          <div className="min-w-0">
            <p className="font-display font-extrabold text-base leading-tight">Razorpay webhook events</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last 20 events Razorpay sent to <code className="font-mono">/api/webhook/razorpay</code>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={data.loading} className="rounded-full" data-testid="webhook-refresh-btn">
          {data.loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          Refresh
        </Button>
      </div>

      {/* Compact stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5" data-testid="webhook-counts">
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Total</p>
          <p className="font-display font-extrabold text-xl mt-0.5" data-testid="webhook-count-total">{counts.total}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2.5">
          <p className="text-[10px] tracking-overline uppercase font-bold text-emerald-700 dark:text-emerald-300">Verified</p>
          <p className="font-display font-extrabold text-xl mt-0.5 text-emerald-900 dark:text-emerald-100" data-testid="webhook-count-ok">{counts.signature_ok}</p>
        </div>
        <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5">
          <p className="text-[10px] tracking-overline uppercase font-bold text-red-700 dark:text-red-300">Invalid sig</p>
          <p className="font-display font-extrabold text-xl mt-0.5 text-red-900 dark:text-red-100" data-testid="webhook-count-failed">{counts.signature_failed}</p>
        </div>
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5">
          <p className="text-[10px] tracking-overline uppercase font-bold text-amber-700 dark:text-amber-300">No secret</p>
          <p className="font-display font-extrabold text-xl mt-0.5 text-amber-900 dark:text-amber-100" data-testid="webhook-count-no-secret">{counts.no_secret}</p>
        </div>
      </div>

      {/* Event list */}
      {data.err ? (
        <p className="text-sm text-destructive" data-testid="webhook-error">{data.err}</p>
      ) : data.loading ? (
        <div className="text-sm text-muted-foreground text-center py-6"><Loader2 className="h-4 w-4 inline mr-2 animate-spin" /> Loading…</div>
      ) : data.events.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8" data-testid="webhook-empty">
          <Webhook className="h-7 w-7 mx-auto mb-2 opacity-50" />
          No webhook events recorded yet. Razorpay will start posting here once webhook URL is configured in dashboard.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="min-w-full text-sm" data-testid="webhook-events-table">
            <thead>
              <tr className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground border-b border-border">
                <th className="text-left py-2 px-2 font-bold">When</th>
                <th className="text-left py-2 px-2 font-bold">Event</th>
                <th className="text-left py-2 px-2 font-bold">Signature</th>
                <th className="text-left py-2 px-2 font-bold">Order</th>
                <th className="text-left py-2 px-2 font-bold">Processed</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.event_id} className="border-b border-border/50 hover:bg-muted/30" data-testid={`webhook-event-${e.event_id}`}>
                  <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">{fmtTs(e.ts)}</td>
                  <td className="py-2 px-2 font-mono text-xs">{e.event || <span className="text-muted-foreground italic">—</span>}</td>
                  <td className="py-2 px-2"><SignatureBadge ok={e.signature_ok} /></td>
                  <td className="py-2 px-2 font-mono text-xs text-muted-foreground truncate max-w-[180px]">{e.order_id || "—"}</td>
                  <td className="py-2 px-2">
                    {e.processed
                      ? <span className="text-emerald-700 dark:text-emerald-300 text-xs font-semibold">✓ Processed</span>
                      : <span className="text-amber-700 dark:text-amber-300 text-xs font-semibold" title={e.processing_error || e.signature_error || ""}>
                          ⚠ {(e.processing_error || e.signature_error || "skipped").slice(0, 40)}
                        </span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  // Iter-51: category filter tabs (dining | tiffin | all)
  const [categoryTab, setCategoryTab] = useState("dining");

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/admin/plans"); setPlans(r.data.plans); }
    catch (e) { toast.error("Failed to load plans"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setOpen(true); };
  const openEdit = (p) => { setForm({ ...p }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim() || Number(form.amount) <= 0 || Number(form.meals) <= 0 || Number(form.duration_days) <= 0) {
      toast.error("Fill all required fields"); return;
    }
    setSaving(true);
    try {
      await api.post("/admin/plans", {
        plan_id: form.plan_id || null,
        name: form.name.trim(),
        description: form.description.trim(),
        amount: Number(form.amount),
        currency: form.currency || "INR",
        duration_days: Number(form.duration_days),
        meals: Number(form.meals),
        active: !!form.active,
        sort_order: Number(form.sort_order) || 100,
        category: form.category || "dining",
        meal_window: form.meal_window || "both",
      });
      toast.success("Plan saved");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete plan "${p.name}"?`)) return;
    try { await api.delete(`/admin/plans/${p.plan_id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  return (
    <div data-testid="admin-plans-page">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Subscription plans</h1>
          <p className="text-muted-foreground mt-2 text-sm">Create, edit and disable plans. Changes go live immediately.</p>
        </div>
        <Button onClick={openNew} className="rounded-full bg-primary hover:bg-primary/90" data-testid="new-plan-button">
          <Plus className="h-4 w-4 mr-2" /> New plan
        </Button>
      </div>

      <RazorpayStatusCard />
      <WebhookEventsPanel />

      {/* Iter-51: category tabs to bifurcate dining vs tiffin plans */}
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="plan-category-tabs">
        {[
          { v: "dining", label: "Dining (eat-in / QR)" },
          { v: "tiffin", label: "Tiffin (home delivery)" },
          { v: "all",    label: "All" },
        ].map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => setCategoryTab(t.v)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${categoryTab === t.v ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-muted"}`}
            data-testid={`plan-tab-${t.v}`}
          >
            {t.label} ({categoryTab === t.v ? "•" : ""}{plans.filter((p) => t.v === "all" || (p.category || "dining") === t.v).length})
          </button>
        ))}
      </div>

      <div className="bg-card rounded-2xl border border-black/5 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : (() => {
          const filtered = plans.filter((p) => categoryTab === "all" || (p.category || "dining") === categoryTab);
          if (filtered.length === 0) {
            return <div className="p-12 text-center text-muted-foreground">No {categoryTab} plans yet.</div>;
          }
          return (
          <div className="divide-y divide-black/5">
            {filtered.map((p) => (
              <div key={p.plan_id} className="flex flex-wrap items-center justify-between gap-4 p-6" data-testid={`admin-plan-row-${p.plan_id}`}>
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-display font-bold text-lg">{p.name}</p>
                    <span className={`text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full ${p.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {p.active ? "Active" : "Inactive"}
                    </span>
                    <span className="text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200" data-testid={`plan-category-${p.plan_id}`}>
                      {(p.category || "dining")}
                    </span>
                    {p.meal_window && p.meal_window !== "both" && (
                      <span className="text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        {p.meal_window}-only
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                </div>
                <div className="flex items-center gap-8 text-sm">
                  <div><p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Price</p><p className="font-display font-bold text-lg flex items-center"><IndianRupee className="h-4 w-4" />{p.amount.toFixed(0)}</p></div>
                  <div><p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Days</p><p className="font-display font-bold text-lg">{p.duration_days}</p></div>
                  <div><p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Meals</p><p className="font-display font-bold text-lg">{p.meals}</p></div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(p)} className="rounded-full" data-testid={`edit-plan-${p.plan_id}`}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => remove(p)} className="rounded-full text-destructive hover:text-destructive" data-testid={`delete-plan-${p.plan_id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          );
        })()}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="plan-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">{form.plan_id ? "Edit plan" : "New plan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="field-name" /></Field>
            <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="field-description" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select
                  value={form.category || "dining"}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="h-10 w-full rounded-2xl border border-input bg-background px-3 text-sm"
                  data-testid="field-category"
                >
                  <option value="dining">Dining (eat-in / QR)</option>
                  <option value="tiffin">Tiffin (home delivery)</option>
                </select>
              </Field>
              <Field label="Meal window">
                <select
                  value={form.meal_window || "both"}
                  onChange={(e) => setForm({ ...form, meal_window: e.target.value })}
                  className="h-10 w-full rounded-2xl border border-input bg-background px-3 text-sm"
                  data-testid="field-meal-window"
                >
                  <option value="both">Both (lunch + dinner)</option>
                  <option value="lunch">Lunch only</option>
                  <option value="dinner">Dinner only</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Amount (₹)"><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="field-amount" /></Field>
              <Field label="Duration (days)"><Input type="number" value={form.duration_days} onChange={(e) => setForm({ ...form, duration_days: e.target.value })} data-testid="field-duration" /></Field>
              <Field label="Meals"><Input type="number" value={form.meals} onChange={(e) => setForm({ ...form, meals: e.target.value })} data-testid="field-meals" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sort order"><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} data-testid="field-sort" /></Field>
              <div>
                <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Active</label>
                <div className="mt-2 flex items-center gap-2">
                  <Switch checked={!!form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="field-active" />
                  <span className="text-sm text-muted-foreground">{form.active ? "Visible to subscribers" : "Hidden"}</span>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-full">Cancel</Button>
            <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="save-plan-button">{saving ? "Saving…" : "Save plan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
