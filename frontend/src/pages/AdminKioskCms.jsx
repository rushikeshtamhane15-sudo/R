/* AdminKioskCms — iter-166.
 * Per-mess editor for the wall-kiosk header strings and voice greeting
 * templates. Writes go through /api/admin/kiosk/cms which auto-scopes to
 * the caller's mess via effective_mess_id() (super-admins without
 * impersonation still write to the global default).
 *
 * We mirror the saved CMS payload into localStorage keys prefixed with
 * `efc.kiosk.*` so the wall kiosk (which renders on-device via
 * announceCheckinSuccess) picks up the change on the very next scan
 * without a page reload.
 */
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { unlockAudio, announceCheckinSuccess } from "../lib/notify";
import { Volume2, Save, RotateCcw, Mic } from "lucide-react";

const FIELDS = [
  { key: "brand_name",          label: "Kiosk headline",           hint: "Big brand text at the top of the wall kiosk header.", placeholder: "e.g. Amravati branch · eFoodCare" },
  { key: "brand_tagline",       label: "Kiosk sub-headline",       hint: "Small tagline shown under the headline.",              placeholder: "e.g. ghar se accha khana" },
  { key: "pure_veg_label",      label: "Pure-veg pill (tooltip)",  hint: "Alt text on the green pure-veg mark.",                placeholder: "100% Pure Veg · FSSAI" },
];

const GREETINGS = [
  { key: "greeting_lunch_hi",  label: "Lunch greeting · Hindi",   placeholder: "{name}, आपका लंच चेक-इन सफल हुआ। धन्यवाद।" },
  { key: "greeting_lunch_en",  label: "Lunch greeting · English", placeholder: "{name}, lunch check-in successful. Thank you." },
  { key: "greeting_dinner_hi", label: "Dinner greeting · Hindi",  placeholder: "{name}, आपका डिनर चेक-इन सफल हुआ। धन्यवाद।" },
  { key: "greeting_dinner_en", label: "Dinner greeting · English", placeholder: "{name}, dinner check-in successful. Thank you." },
];

const ALL_KEYS = [...FIELDS.map((f) => f.key), ...GREETINGS.map((g) => g.key)];

function pushToLocalStorage(cms) {
  try {
    ALL_KEYS.forEach((k) => localStorage.setItem(`efc.kiosk.${k}`, cms[k] || ""));
  } catch { /* private-mode browsers can throw */ }
}

