/* iter-138 · Wall-kiosk continuous face check-in overlay.
 * Runs an always-on camera preview + face detection loop. Every ~1.8s it
 * computes a live 128-dim descriptor and POSTs to /api/kiosk/face-checkin.
 * On strong match the backend records attendance and returns the
 * subscriber name; the parent hooks that into the bilingual voice
 * announcer. Rate-limited so the same person can't spam the endpoint.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { computeDescriptor, ensureModelsLoaded } from "../../lib/faceApi";
import { ScanFace, Loader2, HelpCircle, X as XIcon } from "lucide-react";
import { toast } from "sonner";

// Suppress rapid duplicates: same user_id can't check in more than once per 60s
// (attendance dedup already blocks same-slot duplicates, but this keeps the
// TTS queue clean and avoids hammering the backend on staff standing in view).
const COOLDOWN_MS = 60_000;

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
    setPhase("boot");
    try {
      // Kick off model download in parallel with camera acquisition.
      const modelP = ensureModelsLoaded();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      await modelP;
      setReady(true);
      setPhase("live");
      setLastMsg("Camera ready · walk up to check in");
    } catch (e) {
      setPhase("denied");
      setLastMsg(e && e.name === "NotAllowedError" ? "Camera permission denied" : (e?.message || "Camera failed"));
    }
  }, []);

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
      if (inflightRef.current) { tickTimerRef.current = setTimeout(tick, 1200); return; }
      inflightRef.current = true;
      try {
        setPhase("scanning");
        const desc = await computeDescriptor(videoRef.current);
        if (cancelled) return;
        if (!desc) {
          setPhase("live");
          setLastMsg("Looking for a face…");
        } else {
          try {
            const r = await api.post("/kiosk/face-checkin", { embedding: desc });
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
        }
      } catch (e) {
        setLastMsg(`Detector error · ${(e && e.message) || "?"}`);
      } finally {
        setPhase("live");
        inflightRef.current = false;
        if (!cancelled) tickTimerRef.current = setTimeout(tick, 1800);
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
      <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 justify-center bg-black/60 text-white py-1.5 px-3">
        <ScanFace className={`h-3.5 w-3.5 ${phase === "scanning" ? "text-emerald-300 animate-pulse" : "text-white/80"}`} />
        <span className="text-[10px] tracking-[0.16em] uppercase font-extrabold">Face check-in</span>
        {phase === "boot" && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70 ml-1" />}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-center text-[11px] font-bold py-1.5 px-2 truncate" data-testid="kiosk-face-scan-msg">
        {lastMsg || "Loading camera…"}
      </div>
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
