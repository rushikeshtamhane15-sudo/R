/* useNotifyPrefs — reads/writes server-side notification prefs (per user).
 * Falls back to optimistic UI; errors are silent.
 */
import { useEffect, useState, useCallback } from "react";
import { api } from "./api";

export function useNotifyPrefs() {
  const [prefs, setPrefs] = useState({ sound: true, voice: true });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get("/auth/prefs")
      .then((r) => { if (!cancelled) { setPrefs(r.data); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback(async (partial) => {
    const next = { ...prefs, ...partial };
    setPrefs(next); // optimistic
    try { await api.post("/auth/prefs", partial); } catch { /* silent */ }
    return next;
  }, [prefs]);

  return { prefs, loaded, update };
}
