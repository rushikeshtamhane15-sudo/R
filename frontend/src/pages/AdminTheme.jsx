import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useTheme } from "../context/ThemeContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Palette, RotateCcw, Save } from "lucide-react";

const TOKEN_FIELDS = [
  { key: "primary", label: "Primary (brand)", color: true },
  { key: "primary_foreground", label: "Primary text", color: true },
  { key: "secondary", label: "Secondary", color: true },
  { key: "secondary_foreground", label: "Secondary text", color: true },
  { key: "accent", label: "Accent (subtle bg)", color: true },
  { key: "accent_foreground", label: "Accent text", color: true },
  { key: "destructive", label: "Destructive (red)", color: true },
  { key: "background", label: "Background", color: true },
  { key: "foreground", label: "Foreground", color: true },
  { key: "muted", label: "Muted", color: true },
  { key: "muted_foreground", label: "Muted text", color: true },
  { key: "border", label: "Border", color: true },
  { key: "ring", label: "Focus ring", color: true },
  { key: "radius", label: "Border radius", color: false },
];

const PRESETS = [
  {
    name: "Green & Blue Default",
    tokens: { primary: "142 45% 38%", primary_foreground: "0 0% 100%", secondary: "220 70% 50%", secondary_foreground: "0 0% 100%", destructive: "0 70% 50%", accent: "142 30% 95%", accent_foreground: "142 45% 38%", background: "0 0% 100%", foreground: "215 28% 17%", muted: "215 20% 96%", muted_foreground: "215 15% 45%", border: "215 20% 90%", ring: "142 45% 38%" },
  },
  {
    name: "Red & Green festive",
    tokens: { primary: "0 70% 48%", primary_foreground: "0 0% 100%", secondary: "142 50% 35%", secondary_foreground: "0 0% 100%", destructive: "0 80% 40%", accent: "0 50% 96%", accent_foreground: "0 70% 48%", background: "0 0% 100%", foreground: "215 28% 17%", muted: "0 20% 96%", muted_foreground: "215 15% 45%", border: "0 30% 90%", ring: "0 70% 48%" },
  },
  {
    name: "Blue trust",
    tokens: { primary: "220 70% 45%", primary_foreground: "0 0% 100%", secondary: "0 70% 50%", secondary_foreground: "0 0% 100%", destructive: "0 70% 50%", accent: "220 60% 95%", accent_foreground: "220 70% 45%", background: "0 0% 100%", foreground: "215 28% 17%", muted: "215 20% 96%", muted_foreground: "215 15% 45%", border: "215 20% 90%", ring: "220 70% 45%" },
  },
];

export default function AdminTheme() {
  const { theme, refresh, applyTokens } = useTheme();
  const [brandName, setBrandName] = useState("");
  const [brandTagline, setBrandTagline] = useState("");
  const [tokens, setTokens] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (theme) {
      setBrandName(theme.brand_name || "");
      setBrandTagline(theme.brand_tagline || "");
      setTokens(theme.tokens || {});
    }
  }, [theme]);

  const updateToken = (k, v) => {
    const next = { ...tokens, [k]: v };
    setTokens(next);
    applyTokens(next); // live preview
  };

  const applyPreset = (preset) => {
    const next = { ...tokens, ...preset.tokens };
    setTokens(next);
    applyTokens(next);
    toast.success(`Preview: ${preset.name}. Click Save to apply for everyone.`);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/admin/theme", { brand_name: brandName, brand_tagline: brandTagline, tokens });
      await refresh();
      toast.success("Design saved — visible to everyone");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset to factory defaults?")) return;
    setSaving(true);
    try {
      await api.post("/admin/theme/reset");
      await refresh();
      toast.success("Reset to defaults");
    } finally { setSaving(false); }
  };

  return (
    <div data-testid="admin-theme-page">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Design</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2 flex items-center gap-2">
            <Palette className="h-7 w-7 text-primary" /> Design controls
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">Edit brand, tagline and the entire color palette. Changes preview live and save for everyone.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} className="rounded-full" data-testid="reset-theme-button">
            <RotateCcw className="h-4 w-4 mr-2" /> Reset
          </Button>
          <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="save-theme-button">
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save design"}
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-2xl border border-border p-6">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Brand</p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Brand name</label>
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} className="mt-2 rounded-xl" data-testid="brand-name-input" />
            </div>
            <div>
              <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Tagline</label>
              <Input value={brandTagline} onChange={(e) => setBrandTagline(e.target.value)} className="mt-2 rounded-xl" data-testid="brand-tagline-input" />
            </div>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-6">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Quick presets</p>
          <p className="text-xs text-muted-foreground mt-2">Tap to preview, then Save to apply.</p>
          <div className="mt-4 space-y-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(p)}
                data-testid={`preset-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="w-full text-left rounded-xl border border-border hover:border-primary transition-colors px-4 py-3 flex items-center justify-between"
              >
                <span className="font-semibold text-sm">{p.name}</span>
                <span className="flex gap-1.5">
                  <span className="h-5 w-5 rounded-full border border-black/5" style={{ backgroundColor: `hsl(${p.tokens.primary})` }} />
                  <span className="h-5 w-5 rounded-full border border-black/5" style={{ backgroundColor: `hsl(${p.tokens.secondary})` }} />
                  <span className="h-5 w-5 rounded-full border border-black/5" style={{ backgroundColor: `hsl(${p.tokens.destructive})` }} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 bg-card rounded-2xl border border-border p-6">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Color tokens</p>
        <p className="text-xs text-muted-foreground mt-1">Use HSL format: <span className="font-mono">"H S% L%"</span> — e.g., <span className="font-mono">"142 45% 38%"</span></p>
        <div className="mt-5 grid sm:grid-cols-2 gap-4">
          {TOKEN_FIELDS.map((f) => (
            <TokenField key={f.key} field={f} value={tokens[f.key] || ""} onChange={(v) => updateToken(f.key, v)} />
          ))}
        </div>
      </div>

      <div className="mt-6 bg-card rounded-2xl border border-border p-6" data-testid="theme-preview">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground mb-4">Live preview</p>
        <div className="flex flex-wrap gap-3">
          <Button className="rounded-full bg-primary hover:bg-primary/90">Primary button</Button>
          <Button className="rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground">Secondary</Button>
          <Button variant="outline" className="rounded-full">Outline</Button>
          <Button className="rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground">Destructive</Button>
        </div>
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border p-4 bg-card"><p className="font-display font-bold">Card</p><p className="text-sm text-muted-foreground mt-1">Standard card surface.</p></div>
          <div className="rounded-xl bg-primary text-primary-foreground p-4"><p className="font-display font-bold">Brand block</p><p className="text-sm opacity-80 mt-1">Primary on brand color.</p></div>
          <div className="rounded-xl bg-accent p-4"><p className="font-display font-bold text-accent-foreground">Accent block</p><p className="text-sm text-accent-foreground/80 mt-1">Subtle highlight.</p></div>
        </div>
      </div>
    </div>
  );
}

function TokenField({ field, value, onChange }) {
  return (
    <div>
      <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{field.label}</label>
      <div className="mt-2 flex items-center gap-2">
        {field.color && (
          <span
            className="h-9 w-9 rounded-lg border border-border shrink-0"
            style={{ backgroundColor: value ? `hsl(${value})` : "transparent" }}
            data-testid={`swatch-${field.key}`}
          />
        )}
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl font-mono text-sm" data-testid={`token-${field.key}`} />
      </div>
    </div>
  );
}
