import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import {
  Star, ArrowUp, ArrowDown, Eye, EyeOff, Save, RotateCcw, Loader2,
  Trash2, Plus, Upload, Image as ImageIcon, Quote,
} from "lucide-react";

const blankItem = () => ({
  id: "",
  name: "",
  role: "",
  quote: "",
  image_url: "",
  rating: 5,
  visible: true,
});

// ~1.4 MB base64 cap (server allows ~1.5 MB, leave a margin)
const MAX_IMAGE_BYTES = 1_400_000;

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

export default function AdminTestimonials() {
  const [items, setItems] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileInputs = useRef({});

  const load = async () => {
    try {
      const r = await api.get("/admin/testimonials");
      setItems(r.data?.items || []);
    } catch {
      toast.error("Could not load testimonials");
      setItems([]);
    }
  };

  useEffect(() => { load(); }, []);

  const update = (idx, patch) => {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const move = (idx, delta) => {
    setItems((arr) => {
      const next = [...arr];
      const ni = idx + delta;
      if (ni < 0 || ni >= next.length) return arr;
      [next[idx], next[ni]] = [next[ni], next[idx]];
      return next;
    });
  };

  const remove = (idx) => {
    setItems((arr) => arr.filter((_, i) => i !== idx));
  };

  const add = () => {
    setItems((arr) => [...arr, blankItem()]);
  };

  const onImageFile = async (idx, file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image file");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image too large (max ~1.4 MB)");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      update(idx, { image_url: dataUrl });
      toast.success("Image attached");
    } catch {
      toast.error("Could not read image file");
    }
  };

  const save = async () => {
    // Frontend validation
    for (const [i, it] of items.entries()) {
      if (!it.name?.trim()) return toast.error(`Row ${i + 1}: name is required`);
      if (!it.quote?.trim()) return toast.error(`Row ${i + 1}: quote is required`);
    }
    setSaving(true);
    try {
      const payload = {
        items: items.map((it, i) => ({
          id: it.id || undefined,
          name: it.name.trim(),
          role: (it.role || "").trim(),
          quote: it.quote.trim(),
          image_url: it.image_url || "",
          rating: Math.max(1, Math.min(5, Number(it.rating) || 5)),
          order: i,
          visible: it.visible !== false,
        })),
      };
      const r = await api.put("/admin/testimonials", payload);
      setItems(r.data?.items || []);
      toast.success("Testimonials saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset to default testimonials? Your edits will be lost.")) return;
    try {
      const r = await api.post("/admin/testimonials/reset");
      setItems(r.data?.items || []);
      toast.success("Reset to defaults");
    } catch {
      toast.error("Reset failed");
    }
  };

  if (items === null) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground" data-testid="admin-testimonials-loading">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading testimonials…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="admin-testimonials">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Content</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-1 leading-tight">
            Testimonials
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            What subscribers say — shown on the landing page. Reorder, hide, edit text, swap images.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={reset} data-testid="testimonials-reset-btn">
            <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
          </Button>
          <Button variant="outline" onClick={add} data-testid="testimonials-add-btn">
            <Plus className="h-4 w-4 mr-1.5" /> Add testimonial
          </Button>
          <Button onClick={save} disabled={saving} data-testid="testimonials-save-btn">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="rounded-3xl border border-dashed border-border p-10 text-center" data-testid="testimonials-empty">
          <Quote className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">No testimonials yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Add one to start building social proof on the homepage.
          </p>
          <Button onClick={add} data-testid="testimonials-add-empty-btn">
            <Plus className="h-4 w-4 mr-1.5" /> Add your first testimonial
          </Button>
        </div>
      )}

      {/* List */}
      <div className="space-y-4">
        {items.map((it, idx) => (
          <article
            key={it.id || `new-${idx}`}
            className="rounded-2xl border border-border bg-card p-5 md:p-6"
            data-testid={`testimonial-row-${idx}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">
                #{idx + 1}{!it.visible && " · hidden"}
              </p>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up" data-testid={`testimonial-up-${idx}`}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label="Move down" data-testid={`testimonial-down-${idx}`}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => update(idx, { visible: !it.visible })}
                  aria-label={it.visible ? "Hide" : "Show"}
                  data-testid={`testimonial-visible-${idx}`}
                >
                  {it.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(idx)} aria-label="Delete" data-testid={`testimonial-remove-${idx}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            <div className="grid md:grid-cols-[200px_1fr] gap-5">
              {/* Photo */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Photo</label>
                <div className="relative h-44 w-full rounded-xl bg-muted overflow-hidden flex items-center justify-center border border-border">
                  {it.image_url ? (
                    <img src={it.image_url} alt={it.name || "Testimonial"} className="h-full w-full object-cover" />
                  ) : (
                    <div className="text-center text-muted-foreground text-xs px-3">
                      <ImageIcon className="h-6 w-6 mx-auto mb-1.5 opacity-60" />
                      No photo
                    </div>
                  )}
                </div>
                <input
                  ref={(el) => { fileInputs.current[idx] = el; }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onImageFile(idx, e.target.files?.[0])}
                  data-testid={`testimonial-file-${idx}`}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputs.current[idx]?.click()}
                    data-testid={`testimonial-upload-${idx}`}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                    Upload
                  </Button>
                  {it.image_url && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => update(idx, { image_url: "" })}
                      data-testid={`testimonial-clear-image-${idx}`}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <Input
                  placeholder="…or paste image URL"
                  value={it.image_url?.startsWith("data:") ? "" : (it.image_url || "")}
                  onChange={(e) => update(idx, { image_url: e.target.value })}
                  className="text-xs"
                  data-testid={`testimonial-image-url-${idx}`}
                />
              </div>

              {/* Text fields */}
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Name</label>
                    <Input
                      placeholder="e.g. Priya · Hinjawadi"
                      value={it.name}
                      onChange={(e) => update(idx, { name: e.target.value })}
                      maxLength={80}
                      data-testid={`testimonial-name-${idx}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Role / sub-line</label>
                    <Input
                      placeholder="e.g. Tiffin subscriber"
                      value={it.role || ""}
                      onChange={(e) => update(idx, { role: e.target.value })}
                      maxLength={80}
                      data-testid={`testimonial-role-${idx}`}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Quote</label>
                  <Textarea
                    placeholder="What did they say?"
                    value={it.quote}
                    onChange={(e) => update(idx, { quote: e.target.value })}
                    rows={3}
                    maxLength={600}
                    data-testid={`testimonial-quote-${idx}`}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 text-right">{(it.quote || "").length}/600</p>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-xs font-semibold text-muted-foreground">Rating</label>
                  <div className="flex items-center gap-0.5" data-testid={`testimonial-rating-${idx}`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => update(idx, { rating: n })}
                        className="p-1 hover:scale-110 transition-transform"
                        aria-label={`${n} star${n > 1 ? "s" : ""}`}
                        data-testid={`testimonial-star-${idx}-${n}`}
                      >
                        <Star
                          className={`h-5 w-5 ${n <= (it.rating || 5) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                          strokeWidth={1.5}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Sticky save bar — mobile-friendly */}
      {items.length > 0 && (
        <div className="sticky bottom-4 z-20 flex justify-end">
          <Button size="lg" onClick={save} disabled={saving} className="shadow-lg" data-testid="testimonials-save-sticky">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