export default function AdminKioskCms() {
  const [form, setForm] = useState(() => ALL_KEYS.reduce((o, k) => ({ ...o, [k]: "" }), {}));
  const [effective, setEffective] = useState(null); // merged view w/ platform fallback
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testName, setTestName] = useState("Rushikesh");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/kiosk/cms");
      const data = r.data || {};
      const next = { ...form };
      // Only fill the "override" input with the mess's own value — the
      // effective merged value is shown separately. But since the backend
      // returns the effective merged value (empty inputs inherit from
      // platform defaults), we prefill everything.
      ALL_KEYS.forEach((k) => { next[k] = data[k] || ""; });
      setForm(next);
      setEffective(data);
      pushToLocalStorage(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load kiosk CMS");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {};
      ALL_KEYS.forEach((k) => { payload[k] = (form[k] || "").trim(); });
      const r = await api.put("/admin/kiosk/cms", payload);
      pushToLocalStorage(r.data || {});
      setEffective(r.data || null);
      toast.success("Kiosk CMS saved · wall kiosk will pick up on the next scan");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset all kiosk overrides to the platform default? Voice greetings and headlines will revert.")) return;
    setSaving(true);
    try {
      const r = await api.post("/admin/kiosk/cms/reset");
      const next = { ...form };
      ALL_KEYS.forEach((k) => { next[k] = ""; });
      setForm(next);
      pushToLocalStorage(r.data || {});
      setEffective(r.data || null);
      toast.success("Reverted to platform defaults");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    } finally { setSaving(false); }
  };

  const previewMeal = (meal) => {
    unlockAudio();
    // Snapshot current form values BEFORE the announcer reads localStorage so
    // admin hears the un-saved edit exactly as it will sound to subscribers.
    try {
      ALL_KEYS.forEach((k) => localStorage.setItem(`efc.kiosk.${k}`, (form[k] || "").trim() || (effective?.[k] || "")));
    } catch { /* noop */ }
    announceCheckinSuccess(meal, testName || "Guest");
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-kiosk-cms">
      <div>
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Wall kiosk · Branded copy</p>
        <h1 className="font-display font-extrabold text-3xl mt-1 flex items-center gap-2">
          <Volume2 className="h-7 w-7 text-primary" /> Wall-kiosk headline &amp; voice
        </h1>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          Customise what your wall kiosk shows and speaks. Leave any field blank to inherit the platform default. Changes are strictly scoped to your mess &mdash; other tenants and anonymous visitors keep seeing the platform defaults.
        </p>
      </div>

      <section className="rounded-2xl card-3d p-5 space-y-4" data-testid="kiosk-cms-branding">
        <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Branding · header text</p>
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{f.label}</span>
            <Input
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              placeholder={f.placeholder}
              className="mt-1.5"
              data-testid={`kiosk-cms-${f.key}`}
            />
            <span className="text-[11px] text-muted-foreground mt-1 block">{f.hint}</span>
          </label>
        ))}
      </section>

      <section className="rounded-2xl card-3d p-5 space-y-4" data-testid="kiosk-cms-greetings">
        <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Voice greetings · check-in success</p>
        <p className="text-[11px] text-muted-foreground -mt-2 leading-relaxed">
          Use <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{"{name}"}</code> anywhere to personalise the read with the subscriber&rsquo;s first name. The wall kiosk speaks one greeting per scan in the language you picked in <a href="/admin/voice-settings" className="text-primary underline">Kiosk voice</a>.
        </p>
        {GREETINGS.map((g) => (
          <label key={g.key} className="block">
            <span className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{g.label}</span>
            <Textarea
              rows={2}
              value={form[g.key]}
              onChange={(e) => setForm({ ...form, [g.key]: e.target.value })}
              placeholder={g.placeholder}
              className="mt-1.5 font-mono text-sm"
              data-testid={`kiosk-cms-${g.key}`}
            />
          </label>
        ))}
      </section>

      <section className="rounded-2xl card-3d p-5 space-y-3" data-testid="kiosk-cms-preview">
        <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Live preview</p>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-xs font-bold text-muted-foreground">Subscriber name:</label>
          <Input
            value={testName}
            onChange={(e) => setTestName(e.target.value)}
            placeholder="e.g. Rushikesh"
            className="flex-1 min-w-[180px] max-w-[280px] rounded-xl h-9"
            data-testid="kiosk-cms-preview-name"
          />
          <Button
            onClick={() => previewMeal("lunch")}
            className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold"
            data-testid="kiosk-cms-preview-lunch"
          >
            <Mic className="h-4 w-4 mr-1.5" /> Preview lunch
          </Button>
          <Button
            onClick={() => previewMeal("dinner")}
            className="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold"
            data-testid="kiosk-cms-preview-dinner"
          >
            <Mic className="h-4 w-4 mr-1.5" /> Preview dinner
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          The preview reads whatever is currently in the fields above &mdash; even if you haven&rsquo;t hit Save yet.
        </p>
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={reset} disabled={saving} className="rounded-full" data-testid="kiosk-cms-reset">
          <RotateCcw className="h-4 w-4 mr-1.5" /> Reset to platform default
        </Button>
        <Button onClick={save} disabled={saving} className="rounded-full" data-testid="kiosk-cms-save">
          <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save & publish"}
        </Button>
      </div>
    </div>
  );
}
