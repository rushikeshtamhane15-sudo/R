import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  GripVertical, ArrowUp, ArrowDown, Eye, EyeOff, Save, RefreshCw, Plus, Trash2,
  Volume2, Upload, Play, Pause, Layout,
} from "lucide-react";

const AVAILABLE_ICONS = [
  "Home", "ChefHat", "LayoutDashboard", "Bike", "User", "Phone", "LogIn", "LogOut",
  "Receipt", "ShoppingBag", "Wallet", "Heart", "Settings", "Bell", "MapPin", "Clock",
  "Star", "ScanLine",
];

const ROLES = [
  { key: "subscriber", title: "Logged-in customer", note: "Subscribers + restaurant order users" },
  { key: "guest",      title: "Guest (logged-out)", note: "Visitors before they sign up" },
  { key: "rider",      title: "Rider",              note: "Delivery riders (visible on desktop too)" },
];

export default function AdminBottomNavEditor() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [soundUrl, setSoundUrl] = useState("");
  const [savingSound, setSavingSound] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef(null);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const r = await api.get("/bottom-nav");
      setConfig(r.data);
    } catch { toast.error("Could not load bottom-nav config"); }
    try {
      const s = await api.get("/notify-sound");
      setSoundUrl(s.data?.sound_url || "");
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const updateRole = (role, items) => setConfig({ ...config, [role]: items });

  const moveItem = (role, idx, dir) => {
    const items = [...config[role]];
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j], items[idx]];
    updateRole(role, items);
  };

  // Drag-and-drop reorder — HTML5 native API. Drag handle is the GripVertical icon.
  const [dragState, setDragState] = useState(null); // {role, idx} | null
  const onDragStart = (role, idx) => (e) => {
    setDragState({ role, idx });
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", `${role}:${idx}`); } catch {}
  };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const onDrop = (role, idx) => (e) => {
    e.preventDefault();
    if (!dragState || dragState.role !== role || dragState.idx === idx) { setDragState(null); return; }
    const items = [...config[role]];
    const [moved] = items.splice(dragState.idx, 1);
    items.splice(idx, 0, moved);
    updateRole(role, items);
    setDragState(null);
  };

  const updateItem = (role, idx, patch) => {
    const items = config[role].map((it, i) => i === idx ? { ...it, ...patch } : it);
    updateRole(role, items);
  };

  const addItem = (role) => {
    if ((config[role] || []).length >= 6) return toast.error("Max 6 items per role");
    updateRole(role, [...config[role], { id: `custom_${Date.now()}`, label: "New", icon: "Star", to: "/restaurant", visible: true }]);
  };

  const deleteItem = (role, idx) => {
    if (config[role].length <= 1) return toast.error("At least 1 item required");
    updateRole(role, config[role].filter((_, i) => i !== idx));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/bottom-nav", {
        subscriber: config.subscriber,
        rider: config.rider,
        guest: config.guest,
      });
      toast.success("Bottom nav saved · live for all users");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset bottom nav to factory defaults? Custom items will be lost.")) return;
    try {
      await api.post("/admin/bottom-nav/reset");
      toast.success("Reset to defaults");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Reset failed"); }
  };

  // ----- Notification sound -----
  const onSoundUpload = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 800_000) return toast.error("File too large — max 800 KB");
    if (!f.type.startsWith("audio/")) return toast.error("Only audio files");
    const reader = new FileReader();
    reader.onload = () => setSoundUrl(String(reader.result || ""));
    reader.readAsDataURL(f);
    toast.success(`Loaded ${f.name} · click Save sound to publish`);
  };

  const saveSound = async () => {
    if (!soundUrl) return toast.error("Upload a file or paste a URL first");
    setSavingSound(true);
    try {
      await api.put("/admin/notify-sound", { sound_url: soundUrl });
      toast.success("Notification sound saved · live for admin/rider");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSavingSound(false); }
  };

  const clearSound = async () => {
    if (!window.confirm("Clear custom sound? System will fall back to the default chime.")) return;
    try {
      await api.delete("/admin/notify-sound");
      setSoundUrl("");
      toast.success("Cleared · using default chime");
    } catch (e) { toast.error("Clear failed"); }
  };

  const togglePreview = () => {
    if (!soundUrl) return;
    if (!audioRef.current) { audioRef.current = new Audio(soundUrl); audioRef.current.onended = () => setPreviewing(false); }
    audioRef.current.src = soundUrl;
    if (previewing) { audioRef.current.pause(); setPreviewing(false); }
    else { audioRef.current.play().catch(() => {}); setPreviewing(true); }
  };

  if (!config) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6" data-testid="admin-bottom-nav-editor">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight flex items-center gap-2">
            <Layout className="h-6 w-6 text-primary" /> Navigation & alerts editor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Edit bottom-nav items per role · upload custom alert sound for admin order pings.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} className="rounded-full" data-testid="nav-reset"><RefreshCw className="h-4 w-4 mr-1.5" /> Reset nav</Button>
          <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="nav-save">
            <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save nav"}
          </Button>
        </div>
      </div>

      {/* Per-role nav editor */}
      {ROLES.map(({ key, title, note }) => (
        <section key={key} className="rounded-2xl border border-border bg-card overflow-hidden" data-testid={`nav-section-${key}`}>
          <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-2">
            <div>
              <p className="font-display font-extrabold">{title}</p>
              <p className="text-[11px] text-muted-foreground">{note} · {(config[key] || []).length} item(s)</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => addItem(key)} className="rounded-full" data-testid={`nav-add-${key}`}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {(config[key] || []).map((it, idx) => (
              <li
                key={it.id + idx}
                className={`p-3 flex items-center gap-2 sm:gap-3 flex-wrap transition-all ${dragState?.role === key && dragState?.idx === idx ? "opacity-40" : ""}`}
                data-testid={`nav-row-${key}-${idx}`}
                onDragOver={onDragOver}
                onDrop={onDrop(key, idx)}
              >
                <div
                  className="flex flex-col cursor-grab active:cursor-grabbing select-none"
                  draggable
                  onDragStart={onDragStart(key, idx)}
                  title="Drag to reorder"
                  data-testid={`nav-drag-${key}-${idx}`}
                >
                  <button onClick={() => moveItem(key, idx, -1)} disabled={idx === 0} className="p-0.5 disabled:opacity-30 hover:text-primary" data-testid={`nav-up-${key}-${idx}`}><ArrowUp className="h-3.5 w-3.5" /></button>
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                  <button onClick={() => moveItem(key, idx, +1)} disabled={idx === config[key].length - 1} className="p-0.5 disabled:opacity-30 hover:text-primary" data-testid={`nav-dn-${key}-${idx}`}><ArrowDown className="h-3.5 w-3.5" /></button>
                </div>
                <Input value={it.label} onChange={(e) => updateItem(key, idx, { label: e.target.value })} placeholder="Label" className="w-28 sm:w-32" data-testid={`nav-label-${key}-${idx}`} />
                <select value={it.icon} onChange={(e) => updateItem(key, idx, { icon: e.target.value })} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" data-testid={`nav-icon-${key}-${idx}`}>
                  {AVAILABLE_ICONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <Input value={it.to} onChange={(e) => updateItem(key, idx, { to: e.target.value })} placeholder="/path or __login__ / __logout__" className="flex-1 min-w-[150px] text-xs font-mono" data-testid={`nav-route-${key}-${idx}`} />
                <button onClick={() => updateItem(key, idx, { visible: !it.visible })} className={`p-1.5 rounded-full ${it.visible ? "text-emerald-700 hover:bg-emerald-50" : "text-muted-foreground hover:bg-muted"}`} data-testid={`nav-vis-${key}-${idx}`} title={it.visible ? "Visible — click to hide" : "Hidden — click to show"}>
                  {it.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button onClick={() => deleteItem(key, idx)} className="p-1.5 rounded-full text-rose-700 hover:bg-rose-50" data-testid={`nav-del-${key}-${idx}`} title="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Notification sound */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden" data-testid="nav-section-sound">
        <div className="px-5 py-3 border-b border-border">
          <p className="font-display font-extrabold flex items-center gap-2"><Volume2 className="h-4 w-4 text-primary" /> Custom alert sound</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Plays on admin restaurant orders page (every 2s polling) and rider dashboard for new orders. ≤800 KB · mp3/wav/ogg.</p>
        </div>
        <div className="p-5 space-y-3">
          <input ref={fileRef} type="file" accept="audio/*" onChange={onSoundUpload} className="hidden" data-testid="sound-file-input" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="rounded-full" data-testid="sound-upload-btn">
              <Upload className="h-4 w-4 mr-1.5" /> Upload audio
            </Button>
            {soundUrl && (
              <Button variant="outline" onClick={togglePreview} className="rounded-full" data-testid="sound-preview-btn">
                {previewing ? <Pause className="h-4 w-4 mr-1.5" /> : <Play className="h-4 w-4 mr-1.5" />}
                {previewing ? "Pause" : "Preview"}
              </Button>
            )}
            <Button onClick={saveSound} disabled={savingSound || !soundUrl} className="rounded-full bg-primary hover:bg-primary/90" data-testid="sound-save-btn">
              <Save className="h-4 w-4 mr-1.5" /> {savingSound ? "Saving…" : "Save sound"}
            </Button>
            {soundUrl && (
              <Button variant="ghost" onClick={clearSound} className="rounded-full text-rose-700" data-testid="sound-clear-btn">
                <Trash2 className="h-4 w-4 mr-1.5" /> Clear
              </Button>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            <span className="font-bold">Or paste an https URL:</span>
            <Input value={soundUrl?.startsWith("data:") ? "" : soundUrl} onChange={(e) => setSoundUrl(e.target.value)} placeholder="https://example.com/ding.mp3" className="mt-1.5 font-mono text-xs" data-testid="sound-url-input" />
          </div>
          {soundUrl && (
            <p className="text-[11px] text-emerald-700 font-bold">
              {soundUrl.startsWith("data:") ? `Uploaded data URL · ${Math.round(soundUrl.length / 1024)} KB` : `External URL set`}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
