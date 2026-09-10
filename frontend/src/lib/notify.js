/* Lightweight sound + voice notifications (Web Audio + speechSynthesis).
 * No external deps. Falls back gracefully where APIs are missing.
 *
 * Browser autoplay policy: the AudioContext can only emit sound AFTER a
 * user gesture. Call `unlockAudio()` from a click/tap handler at least once
 * (we surface "Enable alerts" toggles in admin/rider/customer UIs that do
 * this automatically). Subsequent programmatic calls then work.
 */

let _ctx = null;
let _unlocked = false;

function ctx() {
  if (typeof window === "undefined") return null;
  if (_ctx) return _ctx;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) _ctx = new Ctor();
  } catch { /* noop */ }
  return _ctx;
}

/** MUST be called from a user-gesture handler (click/tap) at least once.
 *  Resumes the AudioContext + primes the speechSynthesis engine.
 *  Idempotent. */
export function unlockAudio() {
  const ac = ctx();
  if (ac && ac.state === "suspended") {
    try { ac.resume(); } catch { /* noop */ }
  }
  // Trigger an inaudible TTS so the engine is "warm" and won't block later.
  try {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      u.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  } catch { /* noop */ }
  _unlocked = true;
}

export function isAudioUnlocked() { return _unlocked; }

/** Sharp 2-tone "ping" — for new orders, ready alerts. */
export function playPing() {
  const ac = ctx(); if (!ac) return;
  if (ac.state === "suspended") { try { ac.resume(); } catch { /* noop */ } }
  try {
    const t = ac.currentTime;
    [880, 1320].forEach((freq, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "triangle";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.45);
      o.connect(g).connect(ac.destination);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 0.5);
    });
  } catch { /* noop */ }
}

/** Cheerful C-major arpeggio — used ONLY on a confirmed QR check-in (staff
 *  scanner + self-scan). Distinct from playPing so kitchen staff can audibly
 *  distinguish "new order" from "subscriber checked in". 4 ascending notes
 *  with a soft glockenspiel envelope. */
export function playCheckinSuccess() {
  const ac = ctx(); if (!ac) return;
  if (ac.state === "suspended") { try { ac.resume(); } catch { /* noop */ } }
  try {
    const t = ac.currentTime;
    // C5, E5, G5, C6 — ascending major arpeggio
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      // Triangle base + sine overlay gives that "ka-ching"/glockenspiel timbre.
      o.type = "triangle";
      o.frequency.value = freq;
      const start = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.28, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      o.connect(g).connect(ac.destination);
      o.start(start);
      o.stop(start + 0.36);

      // Sine overlay one octave up — gives the chord a brighter "sparkle".
      const o2 = ac.createOscillator();
      const g2 = ac.createGain();
      o2.type = "sine";
      o2.frequency.value = freq * 2;
      g2.gain.setValueAtTime(0.0001, start);
      g2.gain.exponentialRampToValueAtTime(0.08, start + 0.015);
      g2.gain.exponentialRampToValueAtTime(0.0001, start + 0.30);
      o2.connect(g2).connect(ac.destination);
      o2.start(start);
      o2.stop(start + 0.34);
    });
  } catch { /* noop */ }
}

/** Dramatic 3-tone alarm — for OUT-FOR-DELIVERY, RIDER ARRIVED. */
export function playAlarm() {
  const ac = ctx(); if (!ac) return;
  if (ac.state === "suspended") { try { ac.resume(); } catch { /* noop */ } }
  try {
    const t = ac.currentTime;
    [659, 880, 1175].forEach((freq, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.3, t + i * 0.22 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.55);
      o.connect(g).connect(ac.destination);
      o.start(t + i * 0.22);
      o.stop(t + i * 0.22 + 0.6);
    });
  } catch { /* noop */ }
}

/** iter-137.j — persisted per-language voice preferences from
 *  AdminVoiceSettings. Empty when nothing was chosen. */
