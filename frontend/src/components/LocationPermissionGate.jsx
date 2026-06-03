import React, { useEffect, useState } from "react";
import { MapPin, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";

/**
 * LocationPermissionGate — iter-60 #1
 *
 * Compulsory location permission popup. Stays open and keeps asking until
 * the user grants access. If they deny, the modal stays up with a stronger
 * message and a retry button — the rest of the app is BLOCKED (the modal
 * sits on a 100vh backdrop with z-[100]).
 *
 * Pages that need serviceability checks render this gate. We only short-
 * circuit if the user has already granted (Permissions API reports
 * "granted") or if the page is rendered server-side / Permissions API
 * unavailable (then we fall back to a one-shot getCurrentPosition request).
 *
 * The component is intentionally not styled around a single page — it's
 * mounted globally from App.js so every public surface respects the gate.
 */

const SS_DISMISSED = "efc_location_granted_v1"; // once granted we don't show again in this session

export default function LocationPermissionGate() {
  const [state, setState] = useState("checking"); // checking | needed | denied | granted
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (sessionStorage.getItem(SS_DISMISSED) === "1") { setState("granted"); return; }
    let cancelled = false;
    (async () => {
      // Probe via Permissions API where supported
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const status = await navigator.permissions.query({ name: "geolocation" });
          if (cancelled) return;
          if (status.state === "granted") {
            sessionStorage.setItem(SS_DISMISSED, "1");
            setState("granted");
            return;
          }
          if (status.state === "denied") { setState("denied"); return; }
        } catch {/* fall through */}
      }
      // Always end up asking — the actual getCurrentPosition call below is
      // what triggers the browser's native permission prompt.
      setState("needed");
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const requestPermission = () => {
    if (!("geolocation" in navigator)) {
      // Cannot proceed without a geolocation API — leave the gate up.
      return;
    }
    setState("checking");
    navigator.geolocation.getCurrentPosition(
      () => {
        sessionStorage.setItem(SS_DISMISSED, "1");
        setState("granted");
      },
      (err) => {
        if (err && err.code === err.PERMISSION_DENIED) setState("denied");
        else setState("needed"); // network / timeout — let them retry
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  if (state === "granted" || state === "checking") return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="location-permission-gate"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-card rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl">
        <div className="inline-flex h-12 w-12 rounded-2xl bg-primary/12 text-primary items-center justify-center">
          <MapPin className="h-6 w-6" />
        </div>
        <h2 className="font-display font-extrabold text-xl sm:text-2xl mt-4 leading-tight">
          {state === "denied" ? "Location access blocked" : "We need your location"}
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          {state === "denied" ? (
            <>
              You blocked location access. We use it <b className="text-foreground">only</b> to confirm you are inside our delivery zone — nothing else. <br />
              <span className="inline-flex items-start gap-1.5 mt-2 text-xs text-foreground">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 text-emerald-600 shrink-0" />
                Open your browser site settings → unblock <b>Location</b> for this site, then tap retry.
              </span>
            </>
          ) : (
            <>
              eFoodCare needs your one-time location pin to confirm we deliver in your area. We never track you in the background.
              <span className="inline-flex items-start gap-1.5 mt-2 text-xs text-foreground">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 text-emerald-600 shrink-0" />
                We don't collect it for marketing. Used only for serviceability.
              </span>
            </>
          )}
        </p>
        {state === "denied" && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-xs text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Until access is granted, browsing is paused. Subscribing & ordering need this check.</span>
          </div>
        )}
        <div className="mt-5 flex flex-col gap-2">
          <Button
            onClick={() => { setAttempt((a) => a + 1); requestPermission(); }}
            className="w-full rounded-full h-11 text-sm font-semibold"
            data-testid="location-gate-allow"
          >
            {state === "denied" ? "I've updated settings — retry" : "Allow location access"}
          </Button>
          {state === "needed" && (
            <p className="text-[11px] text-muted-foreground text-center mt-1">
              <Loader2 className="h-3 w-3 inline animate-spin mr-1 align-middle" />
              Your browser will show a permission prompt. Tap "Allow".
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
