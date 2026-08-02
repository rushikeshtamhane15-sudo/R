// iter-137.j · Admin Voice Preview + preference widget.
// Lists available Web Speech API voices, lets admins pin a Hindi + English
// voice, tune rate/pitch/volume, and hear a live preview before showtime.
// Selections persist in localStorage so the wall kiosk announcer
// (`announceCheckinSuccess`) picks them up automatically.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Loader2, Volume2, RotateCcw, Save, Mic } from "lucide-react";
import { announceCheckinSuccess, listVoicesAsync, speak, unlockAudio } from "../lib/notify";

const LS_KEYS = {
  hi: "efc.voice.hi",
  en: "efc.voice.en",
  rate: "efc.voice.rate",
  pitch: "efc.voice.pitch",
  volume: "efc.voice.volume",
};

function readLS(key, fallback = "") {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export default function AdminVoiceSettings() {
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hindiVoice, setHindiVoice] = useState(readLS(LS_KEYS.hi));
  const [englishVoice, setEnglishVoice] = useState(readLS(LS_KEYS.en));
  const [rate, setRate] = useState(Number(readLS(LS_KEYS.rate)) || 1.0);
  const [pitch, setPitch] = useState(Number(readLS(LS_KEYS.pitch)) || 1.0);
  const [volume, setVolume] = useState(Number(readLS(LS_KEYS.volume)) || 1.0);
  const [testName, setTestName] = useState("Rushikesh");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listVoicesAsync();
      setVoices(list);
      // Auto-pick sensible defaults if nothing chosen yet.
      if (!hindiVoice) {
        const hi = list.find((v) => v.lang === "hi-IN") || list.find((v) => /hindi|veena/i.test(v.name));
        if (hi) setHindiVoice(hi.name);
      }
      if (!englishVoice) {
        const en = list.find((v) => v.lang === "en-IN") || list.find((v) => /india|rishi/i.test(v.name));
        if (en) setEnglishVoice(en.name);
      }
    } catch (e) {
      toast.error("Failed to load voices");
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const hindiVoices = useMemo(() => voices.filter((v) => /^hi/i.test(v.lang) || /hindi|veena/i.test(v.name)), [voices]);
  const englishVoices = useMemo(() => voices.filter((v) => /^en/i.test(v.lang)), [voices]);

  const save = () => {
    try {
      localStorage.setItem(LS_KEYS.hi, hindiVoice || "");
      localStorage.setItem(LS_KEYS.en, englishVoice || "");
      localStorage.setItem(LS_KEYS.rate, String(rate));
      localStorage.setItem(LS_KEYS.pitch, String(pitch));
      localStorage.setItem(LS_KEYS.volume, String(volume));
      toast.success("Voice preferences saved · wall kiosk will use these instantly");
    } catch { toast.error("Save failed"); }
  };

  const reset = () => {
    setHindiVoice(""); setEnglishVoice("");
    setRate(1.0); setPitch(1.0); setVolume(1.0);
    try {
      Object.values(LS_KEYS).forEach((k) => localStorage.removeItem(k));
      toast.success("Reset to browser defaults");
    } catch { /* noop */ }
  };

  const previewLine = (lang, text) => {
    unlockAudio();
    speak(text, {
      lang,
      voice: lang.startsWith("hi") ? (hindiVoice || undefined) : (englishVoice || undefined),
      rate, pitch, volume,
    });
  };

  const previewFull = (meal) => {
    // Snapshot current UI values into localStorage first so the announcer
    // picks them up even before "Save" is tapped.
    try {
      localStorage.setItem(LS_KEYS.hi, hindiVoice || "");
      localStorage.setItem(LS_KEYS.en, englishVoice || "");
      localStorage.setItem(LS_KEYS.rate, String(rate));
      localStorage.setItem(LS_KEYS.pitch, String(pitch));
      localStorage.setItem(LS_KEYS.volume, String(volume));
    } catch { /* noop */ }
    unlockAudio();
    announceCheckinSuccess(meal, testName);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-voice-settings">
      <div>
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Wall kiosk</p>
        <h1 className="font-display font-extrabold text-3xl mt-1 flex items-center gap-2">
          <Volume2 className="h-7 w-7 text-primary" /> Voice preview & tuning
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pin the exact Hindi + English voices your wall kiosk should use, tune the rate, pitch and volume, and preview the full bilingual check-in announcement before service starts.
        </p>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading voices…
        </div>
      ) : (
        <>
          <div className="rounded-2xl card-3d p-5 space-y-4">
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Voice selection</p>

            <label className="block">
              <span className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Hindi voice</span>
              <div className="flex gap-2 mt-1">
                <select
                  value={hindiVoice}
                  onChange={(e) => setHindiVoice(e.target.value)}
                  className="flex-1 h-10 rounded-xl border border-input bg-background px-3 text-sm"
                  data-testid="voice-hindi-select"
                >
                  <option value="">Browser default</option>
                  {hindiVoices.map((v) => (
                    <option key={v.name + v.lang} value={v.name}>{v.name} · {v.lang}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => previewLine("hi-IN", `${testName || "अतिथि"}, लंच चेक-इन सफल हुआ। धन्यवाद।`)}
                  data-testid="voice-hindi-preview"
                >
                  <Mic className="h-4 w-4 mr-1.5" /> Test
                </Button>
              </div>
              {hindiVoices.length === 0 && (
                <p className="text-[11px] text-amber-700 mt-1">No Hindi voice found on this device. On Windows: Settings → Time &amp; Language → Speech → add Hindi voice pack. On Android/Chromebook, install "Google Text-to-Speech · Hindi".</p>
              )}
            </label>

            <label className="block">
              <span className="text-xs tracking-overline uppercase font-bold text-muted-foreground">English voice</span>
              <div className="flex gap-2 mt-1">
                <select
                  value={englishVoice}
                  onChange={(e) => setEnglishVoice(e.target.value)}
                  className="flex-1 h-10 rounded-xl border border-input bg-background px-3 text-sm"
                  data-testid="voice-english-select"
                >
                  <option value="">Browser default</option>
                  {englishVoices.map((v) => (
                    <option key={v.name + v.lang} value={v.name}>{v.name} · {v.lang}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => previewLine("en-IN", `${testName || "Guest"}, lunch check-in successful. Thank you.`)}
                  data-testid="voice-english-preview"
                >
                  <Mic className="h-4 w-4 mr-1.5" /> Test
                </Button>
              </div>
            </label>
          </div>

          <div className="rounded-2xl card-3d p-5 space-y-3">
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Rate · Pitch · Volume</p>
            <Slider label="Rate" min={0.5} max={2.0} step={0.05} value={rate} onChange={setRate} suffix="×" testid="voice-rate" />
            <Slider label="Pitch" min={0.5} max={2.0} step={0.05} value={pitch} onChange={setPitch} suffix="×" testid="voice-pitch" />
            <Slider label="Volume" min={0.1} max={1.0} step={0.05} value={volume} onChange={setVolume} suffix="×" testid="voice-volume" />
          </div>

          <div className="rounded-2xl card-3d p-5 space-y-3">
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Full preview · check-in flow</p>
            <div className="flex gap-2 items-center flex-wrap">
              <label className="text-xs font-bold text-muted-foreground">Subscriber name:</label>
              <Input
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="e.g. Rushikesh"
                className="flex-1 min-w-[180px] max-w-[280px] rounded-xl h-9"
                data-testid="voice-test-name"
              />
              <Button
                onClick={() => previewFull("lunch")}
                className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold"
                data-testid="voice-preview-lunch"
              >
                <Volume2 className="h-4 w-4 mr-1.5" /> Play lunch check-in
              </Button>
              <Button
                onClick={() => previewFull("dinner")}
                className="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold"
                data-testid="voice-preview-dinner"
              >
                <Volume2 className="h-4 w-4 mr-1.5" /> Play dinner check-in
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Plays the success chord + Hindi (लंच/डिनर चेक-इन सफल हुआ) + English announcement — exactly what the wall kiosk will say when this subscriber taps in.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" onClick={reset} className="rounded-full" data-testid="voice-reset">
              <RotateCcw className="h-4 w-4 mr-1.5" /> Reset to defaults
            </Button>
            <Button onClick={save} className="rounded-full" data-testid="voice-save">
              <Save className="h-4 w-4 mr-1.5" /> Save preferences
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, suffix, testid }) {
  return (
    <label className="block" data-testid={`${testid}-wrap`}>
      <div className="flex items-center justify-between text-xs">
        <span className="tracking-overline uppercase font-bold text-muted-foreground">{label}</span>
        <span className="tabular-nums font-mono font-bold text-foreground">{Number(value).toFixed(2)}{suffix || ""}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 accent-primary"
        data-testid={testid}
      />
    </label>
  );
}
