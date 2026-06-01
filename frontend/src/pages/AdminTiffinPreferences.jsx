import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Save, Plus, Trash2, ArrowUp, ArrowDown, Image as ImageIcon, RotateCw, Loader2 } from "lucide-react";

/**
 * AdminTiffinPreferences — admin CMS for the tiffin food-preference catalog.
 * Lets admin add/remove items, upload preview images, change emoji + label,
 * reorder, toggle active. The 4 defaults (rice/dal/chapati/sabji) are
 * pre-seeded and editable; custom items can be added below them.
 */
const BLANK = { key: "", label: "", emoji: "", image_url: "", description: "", active: true, order: 100 };

export default function AdminTiffinPreferences() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/tiffin-preferences/catalog");
      setItems(r.data?.items || []);
    } catch (e) { toast.error("Load failed"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const update = (idx, patch) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const remove = (idx) => setItems(items.filter((_, i) => i !== idx));
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[idx], next[j]] = [next[j], next[idx]];
    setItems(next.map((it, i) => ({ ...it, order: i })));
  };
  const add = () => setItems([...items, { ...BLANK, order: items.length }]);

  const upload = async (idx, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast.error("Max 4 MB"); return; }
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await api.post("/admin/tiffin-preferences/upload-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
      update(idx, { image_url: r.data.url });
      toast.success("Uploaded");
    } catch (err) { toast.error(err?.response?.data?.detail || "Upload failed"); }
    e.target.value = "";
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/tiffin-preferences/catalog", { items: items.map((it, i) => ({ ...it, order: i })) });
      toast.success("Saved");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset to factory defaults? Your custom items will be lost.")) return;
    try { await api.post("/admin/tiffin-preferences/reset"); toast.success("Reset"); load(); }
    catch (e) { toast.error("Reset failed"); }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-tiffin-prefs">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">CMS</p>
          <h1 className="font-display font-extrabold text-3xl mt-1">Tiffin food preferences</h1>
          <p className="text-sm text-muted-foreground mt-1">Edit text, icons, images and add custom items shown on the subscriber dashboard.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} className="rounded-full" data-testid="pref-reset">
            <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Reset
          </Button>
          <Button onClick={save} disabled={saving} className="rounded-full" data-testid="pref-save">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />} Save
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-3">
          {items.map((it, idx) => (
            <div key={idx} className="rounded-2xl border border-border bg-card p-4 sm:p-5 grid grid-cols-1 md:grid-cols-[88px_1fr_auto] gap-4 items-center" data-testid={`pref-row-${idx}`}>
              <div className="text-center">
                {it.image_url ? (
                  <img src={it.image_url} alt="" className="h-16 w-16 rounded-xl object-cover mx-auto border border-border" />
                ) : (
                  <span aria-hidden className="text-4xl block">{it.emoji || "🍽"}</span>
                )}
                <label className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-input cursor-pointer hover:bg-muted">
                  <ImageIcon className="h-3 w-3" /> Upload
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(idx, e)} />
                </label>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="block">
                  <span className="text-[9px] tracking-overline uppercase font-bold text-muted-foreground">Key (lowercase, _)</span>
                  <Input value={it.key} onChange={(e) => update(idx, { key: e.target.value })} className="mt-1 h-8 text-xs" data-testid={`pref-key-${idx}`} />
                </label>
                <label className="block">
                  <span className="text-[9px] tracking-overline uppercase font-bold text-muted-foreground">Label</span>
                  <Input value={it.label} onChange={(e) => update(idx, { label: e.target.value })} className="mt-1 h-8 text-xs" data-testid={`pref-label-${idx}`} />
                </label>
                <label className="block">
                  <span className="text-[9px] tracking-overline uppercase font-bold text-muted-foreground">Emoji (fallback)</span>
                  <Input value={it.emoji || ""} onChange={(e) => update(idx, { emoji: e.target.value })} className="mt-1 h-8 text-xs" maxLength={4} />
                </label>
                <label className="flex items-center gap-2 mt-4">
                  <input type="checkbox" checked={it.active !== false} onChange={(e) => update(idx, { active: e.target.checked })} className="h-4 w-4" data-testid={`pref-active-${idx}`} />
                  <span className="text-xs font-semibold">Active</span>
                </label>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(idx, +1)} disabled={idx === items.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(idx)} data-testid={`pref-remove-${idx}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
          <Button variant="outline" onClick={add} className="w-full rounded-2xl border-dashed h-12" data-testid="pref-add">
            <Plus className="h-4 w-4 mr-1.5" /> Add custom preference
          </Button>
        </div>
      )}
    </div>
  );
}
