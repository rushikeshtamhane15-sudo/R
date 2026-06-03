/**
 * lib/cms-cache.js — iter-59 #5
 *
 * Caches CMS payloads in localStorage so cold loads render the last-known
 * persisted values immediately, instead of flashing the hardcoded defaults
 * for ~200-800ms while the network fetch resolves.
 *
 * Usage:
 *   const initial = readCmsCache("/content/login");  // synchronous
 *   const [content, setContent] = useState({...DEFAULTS, ...initial});
 *
 *   useEffect(() => {
 *     api.get("/content/login").then((r) => {
 *       setContent({...DEFAULTS, ...r.data});
 *       writeCmsCache("/content/login", r.data);
 *     });
 *   }, []);
 *
 * The cache key is the URL path. TTL is 30 days (we accept slightly stale
 * data on first paint; the network refresh overwrites within 1 sec).
 */
const PREFIX = "efc_cms_v1::";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function readCmsCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (!ts || Date.now() - ts > TTL_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function writeCmsCache(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* quota or disabled — silent */
  }
}

export function clearCmsCache(key) {
  try {
    if (key) localStorage.removeItem(PREFIX + key);
    else {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
      }
    }
  } catch { /* ignore */ }
}
