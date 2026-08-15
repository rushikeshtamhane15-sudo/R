/* iter-138 · Wall-kiosk continuous face check-in overlay.
 * Runs an always-on camera preview + face detection loop. Every ~1.8s it
 * computes a live 128-dim descriptor and POSTs to /api/kiosk/face-checkin.
 * On strong match the backend records attendance and returns the
 * subscriber name; the parent hooks that into the bilingual voice
 * announcer. Rate-limited so the same person can't spam the endpoint.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { detectFace, ensureModelsLoaded } from "../../lib/faceApi";
import { ScanFace, Loader2, HelpCircle, X as XIcon } from "lucide-react";
import { toast } from "sonner";

// Suppress rapid duplicates: same user_id can't check in more than once per 60s
// (attendance dedup already blocks same-slot duplicates, but this keeps the
// TTS queue clean and avoids hammering the backend on staff standing in view).
const COOLDOWN_MS = 60_000;

// iter-138.l — alignment target: face must fit inside this centered box for
// the guide ring to turn green. Values are fractions of the video frame.
//   TARGET box: 40% width, 60% height, centered.
//   FACE_MIN / FACE_MAX: acceptable face-box width as a fraction of the
//   video width — filters out "too far" (tiny face) and "too close" (huge
//   face) states.
//   OFFSET_TOL: max distance (fraction of video) the face-box center can
//   drift from the target center before turning red.
const TARGET_BOX = { x: 0.30, y: 0.18, w: 0.40, h: 0.64 };
const FACE_MIN_W = 0.18;
const FACE_MAX_W = 0.55;
const OFFSET_TOL = 0.12;

function computeAlignment(box) {
  if (!box) return { aligned: false, reason: "no-face" };
  const cxFace = box.x + box.w / 2;
  const cyFace = box.y + box.h / 2;
  const cxTarget = TARGET_BOX.x + TARGET_BOX.w / 2;
  const cyTarget = TARGET_BOX.y + TARGET_BOX.h / 2;
  // The <video> is CSS-mirrored (scaleX(-1)) so users see themselves
  // naturally; the underlying frame we detect on is NOT mirrored. Mirror
  // the face-box X for UI alignment math.
  const dx = Math.abs((1 - cxFace) - cxTarget);
  const dy = Math.abs(cyFace - cyTarget);
  if (box.w < FACE_MIN_W) return { aligned: false, reason: "too-far" };
  if (box.w > FACE_MAX_W) return { aligned: false, reason: "too-close" };
  if (dx > OFFSET_TOL) return { aligned: false, reason: dx > 0 ? "off-center" : "off-center" };
  if (dy > OFFSET_TOL) return { aligned: false, reason: "off-center" };
  return { aligned: true, reason: "ok" };
}

export default function KioskFaceScan({ onCheckin, isFullscreen = false, active = true, fillParent = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const tickTimerRef = useRef(null);
  const inflightRef = useRef(false);
  const lastByUserRef = useRef(new Map()); // user_id → last checkin ms
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState("boot"); // boot | live | scanning | denied | error
  const [lastMsg, setLastMsg] = useState("");
  const [helperOpen, setHelperOpen] = useState(false);
  // iter-138.l — live alignment state drives the red/green target ring and
  // gates the check-in POST. Only "aligned" faces (centered + right size)
  // trigger a network round-trip; misaligned faces just update the coach
  // message ("move closer", "too close", "look at camera").
  const [alignment, setAlignment] = useState({ aligned: false, reason: "no-face" });

  const stopCamera = useCallback(() => {
    try { if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null; } } catch { /* noop */ }
    try {
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    } catch { /* noop */ }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const boot = useCallback(async () => {
    if (streamRef.current && streamRef.current.active) {
      // iter-138.i — don't re-acquire the camera if we already have a live
      // stream (was causing a strobe/blink cycle every 5s when the model
      // download failed and set phase="denied", triggering the poll to
      // retry boot() while the camera was still perfectly fine).
      setPhase("live");
      return;
    }
    setPhase("boot");
    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPhase("denied");
      setLastMsg("Camera API unavailable · use HTTPS + Chrome/Edge/Safari");
      return;
    }
    // Step 1 — acquire camera. Anything after this is best-effort so a
    // model-download failure never blinks the live preview.
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch { /* iOS autoplay */ }
      }
      setPhase("live");
      setLastMsg("Camera live · loading recognition models…");
    } catch (e) {
      const name = e && e.name ? e.name : "";
      const msg = e && e.message ? e.message : "";
      // eslint-disable-next-line no-console
      console.warn("[face-scan] camera boot failed", name, msg);
      if (name === "NotAllowedError" || name === "SecurityError") {
        setPhase("denied");
        setLastMsg("Camera permission denied · allow in browser 🔒 icon then reload");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setPhase("denied");
        setLastMsg("No camera detected on this device");
      } else if (name === "NotReadableError") {
        setPhase("denied");
        setLastMsg("Camera busy — close other apps/tabs using the camera, then reload");
      } else {
        setPhase("denied");
        setLastMsg(`Camera failed · ${name || "error"} · ${msg || "reload page"}`);
      }
      return;
    }
    // Step 2 — try to load recognition models. If this fails, keep the
    // camera live and show a distinct error message. NEVER flip back to
    // "denied" from a model error — the poll would strobe the camera off.
    // iter-138.j — a dedicated retry effect below re-attempts model load
    // every 8s while `ready` is false, so an initial CDN blip doesn't leave
    // the tile stuck in a "camera live but no detection" limbo.
    try {
      await ensureModelsLoaded();
      setReady(true);
      setLastMsg("Camera ready · walk up to check in");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[face-scan] models load failed", e && e.message);
      setReady(false);
      setLastMsg("Camera live · loading recognition models…");
    }
  }, []);

  // iter-138.j — keep retrying `ensureModelsLoaded()` in the background
  // whenever the camera is live but recognition isn't ready. Without this,
  // one flaky CDN response leaves the tile in a "live video, zero detection"
  // state until the operator reloads the page.
  useEffect(() => {
    if (!active || ready) return undefined;
    let cancelled = false;
    let attempt = 0;
    const tryLoad = async () => {
      if (cancelled || ready) return;
      attempt += 1;
      try {
        await ensureModelsLoaded();
        if (cancelled) return;
        setReady(true);
        setLastMsg("Camera ready · walk up to check in");
      } catch (e) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn(`[face-scan] model retry #${attempt} failed`, e && e.message);
        // iter-138.o — after 3 failed attempts we're almost certainly stuck
        // on a stale service-worker cache. Automatically unregister the SW
        // and hard-reload — ONCE per browser session (guarded by a
        // sessionStorage flag) so a legitimate offline network doesn't loop
        // the page forever. The tile becomes "always on" from the operator's
        // point of view: no tap needed, the browser fixes itself.
        if (attempt >= 3) {
          const key = "efc.facescan.autoReloaded";
          try {
            const alreadyReloaded = window.sessionStorage.getItem(key) === "1";
            if (!alreadyReloaded) {
              window.sessionStorage.setItem(key, "1");
              setLastMsg("Reloading recognition models…");
              try {
                if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                  const regs = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(regs.map((r) => r.unregister()));
                }
                if (typeof caches !== "undefined" && caches.keys) {
                  const keys = await caches.keys();
                  await Promise.all(keys.map((k) => caches.delete(k)));
                }
              } catch { /* noop */ }
              setTimeout(() => { try { window.location.reload(); } catch { /* noop */ } }, 400);
              return;
            }
          } catch { /* noop */ }
          setLastMsg("Recognition models offline · check network");
        } else {
          setLastMsg(`Recognition models loading · retry ${attempt}…`);
        }
        setTimeout(tryLoad, 8_000);
      }
    };
    // First retry fires ~2s after the initial boot() attempt fails so we
    // don't hammer the CDN back-to-back.
    const t = setTimeout(tryLoad, 2_000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [active, ready]);

  // iter-138.h — 30s heartbeat so the admin dashboard can flag a wall
  // kiosk that's lost camera without staff walking to the display.
  useEffect(() => {
    if (!active) return undefined;
    const send = () => {
      try {
        api.post("/admin/kiosk/heartbeat", {
          camera_ok: phase === "live" || phase === "scanning",
          voice_on: true,
          ua: (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent.slice(0, 200) : "",
        }).catch(() => { /* silent */ });
      } catch { /* noop */ }
    };
    send();
    const id = setInterval(send, 30_000);
    return () => clearInterval(id);
  }, [active, phase]);

  // Boot the camera whenever the parent enables us.
  useEffect(() => {
    if (!active) { stopCamera(); return; }
    boot();
  }, [active, boot, stopCamera]);

  // iter-138.f — self-heal from a sticky "denied" phase. Browsers cache a
  // "camera: denied" once the user rejects the first prompt; even after the
  // user re-enables permission via the address-bar icon, our getUserMedia
  // call above already resolved with "denied" and won't retry on its own.
  // Two safety nets:
  //   1. Subscribe to Permissions API changes and re-boot the moment the
  //      status flips to "granted".
  //   2. Every 5s while in the denied phase, silently probe getUserMedia
  //      again. Cheap (throws immediately when denied) and unblocks the
  //      user when they granted permission via a browser dialog we can't
  //      observe.
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let permStatus = null;
    const onChange = () => { if (!cancelled && permStatus && permStatus.state === "granted") boot(); };
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: "camera" }).then((s) => {
          if (cancelled) return;
          permStatus = s;
          s.addEventListener("change", onChange);
          if (s.state === "granted") boot();
        }).catch(() => { /* Firefox may reject camera name */ });
      }
    } catch { /* noop */ }
    const poll = setInterval(() => {
      if (cancelled) return;
      if (phase === "denied") boot();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      try { if (permStatus) permStatus.removeEventListener("change", onChange); } catch { /* noop */ }
    };
  }, [active, boot, phase]);

  // Scanning loop
  useEffect(() => {
    if (!ready || !active) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (inflightRef.current) { tickTimerRef.current = setTimeout(tick, 500); return; }
      inflightRef.current = true;
      try {
        setPhase("scanning");
        const detected = await detectFace(videoRef.current);
        if (cancelled) return;
        if (!detected) {
          setAlignment({ aligned: false, reason: "no-face" });
          setPhase("live");
          setLastMsg("Look at the camera to check in");
          return;
        }
        const align = computeAlignment(detected.box);
        setAlignment(align);
        if (!align.aligned) {
          // Coach the user into the target frame — don't waste a network
          // round-trip on a face that isn't centered/sized correctly yet.
          setPhase("live");
          if (align.reason === "too-far") setLastMsg("Move closer to the camera");
          else if (align.reason === "too-close") setLastMsg("Step back a little");
          else if (align.reason === "off-center") setLastMsg("Center your face in the green frame");
          else setLastMsg("Look straight at the camera");
          return;
        }
        // Aligned! Fire the check-in POST.
        setLastMsg("Matching…");
        try {
          const r = await api.post("/kiosk/face-checkin", { embedding: detected.descriptor });
          if (cancelled) return;
          const data = r.data || {};
          if (data.ok && data.subscriber_user_id) {
            const uid = data.subscriber_user_id;
            const now = Date.now();
            const last = lastByUserRef.current.get(uid) || 0;
            if (now - last >= COOLDOWN_MS) {
              lastByUserRef.current.set(uid, now);
              setLastMsg(`✓ ${data.subscriber_name || "Guest"} · ${data.meal_type}`);
              try { onCheckin && onCheckin(data); } catch { /* noop */ }
            } else {
              setLastMsg(`${data.subscriber_name || "Guest"} · already checked in`);
            }
          } else if (data.reason === "borderline") {
            setLastMsg(`Face unclear · move closer · ${(data.candidate && data.candidate.name) || ""}`);
          } else if (data.reason === "attendance_blocked") {
            setLastMsg(`${(data.candidate && data.candidate.name) || "Face matched"} · ${data.detail}`);
          } else {
            setLastMsg("Face not recognised · scan QR from mobile");
          }
        } catch (err) {
          const s = err?.response?.status;
          const detail = err?.response?.data?.detail;
          if (s === 404 && detail && /No enrolled/.test(detail)) {
            setLastMsg("No subscribers enrolled yet · enroll from Profile page");
          } else if (s === 400) {
            setLastMsg(detail || "No active meal slot");
          } else {
            setLastMsg("Server didn't respond · will retry");
          }
        }
      } catch (e) {
        setLastMsg(`Detector error · ${(e && e.message) || "?"}`);
      } finally {
        setPhase("live");
        inflightRef.current = false;
        // Faster tick (700ms) so the red/green frame reacts quickly as the
        // user moves; when a check-in is in flight we throttle to 500ms.
        if (!cancelled) tickTimerRef.current = setTimeout(tick, 700);
      }
    };
    tick();
    return () => { cancelled = true; if (tickTimerRef.current) clearTimeout(tickTimerRef.current); };
  }, [ready, active, onCheckin]);

  return (
    <div
      className={`relative rounded-2xl overflow-hidden bg-black shadow-lg ring-1 ring-black/30 ${fillParent ? "w-full h-full" : (isFullscreen ? "aspect-video" : "aspect-video max-w-md")} ${phase === "live" && !lastMsg.startsWith("✓") ? "kiosk-face-pulse" : ""}`}
      data-testid="kiosk-face-scan"
    >
      <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
      {/* iter-138.p — face alignment target: a fixed-aspect oval (aspect
          3/4, ~60% of the container width) centered in the tile so it
          always renders as a natural face-shaped ring regardless of how
          tall the container gets. The alignment MATH still uses the
          TARGET_BOX percentages against the video frame; the visual
          oval is a UI guide, not the geometry test. */}
      {ready && phase !== "denied" && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          data-testid="kiosk-face-align-target"
          data-aligned={alignment.aligned ? "1" : "0"}
        >
          <div
            className={`h-[62%] aspect-[3/4] rounded-[36%_36%_44%_44%/40%_40%_50%_50%] border-[6px] transition-colors duration-150 ${
              alignment.aligned
                ? "border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.75)]"
                : "border-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.55)]"
            }`}
            style={{
              backgroundColor: alignment.aligned ? "rgba(16,185,129,0.10)" : "rgba(244,63,94,0.06)",
            }}
          />
        </div>
      )}
      <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 justify-center bg-black/60 text-white py-1.5 px-3">
        <ScanFace className={`h-3.5 w-3.5 ${phase === "scanning" ? "text-emerald-300 animate-pulse" : "text-white/80"}`} />
        <span className="text-[10px] tracking-[0.16em] uppercase font-extrabold">Face check-in</span>
        {phase === "boot" && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70 ml-1" />}
      </div>
      <button
        type="button"
        onClick={() => {
          // iter-138.o — one-tap manual recovery if the auto-reload has
          // already fired once this session and models still won't load.
          // Clears service-worker + caches then hard-reloads.
          if (typeof lastMsg === "string" && /reload|offline/i.test(lastMsg)) {
            (async () => {
              try {
                if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                  const regs = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(regs.map((r) => r.unregister()));
                }
                if (typeof caches !== "undefined" && caches.keys) {
                  const keys = await caches.keys();
                  await Promise.all(keys.map((k) => caches.delete(k)));
                }
                try { window.sessionStorage.removeItem("efc.facescan.autoReloaded"); } catch { /* noop */ }
              } catch { /* noop */ }
              // eslint-disable-next-line no-restricted-globals
              window.location.reload();
            })();
          }
        }}
        className={`absolute inset-x-0 bottom-0 text-white text-center font-extrabold py-2 px-2 leading-tight ${
          lastMsg && /reload|offline/i.test(lastMsg)
            ? "bg-amber-600 animate-pulse cursor-pointer text-sm sm:text-base"
            : "bg-black/70 cursor-default text-xs sm:text-sm"
        }`}
        data-testid="kiosk-face-scan-msg"
      >
        {lastMsg || (ready ? "Look at the camera to check in" : "Loading detector…")}
      </button>
      {phase === "denied" && (
        <>
          <button
            type="button"
            onClick={() => { try { window.location.reload(); } catch { boot(); } }}
            className="absolute inset-0 flex items-center justify-center bg-black/85 text-white text-xs font-extrabold flex-col gap-2 px-3 text-center"
            data-testid="kiosk-face-scan-retry"
          >
            <ScanFace className="h-6 w-6" />
            <span>Tap to grant camera access</span>
            <span className="text-[10px] font-normal opacity-80 leading-tight">
              Allow camera in the browser · this button reloads the page so the new permission takes effect.
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setHelperOpen(true); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setHelperOpen(true); } }}
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-extrabold underline underline-offset-2 text-emerald-300"
              data-testid="kiosk-face-scan-help"
            >
              <HelpCircle className="h-3 w-3" /> Show me how
            </span>
          </button>
          {helperOpen && (
            <div className="absolute inset-0 z-10 bg-slate-900/95 text-white p-4 flex flex-col gap-2 overflow-auto" data-testid="kiosk-face-scan-helper" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold text-emerald-300">Reset camera permission</p>
                <button type="button" onClick={() => setHelperOpen(false)} className="h-6 w-6 inline-flex items-center justify-center rounded-full bg-white/15" aria-label="Close"><XIcon className="h-3.5 w-3.5" /></button>
              </div>
              <ol className="mt-1 space-y-1.5 text-[11px] leading-snug list-decimal list-inside">
                <li>Click the <b>🔒 lock icon</b> on the left of the address bar.</li>
                <li>Find <b>Camera</b> in the list → set it to <b>Allow</b>.</li>
                <li>Tap <b>Reset permissions</b> if it&apos;s stuck as &quot;Blocked&quot;.</li>
                <li>Close the popup and <b>reload</b> the page (Ctrl + R).</li>
                <li>Return here — the camera will start automatically.</li>
              </ol>
              <button
                type="button"
                onClick={() => { try { window.location.reload(); } catch { setHelperOpen(false); boot(); } }}
                className="mt-2 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-xs h-8"
                data-testid="kiosk-face-scan-helper-retry"
              >
                I&apos;ve allowed it — reload &amp; retry
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
