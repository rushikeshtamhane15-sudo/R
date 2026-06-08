/**
 * AdminMesses — iter-75 #8.
 * Lists all messes (corporate branches + franchise applications) and lets
 * admin create / edit / approve / deactivate them. Default corporate
 * mess (`efoodcare-amravati`) is protected from deletion.
 */
import React, { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Plus, Building2, MapPin, Phone, Mail, ShieldCheck, Loader2, Power, PowerOff, Pencil, BarChart3, UserPlus } from "lucide-react";

const EMPTY = {
  slug: "", name: "", tagline: "", address: "", city: "", state: "Maharashtra",
  pincode: "", lat: null, lng: null, manager_name: "", manager_phone: "", manager_email: "",
  is_franchise: false, fssai_number: "", capacity_lunch: 100, capacity_dinner: 100,
};

export default function AdminMesses() {
  const [messes, setMesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | mess_id
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get("/admin/messes"); setMesses(r.data?.messes || []); }
    catch { toast.error("Failed to load messes"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const startCreate = () => { setForm(EMPTY); setEditing("new"); };
  const startEdit = (m) => {
    setForm({
      slug: m.slug || "", name: m.name || "", tagline: m.tagline || "",
      address: m.address || "", city: m.city || "", state: m.state || "Maharashtra",
      pincode: m.pincode || "", lat: m.lat ?? null, lng: m.lng ?? null,
      manager_name: m.manager_name || "", manager_phone: m.manager_phone || "",
      manager_email: m.manager_email || "", is_franchise: !!m.is_franchise,
      fssai_number: m.fssai_number || "",
      capacity_lunch: m.capacity_lunch || 100, capacity_dinner: m.capacity_dinner || 100,
    });
    setEditing(m.mess_id);
  };
  const cancel = () => { setEditing(null); setForm(EMPTY); };

  const save = async () => {
    if (!form.name || !form.slug || !form.city || !form.address) {
      toast.error("name, slug, city, address are required");
      return;
    }
    setSaving(true);
    try {
      if (editing === "new") await api.post("/admin/messes", form);
      else await api.put(`/admin/messes/${editing}`, form);
      toast.success("Saved");
      cancel();
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const setStatus = async (mess_id, status) => {
    try {
      await api.patch(`/admin/messes/${mess_id}/status`, { status });
      toast.success(`Status → ${status}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not change status"); }
  };

  const assignOwner = async (m) => {
    const next = prompt(
      `Assign franchise owner to "${m.name}"\n\nEnter the user_id (or leave blank to UNASSIGN):`,
      m.owner_user_id || "",
    );
    if (next === null) return;
    try {
      await api.patch(`/admin/messes/${m.mess_id}/owner`, { owner_user_id: next.trim() || null });
      toast.success(next ? "Owner assigned — user promoted to franchise_owner" : "Owner cleared");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div data-testid="admin-messes-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Multi-mess</p>
      <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight">Messes &amp; franchise</h1>
        {!editing && (
          <Button onClick={startCreate} className="rounded-full bg-primary" data-testid="admin-messes-new">
            <Plus className="h-4 w-4 mr-1.5" /> Add a mess / branch
          </Button>
        )}
      </div>
      <p className="text-muted-foreground mt-2 text-sm max-w-2xl">
        Manage corporate branches + franchise partner kitchens. The default mess (<code className="text-xs bg-muted/40 rounded px-1 py-0.5">efoodcare-amravati</code>) is always active.
        Franchise applications appear as <em>pending review</em> — click ✅ to approve.
      </p>

      {/* === Edit / create form === */}
      {editing && (
        <div className="mt-6 bg-card rounded-2xl border border-border p-5 space-y-4" data-testid="admin-messes-form">
          <h2 className="font-display font-extrabold text-xl flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            {editing === "new" ? "New mess" : `Edit ${form.name}`}
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Slug (URL-safe id, e.g. efoodcare-nagpur)"><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} data-testid="mess-field-slug" /></Field>
            <Field label="Display name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="mess-field-name" /></Field>
            <Field label="Tagline"><Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} data-testid="mess-field-tagline" /></Field>
            <Field label="FSSAI number"><Input value={form.fssai_number} onChange={(e) => setForm({ ...form, fssai_number: e.target.value })} data-testid="mess-field-fssai" /></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="mess-field-city" /></Field>
            <Field label="State"><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} data-testid="mess-field-state" /></Field>
            <Field label="Pincode"><Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} data-testid="mess-field-pincode" /></Field>
            <Field label="Type">
              <label className="flex items-center gap-2 mt-2.5">
                <input type="checkbox" checked={form.is_franchise} onChange={(e) => setForm({ ...form, is_franchise: e.target.checked })} data-testid="mess-field-franchise" />
                <span className="text-sm">Franchise (partner-run)</span>
              </label>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Full address"><Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="mess-field-address" /></Field>
            </div>
            <Field label="Manager name"><Input value={form.manager_name} onChange={(e) => setForm({ ...form, manager_name: e.target.value })} data-testid="mess-field-mname" /></Field>
            <Field label="Manager phone"><Input value={form.manager_phone} onChange={(e) => setForm({ ...form, manager_phone: e.target.value })} data-testid="mess-field-mphone" /></Field>
            <Field label="Manager email"><Input value={form.manager_email} onChange={(e) => setForm({ ...form, manager_email: e.target.value })} data-testid="mess-field-memail" /></Field>
            <Field label="Capacity lunch"><Input type="number" value={form.capacity_lunch} onChange={(e) => setForm({ ...form, capacity_lunch: Number(e.target.value) || 100 })} data-testid="mess-field-clunch" /></Field>
            <Field label="Capacity dinner"><Input type="number" value={form.capacity_dinner} onChange={(e) => setForm({ ...form, capacity_dinner: Number(e.target.value) || 100 })} data-testid="mess-field-cdinner" /></Field>
            <Field label="Latitude (optional)"><Input value={form.lat ?? ""} onChange={(e) => setForm({ ...form, lat: e.target.value === "" ? null : Number(e.target.value) })} data-testid="mess-field-lat" /></Field>
            <Field label="Longitude (optional)"><Input value={form.lng ?? ""} onChange={(e) => setForm({ ...form, lng: e.target.value === "" ? null : Number(e.target.value) })} data-testid="mess-field-lng" /></Field>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={save} disabled={saving} className="rounded-full bg-primary" data-testid="mess-save">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null} Save
            </Button>
            <Button onClick={cancel} variant="ghost" className="rounded-full" data-testid="mess-cancel">Cancel</Button>
          </div>
        </div>
      )}

      {/* === List === */}
      <div className="mt-6 space-y-3" data-testid="admin-messes-list">
        {loading ? (
          <div className="text-muted-foreground text-sm">Loading…</div>
        ) : messes.length === 0 ? (
          <div className="text-muted-foreground text-sm">No messes yet.</div>
        ) : messes.map((m) => (
          <div key={m.mess_id} className="bg-card rounded-2xl border border-border p-4 sm:p-5 flex flex-col sm:flex-row gap-4" data-testid={`admin-mess-${m.slug}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-extrabold text-lg leading-tight">{m.name}</span>
                <span className={`text-[10px] tracking-[0.16em] uppercase font-extrabold rounded-full px-2 py-0.5 ${m.status === "active" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : m.status === "pending_review" ? "bg-amber-500/15 text-amber-700" : "bg-muted text-muted-foreground"}`}>{m.status}</span>
                {m.is_franchise && <span className="text-[10px] tracking-[0.16em] uppercase font-extrabold rounded-full px-2 py-0.5 bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300">Franchise</span>}
                {m.is_corporate && <span className="text-[10px] tracking-[0.16em] uppercase font-extrabold rounded-full px-2 py-0.5 bg-primary/10 text-primary">Corporate</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">slug: <code className="bg-muted/40 rounded px-1 py-0.5">{m.slug}</code></p>
              <div className="mt-2 grid sm:grid-cols-2 gap-1.5 text-[13px]">
                <p className="flex items-start gap-1.5"><MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" /> {m.address}, {m.city} {m.pincode}</p>
                {m.manager_phone && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {m.manager_phone}</p>}
                {m.manager_email && <p className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {m.manager_email}</p>}
                {m.fssai_number && <p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /> FSSAI {m.fssai_number}</p>}
              </div>
            </div>
            <div className="flex sm:flex-col gap-1.5 sm:w-[170px]">
              <Link to={`/admin/messes/${m.mess_id}/metrics`} data-testid={`mess-metrics-${m.slug}`} className="inline-flex items-center justify-center gap-1 rounded-full h-8 text-xs font-extrabold bg-primary text-white hover:bg-primary/90 px-3">
                <BarChart3 className="h-3.5 w-3.5" /> Metrics
              </Link>
              <Button onClick={() => startEdit(m)} variant="outline" className="rounded-full h-8 text-xs" data-testid={`mess-edit-${m.slug}`}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit</Button>
              <Button onClick={() => assignOwner(m)} variant="outline" className="rounded-full h-8 text-xs" data-testid={`mess-assign-owner-${m.slug}`}><UserPlus className="h-3.5 w-3.5 mr-1" /> Owner</Button>
              {m.status !== "active" ? (
                <Button onClick={() => setStatus(m.mess_id, "active")} className="rounded-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700" data-testid={`mess-activate-${m.slug}`}><Power className="h-3.5 w-3.5 mr-1" /> Approve</Button>
              ) : (
                <Button onClick={() => setStatus(m.mess_id, "inactive")} variant="outline" className="rounded-full h-8 text-xs" disabled={m.is_corporate} data-testid={`mess-deactivate-${m.slug}`}><PowerOff className="h-3.5 w-3.5 mr-1" /> Deactivate</Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
