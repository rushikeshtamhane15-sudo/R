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
    };
  } catch { return { hindi: "", english: "", rate: null, pitch: null, volume: null }; }
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
      const preferred = pinned
        ? voices.find((v) => v.name === pinned)
        : voices.find((v) => v.lang === u.lang)
          || voices.find((v) => (v.lang || "").toLowerCase().startsWith(langPrefix + "-in"))
          || voices.find((v) => /india|hindi|rishi|veena/i.test(v.name));
      if (preferred) u.voice = preferred;
    } catch { /* noop */ }
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** iter-137.h/i — Bilingual "meal check-in successful" announcement.
 *  Plays the success chord first, then Hindi followed by English so the
 *  wall kiosk audibly confirms each subscriber's attendance in both
 *  languages. Voices default to hi-IN / en-IN.
 *  `meal` — "lunch" | "dinner".
 *  `name` — optional subscriber first name so the announcement can be
 *          personalised: "Rushikesh, dinner check-in successful". */
export function announceCheckinSuccess(meal = "lunch", name = "") {
  const isDinner = String(meal).toLowerCase() === "dinner";
  // Use only the first word so long full-names don't slow the read.
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  const hindiPrefix = first ? `${first}, ` : "";
  const englishPrefix = first ? `${first}, ` : "";
  const hindi = isDinner
    ? `${hindiPrefix}डिनर चेक-इन सफल हुआ। धन्यवाद।`
    : `${hindiPrefix}लंच चेक-इन सफल हुआ। धन्यवाद।`;
  const english = isDinner
    ? `${englishPrefix}Dinner check-in successful. Thank you.`
    : `${englishPrefix}Lunch check-in successful. Thank you.`;
  try {
    playCheckinSuccess();
  } catch { /* noop */ }
  // Cancel any pending utterances so back-to-back scans don't queue up.
  try { if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); } catch { /* noop */ }
  // Chime lasts ~450ms. Give a short pause before the voice fires.
  setTimeout(() => {
    speak(hindi, { lang: "hi-IN", rate: 0.98, pitch: 1.0, volume: 1.0 });
    // Chain English after the Hindi utterance finishes. speechSynthesis
    // queues utterances FIFO, so we can just enqueue the English right
    // after — it starts when the Hindi one ends.
    speak(english, { lang: "en-IN", rate: 1.02, pitch: 1.0, volume: 1.0 });
  }, 500);
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

