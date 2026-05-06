/* PWA service worker registration. Called once from src/index.js. */

export function registerSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Don't register on http://localhost dev — CRA dev server hot-reload conflicts with SW caching.
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => {
        // Optional: console.log('SW registered');
      })
      .catch(() => {
        // Silent — registration failures shouldn't break the app.
      });
  });
}
