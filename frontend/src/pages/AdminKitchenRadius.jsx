/**
 * AdminKitchenRadius — iter-94 #2.
 * Franchise-owner page to pin their kitchen's lat/lng + delivery radius +
 * street address. Calls PATCH /franchise/me/kitchen — auto-scoped to their
 * own mess by the backend (cannot edit another branch).
 */
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { MapPin, Loader2, Crosshair, Save, ExternalLink, Building2 } from "lucide-react";

export default function AdminKitchenRadius() {
  const [mess, setMess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ lat: "", lng: "", radius_km: "", address: "" });
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/franchise/me/mess");
        const m = r.data?.mess;
        setMess(m);
        if (m) setForm({
          lat: String(m.lat ?? ""),
          lng: String(m.lng ?? ""),
          radius_km: String(m.radius_km ?? ""),
          address: m.address || "",
        });
      } catch (e) { toast.error(e?.response?.data?.detail || "Could not load branch"); }
      finally { setLoading(false); }
    })();
  }, []);

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) { toast.error("Geolocation unavailable"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }));
        toast.success("Pinned current location");
        setLocating(false);
      },
      (err) => { toast.error(err.message || "Could not get location"); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = async () => {
    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) { toast.error("Enter valid lat / lng"); return; }
    setSaving(true);
    try {
      const payload = { lat, lng };
      if (form.radius_km !== "") payload.radius_km = parseFloat(form.radius_km);
      if (form.address.trim()) payload.address = form.address.trim();
      const r = await api.patch("/franchise/me/kitchen", payload);
      setMess(r.data?.mess);
      toast.success("Kitchen location saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  if (loading) return <p className="text-muted-foreground" data-testid="kitchen-radius-loading">Loading branch…</p>;
  if (!mess) return <p className="text-muted-foreground">No branch assigned to your account.</p>;

  const mapPreview = form.lat && form.lng
    ? `https://www.google.com/maps?q=${form.lat},${form.lng}`
    : null;

  return (
    <div data-testid="kitchen-radius-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Franchise · Branch</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Kitchen &amp; radius</h1>
      <p className="text-muted-foreground mt-2 text-sm max-w-2xl">
        Pin your kitchen on the map and set the delivery radius (km). This is what subscribers see when they check serviceability.
      </p>

      <div className="mt-6 grid lg:grid-cols-[1fr_280px] gap-5 max-w-4xl">
        <div className="bg-card rounded-2xl border border-border p-5 space-y-4" data-testid="kitchen-radius-form">
          <Field icon={Building2} label="Street address">
            <textarea
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              data-testid="kitchen-address-input"
              placeholder="Shop / building, area, city, pincode"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field icon={MapPin} label="Latitude">
              <Input type="number" step="any" value={form.lat} onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))} placeholder="20.9320" data-testid="kitchen-lat-input" />
            </Field>
            <Field icon={MapPin} label="Longitude">
              <Input type="number" step="any" value={form.lng} onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))} placeholder="77.7523" data-testid="kitchen-lng-input" />
            </Field>
          </div>

          <Field icon={Crosshair} label="Delivery radius (km)">
            <Input type="number" step="0.1" min="0" max="50" value={form.radius_km} onChange={(e) => setForm((f) => ({ ...f, radius_km: e.target.value }))} placeholder="e.g. 5" data-testid="kitchen-radius-input" />
            <p className="text-[11px] text-muted-foreground mt-1">Orders outside this radius will be blocked.</p>
          </Field>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={useMyLocation} variant="outline" className="rounded-full h-10" disabled={locating} data-testid="kitchen-use-my-location">
              {locating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Crosshair className="h-4 w-4 mr-1.5" />}
              Use my current location
            </Button>
            <Button onClick={save} disabled={saving} className="rounded-full h-10 bg-primary" data-testid="kitchen-save-btn">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save kitchen location
            </Button>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-4 space-y-2" data-testid="kitchen-summary">
          <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">Current</p>
          <p className="font-display font-extrabold text-lg leading-tight">{mess.name}</p>
          <p className="text-xs text-muted-foreground">{mess.city} · {mess.address || "no address"}</p>
          <div className="rounded-xl bg-muted/40 px-3 py-2 text-xs space-y-0.5">
            <p><span className="text-muted-foreground">Lat:</span> <span className="font-mono">{mess.lat ?? "—"}</span></p>
            <p><span className="text-muted-foreground">Lng:</span> <span className="font-mono">{mess.lng ?? "—"}</span></p>
            <p><span className="text-muted-foreground">Radius:</span> <span className="font-mono">{mess.radius_km ?? "—"} km</span></p>
          </div>
          {mapPreview && (
            <a href={mapPreview} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline pt-1" data-testid="kitchen-open-map">
              Open in Google Maps <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, children }) {
  return (
    <div>
      <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground inline-flex items-center gap-1.5">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null} {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
