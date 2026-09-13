/* AdminMyBottomNav — iter-168 mess-owner editor for THEIR mess's subscriber
 * bottom-nav slot whitelist. Doesn't touch the eFoodTech (super-admin) copy
 * seen by anonymous / logged-out users.
 *
 * Backend endpoints (mess-owner-scoped):
 *   GET  /api/admin/bottom-nav/slot-catalog       — full catalog
 *   GET  /api/admin/messes/<my mess>/bottom-nav-slots
 *   PATCH /api/admin/messes/<my mess>/bottom-nav-slots
 *
 * Frontend contract: shows a checkbox list of every slot in the catalog with
 * the currently-enabled ones pre-checked. Save persists the array.
 */
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Loader2, Save, Layout, RefreshCw } from "lucide-react";

export default function AdminMyBottomNav() {
  const { user, asMessId } = useAuth();
  const [catalog, setCatalog] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [messId, setMessId] = useState(null);
  const [messName, setMessName] = useState("");

  // iter-168 · resolve the caller's target mess via the backend helper so we
  // work correctly even when user.mess_id drifted from the canonical
  // messes.owner_user_id link. Falls back to `asMessId` (impersonation) or
  // `user.mess_id` if the helper can't tell.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (user?.role === "admin" && asMessId) {
        if (alive) setMessId(asMessId);
        return;
      }
      try {
        // iter-168 · reuse existing /franchise/me/mess endpoint (returns full
        // mess doc under `mess` key for mess_owner; scope='global' for un-
        // impersonated admin — we fall through to messId=null in that case).
        const r = await api.get("/franchise/me/mess");
        if (!alive) return;
        const m = r.data?.mess || null;
        setMessId(m?.mess_id || null);
        setMessName(m?.name || "");
      } catch {
        if (alive) setMessId(user?.mess_id || null);
      }
    })();
    return () => { alive = false; };
  }, [user?.role, user?.user_id, user?.mess_id, asMessId]);

  const load = async () => {
    if (!messId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        api.get("/admin/bottom-nav/slot-catalog"),
        api.get(`/admin/messes/${messId}/bottom-nav-slots`),
      ]);
      setCatalog(c.data?.slots || []);
      setSelected(s.data?.slots || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load slot whitelist");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [messId]);

  const toggle = (key) => {
    setSelected((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const save = async () => {
    if (!messId) return;
    if (selected.length === 0) { toast.error("Pick at least one tab"); return; }
    setSaving(true);
    try {
      await api.patch(`/admin/messes/${messId}/bottom-nav-slots`, { slots: selected });
      toast.success("Saved · your logged-in subscribers will see these tabs on next refresh");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const enabledSet = useMemo(() => new Set(selected), [selected]);

  if (loading) return (
    <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );

  if (!messId) return (
    <div className="max-w-2xl mx-auto p-8 text-center" data-testid="admin-my-bottom-nav-nomess">
      <p className="text-sm text-muted-foreground">No mess selected. Open a specific mess from <a href="/super-admin/messes" className="text-primary underline">Onboarded messes</a> to edit its subscriber bottom-nav, or log in as that mess&rsquo;s owner.</p>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-my-bottom-nav">
      <div>
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">My mess · subscriber tabs</p>
        <h1 className="font-display font-extrabold text-3xl mt-1 flex items-center gap-2">
          <Layout className="h-7 w-7 text-primary" /> My bottom navigation
        </h1>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          Toggle which bottom-nav tabs your <span className="font-bold">logged-in subscribers</span> see. Logged-out visitors of the eFoodTech platform always see the super-admin&rsquo;s default nav &mdash; this page never touches that.
        </p>
      </div>

      <section className="rounded-2xl card-3d p-5 space-y-2" data-testid="my-bottom-nav-slots">
        {catalog.map((s) => {
          const on = enabledSet.has(s.key);
          return (
            <label
              key={s.key}
              className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 cursor-pointer transition-colors ${on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
              data-testid={`slot-row-${s.key}`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(s.key)}
                className="h-5 w-5 rounded border-2 border-primary accent-primary"
                data-testid={`slot-toggle-${s.key}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{s.label}</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate">{s.key}</p>
              </div>
              <span className={`text-[10px] font-extrabold uppercase tracking-widest px-2 py-1 rounded-full ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{on ? "Shown" : "Hidden"}</span>
            </label>
          );
        })}
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={load} disabled={saving} className="rounded-full" data-testid="my-bottom-nav-reload">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Reload
        </Button>
        <Button onClick={save} disabled={saving} className="rounded-full" data-testid="my-bottom-nav-save">
          <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
