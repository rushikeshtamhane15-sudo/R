import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import {
  UtensilsCrossed, Save, Plus, Trash2, ArrowUp, ArrowDown, Eye, EyeOff,
  Upload, Image as ImageIcon, RotateCcw, Loader2, ListOrdered, Sparkles,
} from "lucide-react";

const blank = () => ({
  id: "",
  name: "",
  description: "",
  category: "Mains",
  price: 0,
  discounted_price: null,
  image_url: "",
  active: true,
  sort_order: 100,
});

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB (matches backend)

async function uploadMenuImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await api.post("/admin/restaurant/menu/upload-image", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data?.url || "";
}

const CATEGORIES_FALLBACK = ["Starters", "Mains", "Tiffin Specials", "Beverages", "Desserts"];

export default function AdminRestaurant() {
  const [items, setItems] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileInputs = useRef({});

  // Admin-curated category list (rename / reorder / add / delete here).
  // Saved separately via /api/admin/restaurant/categories. Rename propagates
  // server-side to every menu item using the old name.
  const [categories, setCategories] = useState(CATEGORIES_FALLBACK);
  const [savingCats, setSavingCats] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const load = async () => {
    try {
      const [menuRes, catsRes] = await Promise.all([
        api.get("/admin/restaurant/menu"),
        api.get("/admin/restaurant/categories"),
      ]);
      setItems(menuRes.data?.items || []);
      const cats = catsRes.data?.categories;
      if (Array.isArray(cats) && cats.length) setCategories(cats);
    } catch {
      toast.error("Could not load menu");
      setItems([]);
    }
  };

  useEffect(() => { load(); }, []);

  const update = (idx, patch) => setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const remove = (idx) => setItems((arr) => arr.filter((_, i) => i !== idx));
  const move = (idx, delta) => setItems((arr) => {
    const next = [...arr];
    const ni = idx + delta;
    if (ni < 0 || ni >= next.length) return arr;
    [next[idx], next[ni]] = [next[ni], next[idx]];
    return next;
  });
  const add = () => setItems((arr) => [...arr, blank()]);

  const onImageFile = async (idx, file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please pick an image file");
    if (file.size > MAX_IMAGE_BYTES) return toast.error("Image too large (max 4 MB)");
    try {
      // Upload to backend "object storage" — returns a public URL.
      const url = await uploadMenuImage(file);
      if (!url) throw new Error("upload failed");
      update(idx, { image_url: url });
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not upload image");
    }
  };

  // Index of the row whose 3D image is currently generating, or null.
  const [genBusyIdx, setGenBusyIdx] = useState(null);
  const generateImage = async (idx) => {
    const it = items?.[idx];
    if (!it) return;
    if (!it.name?.trim()) return toast.error("Item needs a name first");
    setGenBusyIdx(idx);
    try {
      const r = await api.post("/admin/restaurant/menu/generate-image", {
        name: it.name,
        category: it.category,
        description: it.description,
      });
      if (r.data?.url) {
        update(idx, { image_url: r.data.url });
        toast.success("3D image generated");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Generation failed");
    } finally {
      setGenBusyIdx(null);
    }
  };

  const save = async () => {
    for (const [i, it] of items.entries()) {
      if (!it.name?.trim()) return toast.error(`Row ${i + 1}: name is required`);
      if (Number(it.price) <= 0) return toast.error(`Row ${i + 1}: price must be > 0`);
    }
    setSaving(true);
    try {
      const payload = {
        items: items.map((it, i) => ({
          id: it.id || undefined,
          name: it.name.trim(),
          description: (it.description || "").trim().slice(0, 500),
          category: (it.category || "Mains").trim(),
          price: Math.max(0, Number(it.price) || 0),
          discounted_price: it.discounted_price === "" || it.discounted_price == null
            ? null
            : Math.max(0, Number(it.discounted_price) || 0),
          image_url: it.image_url || "",
          active: it.active !== false,
          sort_order: Number(it.sort_order) || (i + 1) * 10,
          is_returnable_tiffin: it.is_returnable_tiffin === true,
        })),
      };
      const r = await api.put("/admin/restaurant/menu", payload);
      setItems(r.data?.items || []);
      toast.success("Menu saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset menu to defaults? Custom items and edits will be lost.")) return;
    try {
      const r = await api.post("/admin/restaurant/menu/reset");
      setItems(r.data?.items || []);
      toast.success("Reset to defaults");
    } catch { toast.error("Reset failed"); }
  };

  // --- Category editor handlers ---------------------------------------------
  const moveCat = (idx, delta) => setCategories((arr) => {
    const next = [...arr];
    const ni = idx + delta;
    if (ni < 0 || ni >= next.length) return arr;
    [next[idx], next[ni]] = [next[ni], next[idx]];
    return next;
  });
  const renameCat = (idx, name) => setCategories((arr) => arr.map((c, i) => (i === idx ? name : c)));
  const removeCat = (idx) => {
    const c = categories[idx];
    const inUse = (items || []).some((it) => it.category === c);
    if (inUse && !window.confirm(`Items still use "${c}". Delete anyway? (Items will keep the category name as-is.)`)) return;
    setCategories((arr) => arr.filter((_, i) => i !== idx));
  };
  const addCat = () => {
    const name = (newCatName || "").trim();
    if (!name) return toast.error("Enter a category name");
    if (categories.includes(name)) return toast.error("Already exists");
    setCategories((arr) => [...arr, name]);
    setNewCatName("");
  };
  const saveCategories = async () => {
    setSavingCats(true);
    try {
      const r = await api.put("/admin/restaurant/categories", { categories });
      const saved = r.data?.categories || categories;
      setCategories(saved);
      const renames = r.data?.renames || {};
      const renameCount = Object.keys(renames).length;
      if (renameCount) {
        // Reflect server-side rename propagation in our local items state
        setItems((arr) => (arr || []).map((it) => (renames[it.category] ? { ...it, category: renames[it.category] } : it)));
        toast.success(`Categories saved · ${renameCount} rename(s) propagated to items`);
      } else {
        toast.success("Categories saved");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSavingCats(false); }
  };

  if (items === null) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading menu…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="admin-restaurant">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><UtensilsCrossed className="h-3.5 w-3.5" /> Restaurant</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-1 leading-tight">Online ordering menu</h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            Items shown on <code className="font-mono text-xs">/restaurant</code>. Hide what's not available today, drop a discount, swap photos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={reset} data-testid="restaurant-reset-btn"><RotateCcw className="h-4 w-4 mr-1.5" /> Reset</Button>
          <Button variant="outline" onClick={add} data-testid="restaurant-add-btn"><Plus className="h-4 w-4 mr-1.5" /> Add item</Button>
          <Button onClick={save} disabled={saving} data-testid="restaurant-save-btn">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save
          </Button>
        </div>
      </div>

      {/* === Category editor === reorder · rename · add · delete.
          Sits above the menu rows so admins can shape the storefront's
          category strip without leaving this page. */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="admin-categories-editor">
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">
              <ListOrdered className="h-3.5 w-3.5" /> Categories
            </p>
            <h2 className="font-display font-extrabold text-lg sm:text-xl tracking-tight mt-0.5 leading-tight">
              Reorder & rename
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Drag-order on the storefront strip. Renaming a category here propagates to every item using it.
            </p>
          </div>
          <Button
            onClick={saveCategories}
            disabled={savingCats || !categories.length}
            data-testid="admin-categories-save"
            size="sm"
          >
            {savingCats ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save
          </Button>
        </div>

        <ul className="space-y-2" data-testid="admin-categories-list">
          {categories.map((c, idx) => (
            <li key={`${idx}-${c}`} className="flex items-center gap-1.5" data-testid={`admin-cat-row-${idx}`}>
              <Input
                value={c}
                onChange={(e) => renameCat(idx, e.target.value)}
                className="flex-1 h-9 text-sm"
                maxLength={60}
                data-testid={`admin-cat-name-${idx}`}
              />
              <Button size="icon" variant="ghost" onClick={() => moveCat(idx, -1)} disabled={idx === 0} aria-label="Move up" data-testid={`admin-cat-up-${idx}`}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => moveCat(idx, 1)} disabled={idx === categories.length - 1} aria-label="Move down" data-testid={`admin-cat-down-${idx}`}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => removeCat(idx)} aria-label="Delete" data-testid={`admin-cat-remove-${idx}`}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1.5 mt-3">
          <Input
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="New category name (e.g. Snacks)"
            className="flex-1 h-9 text-sm"
            maxLength={60}
            onKeyDown={(e) => e.key === "Enter" && addCat()}
            data-testid="admin-cat-new-name"
          />
          <Button onClick={addCat} size="sm" variant="outline" data-testid="admin-cat-add">
            <Plus className="h-4 w-4 mr-1.5" /> Add
          </Button>
        </div>
      </section>

      <div className="space-y-4">
        {items.map((it, idx) => (
          <article key={it.id || `new-${idx}`} className="rounded-2xl border border-border bg-card p-5" data-testid={`menu-row-${idx}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">
                #{idx + 1}{!it.active && " · hidden"} {it.id && <span className="font-mono opacity-60">· {it.id}</span>}
              </p>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up" data-testid={`menu-up-${idx}`}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label="Move down" data-testid={`menu-down-${idx}`}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => update(idx, { active: !it.active })} aria-label={it.active ? "Hide" : "Show"} data-testid={`menu-visible-${idx}`}>
                  {it.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(idx)} aria-label="Delete" data-testid={`menu-remove-${idx}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>

            <div className="grid md:grid-cols-[200px_1fr] gap-5">
              {/* Photo */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Photo</label>
                <div className="relative aspect-[3/2] w-full rounded-xl bg-muted overflow-hidden flex items-center justify-center border border-border">
                  {it.image_url ? (
                    <img src={it.image_url} alt={it.name || "Item"} className="h-full w-full object-cover" />
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
                  data-testid={`menu-file-${idx}`}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => fileInputs.current[idx]?.click()} data-testid={`menu-upload-${idx}`}>
                    <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => generateImage(idx)}
                    disabled={!!genBusyIdx}
                    data-testid={`menu-generate-${idx}`}
                    className="bg-primary hover:bg-primary/90"
                  >
                    {genBusyIdx === idx ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Generate 3D
                  </Button>
                  {it.image_url && (
                    <Button size="sm" variant="ghost" onClick={() => update(idx, { image_url: "" })} data-testid={`menu-clear-image-${idx}`}>Clear</Button>
                  )}
                </div>
                <Input
                  placeholder="…or paste image URL"
                  value={it.image_url?.startsWith("data:") ? "" : (it.image_url || "")}
                  onChange={(e) => update(idx, { image_url: e.target.value })}
                  className="text-xs"
                  data-testid={`menu-image-url-${idx}`}
                />
              </div>

              {/* Fields */}
              <div className="space-y-3">
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-muted-foreground">Name</label>
                    <Input value={it.name} onChange={(e) => update(idx, { name: e.target.value })} placeholder="Item name" maxLength={80} data-testid={`menu-name-${idx}`} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Category</label>
                    <select
                      value={it.category}
                      onChange={(e) => update(idx, { category: e.target.value })}
                      className="w-full mt-2 h-10 px-3 rounded-md border border-input bg-background text-sm"
                      data-testid={`menu-category-${idx}`}
                    >
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Description</label>
                  <Textarea value={it.description || ""} onChange={(e) => update(idx, { description: e.target.value })} rows={2} maxLength={400} placeholder="Short, appetising — what's in it, what makes it special" data-testid={`menu-description-${idx}`} />
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Price ₹</label>
                    <Input type="number" min={0} step={1} value={it.price} onChange={(e) => update(idx, { price: e.target.value })} data-testid={`menu-price-${idx}`} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Discounted ₹ <span className="opacity-60 font-normal normal-case">(optional)</span></label>
                    <Input type="number" min={0} step={1} value={it.discounted_price ?? ""} onChange={(e) => update(idx, { discounted_price: e.target.value === "" ? null : e.target.value })} placeholder="—" data-testid={`menu-discounted-${idx}`} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Sort order</label>
                    <Input type="number" value={it.sort_order} onChange={(e) => update(idx, { sort_order: e.target.value })} data-testid={`menu-sort-${idx}`} />
                  </div>
                </div>
                <label className="flex items-center gap-2 mt-3 text-xs font-semibold cursor-pointer select-none" data-testid={`menu-returnable-label-${idx}`}>
                  <input
                    type="checkbox"
                    checked={it.is_returnable_tiffin === true}
                    onChange={(e) => update(idx, { is_returnable_tiffin: e.target.checked })}
                    className="h-4 w-4 rounded border-border accent-primary"
                    data-testid={`menu-returnable-${idx}`}
                  />
                  <span>🍱 Returnable steel tiffin · adds to take-away pendency</span>
                </label>
              </div>
            </div>
          </article>
        ))}
      </div>

      {items.length > 0 && (
        <div className="sticky bottom-4 z-20 flex justify-end">
          <Button size="lg" onClick={save} disabled={saving} className="shadow-lg" data-testid="restaurant-save-sticky">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
