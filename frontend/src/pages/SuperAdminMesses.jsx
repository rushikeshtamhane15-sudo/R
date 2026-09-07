/**
 * SuperAdminMesses — iter-144 · efoodtech platform onboarding.
 *
 * Single-page shell for the platform super-admin (role=admin, not
 * franchise_owner) to:
 *   • Onboard a new mess in ONE flow: name, custom Mess ID, owner phone,
 *     address, tagline, etc. Auto-promotes the owner to `franchise_owner`
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
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import {
  Building2, Plus, Save, X, Loader2, ShieldCheck, PowerOff, Power,
  Phone, Hash, MapPin, BadgeCheck, AlertTriangle, Copy,
} from "lucide-react";

const EMPTY = {
  name: "", slug: "", mess_id_custom: "", owner_phone: "", owner_email: "",
  city: "", state: "Maharashtra", pincode: "", address: "",
  tagline: "", manager_name: "", manager_phone: "",
  is_franchise: true, fssai_number: "",
};

export default function SuperAdminMesses() {
  const { user } = useAuth();
  const [messes, setMesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [lastCreated, setLastCreated] = useState(null);

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
            <Field label="Owner phone (10 digits)" hint="Auto-promotes them to franchise_owner if they've logged in before.">
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
              <div key={m.mess_id} className="p-4 flex items-center gap-4 hover:bg-slate-50 transition" data-testid={`mess-row-${m.mess_id}`}>
                {m.logo_url ? (
                  <img src={m.logo_url} alt="" className="h-11 w-11 rounded-xl object-cover border border-slate-200" />
                ) : (
                  <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Building2 className="h-5 w-5" /></div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-bold text-slate-900 truncate">{m.name}</div>
                    <button onClick={() => copyId(m.mess_id)} className="inline-flex items-center gap-1 font-mono font-bold text-[11px] text-primary bg-primary/10 rounded-full px-2 py-0.5 hover:bg-primary/20" title="Copy mess ID">
                      <Hash className="h-3 w-3" /> {m.mess_id}
                    </button>
                    <StatusPill status={m.status} />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {m.city}{m.state ? ` · ${m.state}` : ""}</span>
                    {m.owner_phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {m.owner_phone}</span>}
                    {m.razorpay_key_id ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">✓ Own Razorpay</span>
                    ) : (
                      <span className="text-amber-600">Platform Razorpay</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleStatus(m)} className="rounded-xl" data-testid={`toggle-${m.mess_id}`}>
                    {m.status === "active" ? (<><PowerOff className="h-3.5 w-3.5 mr-1" /> Suspend</>) : (<><Power className="h-3.5 w-3.5 mr-1" /> Activate</>)}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="text-[11px] text-slate-500 text-center">
        Need finer control (page access, franchise pages)? Use{" "}
        <a href="/admin/messes" className="text-primary font-semibold underline">/admin/messes</a>.
      </div>
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
