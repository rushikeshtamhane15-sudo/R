import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";
import { Utensils, Save, Loader2 } from "lucide-react";

/**
 * TiffinPreferencesCard — let the tiffin subscriber opt in/out of items
 * (rice / dal / chapati / sabji) and tune chapati count. Plan amount is
 * unchanged; this is a premium UX touch that also reduces food waste.
 *
 * Backend: GET/PUT /api/my/tiffin/preferences (routes/subscription.py).
 * Saved prefs snapshot onto each NEW daily_rosters doc at generation time
 * so dispatch staff packs exactly what the user wants.
 */

const ITEMS = [
  { key: "rice", label: "Rice", emoji: "🍚" },
  { key: "dal", label: "Dal", emoji: "🍲" },
  { key: "chapati", label: "Chapati", emoji: "🫓" },
  { key: "sabji", label: "Sabji", emoji: "🥬" },
];

export default function TiffinPreferencesCard() {
  const [prefs, setPrefs] = useState({ rice: true, dal: true, chapati: true, sabji: true, chapati_count: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/my/tiffin/preferences");
        setPrefs({ ...prefs, ...(r.data || {}) });
      } catch {
        // Not a tiffin sub or no active — silently hide
        setPrefs(null);
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return null;
  if (!prefs) return null;

  const toggle = (k) => setPrefs({ ...prefs, [k]: !prefs[k] });

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/my/tiffin/preferences", prefs);
      toast.success("Saved · applies from tomorrow's tiffin");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-6 md:p-7 space-y-4" data-testid="tiffin-preferences-card">
      <div className="flex items-center gap-2">
        <Utensils className="h-4 w-4 text-primary" />
        <p className="font-display font-extrabold">Tiffin food preferences</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Customize what comes in your tiffin. Same plan price — just helps us cook less waste.
        Changes apply from the <strong>next</strong> dispatch.
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        {ITEMS.map((it) => {
          const on = prefs[it.key] !== false;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => toggle(it.key)}
              data-testid={`tiffin-pref-${it.key}`}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 transition-colors text-left ${on ? "border-primary bg-primary/8 text-foreground" : "border-border bg-muted/40 text-muted-foreground"}`}
            >
              <span aria-hidden className="text-lg">{it.emoji}</span>
              <span className="flex-1 font-semibold text-sm">{it.label}</span>
              <span className={`inline-flex items-center justify-center h-5 w-5 rounded border-2 ${on ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {prefs.chapati !== false && (
        <label className="block" data-testid="tiffin-chapati-count">
          <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Chapati count per tiffin</span>
          <Input
            type="number"
            min={0}
            max={8}
            value={prefs.chapati_count ?? ""}
            placeholder="Plan default (3 or 5)"
            onChange={(e) => setPrefs({ ...prefs, chapati_count: e.target.value === "" ? null : Math.max(0, Math.min(8, Number(e.target.value))) })}
            className="mt-1.5 h-9 max-w-[180px]"
          />
          <span className="text-[11px] text-muted-foreground italic mt-1 block">Leave blank to use your plan's default count.</span>
        </label>
      )}

      <Button
        onClick={save}
        disabled={saving}
        data-testid="tiffin-pref-save"
        className="w-full sm:w-auto rounded-full"
      >
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Save preferences
      </Button>
    </div>
  );
}
