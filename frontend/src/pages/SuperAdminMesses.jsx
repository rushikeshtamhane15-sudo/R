/**
 * SuperAdminMesses — iter-144 · efoodtech platform onboarding.
 *
 * Single-page shell for the platform super-admin (role=admin, not
 * mess_owner) to:
 *   • Onboard a new mess in ONE flow: name, custom Mess ID, owner phone,
 *     address, tagline, etc. Auto-promotes the owner to `mess_owner`
 *     the moment their phone matches an existing efoodtech user.
 *   • See all messes at a glance: mess_id, owner, status, city.
 *   • Activate / suspend a mess with one click.
 *
 * This is deliberately separate from the older /admin/messes page (which
 * still handles finer editing + franchise-page access). This new shell is
 * optimised for the "create a new tenant" flow — the highest-value SaaS
 * onboarding path.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import {
  Building2, Plus, Save, X, Loader2, ShieldCheck, PowerOff, Power,
  Phone, Hash, MapPin, BadgeCheck, AlertTriangle, Copy, UserCog, ListChecks,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";

const EMPTY = {
  name: "", slug: "", mess_id_custom: "", owner_phone: "", owner_email: "",
  city: "", state: "Maharashtra", pincode: "", address: "",
  tagline: "", manager_name: "", manager_phone: "",
  is_franchise: true, fssai_number: "",
};

export default function SuperAdminMesses() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messes, setMesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [lastCreated, setLastCreated] = useState(null);
  // iter-158e · Per-mess page whitelist editor (super-admin only).
  const [pagesEditor, setPagesEditor] = useState(null); // { messId, name, catalog[], selected[Set] }
  const [pagesBusy, setPagesBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/messes");
      setMesses(r.data?.messes || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load messes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;

  const create = async () => {
    const errs = [];
    if (!form.name.trim()) errs.push("Mess name");
    if (!form.slug.trim()) errs.push("Slug");
    if (!form.city.trim()) errs.push("City");
    if (!form.address.trim() || form.address.trim().length < 10) errs.push("Full address (min 10 chars)");
    if (!form.pincode.trim() || form.pincode.trim().length < 4) errs.push("Pincode");
    if (errs.length) { toast.error(`Missing: ${errs.join(", ")}`); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      // Server-side normalises mess_id_custom to uppercase + trims
      const r = await api.post("/admin/messes", payload);
      toast.success(`Mess "${r.data.name}" created · ID: ${r.data.mess_id}`);
      setLastCreated(r.data);
      setShowForm(false);
      setForm(EMPTY);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Create failed");
    } finally { setSaving(false); }
  };

  const toggleStatus = async (m) => {
    const next = m.status === "active" ? "inactive" : "active";
    if (!window.confirm(`${next === "active" ? "Re-activate" : "Suspend"} "${m.name}"?`)) return;
    try {
      await api.patch(`/admin/messes/${m.mess_id}/status`, { status: next });
      toast.success(`Status → ${next}`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const copyId = (id) => {
    navigator.clipboard?.writeText(id).catch(() => {});
    toast.success(`Copied ${id}`);
  };

  const suggestSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  const openPagesEditor = async (m) => {
    try {
      const r = await api.get(`/admin/messes/${encodeURIComponent(m.mess_id)}/franchise-pages`);
      setPagesEditor({
        messId: m.mess_id, name: m.name,
        catalog: r.data.catalog || [],
        selected: new Set(r.data.visible_pages || []),
      });
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to load pages"); }
  };
  const togglePage = (key) => {
    setPagesEditor((s) => {
      if (!s) return s;
      const next = new Set(s.selected);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...s, selected: next };
    });
  };
  const savePagesEditor = async () => {
    if (!pagesEditor) return;
    setPagesBusy(true);
    try {
      await api.patch(`/admin/messes/${encodeURIComponent(pagesEditor.messId)}/franchise-pages`, {
        visible_pages: Array.from(pagesEditor.selected),
      });
      toast.success(`Page access saved for ${pagesEditor.name}`);
      setPagesEditor(null);
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setPagesBusy(false); }
  };
  const allOn = () => setPagesEditor((s) => s ? { ...s, selected: new Set(s.catalog.map((p) => p.key)) } : s);
  const allOff = () => setPagesEditor((s) => s ? { ...s, selected: new Set() } : s);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6" data-testid="super-admin-messes">
      {/* Header */}
      <div className="rounded-2xl bg-primary text-white p-5 shadow-lg">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">Super Admin · Platform Onboarding</div>
            <div className="text-xl font-extrabold">Messes on efoodtech</div>
            <div className="text-xs text-white/70 mt-0.5">{messes.length} tenant{messes.length === 1 ? "" : "s"} · SaaS multi-tenant</div>
          </div>
          {!showForm && (
            <Button onClick={() => { setForm(EMPTY); setShowForm(true); setLastCreated(null); }}
              className="rounded-xl bg-white text-primary hover:bg-white/90 font-semibold" data-testid="new-mess-btn">
              <Plus className="h-4 w-4 mr-1.5" /> Onboard new mess
            </Button>
          )}
        </div>
      </div>

          {/* Last created ribbon + WhatsApp welcome */}
      {lastCreated && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-testid="last-created-ribbon">
          <div className="flex items-start gap-3">
            <BadgeCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-emerald-900">Step 3 · Mess is live — {lastCreated.name}</div>
              <div className="text-xs text-emerald-800 mt-1 flex items-center gap-2 flex-wrap">
                <span>Mess ID:</span>
                <span className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-200">{lastCreated.mess_id}</span>
                <button onClick={() => copyId(lastCreated.mess_id)} className="text-emerald-700 hover:text-emerald-900" data-testid="copy-mess-id">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              {lastCreated.promoted_owner_user_id ? (
                <div className="text-emerald-700 text-xs mt-1">✓ Owner promoted automatically. Ask them to log out + log back in.</div>
              ) : lastCreated.owner_phone ? (
                <div className="text-amber-700 text-xs mt-1">⚠ Owner phone <b>{lastCreated.owner_phone}</b> has no account yet — they'll be auto-promoted once they log in with this Mess ID.</div>
              ) : null}
              {lastCreated.owner_phone && (
                <a
                  href={`https://wa.me/91${(lastCreated.owner_phone || "").replace(/[^0-9]/g, "").slice(-10)}?text=${encodeURIComponent(`Hi! You're now the mess owner on efoodtech.\n\nMess: ${lastCreated.name}\nYour Mess ID: ${lastCreated.mess_id}\n\nLogin here: ${window.location.origin}/login\nJust type "${lastCreated.mess_id}" or "${lastCreated.name}" to find your mess and log in with this phone.\n\nAfter login, open Owner Settings to upload your logo, tagline, and Razorpay keys so payments land straight in your account.`)}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5"
                  data-testid="whatsapp-welcome-btn"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M20.52 3.48A11.9 11.9 0 0012 0C5.37 0 0 5.37 0 12c0 2.11.55 4.16 1.6 5.97L0 24l6.2-1.63A11.94 11.94 0 0012 24c6.63 0 12-5.37 12-12 0-3.2-1.25-6.21-3.48-8.52zM12 22c-1.9 0-3.75-.5-5.37-1.45l-.38-.23-3.68.97.98-3.59-.25-.37A9.94 9.94 0 012 12c0-5.52 4.48-10 10-10s10 4.48 10 10-4.48 10-10 10z"/></svg>
                  Send WhatsApp welcome
                </a>
              )}
            </div>
            <button onClick={() => setLastCreated(null)} className="text-emerald-700 hover:text-emerald-900" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Onboarding form */}
      {showForm && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4" data-testid="onboard-mess-form">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-extrabold text-lg text-slate-900">Onboard a new mess</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-red-600"><X className="h-4 w-4" /></button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Mess name *">
              <Input value={form.name} onChange={(e) => {
                const v = e.target.value;
                setForm((f) => ({ ...f, name: v, slug: f.slug || suggestSlug(v) }));
              }} placeholder="e.g. Mangal Mess" data-testid="field-name" />
            </Field>
            <Field label="Slug (URL) *">
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                placeholder="e.g. mangal-mess" data-testid="field-slug" />
            </Field>

            <Field label="Custom Mess ID (optional)" hint="Uppercase. Leave blank for auto MESS-XXXX.">
              <Input value={form.mess_id_custom} onChange={(e) => setForm({ ...form, mess_id_custom: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })}
                placeholder="e.g. MUMBAI-KHAR-42" className="font-mono tracking-widest" data-testid="field-custom-id" />
            </Field>
            <Field label="Owner phone (10 digits)" hint="Auto-promotes them to mess_owner if they've logged in before.">
              <Input value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value.replace(/[^0-9]/g, "").slice(0, 10) })}
                inputMode="numeric" placeholder="9876543210" data-testid="field-owner-phone" />
            </Field>

            <Field label="Owner email (optional)">
              <Input value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                placeholder="owner@example.com" data-testid="field-owner-email" />
            </Field>
            <Field label="Tagline">
              <Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                placeholder="e.g. Home-style meals, fresh daily" data-testid="field-tagline" />
            </Field>

            <Field label="City *">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Mumbai" data-testid="field-city" />
            </Field>
            <Field label="State *">
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} data-testid="field-state" />
            </Field>

            <Field label="Pincode *">
              <Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/[^0-9]/g, "").slice(0, 6) })}
                inputMode="numeric" data-testid="field-pincode" />
            </Field>
            <Field label="FSSAI number">
              <Input value={form.fssai_number} onChange={(e) => setForm({ ...form, fssai_number: e.target.value })} data-testid="field-fssai" />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Full address *">
                <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Building, area, landmark, city, state, pincode" data-testid="field-address" />
              </Field>
            </div>

            <Field label="Manager name">
              <Input value={form.manager_name} onChange={(e) => setForm({ ...form, manager_name: e.target.value })} data-testid="field-manager-name" />
            </Field>
            <Field label="Manager phone">
              <Input value={form.manager_phone} onChange={(e) => setForm({ ...form, manager_phone: e.target.value })} data-testid="field-manager-phone" />
            </Field>
          </div>

          <label className="flex items-center gap-2 pt-1">
            <input type="checkbox" checked={form.is_franchise} onChange={(e) => setForm({ ...form, is_franchise: e.target.checked })} data-testid="field-is-franchise" />
            <span className="text-sm text-slate-700">Partner-run (franchise) — uncheck only if this is a corporate branch</span>
          </label>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button onClick={create} disabled={saving} className="flex-1 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold h-11" data-testid="submit-mess-btn">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Create mess
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-xl">Cancel</Button>
          </div>
        </section>
      )}

      {/* Messes table */}
      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="messes-table">
        {loading ? (
          <div className="p-10 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div>
        ) : messes.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            <Building2 className="h-9 w-9 mx-auto mb-2 opacity-40" />
            No messes yet. Onboard your first mess above.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {messes.map((m) => (
              <div key={m.mess_id} className="p-4" data-testid={`mess-row-${m.mess_id}`}>
                {/* iter-158h · Redesigned card: header row (logo + name + status) then
                    two-column details grid, then bottom action strip. Prevents the
                    mobile overlap between ID pill and action buttons. */}
                <div className="flex items-start gap-3">
                  {m.logo_url ? (
                    <img src={m.logo_url} alt="" className="h-12 w-12 rounded-xl object-cover border border-slate-200 shrink-0" />
                  ) : (
                    <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Building2 className="h-6 w-6" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-base font-extrabold text-slate-900 leading-tight break-words">{m.name}</div>
                      <StatusPill status={m.status} />
                    </div>
                    <button onClick={() => copyId(m.mess_id)} className="mt-1 inline-flex items-center gap-1 font-mono font-bold text-[11px] text-primary bg-primary/10 rounded-md px-1.5 py-0.5 hover:bg-primary/20" title="Copy mess ID" data-testid={`copy-id-${m.mess_id}`}>
                      <Hash className="h-3 w-3" /> {m.mess_id}
                      <Copy className="h-3 w-3 ml-0.5 opacity-60" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
                  <div className="flex items-start gap-1.5 text-slate-600">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
                    <span>{m.city}{m.state ? `, ${m.state}` : ""}{m.pincode ? ` · ${m.pincode}` : ""}</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <Phone className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
                    {m.owner_phone ? (
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-slate-800">+91 {m.owner_phone}</div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          Owner
                          {m.owner_user_id ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold"><BadgeCheck className="h-3 w-3" /> linked</span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-amber-700 font-semibold"><AlertTriangle className="h-3 w-3" /> not logged in yet</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-amber-700 italic">No owner phone set</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    {m.razorpay_key_id ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-50 rounded-full px-2 py-0.5">✓ Own Razorpay</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-semibold bg-amber-50 rounded-full px-2 py-0.5">Platform Razorpay</span>
                    )}
                    {typeof m.platform_wallet_balance === "number" && (
                      <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-100 rounded-full px-2 py-0.5">
                        Wallet ₹{m.platform_wallet_balance}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={async () => {
                    try {
                      await api.post(`/admin/impersonate/${encodeURIComponent(m.mess_id)}`);
                      toast.success(`Acting as ${m.name}`);
                      navigate("/admin");
                    } catch (e) { toast.error(e?.response?.data?.detail || "Impersonation failed"); }
                  }} className="flex-1 min-w-[7.5rem] rounded-xl bg-primary hover:bg-primary/90 text-white" data-testid={`impersonate-${m.mess_id}`}>
                    <UserCog className="h-3.5 w-3.5 mr-1.5" /> Act as
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openPagesEditor(m)} className="flex-1 min-w-[7.5rem] rounded-xl" data-testid={`pages-${m.mess_id}`}>
                    <ListChecks className="h-3.5 w-3.5 mr-1.5" /> Pages
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleStatus(m)} className="flex-1 min-w-[7.5rem] rounded-xl" data-testid={`toggle-${m.mess_id}`}>
                    {m.status === "active" ? (<><PowerOff className="h-3.5 w-3.5 mr-1.5" /> Suspend</>) : (<><Power className="h-3.5 w-3.5 mr-1.5" /> Activate</>)}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="text-[11px] text-slate-500 text-center">
        Each mess owner logs in with their own phone and gets full admin rights
        over their own mess. Toggle which pages they can see per mess via the
        "Pages" button.
      </div>

      {/* iter-158e · Per-mess page whitelist editor */}
      <Dialog open={!!pagesEditor} onOpenChange={(o) => !o && setPagesEditor(null)}>
        <DialogContent className="max-w-2xl" data-testid="pages-editor">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              Page access · {pagesEditor?.name}
            </DialogTitle>
            <DialogDescription>
              Choose which admin pages this mess owner can see in their sidebar.
              Untick to hide, tick to grant access. Applies immediately on save.
            </DialogDescription>
          </DialogHeader>
          {pagesEditor && (
            <>
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <button onClick={allOn} className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900" data-testid="pages-all-on">Enable all</button>
                <span className="text-slate-300">·</span>
                <button onClick={allOff} className="text-[11px] font-semibold text-red-700 hover:text-red-900" data-testid="pages-all-off">Disable all</button>
                <span className="ml-auto text-[11px] text-slate-500">
                  {pagesEditor.selected.size} / {pagesEditor.catalog.length} enabled
                </span>
              </div>
              <div className="max-h-[55vh] overflow-y-auto grid sm:grid-cols-2 gap-1 py-2">
                {pagesEditor.catalog.map((p) => {
                  const on = pagesEditor.selected.has(p.key);
                  return (
                    <label key={p.key} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-slate-50 ${on ? "bg-emerald-50/50" : ""}`} data-testid={`page-toggle-${p.key}`}>
                      <input type="checkbox" checked={on} onChange={() => togglePage(p.key)} className="h-4 w-4 accent-primary" />
                      <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">{p.label}</span>
                      <span className="font-mono text-[10px] text-slate-400 truncate">{p.key}</span>
                    </label>
                  );
                })}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPagesEditor(null)} className="rounded-xl">Cancel</Button>
                <Button onClick={savePagesEditor} disabled={pagesBusy} className="rounded-xl bg-primary hover:bg-primary/90 text-white" data-testid="pages-save-btn">
                  {pagesBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Save
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[10px] tracking-widest uppercase font-bold text-slate-500">{label}</label>
      {children && <div className="mt-1">{children}</div>}
      {hint && <div className="text-[10px] text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

function StatusPill({ status }) {
  const cls = status === "active"
    ? "bg-emerald-100 text-emerald-800"
    : status === "pending_review"
      ? "bg-amber-100 text-amber-800"
      : "bg-slate-200 text-slate-600";
  return <span className={`text-[10px] uppercase tracking-widest font-bold rounded-full px-2 py-0.5 ${cls}`}>{status}</span>;
}
