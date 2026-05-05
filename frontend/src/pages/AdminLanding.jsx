import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Save, Plus, Trash2, MoveUp, MoveDown, RotateCcw } from "lucide-react";

export default function AdminLanding() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => { try { const r = await api.get("/content/landing"); setData(r.data); } catch {} })(); }, []);

  if (!data) return <div className="text-muted-foreground">Loading…</div>;

  const update = (patch) => setData({ ...data, ...patch });
  const sections = data.sections || [];
  const setSections = (s) => update({ sections: s });

  const addSection = () => setSections([...sections, { heading: "New section", body: "", image_url: "", align: "left" }]);
  const editSection = (i, patch) => setSections(sections.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const removeSection = (i) => setSections(sections.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  };

  const save = async () => {
    setSaving(true);
    try { await api.post("/admin/content/landing", { data }); toast.success("Landing saved"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset landing page to defaults?")) return;
    try { const r = await api.post("/admin/content/landing/reset"); setData(r.data); toast.success("Reset"); } catch {}
  };

  return (
    <div data-testid="admin-landing-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Landing</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Home page editor</h1>
      <p className="text-muted-foreground mt-2 text-sm">Edit the hero, change the background image, and add your own sections at the bottom.</p>

      <div className="mt-6 space-y-5">
        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Hero</p>
          <Field label="Overline (small text above title)"><Input value={data.hero_overline || ""} onChange={(e) => update({ hero_overline: e.target.value })} data-testid="hero-overline" /></Field>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Title line 1"><Input value={data.hero_title_line1 || ""} onChange={(e) => update({ hero_title_line1: e.target.value })} data-testid="hero-title-1" /></Field>
            <Field label="Title line 2"><Input value={data.hero_title_line2 || ""} onChange={(e) => update({ hero_title_line2: e.target.value })} data-testid="hero-title-2" /></Field>
          </div>
          <Field label="Subtitle"><Textarea rows={3} value={data.hero_subtitle || ""} onChange={(e) => update({ hero_subtitle: e.target.value })} data-testid="hero-subtitle" /></Field>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Primary button label"><Input value={data.hero_cta_primary || ""} onChange={(e) => update({ hero_cta_primary: e.target.value })} data-testid="hero-cta-primary" /></Field>
            <Field label="Secondary button label"><Input value={data.hero_cta_secondary || ""} onChange={(e) => update({ hero_cta_secondary: e.target.value })} data-testid="hero-cta-secondary" /></Field>
          </div>
          <Field label="Hero background image URL">
            <Input value={data.hero_image_url || ""} onChange={(e) => update({ hero_image_url: e.target.value })} data-testid="hero-image-url" placeholder="https://…" />
            {data.hero_image_url && <img src={data.hero_image_url} alt="hero" className="mt-3 h-40 rounded-xl object-cover w-full" />}
          </Field>
        </div>

        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Custom sections</p>
            <Button onClick={addSection} size="sm" className="rounded-full bg-primary hover:bg-primary/90" data-testid="add-section-button"><Plus className="h-3.5 w-3.5 mr-1.5" /> Add section</Button>
          </div>

          {sections.length === 0 && <p className="text-sm text-muted-foreground mt-4">No custom sections yet. Click "Add section" to create one.</p>}

          <div className="mt-4 space-y-4">
            {sections.map((s, i) => (
              <div key={i} className="rounded-xl border border-border p-4 space-y-3" data-testid={`section-${i}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Section #{i + 1}</span>
                  <div className="flex gap-1">
                    <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => move(i, -1)} disabled={i === 0}><MoveUp className="h-3 w-3" /></Button>
                    <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => move(i, +1)} disabled={i === sections.length - 1}><MoveDown className="h-3 w-3" /></Button>
                    <Button size="icon" variant="outline" className="h-7 w-7 rounded-full text-destructive hover:text-destructive" onClick={() => removeSection(i)} data-testid={`remove-section-${i}`}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
                <Field label="Heading"><Input value={s.heading || ""} onChange={(e) => editSection(i, { heading: e.target.value })} data-testid={`section-heading-${i}`} /></Field>
                <Field label="Body"><Textarea rows={4} value={s.body || ""} onChange={(e) => editSection(i, { body: e.target.value })} data-testid={`section-body-${i}`} /></Field>
                <Field label="Image URL (optional)"><Input value={s.image_url || ""} onChange={(e) => editSection(i, { image_url: e.target.value })} data-testid={`section-image-${i}`} placeholder="https://…" /></Field>
                <Field label="Image alignment">
                  <select
                    value={s.align || "left"}
                    onChange={(e) => editSection(i, { align: e.target.value })}
                    className="h-9 rounded-xl border border-input px-3 text-sm bg-background"
                    data-testid={`section-align-${i}`}
                  >
                    <option value="left">Image left</option>
                    <option value="right">Image right</option>
                    <option value="none">No image (full width)</option>
                  </select>
                </Field>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="save-landing-button">
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save landing"}
          </Button>
          <Button onClick={reset} variant="outline" className="rounded-full"><RotateCcw className="h-4 w-4 mr-2" /> Reset to default</Button>
          <a href="/" target="_blank" rel="noreferrer"><Button variant="outline" className="rounded-full">Preview home →</Button></a>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{label}</label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
