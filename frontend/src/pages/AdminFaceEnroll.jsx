/* iter-138.a · Admin batch face-enrollment tool.
 * Runs one-time (or whenever new subscribers upload selfies): loads every
 * enrolled user's profile_photo_url into an off-screen <img>, computes a
 * 128-dim face descriptor via face-api.js in this browser, and posts the
 * result to /admin/users/{id}/face-embedding. Reuses the selfies we
 * already have (86+ users) so nobody has to re-scan on their phone.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Loader2, ScanFace, PlayCircle, StopCircle, RefreshCcw, CheckCircle2, XCircle, ImageOff } from "lucide-react";
import { ensureModelsLoaded, computeDescriptor } from "../lib/faceApi";

const STATUS = { PENDING: "pending", RUNNING: "running", DONE: "done", FAILED: "failed", NO_FACE: "no_face", NO_IMAGE: "no_image" };

function loadImage(url) {
  // face-api.js needs an image element with the pixels available for canvas
  // ops. Some CDNs don't send CORS headers; if crossOrigin="anonymous"
  // fails we retry without it (canvas may then taint, which face-api still
  // works on because it uses toRaw / TypedArrays under the hood).
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      const noCors = new Image();
      noCors.onload = () => resolve(noCors);
      noCors.onerror = () => reject(new Error("Image failed to load"));
      noCors.src = url;
    };
    img.src = url;
  });
}

export default function AdminFaceEnroll() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0, noface: 0, noimg: 0 });
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [statuses, setStatuses] = useState({}); // user_id -> {status, note}
  const stopRef = useRef(false);

  const setStatus = useCallback((uid, status, note = "") => {
    setStatuses((prev) => ({ ...prev, [uid]: { status, note } }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/admin/users/face-enroll-list?only_missing=${onlyMissing ? "true" : "false"}`);
      const list = r.data?.users || [];
      setUsers(list);
      const initial = {};
      list.forEach((u) => { initial[u.user_id] = { status: STATUS.PENDING, note: "" }; });
      setStatuses(initial);
      setProgress({ done: 0, total: list.length, ok: 0, fail: 0, noface: 0, noimg: 0 });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load users");
    } finally { setLoading(false); }
  }, [onlyMissing]);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    stopRef.current = false;
    try {
      toast.message(`Loading face-api.js models (~6 MB, cached after first run)…`, { duration: 3000 });
      await ensureModelsLoaded();
    } catch (e) {
      toast.error(`Models failed to load · ${e?.message || "network"}`);
      setRunning(false);
      return;
    }

    let done = 0, ok = 0, fail = 0, noface = 0, noimg = 0;
    for (const u of users) {
      if (stopRef.current) break;
      setStatus(u.user_id, STATUS.RUNNING);
      if (!u.profile_photo_url) {
        setStatus(u.user_id, STATUS.NO_IMAGE, "No selfie on profile");
        noimg += 1; done += 1;
        setProgress({ done, total: users.length, ok, fail, noface, noimg });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const img = await loadImage(u.profile_photo_url);
        // eslint-disable-next-line no-await-in-loop
        const desc = await computeDescriptor(img);
        if (!desc || !desc.length) {
          setStatus(u.user_id, STATUS.NO_FACE, "Face-api couldn't lock on a face");
          noface += 1;
        } else {
          // eslint-disable-next-line no-await-in-loop
          await api.post(`/admin/users/${u.user_id}/face-embedding`, { embedding: desc });
          setStatus(u.user_id, STATUS.DONE, "Enrolled");
          ok += 1;
        }
      } catch (e) {
        setStatus(u.user_id, STATUS.FAILED, e?.message || "unexpected");
        fail += 1;
      }
      done += 1;
      setProgress({ done, total: users.length, ok, fail, noface, noimg });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 60));
    }
    setRunning(false);
    toast.success(`Enrollment complete · ${ok} ok · ${fail + noface + noimg} skipped`);
  };

  const stop = () => { stopRef.current = true; };

  const StatusPill = ({ s }) => {
    const st = s?.status || STATUS.PENDING;
    const map = {
      [STATUS.PENDING]: { icon: null, cls: "bg-white text-muted-foreground border border-border", label: "Waiting" },
      [STATUS.RUNNING]: { icon: <Loader2 className="h-3 w-3 animate-spin" />, cls: "bg-blue-100 text-blue-700 border border-blue-300", label: "Scanning…" },
      [STATUS.DONE]: { icon: <CheckCircle2 className="h-3 w-3" />, cls: "bg-emerald-100 text-emerald-800 border border-emerald-300", label: "Enrolled" },
      [STATUS.FAILED]: { icon: <XCircle className="h-3 w-3" />, cls: "bg-red-100 text-red-800 border border-red-300", label: "Failed" },
      [STATUS.NO_FACE]: { icon: <ImageOff className="h-3 w-3" />, cls: "bg-amber-100 text-amber-900 border border-amber-300", label: "No face detected" },
      [STATUS.NO_IMAGE]: { icon: <ImageOff className="h-3 w-3" />, cls: "bg-slate-100 text-slate-700 border border-slate-300", label: "No selfie" },
    };
    const m = map[st] || map[STATUS.PENDING];
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${m.cls}`}>{m.icon}{m.label}</span>
    );
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto p-6 sm:p-8 space-y-5" data-testid="admin-face-enroll-page">
      <div>
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Wall kiosk</p>
        <h1 className="font-display font-extrabold text-3xl mt-1 flex items-center gap-2">
          <ScanFace className="h-7 w-7 text-primary" /> Batch face enrollment
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Scans every subscriber's already-uploaded profile selfie once, computes a face descriptor entirely in this browser, and saves it so the wall kiosk can auto-check-in. Skips anyone already enrolled by default — safe to re-run.
        </p>
      </div>

      <div className="rounded-2xl card-3d p-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} disabled={running} data-testid="face-enroll-only-missing" />
          Only users missing an embedding
        </label>
        <Button variant="outline" onClick={load} disabled={loading || running} className="rounded-full" data-testid="face-enroll-reload">
          <RefreshCcw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Reload list
        </Button>
        {!running ? (
          <Button onClick={run} disabled={!users.length} className="rounded-full bg-primary text-primary-foreground font-extrabold" data-testid="face-enroll-run">
            <PlayCircle className="h-4 w-4 mr-1.5" /> Enroll {users.length} subscriber{users.length === 1 ? "" : "s"}
          </Button>
        ) : (
          <Button onClick={stop} variant="destructive" className="rounded-full font-extrabold" data-testid="face-enroll-stop">
            <StopCircle className="h-4 w-4 mr-1.5" /> Stop
          </Button>
        )}
      </div>

      {(running || progress.done > 0) && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
            <span>{progress.done} / {progress.total} processed</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-primary/10 overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} data-testid="face-enroll-progress-bar" />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
            <Stat label="Enrolled" value={progress.ok} tone="ok" />
            <Stat label="No face" value={progress.noface} tone="warn" />
            <Stat label="No image" value={progress.noimg} tone="mute" />
            <Stat label="Failed" value={progress.fail} tone="bad" />
          </div>
        </div>
      )}

      <div className="rounded-2xl card-3d overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {onlyMissing ? "All subscribers with selfies are already enrolled." : "No subscribers have a profile selfie yet."}
          </div>
        ) : (
          <ul className="divide-y divide-border" data-testid="face-enroll-list">
            {users.map((u) => {
              const s = statuses[u.user_id];
              return (
                <li key={u.user_id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`face-enroll-row-${u.user_id}`}>
                  <div className="h-10 w-10 rounded-full overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
                    {u.profile_photo_url ? (
                      <img src={u.profile_photo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <ImageOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold truncate">{u.name || u.user_id}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{s?.note || u.user_id}</p>
                  </div>
                  <StatusPill s={s} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const map = {
    ok: "bg-emerald-100 text-emerald-800 border-emerald-300",
    warn: "bg-amber-100 text-amber-900 border-amber-300",
    bad: "bg-red-100 text-red-800 border-red-300",
    mute: "bg-slate-100 text-slate-700 border-slate-300",
  };
  return (
    <div className={`rounded-lg border px-2 py-1 text-center ${map[tone] || map.mute}`}>
      <p className="text-[9px] tracking-widest uppercase font-bold">{label}</p>
      <p className="text-lg font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
