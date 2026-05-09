/* Lightweight sound + voice notifications (Web Audio + speechSynthesis).
 * No external deps. Falls back gracefully where APIs are missing.
 */

let _ctx = null;
function ctx() {
  if (typeof window === "undefined") return null;
  if (_ctx) return _ctx;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) _ctx = new Ctor();
  } catch { /* noop */ }
  return _ctx;
}

/** Sharp 2-tone "ping" — for new orders, ready alerts. */
export function playPing() {
  const ac = ctx(); if (!ac) return;
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

/** Dramatic 3-tone alarm — for OUT-FOR-DELIVERY, RIDER ARRIVED. */
export function playAlarm() {
  const ac = ctx(); if (!ac) return;
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

/** Speak a short phrase (English). Returns true if engine was available. */
export function speak(text, opts = {}) {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? 1.05;
    u.pitch = opts.pitch ?? 1.0;
    u.volume = opts.volume ?? 1.0;
    u.lang = opts.lang ?? "en-IN";
    window.speechSynthesis.cancel(); // avoid pile-up
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

/**
 * Combo: alarm chime + voice phrase. Use for high-priority events.
 * Many browsers gate audio behind a user gesture — call once in an onClick
 * before relying on auto-fire from polling.
 */
export function alertWithVoice(text) {
  playAlarm();
  // small delay so the chime doesn't clobber TTS on some engines
  setTimeout(() => speak(text), 250);
}
