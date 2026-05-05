import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Save, Sun, Moon } from "lucide-react";

function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function AdminMenu() {
  const [date, setDate] = useState(todayStr());
  const [lunch, setLunch] = useState("");
  const [dinner, setDinner] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/menu/today");
      if (r.data.menu_date === date) {
        setLunch((r.data.lunch_items || []).join("\n"));
        setDinner((r.data.dinner_items || []).join("\n"));
      }
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/admin/menu", {
        menu_date: date,
        lunch_items: lunch.split("\n").map((s) => s.trim()).filter(Boolean),
        dinner_items: dinner.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      toast.success("Menu saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div data-testid="admin-menu-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Menu</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Daily menu editor</h1>
      <p className="text-muted-foreground mt-2 text-sm">One item per line.</p>

      <div className="mt-6 bg-card rounded-2xl border border-border p-6 space-y-5">
        <div>
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Date</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-2 rounded-xl max-w-xs" data-testid="menu-date" />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><Sun className="h-3 w-3 text-secondary" /> Lunch</label>
            <Textarea rows={6} value={lunch} onChange={(e) => setLunch(e.target.value)} className="mt-2 rounded-xl font-mono text-sm" data-testid="menu-lunch" placeholder="Jeera Rice&#10;Dal Tadka&#10;..." />
          </div>
          <div>
            <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><Moon className="h-3 w-3 text-primary" /> Dinner</label>
            <Textarea rows={6} value={dinner} onChange={(e) => setDinner(e.target.value)} className="mt-2 rounded-xl font-mono text-sm" data-testid="menu-dinner" placeholder="Veg Biryani&#10;Raita&#10;..." />
          </div>
        </div>
        <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="save-menu-button">
          <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save menu"}
        </Button>
      </div>
    </div>
  );
}
