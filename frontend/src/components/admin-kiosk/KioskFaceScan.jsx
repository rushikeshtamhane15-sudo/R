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
import { ScanFace, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Suppress rapid duplicates: same user_id can't check in more than once per 60s
// (attendance dedup already blocks same-slot duplicates, but this keeps the
// TTS queue clean and avoids hammering the backend on staff standing in view).
const COOLDOWN_MS = 60_000;

export default function KioskFaceScan({ onCheckin, isFullscreen = false, active = true }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const tickTimerRef = useRef(null);
  const inflightRef = useRef(false);
  const lastByUserRef = useRef(new Map()); // user_id → last checkin ms
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState("boot"); // boot | live | scanning | denied | error
  const [lastMsg, setLastMsg] = useState("");

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
    <div className={`relative rounded-2xl overflow-hidden bg-black shadow-lg ring-1 ring-black/30 ${isFullscreen ? "aspect-video" : "aspect-video max-w-md"}`} data-testid="kiosk-face-scan">
      <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
      <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 justify-center bg-black/60 text-white py-1.5 px-3">
        <ScanFace className={`h-3.5 w-3.5 ${phase === "scanning" ? "text-emerald-300 animate-pulse" : "text-white/80"}`} />
        <span className="text-[10px] tracking-[0.16em] uppercase font-extrabold">Face check-in</span>
        {phase === "boot" && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70 ml-1" />}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-center text-[11px] font-bold py-1.5 px-2 truncate" data-testid="kiosk-face-scan-msg">
        {lastMsg || "Loading camera…"}
      </div>
      {phase === "denied" && (
        <button
          type="button"
          onClick={() => { toast.message("Please allow camera access in the browser to enable face check-in"); boot(); }}
          className="absolute inset-0 flex items-center justify-center bg-black/85 text-white text-xs font-extrabold flex-col gap-2"
          data-testid="kiosk-face-scan-retry"
        >
          <ScanFace className="h-6 w-6" />
          Tap to grant camera access
        </button>
      )}
    </div>
  );
}
