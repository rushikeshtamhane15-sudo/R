/* efoodcare service worker — minimal, non-intrusive.
 *
 * Goals:
 * - Make the app installable (PWA) via a fetch handler.
 * - Cache the app shell so repeat opens are instant on poor networks.
 * - NEVER cache /api/* — auth + live data must always hit the backend.
 *
 * Strategy:
 * - Navigation requests: network-first, fall back to cached index.html when offline.
 * - Same-origin static assets (JS/CSS/images): cache-first with background revalidate.
 * - Everything else (third-party, /api, POST/PUT/DELETE): pass-through.
 */

const VERSION = "v-993d0d09af85";
const APP_SHELL = `efoodcare-shell-${VERSION}`;
const STATIC = `efoodcare-static-${VERSION}`;
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // iter-137.k — nuke ALL caches whose keys don't include the current
      // VERSION string. Prior activate() logic only cleared caches missing
      // from the whitelist, which meant a stale service-worker.js identical
      // in content (but with tree-changed bundles) would silently serve a
      // broken mix of old + new hashed JS. Version-scoped keys guarantee a
      // clean slate whenever VERSION is bumped.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return /\.(?:js|css|png|jpg|jpeg|webp|svg|gif|woff2?|ttf|ico)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never touch backend or third-party origins.
  if (isApi(url) || url.origin !== self.location.origin) return;
  // iter-137.l — /recover.html is a stateless escape hatch that MUST hit the
  // network so it can unregister the SW that would otherwise trap the user.
  if (url.pathname === "/recover.html" || url.pathname === "/recover") return;

  // App shell — network-first so we always serve fresh JS bundles when online.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP_SHELL).then((c) => c.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(async () => (await caches.match("/index.html")) || (await caches.match("/")))
    );
    return;
  }

  // Static assets — cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
