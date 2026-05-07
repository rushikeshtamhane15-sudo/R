import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Switch } from "../components/ui/switch";
import { Plus, Pencil, Trash2, IndianRupee, ShieldCheck, Loader2, AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";

const EMPTY = { plan_id: null, name: "", description: "", amount: 0, currency: "INR", duration_days: 30, meals: 60, active: true, sort_order: 100 };

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

export default function AdminPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

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

      <div className="bg-card rounded-2xl border border-black/5 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : plans.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No plans yet.</div>
        ) : (
          <div className="divide-y divide-black/5">
            {plans.map((p) => (
              <div key={p.plan_id} className="flex flex-wrap items-center justify-between gap-4 p-6" data-testid={`admin-plan-row-${p.plan_id}`}>
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2">
                    <p className="font-display font-bold text-lg">{p.name}</p>
                    <span className={`text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full ${p.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {p.active ? "Active" : "Inactive"}
                    </span>
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
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="plan-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">{form.plan_id ? "Edit plan" : "New plan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="field-name" /></Field>
            <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="field-description" /></Field>
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
