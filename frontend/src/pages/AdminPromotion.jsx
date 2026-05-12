import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Save, Upload, Sparkles, Power, PowerOff, Image as ImageIcon } from "lucide-react";

const DEFAULT = {
  active: false,
  title: "",
  body: "",
  image_url: "",
  cta_label: "Order now",
  cta_link: "/restaurant",
  accent_color: "#b91c1c",
  image_prompt: "",
};

// Resolve relative /api/uploads/... URLs to absolute against REACT_APP_BACKEND_URL
const absUrl = (u) => {
  if (!u) return "";
  if (/^https?:\/\//.test(u)) return u;
  return `${process.env.REACT_APP_BACKEND_URL || ""}${u}`;
};

/**
 * Admin — landing-page promotional popup editor.
 *
 * Capabilities:
 *   • Edit title / body / CTA label + link / accent colour
 *   • Upload a custom image (multipart)
 *   • Generate a 3D image via Gemini Nano Banana from a free-text prompt
 *   • Start / Stop the popup (the public endpoint only ships when active)
 */
export default function AdminPromotion() {
  const [promo, setPromo] = useState(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const r = await api.get("/admin/landing-promotion");
      setPromo({ ...DEFAULT, ...(r.data?.promotion || {}) });
    } catch { toast.error("Could not load promotion"); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/admin/landing-promotion", promo);
      setPromo({ ...DEFAULT, ...(r.data?.promotion || {}) });
      toast.success("Saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const toggleActive = async () => {
    try {
      const path = promo.active ? "/admin/landing-promotion/stop" : "/admin/landing-promotion/start";
      await api.post(path);
      setPromo((p) => ({ ...p, active: !p.active }));
      toast.success(promo.active ? "Popup stopped" : "Popup started");
    } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
  };

  const onUpload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Pick an image");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/admin/landing-promotion/upload-image", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPromo((p) => ({ ...p, image_url: r.data?.url || p.image_url }));
      toast.success("Image uploaded");
    } catch (e) { toast.error(e?.response?.data?.detail || "Upload failed"); }
    finally { setUploading(false); }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await api.post("/admin/landing-promotion/generate-image", {
        prompt: promo.image_prompt || undefined,
      });
      const updated = r.data?.promotion;
      if (updated) setPromo({ ...DEFAULT, ...updated });
      else if (r.data?.url) setPromo((p) => ({ ...p, image_url: r.data.url }));
      toast.success("3D image generated");
    } catch (e) { toast.error(e?.response?.data?.detail || "Generation failed"); }
    finally { setGenerating(false); }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8" data-testid="admin-promotion-page">
      <div className="flex items-end justify-between gap-3 mb-6">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Landing popup
          </p>
          <h1 className="font-display font-extrabold text-3xl tracking-tight mt-1">Promotional offer</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Auto-opens on landing once per visitor session. Start/stop anytime.
          </p>
        </div>
        <Button
          onClick={toggleActive}
          variant={promo.active ? "destructive" : "default"}
          data-testid="admin-promo-toggle-active"
          className="flex-shrink-0"
        >
          {promo.active ? (<><PowerOff className="h-4 w-4 mr-1.5" /> Stop</>) : (<><Power className="h-4 w-4 mr-1.5" /> Start</>)}
        </Button>
      </div>

      <div className="surface-3d bg-card rounded-2xl border border-border p-5 sm:p-6 space-y-4">
        <div>
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Title</label>
          <Input
            value={promo.title}
            onChange={(e) => setPromo({ ...promo, title: e.target.value })}
            maxLength={120}
            data-testid="admin-promo-title"
            className="mt-1.5 rounded-xl"
            placeholder="🎉 Welcome offer"
          />
        </div>
        <div>
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Body</label>
          <Textarea
            value={promo.body}
            onChange={(e) => setPromo({ ...promo, body: e.target.value })}
            maxLength={400}
            rows={3}
            data-testid="admin-promo-body"
            className="mt-1.5 rounded-xl"
            placeholder="Use code FRESH10 for 10% off your first order."
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">CTA label</label>
            <Input value={promo.cta_label} onChange={(e) => setPromo({ ...promo, cta_label: e.target.value })} maxLength={40} className="mt-1.5 rounded-xl" data-testid="admin-promo-cta-label" />
          </div>
          <div>
            <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">CTA link</label>
            <Input value={promo.cta_link} onChange={(e) => setPromo({ ...promo, cta_link: e.target.value })} maxLength={400} className="mt-1.5 rounded-xl" data-testid="admin-promo-cta-link" />
          </div>
          <div>
            <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Accent color</label>
            <Input value={promo.accent_color} onChange={(e) => setPromo({ ...promo, accent_color: e.target.value })} maxLength={12} className="mt-1.5 rounded-xl font-mono" data-testid="admin-promo-accent" placeholder="#b91c1c" />
          </div>
        </div>

        {/* Image */}
        <div>
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <ImageIcon className="h-3 w-3" /> Image (uploaded or AI-generated)
          </label>
          <div className="mt-2 flex flex-wrap gap-3 items-start">
            <div className="h-28 w-44 rounded-xl border-2 border-dashed border-border bg-muted/40 overflow-hidden flex items-center justify-center" data-testid="admin-promo-image-preview">
              {promo.image_url ? (
                <img src={absUrl(promo.image_url)} alt="promo" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-7 w-7 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2 flex-1 min-w-[200px]">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => onUpload(e.target.files?.[0])}
                className="hidden"
                data-testid="admin-promo-upload-input"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                data-testid="admin-promo-upload-btn"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Upload className="h-4 w-4 mr-1.5" />}
                Upload image
              </Button>
              <Textarea
                value={promo.image_prompt}
                onChange={(e) => setPromo({ ...promo, image_prompt: e.target.value })}
                maxLength={400}
                rows={2}
                data-testid="admin-promo-image-prompt"
                className="rounded-xl"
                placeholder="3D prompt: e.g. festive thali on saffron silk, marigolds, golden bokeh"
              />
              <Button
                type="button"
                variant="default"
                onClick={generate}
                disabled={generating}
                data-testid="admin-promo-generate-btn"
                className="bg-primary hover:bg-primary/90"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                Generate 3D image
              </Button>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Status: <b className={promo.active ? "text-emerald-700" : "text-muted-foreground"}>{promo.active ? "Live" : "Stopped"}</b>
          </p>
          <Button onClick={save} disabled={saving} data-testid="admin-promo-save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
