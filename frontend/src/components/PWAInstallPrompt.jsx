import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Download, X } from "lucide-react";

const DISMISS_KEY = "efc_pwa_dismissed_at";
const DISMISS_TTL_DAYS = 14;
const DEFER_KEY = "efc_pwa_defer_until";

/**
 * Listens for the browser's `beforeinstallprompt` event and surfaces a tasteful
 * bottom-right pill on desktop / bottom-sheet on mobile. We honor a 14-day
 * dismissal so we never nag the user.
 *
 * If the user already installed (display-mode: standalone) or the device doesn't
 * fire the event (Safari/iOS), the pill never shows.
 */
export default function PWAInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Already installed?
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
      return;
    }
    if (window.navigator && window.navigator.standalone) {
      // iOS standalone
      setInstalled(true);
      return;
    }
    // Honor previous dismissal
    try {
      const lastDismiss = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10);
      if (lastDismiss && Date.now() - lastDismiss < DISMISS_TTL_DAYS * 24 * 3600 * 1000) return;
    } catch { /* ignore */ }

    const onBefore = (e) => {
      e.preventDefault();
      setDeferred(e);
      // Wait a beat — don't ambush the first paint.
      const delay = parseInt(localStorage.getItem(DEFER_KEY) || "0", 10) > Date.now() ? 0 : 8000;
      setTimeout(() => setOpen(true), delay);
    };
    const onInstalled = () => { setInstalled(true); setOpen(false); };

    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setOpen(false);
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice?.outcome === "accepted") {
      setOpen(false);
      setInstalled(true);
    } else {
      // Cooldown 1h on dismiss-via-prompt
      try { localStorage.setItem(DEFER_KEY, String(Date.now() + 3600 * 1000)); } catch { /* ignore */ }
      setOpen(false);
    }
  };

  if (installed || !open || !deferred) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-3 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:max-w-sm z-[80] animate-in fade-in slide-in-from-bottom-4 duration-300"
      data-testid="pwa-install-prompt"
    >
      <div className="rounded-2xl bg-card border border-border shadow-2xl p-4 flex items-start gap-3">
        <div className="inline-flex h-11 w-11 rounded-xl bg-primary/10 text-primary items-center justify-center shrink-0">
          <Download className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-extrabold text-base leading-tight">Install eFoodCare</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add the app to your home screen — opens full-screen, loads instantly, works through patchy network.
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={install} size="sm" className="rounded-full bg-primary hover:bg-primary/90 font-semibold" data-testid="pwa-install-btn">
              Install
            </Button>
            <Button onClick={dismiss} size="sm" variant="ghost" className="rounded-full" data-testid="pwa-dismiss-btn">
              Not now
            </Button>
          </div>
        </div>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1" aria-label="Dismiss" data-testid="pwa-close">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