function _voicePrefs() {
  try {
    return {
      hindi: localStorage.getItem("efc.voice.hi") || "",
      english: localStorage.getItem("efc.voice.en") || "",
      rate: Number(localStorage.getItem("efc.voice.rate") || "") || null,
      pitch: Number(localStorage.getItem("efc.voice.pitch") || "") || null,
      volume: Number(localStorage.getItem("efc.voice.volume") || "") || null,
      // iter-138.p — "female" | "male" | "" (any). When set, we bias voice
      // picking below toward names that heuristically match this gender.
      gender: (localStorage.getItem("efc.voice.gender") || "").toLowerCase(),
      // iter-140 — announcement language: "en" | "hi" | "both". Default to
      // "en" so a fresh install speaks ONCE (not the confusing Hindi +
      // English back-to-back the wall kiosk used to play).
      language: (localStorage.getItem("efc.voice.language") || "en").toLowerCase(),
    };
  } catch { return { hindi: "", english: "", rate: null, pitch: null, volume: null, gender: "", language: "en" }; }
}

// iter-138.p — voice-name heuristic matching the one in AdminVoiceSettings.
// Kept lightweight and duplicated here so notify.js stays a leaf module.
const _FEMALE_HINTS_RX = /female|woman|zira|aditi|shreya|veena|geeta|hema|prisha|kalpana|neha|ipsheeta|mahita|niha|swara|hina|kajal|meera|priya|payal|sonal|isha|ananya|neel/i;
const _MALE_HINTS_RX   = /male|man|david|ravi|hemant|arjun|sagar|amit|karan|rahul|kabir|vijay|akshay|prabhat/i;
function _matchesGender(voice, gender) {
  if (!gender || !voice || !voice.name) return true;
  if (gender === "female") return _FEMALE_HINTS_RX.test(voice.name);
  if (gender === "male") return _MALE_HINTS_RX.test(voice.name);
  return true;
}

