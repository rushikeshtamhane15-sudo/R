/* DeliveryTimeCard — tiffin user picks lunch + dinner delivery windows.
 * Splashed on the user dashboard. Staff dispatch, delivery-boy list and
 * admin today panel read the same window and sort/colour by it.
 *
 * Backend: GET/PUT /api/my/delivery-prefs
 */
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";
import { Clock, Save, Loader2, Sun, Moon, AlertCircle, CheckCircle2 } from "lucide-react";

const DEFAULTS = {
  lunch: { start: "12:00", end: "12:30" },
  dinner: { start: "20:00", end: "20:30" },
};

export default function DeliveryTimeCard() {
  const [prefs, setPrefs] = useState({ lunch: null, dinner: null, is_set: false });
  const [draft, setDraft] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/my/delivery-prefs");
        setPrefs(r.data);
        setDraft({
          lunch: r.data.lunch || DEFAULTS.lunch,
          dinner: r.data.dinner || DEFAULTS.dinner,
        });
      } catch {
        // silently keep defaults for unauthenticated / no-plan users
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setField = (meal, field, value) => {
    setDraft((d) => ({ ...d, [meal]: { ...d[meal], [field]: value } }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/my/delivery-prefs", draft);
      setPrefs({ ...r.data.prefs, is_set: true });
      setDirty(false);
      toast.success("Delivery windows saved — staff will pack + dispatch by these times");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save your delivery windows");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-border bg-card p-4 text-sm text-muted-foreground flex items-center gap-2" data-testid="delivery-time-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading delivery windows…
      </div>
    );
  }

  const unset = !prefs.is_set;

  return (
    <section
      className={`rounded-3xl border p-4 md:p-5 space-y-4 ${
        unset ? "border-amber-300 bg-amber-50/60" : "border-border bg-card"
      }`}
      data-testid="delivery-time-card"
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${unset ? "bg-amber-200 text-amber-900" : "bg-emerald-100 text-emerald-700"}`}>
          {unset ? <AlertCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">Delivery time</p>
          <h3 className="font-display font-extrabold text-xl mt-0.5" data-testid="delivery-time-heading">
            {unset ? "Tell us when to deliver" : "Your delivery windows"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {unset
              ? "Pick a lunch and dinner window (30–60 min slots work best). We&apos;ll plan the delivery-boy route to reach you inside your window every day."
              : "Change these anytime — updates apply from your next dispatch (or today if the kitchen hasn&apos;t packed yet)."}
          </p>
        </div>
        {!unset && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] tracking-overline uppercase font-bold px-2 py-1" data-testid="delivery-time-status-pill">
            <CheckCircle2 className="h-3 w-3" /> Set
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <WindowRow
          meal="lunch"
          icon={<Sun className="h-4 w-4" />}
          label="Lunch"
          value={draft.lunch}
          onChange={(f, v) => setField("lunch", f, v)}
        />
        <WindowRow
          meal="dinner"
          icon={<Moon className="h-4 w-4" />}
          label="Dinner"
          value={draft.dinner}
          onChange={(f, v) => setField("dinner", f, v)}
        />
      </div>

      <div className="flex items-center gap-2 justify-end">
        <Button
          onClick={save}
          disabled={!dirty || saving}
          className={`rounded-full h-10 px-5 font-bold ${dirty ? "bg-primary hover:bg-primary/90 text-primary-foreground" : "bg-muted text-muted-foreground cursor-not-allowed"}`}
          data-testid="delivery-time-save"
        >
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? "Saving…" : dirty ? "Save windows" : "Saved"}
        </Button>
      </div>
    </section>
  );
}

function WindowRow({ meal, icon, label, value, onChange }) {
  return (
    <div className="rounded-2xl bg-white/60 ring-1 ring-border p-3" data-testid={`window-row-${meal}`}>
      <p className="flex items-center gap-1.5 text-[10px] tracking-overline uppercase font-bold text-secondary">
        {icon} {label}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="text-muted-foreground text-[11px]">From</span>
          <Input
            type="time"
            value={value.start}
            onChange={(e) => onChange("start", e.target.value)}
            className="h-10 mt-1 rounded-xl tabular-nums text-base font-semibold"
            data-testid={`window-${meal}-start`}
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground text-[11px]">To</span>
          <Input
            type="time"
            value={value.end}
            onChange={(e) => onChange("end", e.target.value)}
            className="h-10 mt-1 rounded-xl tabular-nums text-base font-semibold"
            data-testid={`window-${meal}-end`}
          />
        </label>
      </div>
    </div>
  );
}
