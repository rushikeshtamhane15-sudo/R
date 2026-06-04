import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { CalendarDays, ChefHat, Save, Trash2, Copy, Printer, Share2 } from "lucide-react";

/**
 * AdminMessMenuCalendar — iter-62 #8
 *
 * Lets admin pre-fill the entire month's lunch + dinner mess menu day by
 * day. Click any date in the grid → editor on the right → Save. The
 * "Copy yesterday" shortcut speeds bulk entry for weeks where the menu
 * repeats. Backend serves the entry on /api/mess-menu/today which the
 * user dashboard + restaurant page poll for daily flash.
 */
function isoToday() { return new Date().toISOString().slice(0, 10); }
function isoMonth(d) { return d.toISOString().slice(0, 7); }
function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}
function daysInMonth(yyyy, mm) {
  return new Date(Number(yyyy), Number(mm), 0).getDate();
}

export default function AdminMessMenuCalendar() {
  const [monthDate, setMonthDate] = useState(new Date());
  const [items, setItems] = useState([]);
  const [selectedDate, setSelectedDate] = useState(isoToday());
  const [lunch, setLunch] = useState("");
  const [dinner, setDinner] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const month = isoMonth(monthDate);
  const [yyyy, mm] = month.split("-");
  const dim = daysInMonth(yyyy, mm);
  const map = useMemo(() => new Map(items.map((i) => [i.date, i])), [items]);

  const load = async (m) => {
    setLoading(true);
    try {
      const r = await api.get(`/admin/mess-menu?month=${m}`);
      setItems(r.data.items || []);
    } catch { toast.error("Failed to load month"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(month); }, [month]);

  useEffect(() => {
    const doc = map.get(selectedDate);
    setLunch(doc?.lunch || "");
    setDinner(doc?.dinner || "");
    setNote(doc?.note || "");
  }, [selectedDate, items, map]);

  const save = async () => {
    if (!lunch.trim() && !dinner.trim() && !note.trim()) { toast.error("Add at least one of lunch / dinner / note"); return; }
    setSaving(true);
    try {
      await api.post("/admin/mess-menu/upsert", { date: selectedDate, lunch, dinner, note });
      toast.success(`Saved ${selectedDate}`);
      load(month);
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the menu for ${selectedDate}?`)) return;
    setSaving(true);
    try {
      await api.delete(`/admin/mess-menu/${selectedDate}`);
      toast.success("Removed");
      load(month);
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
    finally { setSaving(false); }
  };

  const copyFromYesterday = () => {
    const d = new Date(selectedDate); d.setDate(d.getDate() - 1);
    const key = d.toISOString().slice(0, 10);
    const prev = map.get(key);
    if (!prev) { toast.error(`No menu saved for ${key}`); return; }
    setLunch(prev.lunch || ""); setDinner(prev.dinner || ""); setNote(prev.note || "");
    toast.success(`Pulled from ${key} — review and save`);
  };

  const cells = [];
  for (let d = 1; d <= dim; d++) {
    const iso = `${yyyy}-${mm}-${String(d).padStart(2, "0")}`;
    const has = map.has(iso);
    const isSelected = iso === selectedDate;
    const isToday = iso === isoToday();
    cells.push({ iso, d, has, isSelected, isToday });
  }

  const monthLabel = monthDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div data-testid="admin-mess-menu-calendar">
      <p className="text-[10px] sm:text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Mess menu · day-wise calendar</p>
      <h1 className="font-display font-extrabold text-xl sm:text-2xl md:text-3xl mt-1">Plan the whole month, flash daily before 7 AM</h1>
      <p className="text-xs sm:text-sm text-muted-foreground mt-1">Users see today's lunch + dinner on the dashboard and restaurant page. Before 7 AM IST we also surface tomorrow's preview.</p>

      {/* iter-63 #1: Weekly poster generator */}
      <WeeklyPosterCard />

      <div className="mt-5 grid lg:grid-cols-5 gap-4 sm:gap-5">
        {/* Calendar */}
        <div className="lg:col-span-3 bg-card rounded-2xl border border-border p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" className="rounded-full h-8 text-xs" onClick={() => setMonthDate(addMonths(monthDate, -1))} data-testid="cal-prev">←</Button>
            <p className="font-display font-extrabold text-base sm:text-lg">{monthLabel}</p>
            <Button variant="outline" size="sm" className="rounded-full h-8 text-xs" onClick={() => setMonthDate(addMonths(monthDate, 1))} data-testid="cal-next">→</Button>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1.5 text-center">
            {["S","M","T","W","T","F","S"].map((d, i) => <div key={i} className="text-[10px] text-muted-foreground font-bold uppercase">{d}</div>)}
            {/* Padding cells so the 1st aligns under correct weekday */}
            {Array.from({ length: new Date(`${yyyy}-${mm}-01T00:00:00`).getDay() }).map((_, i) => <div key={`pad-${i}`} />)}
            {cells.map((c) => (
              <button
                key={c.iso}
                type="button"
                onClick={() => setSelectedDate(c.iso)}
                className={`h-10 sm:h-12 rounded-lg text-xs sm:text-sm font-bold transition-colors relative ${
                  c.isSelected
                    ? "bg-primary text-primary-foreground"
                    : c.has
                    ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                    : "bg-muted/40 text-foreground hover:bg-muted"
                } ${c.isToday && !c.isSelected ? "ring-2 ring-primary/40" : ""}`}
                data-testid={`cal-cell-${c.iso}`}
              >
                {c.d}
                {c.has && !c.isSelected && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-emerald-600" />}
              </button>
            ))}
          </div>
          {loading && <p className="text-[11px] text-muted-foreground mt-2">Loading…</p>}
          <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-100 border border-emerald-300 inline-block" /> Saved</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted/60 border border-border inline-block" /> Empty</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm ring-2 ring-primary/40 inline-block" /> Today</span>
          </p>
        </div>

        {/* Editor */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border p-4 sm:p-5" data-testid="menu-editor">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Editing</p>
            <Input
              type="date" value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-xl h-9 text-sm tabular-nums w-auto"
              data-testid="menu-editor-date"
            />
          </div>
          <p className="font-display font-extrabold text-lg sm:text-xl mt-1 flex items-center gap-1.5"><ChefHat className="h-4 w-4 text-primary" /> {new Date(selectedDate).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}</p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Lunch</label>
              <Input value={lunch} onChange={(e) => setLunch(e.target.value)} placeholder="e.g. Dal tadka · Aloo gobhi · Phulka · Rice · Salad" className="mt-1.5 rounded-xl" data-testid="menu-lunch" />
            </div>
            <div>
              <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Dinner</label>
              <Input value={dinner} onChange={(e) => setDinner(e.target.value)} placeholder="e.g. Paneer butter masala · Jeera rice · Roti · Raita" className="mt-1.5 rounded-xl" data-testid="menu-dinner" />
            </div>
            <div>
              <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Note (optional)</label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. festival special, sweet of the day" className="mt-1.5 rounded-xl" data-testid="menu-note" />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 justify-end">
            <Button variant="outline" size="sm" className="rounded-full h-9 text-xs" onClick={copyFromYesterday} data-testid="copy-yesterday">
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy yesterday
            </Button>
            {map.has(selectedDate) && (
              <Button variant="outline" size="sm" className="rounded-full h-9 text-xs border-destructive/40 text-destructive hover:bg-destructive/5" onClick={remove} disabled={saving} data-testid="menu-remove">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
              </Button>
            )}
            <Button size="sm" className="rounded-full h-9 text-xs" onClick={save} disabled={saving} data-testid="menu-save">
              <Save className="h-3.5 w-3.5 mr-1.5" /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


function WeeklyPosterCard() {
  const [start, setStart] = React.useState(isoToday());
  const [format, setFormat] = React.useState("a4");
  const [preview, setPreview] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const generate = async (download = false, asJpg = false) => {
    setLoading(true);
    try {
      const url = `/api/admin/mess-menu/poster?start=${start}&format=${format}&fmt=${asJpg ? "jpg" : "png"}`;
      // Fetch via axios's underlying base so cookies are sent; then make a blob URL
      const base = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
      const r = await fetch(base + url, { credentials: "include" });
      if (!r.ok) { toast.error("Could not generate poster"); return; }
      const blob = await r.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPreview(blobUrl);
      if (download) {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `mess-menu-${start}-${format}.${asJpg ? "jpg" : "png"}`;
        a.click();
      }
    } catch (e) {
      toast.error("Could not generate poster");
    } finally { setLoading(false); }
  };

  return (
    <div className="mt-5 bg-card rounded-2xl border border-border p-4 sm:p-5" data-testid="weekly-poster-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] sm:text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><Printer className="h-3.5 w-3.5" /> Weekly poster · #1</p>
          <h2 className="font-display font-extrabold text-base sm:text-lg mt-1 leading-tight">Print a 7-day menu poster for the kitchen wall</h2>
          <p className="text-xs text-muted-foreground mt-1">One click → A4 print or WhatsApp-ready square. Pulls 7 consecutive days starting from the date picker.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Start</label>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-xl h-9 text-sm w-auto tabular-nums" data-testid="poster-start-date" />
        </div>
        <div className="inline-flex flex-row bg-muted/50 rounded-full p-1 gap-1">
          {[{ id: "a4", label: "A4 print" }, { id: "square", label: "WhatsApp" }].map((f) => (
            <button
              key={f.id} type="button" onClick={() => setFormat(f.id)}
              className={`px-3 h-8 rounded-full text-xs font-bold transition-colors ${format === f.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`poster-format-${f.id}`}
            >{f.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 ml-auto">
          <Button variant="outline" size="sm" className="rounded-full h-9 text-xs" onClick={() => generate(false, false)} disabled={loading} data-testid="poster-preview">
            <Printer className="h-3.5 w-3.5 mr-1.5" /> {loading ? "Rendering…" : "Preview"}
          </Button>
          <Button size="sm" className="rounded-full h-9 text-xs" onClick={() => generate(true, format === "square")} disabled={loading} data-testid="poster-download">
            <Share2 className="h-3.5 w-3.5 mr-1.5" /> Download {format === "square" ? "JPG" : "PNG"}
          </Button>
        </div>
      </div>
      {preview && (
        <div className="mt-4 border border-border rounded-xl p-2 bg-muted/20 inline-block max-w-full" data-testid="poster-preview-pane">
          <img src={preview} alt="poster preview" className="max-w-full max-h-[420px] rounded-md" />
        </div>
      )}
    </div>
  );
}