/** Speak a short phrase (English). Returns true if engine was available. */
export function speak(text, opts = {}) {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  try {
    const prefs = _voicePrefs();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? prefs.rate ?? 1.05;
    u.pitch = opts.pitch ?? prefs.pitch ?? 1.0;
    u.volume = opts.volume ?? prefs.volume ?? 1.0;
    u.lang = opts.lang ?? "en-IN";
    // iter-137.h — prefer an Indian voice (hi-IN / en-IN) when available so
    // the wall kiosk sounds natural. Chrome/Edge on Windows ship "Google
    // हिन्दी" and "Google Indian English"; iOS ships "Rishi" / "Veena".
    try {
      const voices = window.speechSynthesis.getVoices() || [];
      const langPrefix = String(u.lang).split("-")[0];
      const pinned = opts.voice
        || (langPrefix === "hi" ? prefs.hindi : "")
        || (langPrefix === "en" ? prefs.english : "");
      // iter-138.p — if a specific voice is pinned, use it regardless of
      // gender. Otherwise pick the first Indian voice of the preferred
      // language that also matches the admin's gender preference, falling
      // back to language-only when no gender-matched voice is available.
      const langMatches = voices.filter((v) =>
        v.lang === u.lang
        || (v.lang || "").toLowerCase().startsWith(langPrefix + "-in")
        || (langPrefix === "hi" && /hindi|veena/i.test(v.name))
        || (langPrefix === "en" && /india|rishi/i.test(v.name)),
      );
      let preferred = null;
      if (pinned) {
        preferred = voices.find((v) => v.name === pinned) || null;
      } else if (prefs.gender && langMatches.length) {
        preferred = langMatches.find((v) => _matchesGender(v, prefs.gender)) || langMatches[0];
      } else if (langMatches.length) {
        preferred = langMatches[0];
      } else {
        preferred = voices.find((v) => v.lang === u.lang) || null;
      }
      if (preferred) u.voice = preferred;
    } catch { /* noop */ }
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** iter-137.h/i — Bilingual "meal check-in successful" announcement.
 *  iter-140 — Now plays ONLY the language the admin picked in
 *  AdminVoiceSettings (`efc.voice.language` → "en" | "hi" | "both").
 *  Default is "en" — the previous behaviour of speaking both languages
 *  back-to-back was confusing on-floor at the wall kiosk.
 *  `meal` — "lunch" | "dinner".
 *  `name` — optional subscriber first name so the announcement can be
 *          personalised: "Rushikesh, dinner check-in successful". */
export function announceCheckinSuccess(meal = "lunch", name = "") {
  const isDinner = String(meal).toLowerCase() === "dinner";
  // Use only the first word so long full-names don't slow the read.
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  // iter-166 · mess-owner-editable greeting templates. The wall kiosk writes
  // its CMS payload into localStorage on mount (see AdminKiosk.jsx). If a
  // template contains "{name}" we substitute the first name; otherwise we
  // prepend it just like the legacy behaviour.
  const readCms = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const applyTpl = (tpl, fallback) => {
    const raw = (tpl || "").trim();
    if (!raw) return fallback;
    if (raw.includes("{name}")) return raw.replace("{name}", first || "").trim().replace(/^,\s*/, "");
    return first ? `${first}, ${raw}` : raw;
  };
  const hindi = applyTpl(
    readCms(isDinner ? "efc.kiosk.greeting_dinner_hi" : "efc.kiosk.greeting_lunch_hi"),
    (first ? `${first}, ` : "") + (isDinner ? "डिनर चेक-इन सफल हुआ। धन्यवाद।" : "लंच चेक-इन सफल हुआ। धन्यवाद।"),
  );
  const english = applyTpl(
    readCms(isDinner ? "efc.kiosk.greeting_dinner_en" : "efc.kiosk.greeting_lunch_en"),
    (first ? `${first}, ` : "") + (isDinner ? "Dinner check-in successful. Thank you." : "Lunch check-in successful. Thank you."),
  );
  try {
    playCheckinSuccess();
  } catch { /* noop */ }
  // Cancel any pending utterances so back-to-back scans don't queue up.
  try { if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); } catch { /* noop */ }
  const language = (_voicePrefs().language || "en").toLowerCase();
  const speakHindi = () => speak(hindi, { lang: "hi-IN", rate: 1.18, pitch: 1.0, volume: 1.0 });
  const speakEnglish = () => speak(english, { lang: "en-IN", rate: 1.22, pitch: 1.0, volume: 1.0 });
  // Small pause after the chime so it doesn't clobber TTS on some engines.
  setTimeout(() => {
    if (language === "hi") {
      speakHindi();
    } else if (language === "both") {
      // Legacy dual-language mode — kept for admins who explicitly opt in.
      speakHindi();
      speakEnglish();
    } else {
      // Default / "en" — single English announcement only.
      speakEnglish();
    }
  }, 220);
}

/**
 * Combo: alarm chime + voice phrase. Use for high-priority events.
 * Many browsers gate audio behind a user gesture — call once in an onClick
 * before relying on auto-fire from polling.
 */
export function alertWithVoice(text) {
  if (!playCustomSound()) playAlarm();
  // small delay so the chime doesn't clobber TTS on some engines
  setTimeout(() => speak(text), 250);
}

// ---------------------------------------------------------------------------
// Admin-uploaded custom notification sound.
// Set via `setCustomSoundUrl(url)` once after fetching from /api/notify-sound.
// playCustomSound() returns true on successful play, false to fall back to
// the generated WebAudio alarm.
// ---------------------------------------------------------------------------
let _customSoundUrl = null;
let _audioEl = null;

export function setCustomSoundUrl(url) {
  _customSoundUrl = url || null;
  if (_audioEl) { try { _audioEl.pause(); } catch {} _audioEl = null; }
}

export function playCustomSound() {
  if (!_customSoundUrl) return false;
  try {
    if (!_audioEl) {
      _audioEl = new Audio(_customSoundUrl);
      _audioEl.preload = "auto";
    }
    _audioEl.currentTime = 0;
    const p = _audioEl.play();
    if (p && typeof p.then === "function") p.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** iter-137.j — Return the list of available Web Speech API voices, awaiting
 *  the async voice-load event on Chrome (voices are populated after a
 *  microtask on first call). Returns an empty array on unsupported browsers. */
export async function listVoicesAsync() {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  const speech = window.speechSynthesis;
  const now = speech.getVoices() || [];
  if (now.length) return now;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(speech.getVoices() || []); };
    speech.addEventListener?.("voiceschanged", finish, { once: true });
    // Fallback in case voiceschanged never fires (Safari, older FF).
    setTimeout(finish, 800);
  });
}

