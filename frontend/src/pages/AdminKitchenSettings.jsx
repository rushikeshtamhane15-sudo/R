import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Loader2, Save, MapPin } from "lucide-react";

/**
 * AdminKitchenSettings — iter-55 #10b
 * Admin sets kitchen lat/lng + dispatch radius. This drives both:
 *   1) Geo-block on purchase endpoints
 *   2) Map clamping on every user-facing map (FE reads /api/kitchen-location)
 */
export default function AdminKitchenSettings() {
  const [form, setForm] = useState({ dispatch_lat: 18.5204, dispatch_lng: 73.8567, dispatch_radius_km: 15, address_label: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/kitchen-settings");
      setForm(r.data);
    } catch (e) { toast.error("Load failed"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/kitchen-settings", {
        dispatch_lat: Number(form.dispatch_lat),
        dispatch_lng: Number(form.dispatch_lng),
        dispatch_radius_km: Number(form.dispatch_radius_km),
        address_label: form.address_label,
      });
      toast.success("Saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    setSaving(false);
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-kitchen-settings">
      <div>
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Operations</p>
        <h1 className="font-display font-extrabold text-3xl mt-1">Kitchen & dispatch radius</h1>
        <p className="text-sm text-muted-foreground mt-1">Sets where orders are dispatched from and the maximum delivery radius. Orders outside this radius are blocked at checkout.</p>
      </div>

      <div className="rounded-2xl card-3d p-5 space-y-3">
        <label className="block">
          <span className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Kitchen address label</span>
          <Input value={form.address_label || ""} onChange={(e) => setForm({ ...form, address_label: e.target.value })} className="mt-1 rounded-xl" placeholder="e.g. Kothrud, Pune, MH" data-testid="kitchen-address-label" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Latitude</span>
            <Input type="number" step="0.000001" value={form.dispatch_lat} onChange={(e) => setForm({ ...form, dispatch_lat: e.target.value })} className="mt-1 rounded-xl tabular-nums" data-testid="kitchen-lat" />
          </label>
          <label className="block">
            <span className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Longitude</span>
            <Input type="number" step="0.000001" value={form.dispatch_lng} onChange={(e) => setForm({ ...form, dispatch_lng: e.target.value })} className="mt-1 rounded-xl tabular-nums" data-testid="kitchen-lng" />
          </label>
        </div>
        <label className="block">
          <span className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Dispatch radius (km)</span>
          <Input type="number" min="0.5" max="200" step="0.5" value={form.dispatch_radius_km} onChange={(e) => setForm({ ...form, dispatch_radius_km: e.target.value })} className="mt-1 rounded-xl tabular-nums" data-testid="kitchen-radius" />
          <p className="text-[11px] text-muted-foreground mt-1">All maps in the app will be clamped to {form.dispatch_radius_km}km around this point.</p>
        </label>
        <div className="flex items-center justify-between">
          <a href={`https://www.google.com/maps?q=${form.dispatch_lat},${form.dispatch_lng}`} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Verify on Google Maps</a>
          <Button onClick={save} disabled={saving} className="rounded-full" data-testid="kitchen-save"><Save className="h-3.5 w-3.5 mr-1.5" /> {saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
