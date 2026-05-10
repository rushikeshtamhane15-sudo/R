import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Eye, EyeOff, Save, RefreshCw, Plus, Trash2, Menu as MenuIcon, GripVertical } from "lucide-react";

export default function AdminHeaderMenu() {
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/header-menu");
      setItems(r.data?.items || []);
    } catch { toast.error("Could not load header menu"); }
  };
  useEffect(() => { load(); }, []);

  const move = (i, d) => {
    const j = i + d; if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; setItems(next);
  };
  const update = (i, patch) => setItems(items.map((it, k) => k === i ? { ...it, ...patch } : it));
  const add = () => {
    if (items.length >= 12) return toast.error("Max 12 items");
    setItems([...items, { id: `custom_${Date.now()}`, label: "New", to: "/", visible: true }]);
  };
  const del = (i) => {
    if (items.length <= 1) return toast.error("At least 1 item required");
    setItems(items.filter((_, k) => k !== i));
  };

  // Drag-and-drop reorder
  const [dragIdx, setDragIdx] = useState(null);
  const onDragStart = (idx) => (e) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(idx)); } catch {}
  };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const onDrop = (idx) => (e) => {
    e.preventDefault();
    if (dragIdx == null || dragIdx === idx) { setDragIdx(null); return; }
    const next = [...items];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setItems(next);
    setDragIdx(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/header-menu", { items });
      toast.success("Header menu saved · live for all users");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset header menu to defaults?")) return;
    try {
      await api.post("/admin/header-menu/reset");
      toast.success("Reset to defaults");
      load();
    } catch (e) { toast.error("Reset failed"); }
  };

  return (
    <div className="space-y-5" data-testid="admin-header-menu">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight flex items-center gap-2">
            <MenuIcon className="h-6 w-6 text-primary" /> Hamburger menu editor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Edit links shown in the top-right hamburger drawer (visible on every page). Reorder, rename, hide, or add custom links.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} className="rounded-full" data-testid="hm-reset"><RefreshCw className="h-4 w-4 mr-1.5" /> Reset</Button>
          <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="hm-save">
            <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">{items.length} item(s)</p>
          <Button size="sm" variant="outline" onClick={add} className="rounded-full" data-testid="hm-add">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {items.map((it, idx) => (
            <li
              key={it.id + idx}
              className={`p-3 flex items-center gap-2 sm:gap-3 flex-wrap transition-all ${dragIdx === idx ? "opacity-40" : ""}`}
              data-testid={`hm-row-${idx}`}
              onDragOver={onDragOver}
              onDrop={onDrop(idx)}
            >
              <div
                className="flex flex-col cursor-grab active:cursor-grabbing select-none"
                draggable
                onDragStart={onDragStart(idx)}
                title="Drag to reorder"
                data-testid={`hm-drag-${idx}`}
              >
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="p-0.5 disabled:opacity-30 hover:text-primary" data-testid={`hm-up-${idx}`}><ArrowUp className="h-3.5 w-3.5" /></button>
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                <button onClick={() => move(idx, +1)} disabled={idx === items.length - 1} className="p-0.5 disabled:opacity-30 hover:text-primary" data-testid={`hm-dn-${idx}`}><ArrowDown className="h-3.5 w-3.5" /></button>
              </div>
              <Input value={it.label} onChange={(e) => update(idx, { label: e.target.value })} placeholder="Label" className="w-32 sm:w-40" data-testid={`hm-label-${idx}`} />
              <Input value={it.to} onChange={(e) => update(idx, { to: e.target.value })} placeholder="/path or full URL" className="flex-1 min-w-[150px] text-xs font-mono" data-testid={`hm-route-${idx}`} />
              <button onClick={() => update(idx, { visible: !it.visible })} className={`p-1.5 rounded-full ${it.visible ? "text-emerald-700 hover:bg-emerald-50" : "text-muted-foreground hover:bg-muted"}`} data-testid={`hm-vis-${idx}`} title={it.visible ? "Visible" : "Hidden"}>
                {it.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
              <button onClick={() => del(idx)} className="p-1.5 rounded-full text-rose-700 hover:bg-rose-50" data-testid={`hm-del-${idx}`} title="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
