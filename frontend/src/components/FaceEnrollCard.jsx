/* iter-138 · Face check-in enrollment card for the user Profile page.
 * Opens the front camera, captures three consecutive frames, computes a
 * 128-dim descriptor via face-api.js, averages them for stability, then
 * POSTs the vector to /users/me/face-embedding. One-time setup — the wall
 * kiosk then auto-recognises the user on future visits.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Loader2, ScanFace, Trash2, CheckCircle2, Camera } from "lucide-react";
import { toast } from "sonner";
import { ensureModelsLoaded, computeDescriptor } from "../lib/faceApi";

function _avg(vectors) {
  // Element-wise mean of the descriptors — reduces jitter from single frames.
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

export default function FaceEnrollCard() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [enrolled, setEnrolled] = useState(false);
  const [enrolledAt, setEnrolledAt] = useState(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | preparing | scanning | saving
  const [progress, setProgress] = useState(0);

  const loadStatus = useCallback(async () => {
    try {
      const r = await api.get("/users/me/face-embedding");
      setEnrolled(!!r.data?.enrolled);
      setEnrolledAt(r.data?.updated_at || null);
    } catch { /* noop — likely unauth */ }
    finally { setStatusLoaded(true); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const stopCamera = useCallback(() => {
    try {
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    } catch { /* noop */ }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startEnrollment = async () => {
    setPhase("preparing");
    setProgress(0);
    try {
      // Kick off model download early so it overlaps with camera setup.
      const modelP = ensureModelsLoaded();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Video element missing");
      video.srcObject = stream;
      await video.play();
      await modelP;
      setPhase("scanning");

      // Capture 3 descriptors with a short pause between so head movement
      // doesn't dominate. Each attempt has a small retry budget.
      const captured = [];
      const NEEDED = 3;
      const MAX_TRIES = 12;
      let tries = 0;
      while (captured.length < NEEDED && tries < MAX_TRIES) {
        tries += 1;
        // eslint-disable-next-line no-await-in-loop
        const d = await computeDescriptor(video);
        if (d && d.length) {
          captured.push(d);
          setProgress(Math.round((captured.length / NEEDED) * 100));
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 350));
      }
      if (captured.length < NEEDED) {
        toast.error("Could not detect your face clearly. Move to bright light and try again.");
        stopCamera();
        setPhase("idle");
        return;
      }
      const mean = _avg(captured);
      setPhase("saving");
      await api.post("/users/me/face-embedding", { embedding: mean });
      toast.success("Face check-in enabled — walk up to the wall kiosk!");
      setEnrolled(true);
      setEnrolledAt(new Date().toISOString());
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Enrollment failed";
      toast.error(detail);
    } finally {
      stopCamera();
      setPhase("idle");
      setProgress(0);
    }
  };

  const unenroll = async () => {
    try {
      await api.delete("/users/me/face-embedding");
      setEnrolled(false); setEnrolledAt(null);
      toast.success("Face check-in disabled");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to remove"); }
  };

  if (!statusLoaded) return null;
  const scanning = phase === "scanning" || phase === "preparing";
  return (
    <div className="rounded-2xl border border-emerald-300 bg-emerald-50/40 p-4" data-testid="face-enroll-card">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
          <ScanFace className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-display font-extrabold text-base text-emerald-900">Face check-in (wall kiosk)</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Walk up to the wall kiosk camera — you'll be recognised automatically, no phone needed. Enrollment runs entirely in this browser; only a math vector (not the photo) is sent to the server.
          </p>
          {enrolled && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-extrabold px-2.5 py-1" data-testid="face-enroll-status-on">
              <CheckCircle2 className="h-3.5 w-3.5" /> Enrolled{enrolledAt ? ` · ${enrolledAt.slice(0, 10)}` : ""}
            </div>
          )}
        </div>
      </div>

      {scanning && (
        <div className="mt-3">
          <div className="relative rounded-2xl overflow-hidden bg-black/80 aspect-video max-w-sm mx-auto">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-center text-xs font-extrabold py-2 tracking-widest uppercase">
              {phase === "preparing" ? "Loading models…" : `Scanning · ${progress}%`}
            </div>
          </div>
        </div>
      )}
      {phase === "saving" && (
        <p className="mt-2 text-xs text-muted-foreground text-center inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</p>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <Button
          onClick={startEnrollment}
          disabled={phase !== "idle"}
          className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs"
          data-testid="face-enroll-start"
        >
          {enrolled ? <Camera className="h-3.5 w-3.5 mr-1.5" /> : <ScanFace className="h-3.5 w-3.5 mr-1.5" />}
          {enrolled ? "Re-scan face" : "Enable face check-in"}
        </Button>
        {enrolled && (
          <Button onClick={unenroll} variant="ghost" className="rounded-full text-red-700 hover:bg-red-50 text-xs" data-testid="face-enroll-remove">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
