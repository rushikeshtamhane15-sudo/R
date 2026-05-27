import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Save, Plus, Trash2, MoveUp, MoveDown, RotateCcw } from "lucide-react";

const ICON_OPTIONS = [
  "BadgeCheck", "Wheat", "Sprout", "Soup", "Carrot", "Droplet", "Ban",
  "Smartphone", "Wallet", "QrCode", "ShieldCheck", "Utensils", "TrendingUp", "Sparkles", "Heart", "Leaf",
];
const BG_OPTIONS = [
  { value: "green", label: "Green (default)" },
  { value: "red", label: "Brand red" },
  { value: "blue", label: "Blue" },
  { value: "amber", label: "Amber" },
];

export default function AdminLanding() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/content/landing"); setData(r.data); } catch {}
    })();
  }, []);

  if (!data) return <div className="text-muted-foreground">Loading…</div>;

  const update = (patch) => setData({ ...data, ...patch });
  const updateList = (key, list) => update({ [key]: list });

  const save = async () => {
    setSaving(true);
    try { await api.post("/admin/content/landing", { data }); toast.success("Landing saved"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset landing page to defaults? This will overwrite ALL home page content.")) return;
    try { const r = await api.post("/admin/content/landing/reset"); setData(r.data); toast.success("Reset"); } catch {}
  };

  return (
    <div data-testid="admin-landing-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Landing</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Home page editor</h1>
      <p className="text-muted-foreground mt-2 text-sm">Edit every block on the home page — text, images, icons, and the green "100% the good stuff" colour.</p>

      <div className="mt-6 space-y-5">
        {/* Hero */}
        <Card title="Hero" description="The big top section visitors see first.">
          <Field label="Overline (small text above title)"><Input value={data.hero_overline || ""} onChange={(e) => update({ hero_overline: e.target.value })} /></Field>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Title line 1"><Input value={data.hero_title_line1 || ""} onChange={(e) => update({ hero_title_line1: e.target.value })} /></Field>
            <Field label="Title line 2"><Input value={data.hero_title_line2 || ""} onChange={(e) => update({ hero_title_line2: e.target.value })} /></Field>
          </div>
          <Field label="Subtitle"><Textarea rows={3} value={data.hero_subtitle || ""} onChange={(e) => update({ hero_subtitle: e.target.value })} /></Field>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Primary button label"><Input value={data.hero_cta_primary || ""} onChange={(e) => update({ hero_cta_primary: e.target.value })} /></Field>
            <Field label="Secondary button label"><Input value={data.hero_cta_secondary || ""} onChange={(e) => update({ hero_cta_secondary: e.target.value })} /></Field>
          </div>
          <ImageField label="Hero background image" value={data.hero_image_url} onChange={(v) => update({ hero_image_url: v })} />
        </Card>

        {/* How it works */}
        <Card title="How it works" description="The 4-step explainer with two side images.">
          <Field label="Overline"><Input value={data.how_overline || ""} onChange={(e) => update({ how_overline: e.target.value })} /></Field>
          <Field label="Title"><Textarea rows={2} value={data.how_title || ""} onChange={(e) => update({ how_title: e.target.value })} /></Field>
          <Field label="Body"><Textarea rows={3} value={data.how_body || ""} onChange={(e) => update({ how_body: e.target.value })} /></Field>
          <div className="grid md:grid-cols-2 gap-3">
            <ImageField label="Image 1 URL" value={data.how_image_1} onChange={(v) => update({ how_image_1: v })} />
            <ImageField label="Image 2 URL" value={data.how_image_2} onChange={(v) => update({ how_image_2: v })} />
          </div>
          <ListEditor
            title="Features (bullet list)"
            items={data.how_features || []}
            onChange={(list) => updateList("how_features", list)}
            template={{ icon: "Smartphone", title: "New feature", body: "Describe it." }}
            renderItem={(item, onChange) => (
              <>
                <Field label="Icon"><IconSelect value={item.icon} onChange={(v) => onChange({ icon: v })} /></Field>
                <Field label="Title"><Input value={item.title || ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
                <Field label="Body"><Input value={item.body || ""} onChange={(e) => onChange({ body: e.target.value })} /></Field>
              </>
            )}
          />
        </Card>

        {/* Features band */}
        <Card title="Features band" description="Three feature cards with icons — usually in a green/accent strip.">
          <Field label="Overline"><Input value={data.band_overline || ""} onChange={(e) => update({ band_overline: e.target.value })} /></Field>
          <Field label="Title"><Input value={data.band_title || ""} onChange={(e) => update({ band_title: e.target.value })} /></Field>
          <ListEditor
            title="Cards"
            items={data.band_items || []}
            onChange={(list) => updateList("band_items", list)}
            template={{ icon: "Utensils", title: "New card", body: "Describe it." }}
            renderItem={(item, onChange) => (
              <>
                <Field label="Icon"><IconSelect value={item.icon} onChange={(v) => onChange({ icon: v })} /></Field>
                <Field label="Title"><Input value={item.title || ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
                <Field label="Body"><Input value={item.body || ""} onChange={(e) => onChange({ body: e.target.value })} /></Field>
              </>
            )}
          />
        </Card>

        {/* Healthy promise */}
        <Card title="Kitchen promise (0% / 100%)" description="The two-column 'NOT in your tiffin' vs 'always in your tiffin' section.">
          <Field label="Overline"><Input value={data.healthy_overline || ""} onChange={(e) => update({ healthy_overline: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground -mt-1">Title is split into 5 parts so you can highlight any words in brand colour:</p>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Title — part 1 (plain)"><Input value={data.healthy_title_part_1 || ""} onChange={(e) => update({ healthy_title_part_1: e.target.value })} /></Field>
            <Field label="Title — highlight 1 (coloured)"><Input value={data.healthy_title_highlight_1 || ""} onChange={(e) => update({ healthy_title_highlight_1: e.target.value })} /></Field>
            <Field label="Title — part 2 (plain)"><Input value={data.healthy_title_part_2 || ""} onChange={(e) => update({ healthy_title_part_2: e.target.value })} /></Field>
            <Field label="Title — highlight 2 (coloured)"><Input value={data.healthy_title_highlight_2 || ""} onChange={(e) => update({ healthy_title_highlight_2: e.target.value })} /></Field>
            <Field label="Title — part 3 (plain)"><Input value={data.healthy_title_part_3 || ""} onChange={(e) => update({ healthy_title_part_3: e.target.value })} /></Field>
          </div>
          <Field label="Subtitle"><Textarea rows={3} value={data.healthy_subtitle || ""} onChange={(e) => update({ healthy_subtitle: e.target.value })} /></Field>

          <div className="grid lg:grid-cols-2 gap-5 mt-2">
            <div className="bg-muted/40 rounded-xl p-4 space-y-3">
              <p className="text-xs tracking-overline uppercase font-bold text-destructive">Never card</p>
              <Field label="Small label"><Input value={data.healthy_never_title || ""} onChange={(e) => update({ healthy_never_title: e.target.value })} /></Field>
              <Field label="Big heading"><Input value={data.healthy_never_heading || ""} onChange={(e) => update({ healthy_never_heading: e.target.value })} /></Field>
              <ListEditor
                compact
                title="0% items"
                items={data.healthy_never_items || []}
                onChange={(list) => updateList("healthy_never_items", list)}
                template={{ label: "New item", note: "Why we avoid it" }}
                renderItem={(item, onChange) => (
                  <>
                    <Field label="Label"><Input value={item.label || ""} onChange={(e) => onChange({ label: e.target.value })} /></Field>
                    <Field label="Note"><Input value={item.note || ""} onChange={(e) => onChange({ note: e.target.value })} /></Field>
                  </>
                )}
              />
            </div>

            <div className="bg-muted/40 rounded-xl p-4 space-y-3">
              <p className="text-xs tracking-overline uppercase font-bold text-emerald-700">Always card</p>
              <Field label="Card background colour">
                <select
                  value={data.healthy_always_bg || "green"}
                  onChange={(e) => update({ healthy_always_bg: e.target.value })}
                  className="h-9 rounded-xl border border-input px-3 text-sm bg-background"
                  data-testid="healthy-always-bg-select"
                >
                  {BG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Small label"><Input value={data.healthy_always_title || ""} onChange={(e) => update({ healthy_always_title: e.target.value })} /></Field>
              <Field label="Big heading"><Input value={data.healthy_always_heading || ""} onChange={(e) => update({ healthy_always_heading: e.target.value })} /></Field>
              <ListEditor
                compact
                title="100% items"
                items={data.healthy_always_items || []}
                onChange={(list) => updateList("healthy_always_items", list)}
                template={{ icon: "BadgeCheck", label: "New item", note: "Why we love it" }}
                renderItem={(item, onChange) => (
                  <>
                    <Field label="Icon"><IconSelect value={item.icon} onChange={(v) => onChange({ icon: v })} /></Field>
                    <Field label="Label"><Input value={item.label || ""} onChange={(e) => onChange({ label: e.target.value })} /></Field>
                    <Field label="Note"><Input value={item.note || ""} onChange={(e) => onChange({ note: e.target.value })} /></Field>
                  </>
                )}
              />
            </div>
          </div>
        </Card>

        {/* Final CTA */}
        <Card title="Bottom CTA" description="The big red call-to-action just above the footer.">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Title — line 1"><Input value={data.cta_title_line1 || ""} onChange={(e) => update({ cta_title_line1: e.target.value })} /></Field>
            <Field label="Title — line 2"><Input value={data.cta_title_line2 || ""} onChange={(e) => update({ cta_title_line2: e.target.value })} /></Field>
          </div>
          <Field label="Subtitle"><Input value={data.cta_subtitle || ""} onChange={(e) => update({ cta_subtitle: e.target.value })} /></Field>
          <Field label="Button label"><Input value={data.cta_button_label || ""} onChange={(e) => update({ cta_button_label: e.target.value })} /></Field>
        </Card>

        {/* Custom sections */}
        <Card title="Custom sections" description="Add free-form sections anywhere between the kitchen promise and the bottom CTA.">
          <ListEditor
            title="Sections"
            addLabel="Add section"
            items={data.sections || []}
            onChange={(list) => updateList("sections", list)}
            template={{ heading: "New section", body: "", image_url: "", align: "left" }}
            renderItem={(item, onChange) => (
              <>
                <Field label="Heading"><Input value={item.heading || ""} onChange={(e) => onChange({ heading: e.target.value })} /></Field>
                <Field label="Body"><Textarea rows={4} value={item.body || ""} onChange={(e) => onChange({ body: e.target.value })} /></Field>
                <ImageField label="Image URL (optional)" value={item.image_url} onChange={(v) => onChange({ image_url: v })} />
                <Field label="Image alignment">
                  <select
                    value={item.align || "left"}
                    onChange={(e) => onChange({ align: e.target.value })}
                    className="h-9 rounded-xl border border-input px-3 text-sm bg-background"
                  >
                    <option value="left">Image left</option>
                    <option value="right">Image right</option>
                    <option value="none">No image (full width)</option>
                  </select>
                </Field>
              </>
            )}
          />
        </Card>

        <div className="flex flex-wrap gap-2 sticky bottom-3 bg-background/80 backdrop-blur-sm border border-border rounded-2xl p-3 z-10">
          <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="save-landing-button">
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save home page"}
          </Button>
          <Button onClick={reset} variant="outline" className="rounded-full"><RotateCcw className="h-4 w-4 mr-2" /> Reset to default</Button>
          <a href="/" target="_blank" rel="noreferrer"><Button variant="outline" className="rounded-full">Preview home →</Button></a>
        </div>
      </div>
    </div>
  );
}

function Card({ title, description, children }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
      <div>
        <p className="font-display font-bold text-lg leading-none">{title}</p>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </div>
      {children}
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

function ImageField({ label, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Max 5 MB"); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post("/admin/landing/upload-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange(r.data.url);
      toast.success("Uploaded");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally { setBusy(false); e.target.value = ""; }
  };
  return (
    <Field label={label}>
      <div className="flex items-stretch gap-2">
        <Input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="https://… or upload below" className="flex-1" />
        <label className={`inline-flex items-center gap-1.5 px-3 rounded-xl border border-input text-sm font-semibold cursor-pointer ${busy ? "opacity-50 pointer-events-none" : "hover:bg-muted"}`}>
          {busy ? "Uploading…" : "Upload"}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onPick} />
        </label>
      </div>
      {value && <img src={value} alt="" className="mt-2 h-32 w-full object-cover rounded-lg border border-border" />}
    </Field>
  );
}

function IconSelect({ value, onChange }) {
  return (
    <select
      value={value || "BadgeCheck"}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-xl border border-input px-3 text-sm bg-background w-full"
    >
      {ICON_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

function ListEditor({ title, items, onChange, template, renderItem, addLabel = "Add item", compact = false }) {
  const update = (i, patch) => onChange(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => onChange([...items, { ...template }]);

  return (
    <div className={compact ? "" : "bg-muted/30 rounded-xl p-4"}>
      <div className="flex items-center justify-between">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{title}</p>
        <Button onClick={add} size="sm" variant="outline" className="rounded-full h-8">
          <Plus className="h-3.5 w-3.5 mr-1" /> {addLabel}
        </Button>
      </div>
      {items.length === 0 && <p className="text-sm text-muted-foreground mt-3">No items yet.</p>}
      <div className="mt-3 space-y-3">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border border-border p-3 space-y-2 bg-card">
            <div className="flex items-center justify-between">
              <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">#{i + 1}</span>
              <div className="flex gap-1">
                <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => move(i, -1)} disabled={i === 0}><MoveUp className="h-3 w-3" /></Button>
                <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => move(i, 1)} disabled={i === items.length - 1}><MoveDown className="h-3 w-3" /></Button>
                <Button size="icon" variant="outline" className="h-7 w-7 rounded-full text-destructive" onClick={() => remove(i)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            </div>
            {renderItem(it, (patch) => update(i, patch))}
          </div>
        ))}
      </div>
    </div>
  );
}
