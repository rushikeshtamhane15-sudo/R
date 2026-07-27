/* AdminMealSlots — admin screen to edit lunch/dinner slot windows.
 * iter-131.30 · Backend server._mark_attendance reads from db.admin_config
 * meal_slots. Public GET /api/meal-slots exposes windows to the kiosk/mobile.
 */
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Clock, Save, Sun, Moon } from "lucide-react";

export default function AdminMealSlots() {
  const [slots, setSlots] = useState({ lunch: { start: "12:00", end: "15:00" }, dinner: { start: "19:00", end: "22:00" } });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/meal-slots").then((r) => setSlots(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const update = (meal, field, value) => setSlots((s) => ({ ...s, [meal]: { ...s[meal], [field]: value } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/meal-slots", slots);
      toast.success("Slot windows updated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6" data-testid="admin-meal-slots">
      <div>
        <p className="text-[10px] tracking-widest uppercase font-bold text-primary flex items-center gap-1.5">
          <Clock className="h-3 w-3" /> Operations
        </p>
        <h1 className="font-display font-extrabold text-3xl mt-1">Meal slot windows</h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Set the times during which kiosk QR scans are accepted. Scans outside these windows return
          a friendly “please come back during the slot” error. Times are Indian Standard Time (24-hour).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { key: "lunch", label: "Lunch", Icon: Sun, ring: "ring-amber-300", bg: "bg-amber-50" },
          { key: "dinner", label: "Dinner", Icon: Moon, ring: "ring-blue-300", bg: "bg-blue-50" },
        ].map(({ key, label, Icon, ring, bg }) => (
          <div key={key} className={`rounded-2xl ${bg} ring-1 ${ring} p-4 shadow-sm`} data-testid={`slot-card-${key}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex h-8 w-8 rounded-full bg-white items-center justify-center">
                <Icon className="h-4 w-4 text-foreground" strokeWidth={2.5} />
              </span>
              <p className="font-display font-extrabold text-lg uppercase tracking-wide">{label}</p>
            </div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Start</label>
            <Input
              type="time"
              value={slots[key].start}
              onChange={(e) => update(key, "start", e.target.value)}
              className="mt-1 h-11 rounded-lg tabular-nums font-semibold"
              data-testid={`slot-${key}-start`}
            />
            <label className="mt-3 block text-xs font-bold text-muted-foreground uppercase tracking-wide">End</label>
            <Input
              type="time"
              value={slots[key].end}
              onChange={(e) => update(key, "end", e.target.value)}
              className="mt-1 h-11 rounded-lg tabular-nums font-semibold"
              data-testid={`slot-${key}-end`}
            />
          </div>
        ))}
      </div>

      <Button
        onClick={save}
        disabled={saving}
        className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 font-bold text-base"
        data-testid="save-meal-slots"
      >
        <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save slot windows"}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        These windows also drive kiosk QR auto-switching — the wall kiosk shows only the currently-active meal.
      </p>
    </div>
  );
}
