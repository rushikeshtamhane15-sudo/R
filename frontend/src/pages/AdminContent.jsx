import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Save, RotateCcw, ArrowLeft } from "lucide-react";

// Declarative schemas — simple, matches DEFAULT_CONTENT on backend
const SCHEMAS = {
  footer: {
    title: "Footer",
    description: "Shown at the bottom of every page.",
    fields: [
      { key: "copyright", label: "Copyright line", type: "input" },
      { key: "tagline", label: "Tagline", type: "input" },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    description: "Public page at /privacy — write your full policy here.",
    fields: [
      { key: "title", label: "Page title", type: "input" },
      { key: "last_updated", label: "Last updated date (e.g., Feb 2026)", type: "input" },
      { key: "body", label: "Body text", type: "textarea", rows: 18 },
    ],
  },
  refund: {
    title: "Refund Policy",
    description: "Public page at /refund — write your full refund policy here.",
    fields: [
      { key: "title", label: "Page title", type: "input" },
      { key: "last_updated", label: "Last updated date", type: "input" },
      { key: "body", label: "Body text", type: "textarea", rows: 18 },
    ],
  },
  contact: {
    title: "Contact Us",
    description: "Public page at /contact — update address, map, phone, email.",
    fields: [
      { key: "title", label: "Page title", type: "input" },
      { key: "intro", label: "Intro paragraph", type: "textarea", rows: 3 },
      { key: "company", label: "Company name", type: "input" },
      { key: "address", label: "Full address (use new lines)", type: "textarea", rows: 3 },
      { key: "phone", label: "Phone", type: "input" },
      { key: "email", label: "Email", type: "input" },
      { key: "hours", label: "Business hours", type: "input" },
      { key: "map_embed_src", label: "Google Maps embed URL (from Share → Embed a map → iframe src)", type: "textarea", rows: 3 },
    ],
  },
};

export default function AdminContent() {
  const { contentKey } = useParams();
  const navigate = useNavigate();
  const schema = SCHEMAS[contentKey];
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!schema) return;
    (async () => {
      try { const r = await api.get(`/content/${contentKey}`); setData(r.data); }
      catch { toast.error("Failed to load content"); }
    })();
  }, [contentKey, schema]);

  if (!schema) return <div className="text-muted-foreground">Unknown content key.</div>;
  if (!data) return <div className="text-muted-foreground">Loading…</div>;

  const update = (k, v) => setData({ ...data, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/admin/content/${contentKey}`, { data });
      toast.success("Saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset this page to default content?")) return;
    try {
      const r = await api.post(`/admin/content/${contentKey}/reset`);
      setData(r.data);
      toast.success("Reset to default");
    } catch (e) { toast.error("Reset failed"); }
  };

  return (
    <div data-testid={`admin-content-${contentKey}`}>
      <Link to="/admin" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> Back to admin</Link>
      <p className="text-xs tracking-overline uppercase font-bold text-secondary mt-4">Admin · Content</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Edit: {schema.title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{schema.description}</p>

      <div className="mt-6 bg-card rounded-2xl border border-border p-6 space-y-5">
        {schema.fields.map((f) => (
          <div key={f.key}>
            <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{f.label}</label>
            {f.type === "textarea" ? (
              <Textarea
                rows={f.rows || 5}
                value={data[f.key] ?? ""}
                onChange={(e) => update(f.key, e.target.value)}
                className="mt-2 rounded-xl"
                data-testid={`field-${f.key}`}
              />
            ) : (
              <Input
                value={data[f.key] ?? ""}
                onChange={(e) => update(f.key, e.target.value)}
                className="mt-2 rounded-xl"
                data-testid={`field-${f.key}`}
              />
            )}
          </div>
        ))}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="save-content-button">
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={reset} variant="outline" className="rounded-full" data-testid="reset-content-button">
            <RotateCcw className="h-4 w-4 mr-2" /> Reset to default
          </Button>
          {contentKey !== "footer" && (
            <Button onClick={() => navigate(`/${contentKey}`)} variant="outline" className="rounded-full">
              Preview page →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
