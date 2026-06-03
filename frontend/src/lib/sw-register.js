/* PWA service worker registration. Called once from src/index.js.
 *
 * Iter-55 #9: auto-update behaviour — when a new service worker becomes
 * available (typically after a fresh production deploy), prompt the running
 * tab to refresh ONCE so the user gets the updated bundle without having to
 * uninstall the PWA. We use a one-shot guard on window so the reload only
 * happens the first time.
 */

export function registerSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((reg) => {
        if (!reg) return;
        // Listen for an installing worker AFTER the current one is already active.
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller && !window.__efSwReloadGuard) {
              window.__efSwReloadGuard = true;
              // Ask the new SW to take over immediately, then reload.
              try { sw.postMessage({ type: "SKIP_WAITING" }); } catch { /* non-critical: storage/network unavailable */ }
              setTimeout(() => window.location.reload(), 400);
            }
          });
        });
        // If a new SW activates while the page is open, also reload.
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });
      })
      .catch(() => { /* silent */ });
  });
}
