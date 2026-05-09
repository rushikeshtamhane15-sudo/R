import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Palette, Save, Eye, RefreshCw, Sparkles, Type, ShoppingBag } from "lucide-react";

// Top-to-bottom text editing rights: every user-visible string on /restaurant
// is editable here. Leave a field blank to use the built-in default copy.
const SECTIONS = [
  {
    title: "Top container · badges",
    icon: Sparkles,
    fields: [
      { key: "pure_veg_label",       label: "Pure Veg badge text",       placeholder: "Pure Veg" },
      { key: "bad_stuff_chip_text",  label: "0%-the-bad-stuff chip",     placeholder: "0% the bad stuff" },
      { key: "hero_delivery_badge",  label: "90-min banner text",        placeholder: "90 minutes Fresh Meal Delivery" },
    ],
  },
  {
    title: "Hero copy",
    icon: Type,
    fields: [
      { key: "hero_overline",        label: "Section overline",          placeholder: "efoodcare restaurant" },
      { key: "hero_title",           label: "Hero title",                placeholder: "order online · ghar se accha khana", textarea: true },
      { key: "hero_tagline",         label: "Tagline below title",       placeholder: "Free delivery on orders over ₹500 · ₹50 otherwise" },
      { key: "hero_promise_line1",   label: "Promise line 1 (italic)",   placeholder: "\"Hum late aate hai par fresh late hai\"" },
      { key: "hero_promise_line2",   label: "Promise line 2",            placeholder: "Toh apna khana thoda pre-plan kare 🍱" },
    ],
  },
  {
    title: "Menu item · per-card labels",
    icon: Type,
    fields: [
      { key: "item_promise_label",   label: "Per-item 90-min badge",     placeholder: "90-min fresh" },
    ],
  },
  {
    title: "Cart bar · checkout strings",
    icon: ShoppingBag,
    fields: [
      { key: "search_placeholder",          label: "Search box placeholder",      placeholder: "Search dishes…" },
      { key: "cart_login_hint",             label: "Cart login hint",             placeholder: "Login required to checkout" },
      { key: "cart_free_delivery_label",    label: "Free-delivery label",         placeholder: "Free delivery" },
      { key: "cart_delivery_fee_template",  label: "Delivery-fee template ({fee})", placeholder: "+ ₹{fee} delivery" },
      { key: "checkout_btn_label",          label: "Checkout button (logged-in)", placeholder: "Checkout" },
      { key: "checkout_login_btn_label",    label: "Checkout button (logged-out)", placeholder: "Login & checkout" },
      { key: "no_items_label",              label: "Empty search state",          placeholder: "No items match your search." },
      { key: "reorder_overline",            label: "Reorder banner overline",     placeholder: "Welcome back" },
      { key: "reorder_cta_label",           label: "Reorder button label",        placeholder: "Reorder" },
    ],
  },
];

const COLORS = [
  { key: "hero_bg_color",   label: "Hero background" },
  { key: "hero_text_color", label: "Hero text" },
  { key: "accent_color",    label: "Accent / button" },
];

const ALL_TEXT_KEYS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

export default function AdminRestaurantTheme() {
  const [form, setForm] = useState(() => {
    const o = { hero_bg_color: "", hero_text_color: "", accent_color: "" };
    ALL_TEXT_KEYS.forEach((k) => { o[k] = ""; });
    return o;
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/restaurant/theme");
      const t = r.data || {};
      const next = { ...form };
      ALL_TEXT_KEYS.forEach((k) => { next[k] = t[k] || ""; });
      COLORS.forEach((c) => { next[c.key] = t[c.key] || ""; });
      setForm(next);
    } catch { toast.error("Could not load theme"); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {};
      Object.entries(form).forEach(([k, v]) => {
        if (typeof v === "string" && v.trim()) payload[k] = v.trim();
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
    const next = { hero_bg_color: "", hero_text_color: "", accent_color: "" };
    ALL_TEXT_KEYS.forEach((k) => { next[k] = ""; });
    setForm(next);
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6" data-testid="admin-restaurant-theme">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight flex items-center gap-2">
            <Palette className="h-6 w-6 text-primary" /> Restaurant page editor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Edit any text on the <a href="/restaurant" target="_blank" rel="noreferrer" className="text-primary underline">/restaurant</a> page · leave blank to keep the default. Changes go live instantly.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.open("/restaurant", "_blank")} className="rounded-full" data-testid="theme-preview"><Eye className="h-4 w-4 mr-1.5" /> Preview</Button>
          <Button variant="outline" onClick={reset} className="rounded-full" data-testid="theme-reset"><RefreshCw className="h-4 w-4 mr-1.5" /> Reset</Button>
        </div>
      </div>

      {SECTIONS.map(({ title, icon: Icon, fields }) => (
        <section key={title} className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <p className="font-display font-extrabold flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /> {title}</p>
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{f.label}</span>
              {f.textarea ? (
                <Textarea rows={2} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder} className="mt-1.5" data-testid={`theme-field-${f.key}`} />
              ) : (
                <Input value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder} className="mt-1.5" data-testid={`theme-field-${f.key}`} />
              )}
            </label>
          ))}
        </section>
      ))}

      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <p className="font-display font-extrabold flex items-center gap-2"><Palette className="h-4 w-4 text-primary" /> Colors</p>
        <p className="text-xs text-muted-foreground -mt-2">Use a hex (#a02323), CSS color name (crimson), or leave blank for default.</p>
        {COLORS.map((c) => (
          <label key={c.key} className="block">
            <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{c.label}</span>
            <div className="flex items-center gap-2 mt-1.5">
              <input type="color" value={form[c.key] || "#a02323"} onChange={(e) => setForm({ ...form, [c.key]: e.target.value })} className="h-10 w-12 rounded-lg border border-border cursor-pointer" data-testid={`theme-color-${c.key}`} />
              <Input value={form[c.key]} onChange={(e) => setForm({ ...form, [c.key]: e.target.value })} placeholder="#a02323 or 'crimson' or blank" className="flex-1" />
              {form[c.key] && (
                <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, [c.key]: "" })} className="rounded-full text-xs">Clear</Button>
              )}
            </div>
          </label>
        ))}
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} size="lg" className="rounded-full bg-primary hover:bg-primary/90" data-testid="theme-save">
          <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save & publish"}
        </Button>
      </div>
    </div>
  );
}
