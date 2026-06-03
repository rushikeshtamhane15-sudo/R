import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Save, Loader2, Palette } from "lucide-react";

/**
 * AdminDashboardStyles — iter-56 #1
 * Admin can override background + text colors of the two subscriber-dashboard
 * payment tiles (Cash OTP + Pending balance). Empty values inherit the
 * default `.card-3d-primary` / `.card-3d-amber` look.
 */
const PRESETS = [
  { name: "default", dues_bg: "", dues_text: "", otp_bg: "", otp_text: "" },
  { name: "mint",    dues_bg: "linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%)", dues_text: "#065f46", otp_bg: "linear-gradient(180deg, #ecfeff 0%, #cffafe 100%)", otp_text: "#0e7490" },
  { name: "indigo",  dues_bg: "linear-gradient(180deg, #eef2ff 0%, #c7d2fe 100%)", dues_text: "#3730a3", otp_bg: "linear-gradient(180deg, #faf5ff 0%, #e9d5ff 100%)", otp_text: "#6b21a8" },
];

export default function AdminDashboardStyles() {
  const [v, setV] = useState({ dues_bg: "", dues_text: "", otp_bg: "", otp_text: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/dashboard-styles");
      setV({ dues_bg: r.data.dues_bg || "", dues_text: r.data.dues_text || "", otp_bg: r.data.otp_bg || "", otp_text: r.data.otp_text || "" });
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try { await api.put("/admin/dashboard-styles", v); toast.success("Saved"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    setSaving(false);
  };

  const applyPreset = (p) => setV({ dues_bg: p.dues_bg, dues_text: p.dues_text, otp_bg: p.otp_bg, otp_text: p.otp_text });

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 space-y-5" data-testid="admin-dashboard-styles">
      <div>
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">CMS</p>
        <h1 className="font-display font-extrabold text-3xl mt-1 flex items-center gap-2"><Palette className="h-7 w-7" /> Dashboard tile colors</h1>
        <p className="text-sm text-muted-foreground mt-1">Override the bg / text colour of the two payment tiles on subscriber dashboard. Leave blank to use brand defaults.</p>
      </div>

      <div className="rounded-2xl card-3d p-5 space-y-3">
        <p className="text-[11px] tracking-overline uppercase font-bold text-muted-foreground">Quick presets</p>
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map((p) => <Button key={p.name} size="sm" variant="outline" onClick={() => applyPreset(p)} className="rounded-full capitalize" data-testid={`preset-${p.name}`}>{p.name}</Button>)}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Cash OTP card */}
        <div className="rounded-2xl card-3d p-5 space-y-3" data-testid="otp-style-block">
          <h2 className="font-display font-bold flex items-center gap-2">Cash OTP tile</h2>
          <label className="block"><span className="text-[10px] uppercase tracking-overline font-bold text-muted-foreground">Background (CSS color or gradient)</span><Input value={v.otp_bg} onChange={(e) => setV({ ...v, otp_bg: e.target.value })} placeholder="e.g. linear-gradient(180deg, #ecfeff 0%, #cffafe 100%)" className="mt-1 rounded-xl font-mono text-xs" data-testid="otp-bg" /></label>
          <label className="block"><span className="text-[10px] uppercase tracking-overline font-bold text-muted-foreground">Text color</span><Input value={v.otp_text} onChange={(e) => setV({ ...v, otp_text: e.target.value })} placeholder="#0e7490 or rgb(...)" className="mt-1 rounded-xl font-mono text-xs" data-testid="otp-text" /></label>
          <div className="rounded-xl p-3" style={{ background: v.otp_bg || "color-mix(in srgb, var(--primary) 10%, var(--card))", color: v.otp_text || undefined }}>
            <p className="text-[10px] uppercase tracking-overline opacity-80">Preview · Cash OTP</p>
            <p className="font-display font-extrabold text-xl tracking-[0.25em] mt-1">1 2 3 4 5 6</p>
            <p className="text-[10px] opacity-70 mt-1">Plan · ₹2800</p>
          </div>
        </div>
        {/* Pending dues card */}
        <div className="rounded-2xl card-3d p-5 space-y-3" data-testid="dues-style-block">
          <h2 className="font-display font-bold flex items-center gap-2">Pending balance tile</h2>
          <label className="block"><span className="text-[10px] uppercase tracking-overline font-bold text-muted-foreground">Background</span><Input value={v.dues_bg} onChange={(e) => setV({ ...v, dues_bg: e.target.value })} placeholder="linear-gradient(...) or #fff8e1" className="mt-1 rounded-xl font-mono text-xs" data-testid="dues-bg" /></label>
          <label className="block"><span className="text-[10px] uppercase tracking-overline font-bold text-muted-foreground">Text color</span><Input value={v.dues_text} onChange={(e) => setV({ ...v, dues_text: e.target.value })} placeholder="#7c2d12" className="mt-1 rounded-xl font-mono text-xs" data-testid="dues-text" /></label>
          <div className="rounded-xl p-3" style={{ background: v.dues_bg || "linear-gradient(180deg, #fff8e1, #ffefc4)", color: v.dues_text || undefined }}>
            <p className="text-[10px] uppercase tracking-overline opacity-80">Preview · Pending balance</p>
            <p className="font-display font-extrabold text-xl mt-1">₹1600 due</p>
            <p className="text-[10px] opacity-70 mt-1">Clear before wallet runs out.</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="rounded-full" data-testid="dash-styles-save">{saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />} Save</Button>
      </div>
    </div>
  );
}
