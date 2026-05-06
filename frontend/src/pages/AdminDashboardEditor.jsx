import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Layout, ArrowUp, ArrowDown, Eye, EyeOff, Save, RotateCcw, Loader2,
  Type, Palette, Sparkles,
} from "lucide-react";

const TEXT_LABELS = {
  greeting_overline: { label: "Greeting overline", hint: "Tiny line above the heading. e.g., 'Hello,'" },
  heading_eatin:     { label: "Eat-in heading",    hint: "Shown to subscribers with a dining plan." },
  heading_tiffin:    { label: "Tiffin heading",    hint: "Shown to tiffin-delivery subscribers." },
  subtext:           { label: "Tagline",           hint: "Italic line below the heading." },
  no_sub_title:      { label: "No-plan title",     hint: "Heading on the 'pick a plan' card when user has no subscription." },
  no_sub_subtext:    { label: "No-plan subtext",   hint: "Body copy on the 'pick a plan' card." },
};

const COLOR_LABELS = {
  wallet_bg:        { label: "Wallet card background", placeholder: "#a02323 or empty for theme" },
  wallet_fg:        { label: "Wallet card text colour", placeholder: "#ffffff or empty" },
  hero_accent:      { label: "Hero accent (pass / tiffin)", placeholder: "e.g. #d97706" },
  section_card_bg:  { label: "Side card background tint", placeholder: "e.g. #f8fafc" },
};

export default function AdminDashboardEditor() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/dashboard/config"); setCfg(r.data); }
    catch { toast.error("Could not load dashboard config"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const setSection = (id, patch) => {
    setCfg((c) => ({
      ...c,
      sections: c.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const move = (idx, delta) => {
    setCfg((c) => {
      const arr = [...c.sections];
      const ni = idx + delta;
      if (ni < 0 || ni >= arr.length) return c;
      [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
      return { ...c, sections: arr.map((s, i) => ({ ...s, order: i })) };
    });
  };

  const setText = (k, v) => setCfg((c) => ({ ...c, texts: { ...c.texts, [k]: v } }));
  const setColor = (k, v) => setCfg((c) => ({ ...c, colors: { ...c.colors, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/admin/dashboard/config", {
        sections: cfg.sections,
        texts: cfg.texts,
        colors: cfg.colors,
      });
      toast.success("Dashboard saved · subscribers see this on next load");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset to defaults? Your text + colour overrides will be cleared.")) return;
    try {
      await api.post("/admin/dashboard/config/reset");
      toast.success("Reset to defaults");
      await load();
    } catch { toast.error("Reset failed"); }
  };

  const sortedSections = useMemo(() => (cfg?.sections || []).slice().sort((a, b) => a.order - b.order), [cfg]);

  if (loading || !cfg) {
    return <div className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard editor…</div>;
  }

  return (
    <div className="space-y-6" data-testid="admin-dashboard-editor">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Content & design</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-1">Subscriber dashboard</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Reorder sections, hide what's not relevant, edit headings and tagline, and override card colours. Changes apply to every subscriber's dashboard immediately.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={reset} variant="outline" className="rounded-full" data-testid="reset-config">
            <RotateCcw className="h-4 w-4 mr-2" /> Reset
          </Button>
          <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90 font-semibold" data-testid="save-config">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* ─── Layout & visibility ─── */}
        <section className="rounded-2xl border border-border bg-card p-5" data-testid="sections-panel">
          <div className="flex items-center gap-2">
            <Layout className="h-4 w-4 text-primary" />
            <h2 className="font-display font-extrabold text-lg">Layout & visibility</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Drag-up / drag-down to reorder. Eye toggle hides a card.</p>
          <ul className="mt-4 space-y-2">
            {sortedSections.map((sec, idx) => (
              <li key={sec.id} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5" data-testid={`section-${sec.id}`}>
                <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground w-6">#{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{sec.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">id: {sec.id}</p>
                </div>
                <button onClick={() => setSection(sec.id, { visible: !sec.visible })} className="h-8 w-8 rounded-full hover:bg-accent inline-flex items-center justify-center" data-testid={`toggle-${sec.id}`} title={sec.visible ? "Hide" : "Show"}>
                  {sec.visible ? <Eye className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="h-8 w-8 rounded-full hover:bg-accent inline-flex items-center justify-center disabled:opacity-30" data-testid={`up-${sec.id}`}>
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button onClick={() => move(idx, 1)} disabled={idx === sortedSections.length - 1} className="h-8 w-8 rounded-full hover:bg-accent inline-flex items-center justify-center disabled:opacity-30" data-testid={`down-${sec.id}`}>
                  <ArrowDown className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ─── Text content ─── */}
        <section className="rounded-2xl border border-border bg-card p-5" data-testid="texts-panel">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-primary" />
            <h2 className="font-display font-extrabold text-lg">Text content</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Edit any heading or copy that shows on the subscriber dashboard.</p>
          <div className="mt-4 space-y-3">
            {Object.entries(TEXT_LABELS).map(([k, m]) => (
              <div key={k}>
                <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{m.label}</label>
                <Input
                  value={cfg.texts?.[k] ?? ""}
                  onChange={(e) => setText(k, e.target.value)}
                  className="mt-1.5 h-10"
                  placeholder={m.hint}
                  data-testid={`text-${k}`}
                />
                <p className="text-[10px] text-muted-foreground mt-1">{m.hint}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Colours ─── */}
        <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2" data-testid="colors-panel">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            <h2 className="font-display font-extrabold text-lg">Card colour overrides</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Leave blank to use the theme. Set hex colours for granular control.</p>
          <div className="mt-4 grid md:grid-cols-2 gap-4">
            {Object.entries(COLOR_LABELS).map(([k, m]) => (
              <div key={k}>
                <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{m.label}</label>
                <div className="mt-1.5 flex gap-2 items-center">
                  <input
                    type="color"
                    value={cfg.colors?.[k] || "#a02323"}
                    onChange={(e) => setColor(k, e.target.value)}
                    className="h-10 w-12 rounded-lg border border-input bg-background cursor-pointer"
                    data-testid={`color-picker-${k}`}
                  />
                  <Input
                    value={cfg.colors?.[k] ?? ""}
                    onChange={(e) => setColor(k, e.target.value)}
                    placeholder={m.placeholder}
                    className="h-10 flex-1 font-mono text-sm"
                    data-testid={`color-text-${k}`}
                  />
                  {cfg.colors?.[k] && (
                    <button onClick={() => setColor(k, "")} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline" data-testid={`clear-${k}`}>
                      clear
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl bg-muted/40 border border-border p-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Tip — leave the wallet colours blank to inherit the brand theme. Override only if you want a special look for a campaign.</span>
          </div>
        </section>
      </div>
    </div>
  );
}
