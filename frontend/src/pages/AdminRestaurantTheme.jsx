import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Palette, Save, Eye, RefreshCw, Sparkles } from "lucide-react";

const FIELDS = [
  { key: "hero_title", label: "Hero title (lowercase friendly)", placeholder: "order online · ghar se accha khana", textarea: true },
  { key: "hero_tagline", label: "Tagline under title", placeholder: "Free delivery on orders over ₹500 · ₹50 otherwise" },
  { key: "hero_promise_line1", label: "Promise line 1 (italic quote)", placeholder: "\"Hum late aate hai par fresh late hai\"" },
  { key: "hero_promise_line2", label: "Promise line 2", placeholder: "Toh apna khana thoda pre-plan kare 🍱" },
];

const COLORS = [
  { key: "hero_bg_color", label: "Hero background", default: "" },
  { key: "hero_text_color", label: "Hero text", default: "" },
  { key: "accent_color", label: "Accent / button", default: "" },
];

export default function AdminRestaurantTheme() {
  const [form, setForm] = useState({
    hero_title: "",
    hero_tagline: "",
    hero_promise_line1: "",
    hero_promise_line2: "",
    hero_bg_color: "",
    hero_text_color: "",
    accent_color: "",
    show_zero_bad_stuff_chip: true,
    show_delivery_promise: true,
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/restaurant/theme");
      const t = r.data || {};
      setForm((f) => ({
        ...f,
        hero_title: t.hero_title || "",
        hero_tagline: t.hero_tagline || "",
        hero_promise_line1: t.hero_promise_line1 || "",
        hero_promise_line2: t.hero_promise_line2 || "",
        hero_bg_color: t.hero_bg_color || "",
        hero_text_color: t.hero_text_color || "",
        accent_color: t.accent_color || "",
        show_zero_bad_stuff_chip: t.show_zero_bad_stuff_chip !== false,
        show_delivery_promise: t.show_delivery_promise !== false,
      }));
    } catch { toast.error("Could not load theme"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      // Send only non-empty values for text/color fields; booleans always
      const payload = {};
      Object.entries(form).forEach(([k, v]) => {
        if (typeof v === "boolean") payload[k] = v;
        else if (typeof v === "string" && v.trim()) payload[k] = v.trim();
      });
      await api.put("/admin/restaurant/theme", payload);
      toast.success("Theme saved · live on /restaurant");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!window.confirm("Reset all hero fields to defaults? (clears your custom copy)")) return;
    setForm({
      hero_title: "", hero_tagline: "", hero_promise_line1: "", hero_promise_line2: "",
      hero_bg_color: "", hero_text_color: "", accent_color: "",
      show_zero_bad_stuff_chip: true, show_delivery_promise: true,
    });
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6" data-testid="admin-restaurant-theme">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight flex items-center gap-2">
            <Palette className="h-6 w-6 text-primary" /> Restaurant page editor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Edit hero copy + colors. Changes go live instantly on <a href="/restaurant" target="_blank" rel="noreferrer" className="text-primary underline">/restaurant</a>. Leave a field empty to keep the default.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.open("/restaurant", "_blank")} className="rounded-full" data-testid="theme-preview"><Eye className="h-4 w-4 mr-1.5" /> Preview</Button>
          <Button variant="outline" onClick={reset} className="rounded-full" data-testid="theme-reset"><RefreshCw className="h-4 w-4 mr-1.5" /> Reset</Button>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <p className="font-display font-extrabold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Hero copy</p>
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{f.label}</span>
            {f.textarea ? (
              <Textarea
                rows={2}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="mt-1.5"
                data-testid={`theme-field-${f.key}`}
              />
            ) : (
              <Input
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="mt-1.5"
                data-testid={`theme-field-${f.key}`}
              />
            )}
          </label>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <p className="font-display font-extrabold flex items-center gap-2"><Palette className="h-4 w-4 text-primary" /> Colors</p>
        <p className="text-xs text-muted-foreground -mt-2">Use a hex (#a02323), CSS color name (crimson), or leave blank for default.</p>
        {COLORS.map((c) => (
          <label key={c.key} className="block">
            <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{c.label}</span>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                type="color"
                value={form[c.key] || "#a02323"}
                onChange={(e) => setForm({ ...form, [c.key]: e.target.value })}
                className="h-10 w-12 rounded-lg border border-border cursor-pointer"
                data-testid={`theme-color-${c.key}`}
              />
              <Input
                value={form[c.key]}
                onChange={(e) => setForm({ ...form, [c.key]: e.target.value })}
                placeholder="#a02323 or 'crimson' or blank"
                className="flex-1"
              />
              {form[c.key] && (
                <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, [c.key]: "" })} className="rounded-full text-xs">Clear</Button>
              )}
            </div>
          </label>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <p className="font-display font-extrabold">Visibility toggles</p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.show_zero_bad_stuff_chip}
            onChange={(e) => setForm({ ...form, show_zero_bad_stuff_chip: e.target.checked })}
            className="h-4 w-4 rounded text-primary"
            data-testid="theme-toggle-bad-stuff"
          />
          <span className="text-sm">Show <b>"0% the bad stuff"</b> chip in header</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.show_delivery_promise}
            onChange={(e) => setForm({ ...form, show_delivery_promise: e.target.checked })}
            className="h-4 w-4 rounded text-primary"
            data-testid="theme-toggle-promise"
          />
          <span className="text-sm">Show <b>90-minute delivery promise</b> badge</span>
        </label>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} size="lg" className="rounded-full bg-primary hover:bg-primary/90" data-testid="theme-save">
          <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save & publish"}
        </Button>
      </div>
    </div>
  );
}
