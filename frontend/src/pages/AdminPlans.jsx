import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Switch } from "../components/ui/switch";
import { Plus, Pencil, Trash2, IndianRupee, ShieldCheck, Loader2, AlertTriangle, CheckCircle2, KeyRound, Webhook, RefreshCw, Ban, HelpCircle, Image as ImageIcon, Upload, X } from "lucide-react";
import { BULLET_ICONS, BULLET_ICON_KEYS, getBulletIcon } from "../lib/planBulletIcons";

const EMPTY = { plan_id: null, name: "", description: "", amount: 0, currency: "INR", duration_days: 30, meals: 60, active: true, sort_order: 100, category: "dining", meal_window: "both", features_override: "", features_extra: [], features_override_v2: [], features_extra_v2: [], hero_image_url: null };

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
  const { user } = useAuth();
  const isMessOwner = user?.role === "franchise_owner";
  const [ownMess, setOwnMess] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  // Iter-51: category filter tabs (dining | tiffin | all)
  const [categoryTab, setCategoryTab] = useState("dining");

  useEffect(() => {
    if (!isMessOwner) return;
    (async () => {
      try { const r = await api.get("/mess-owner/me"); setOwnMess(r.data?.mess || null); }
      catch { /* silent */ }
    })();
  }, [isMessOwner]);

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/admin/plans"); setPlans(r.data.plans); }
    catch (e) { toast.error("Failed to load plans"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setOpen(true); };
  const openEdit = (p) => {
    // iter-131.18: migrate plain-text overrides to structured v2 lists so the
    // BulletTextareaWithRows can render the icon dropdowns immediately.
    const asRows = (txt) => (txt || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((t) => ({ icon: "check", text: t }));
    setForm({
      ...EMPTY,
      ...p,
      features_override_v2: Array.isArray(p.features_override_v2) && p.features_override_v2.length ? p.features_override_v2 : asRows(p.features_override),
      features_extra_v2:    Array.isArray(p.features_extra_v2)    && p.features_extra_v2.length    ? p.features_extra_v2    : (p.features_extra || []).map((t) => ({ icon: "check", text: t })),
      features_override: p.features_override || "",
      features_extra: p.features_extra || [],
      hero_image_url: p.hero_image_url || null,
    });
    setOpen(true);
  };

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
        features_override: (form.features_override || "").trim() || null,
        features_extra: (form.features_extra || []).map((s) => (s || "").trim()).filter(Boolean),
        // iter-131.18: structured bullets + hero image URL (image itself is
        // uploaded separately to /admin/plans/{id}/hero-image and stored on
        // the same plan doc; here we just persist whatever URL is set).
        features_override_v2: (form.features_override_v2 || []).filter((b) => b && (b.text || "").trim()),
        features_extra_v2:    (form.features_extra_v2    || []).filter((b) => b && (b.text || "").trim()),
        hero_image_url: form.hero_image_url || null,
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
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">
            {isMessOwner ? "Mess Owner · Plans" : "Admin"}
          </p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Subscription plans</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {isMessOwner
              ? "Edit YOUR mess's plans. Every subscription bought here goes straight to your Razorpay account."
              : "Create, edit and disable plans. Changes go live immediately."}
          </p>
        </div>
        <Button onClick={openNew} className="rounded-full bg-primary hover:bg-primary/90" data-testid="new-plan-button">
          <Plus className="h-4 w-4 mr-2" /> New plan
        </Button>
      </div>

      {/* iter-144 · efoodtech: mess-owner scope banner — hides platform-only cards */}
      {isMessOwner ? (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3 mb-6" data-testid="mess-scope-banner">
          <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-primary">
              Scoped to your mess{ownMess?.name ? ` · ${ownMess.name}` : ""} <span className="font-mono text-[11px] ml-1">{ownMess?.mess_id || ""}</span>
            </div>
            <div className="text-xs text-slate-600 mt-1">
              Only your mess's plans show here. Your subscribers pay via <b>your Razorpay keys</b> (
              {ownMess?.razorpay_key_id ? <span className="text-emerald-700 font-semibold">connected</span> : <a href="/mess-owner/settings" className="text-secondary underline font-semibold">not yet configured — set up</a>}
              ).
            </div>
          </div>
        </div>
      ) : (
        <>
          <RazorpayStatusCard />
          <WebhookEventsPanel />
        </>
      )}

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

            <FeaturesEditor form={form} setForm={setForm} />
            <HeroImageUploader form={form} setForm={setForm} />
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

// iter-131.18: bidirectional bullet editor.
// The textarea is the fast typing surface with `icon: text` prefix syntax:
//   leaf: 100% pure veg
//   clock: 30-minute delivery window
//   plain line without prefix → defaults to check icon
// Every parsed row is also shown below with a dropdown so admin can flip
// the icon visually. Editing either surface updates the underlying
// features_override_v2 / features_extra_v2 structured arrays, and re-emits
// a canonical textarea string so both stay in sync.
const _ICON_RE = new RegExp(`^(${BULLET_ICON_KEYS.join("|")})\\s*:\\s*(.+)$`, "i");

function parseBulletLine(line) {
  const s = (line || "").trim();
  if (!s) return null;
  const m = s.match(_ICON_RE);
  if (m) return { icon: m[1].toLowerCase(), text: m[2].trim() };
  return { icon: "check", text: s };
}

function serialiseBullets(list) {
  return (list || [])
    .filter((b) => b && (b.text || "").trim())
    .map((b) => (b.icon && b.icon !== "check" ? `${b.icon}: ${b.text.trim()}` : b.text.trim()))
    .join("\n");
}

function BulletTextareaWithRows({ label, hint, textareaTestId, rowsTestId, structKey, plainKey, form, setForm, placeholder }) {
  const rows = form[structKey] || [];
  const asText = serialiseBullets(rows);

  const onText = (value) => {
    // parse newline-separated lines into structured rows
    const parsed = value.split(/\r?\n/).map(parseBulletLine).filter(Boolean);
    setForm({ ...form, [structKey]: parsed, [plainKey]: value });
  };

  const setRowIcon = (i, icon) => {
    const next = rows.slice();
    next[i] = { ...next[i], icon };
    setForm({ ...form, [structKey]: next, [plainKey]: serialiseBullets(next) });
  };

  const setRowText = (i, text) => {
    const next = rows.slice();
    next[i] = { ...next[i], text };
    setForm({ ...form, [structKey]: next, [plainKey]: serialiseBullets(next) });
  };

  const deleteRow = (i) => {
    const next = rows.filter((_, idx) => idx !== i);
    setForm({ ...form, [structKey]: next, [plainKey]: serialiseBullets(next) });
  };

  return (
    <div className="space-y-2">
      <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{label}</label>
      <Textarea
        rows={4}
        value={asText}
        onChange={(e) => onText(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-xs"
        data-testid={textareaTestId}
      />
      <p className="text-[10px] text-muted-foreground">
        {hint} · Prefix a line with <code className="rounded bg-muted px-1">leaf:</code>, <code className="rounded bg-muted px-1">clock:</code>, <code className="rounded bg-muted px-1">star:</code>, <code className="rounded bg-muted px-1">truck:</code>, <code className="rounded bg-muted px-1">utensils:</code>, <code className="rounded bg-muted px-1">zap:</code>, <code className="rounded bg-muted px-1">heart:</code>, <code className="rounded bg-muted px-1">shield:</code>, <code className="rounded bg-muted px-1">flame:</code> to pick an icon.
      </p>
      {rows.length > 0 && (
        <ul className="rounded-xl bg-background/60 border border-border divide-y divide-border" data-testid={rowsTestId}>
          {rows.map((b, i) => {
            const Icon = getBulletIcon(b.icon);
            return (
              <li key={i} className="flex items-center gap-2 p-2" data-testid={`${rowsTestId}-row-${i}`}>
                <select
                  value={b.icon || "check"}
                  onChange={(e) => setRowIcon(i, e.target.value)}
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs font-semibold"
                  data-testid={`${rowsTestId}-icon-${i}`}
                >
                  {BULLET_ICON_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-3 w-3" />
                </span>
                <Input
                  value={b.text || ""}
                  onChange={(e) => setRowText(i, e.target.value)}
                  className="h-8 text-xs flex-1"
                  data-testid={`${rowsTestId}-text-${i}`}
                />
                <button
                  type="button"
                  onClick={() => deleteRow(i)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  aria-label="Delete row"
                  data-testid={`${rowsTestId}-delete-${i}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// iter-131.17: mirror the auto-features from Plans.jsx so admin sees exactly
// what will show if they leave the override blank. Kept in sync manually.
function autoFeaturesFor(plan) {
  const meals = Number(plan.meals) || 0;
  const days = Number(plan.duration_days) || 0;
  if ((plan.category || "dining") === "dining") {
    return [`${meals} total meals`, "Lunch + Dinner at our hall", "Scan QR at counter", "Auto-pause on 3+ skipped days"];
  }
  return [`${meals} tiffins · ${days} days`, "Lunch + Dinner delivered daily", "Doorstep geofence verification", "Pause anytime · 7+ days extends plan"];
}

function FeaturesEditor({ form, setForm }) {
  const auto = autoFeaturesFor(form);
  const usingOverride = (form.features_override_v2 || []).length > 0;
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3 space-y-4" data-testid="features-editor">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Plan bullets</p>
        <button
          type="button"
          onClick={() => setForm({ ...form, features_override_v2: [], features_override: "" })}
          disabled={!usingOverride}
          className={`text-[10px] tracking-overline uppercase font-bold rounded-full px-2 py-1 ${usingOverride ? "bg-primary/10 text-primary hover:bg-primary/20" : "bg-muted text-muted-foreground cursor-not-allowed"}`}
          data-testid="reset-features-override"
        >
          Reset to auto
        </button>
      </div>

      <BulletTextareaWithRows
        label="Custom bullets (override)"
        hint="One bullet per line. Leave blank to use the auto bullets shown below."
        textareaTestId="field-features-override"
        rowsTestId="rows-features-override"
        structKey="features_override_v2"
        plainKey="features_override"
        placeholder={auto.map((t) => t).join("\n")}
        form={form}
        setForm={setForm}
      />

      <BulletTextareaWithRows
        label="Extra bullets (always appended)"
        hint="Marketing lines added below whatever bullets show above."
        textareaTestId="field-features-extra"
        rowsTestId="rows-features-extra"
        structKey="features_extra_v2"
        plainKey="features_extra"
        placeholder={"leaf: 100% pure veg\nclock: 30-minute delivery window\nstar: most popular"}
        form={form}
        setForm={setForm}
      />
    </div>
  );
}

// iter-131.18: hero image uploader for the plan card. Uses multipart POST
// to /admin/plans/{plan_id}/hero-image. Requires the plan to be saved
// first (upload endpoint needs a plan_id) — we surface a friendly hint if
// the admin tries to upload before the initial Save.
function HeroImageUploader({ form, setForm }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const planId = form.plan_id;

  const onFile = async (file) => {
    if (!file) return;
    if (!planId) {
      toast.error("Save the plan first, then upload the hero image.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post(`/admin/plans/${planId}/hero-image`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setForm({ ...form, hero_image_url: r.data.hero_image_url });
      toast.success("Hero image uploaded");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally { setUploading(false); }
  };

  const clear = async () => {
    if (!planId) { setForm({ ...form, hero_image_url: null }); return; }
    try {
      await api.post(`/admin/plans/${planId}/hero-image/reset`);
      setForm({ ...form, hero_image_url: null });
      toast.success("Hero image removed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3 space-y-3" data-testid="hero-image-uploader">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5" /> Plan hero image
        </p>
        {form.hero_image_url && (
          <button
            type="button"
            onClick={clear}
            className="text-[10px] tracking-overline uppercase font-bold rounded-full px-2 py-1 bg-destructive/10 text-destructive hover:bg-destructive/20"
            data-testid="clear-hero-image"
          >
            Remove
          </button>
        )}
      </div>
      {form.hero_image_url ? (
        <div
          className="relative rounded-xl overflow-hidden aspect-video ring-1 ring-border"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.55) 100%), url(${form.hero_image_url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          data-testid="hero-preview"
        >
          <div className="absolute bottom-2 left-3 right-3 text-white">
            <p className="text-[9px] tracking-overline uppercase font-bold text-white/80">Preview · {form.name || "Untitled plan"}</p>
            <p className="font-display font-extrabold text-lg leading-tight drop-shadow-md">₹{form.amount || 0}</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-border bg-background/40 aspect-video flex items-center justify-center text-center p-4">
          <div>
            <ImageIcon className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="text-xs text-muted-foreground mt-2">No hero image · card falls back to solid or red background.</p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
          data-testid="hero-file-input"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-full text-xs"
          data-testid="hero-upload-button"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
          {form.hero_image_url ? "Replace image" : "Upload hero image"}
        </Button>
        <p className="text-[10px] text-muted-foreground">JPG / PNG / WebP · up to 3 MB · saved and served instantly.</p>
      </div>
      {!planId && (
        <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">Save the plan first, then upload the hero image.</p>
      )}
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
