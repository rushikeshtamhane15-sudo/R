/**
 * BranchSwitcher — iter-95.
 *
 * Tiny popover anchored to the AdminLayout branch-pill that lets an HQ admin
 * temporarily "view as branch <X>". Persists the choice in localStorage so
 * the dashboard / control-tower stays scoped across reloads.
 *
 * Renders nothing for franchise owners (they are hard-locked to their own
 * branch on the backend regardless).
 */
import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ChevronDown, Check, MapPin, Loader2 } from "lucide-react";

export default function BranchSwitcher({ trigger, side = "bottom" }) {
  const { user, asMessId, setAsMessId } = useAuth();
  const [open, setOpen] = useState(false);
  const [messes, setMesses] = useState(null);
  const [loading, setLoading] = useState(false);
  const popRef = useRef(null);

  // Franchise owners cannot switch — backend always forces their mess.
  const canSwitch = user?.role === "admin" || user?.role === "staff";

  useEffect(() => {
    if (!open || messes) return;
    setLoading(true);
    api.get("/admin/messes", { params: { as_mess_id: null } })
      .then((r) => setMesses(r.data?.messes || []))
      .catch(() => setMesses([]))
      .finally(() => setLoading(false));
  }, [open, messes]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (popRef.current && !popRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const pick = (id) => {
    setAsMessId(id);
    setOpen(false);
    // Soft reload-style: reset transient client state by reloading the current
    // route. Cheaper alternative to plumbing a global "scope changed" event.
    window.location.reload();
  };

  if (!canSwitch) {
    // Pass-through: render the pill but make it non-interactive (franchise owner).
    return typeof trigger === "function" ? trigger({ open: false, toggle: () => {} }) : null;
  }

  return (
    <div className="relative inline-block" ref={popRef}>
      {typeof trigger === "function" && trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={`absolute z-50 ${side === "bottom" ? "top-full mt-2" : "bottom-full mb-2"} left-0 w-72 max-w-[95vw] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden`}
          data-testid="branch-switcher-popover"
          role="dialog"
        >
          <div className="px-4 pt-3 pb-2 border-b border-border">
            <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">View as branch</p>
            <p className="text-xs text-muted-foreground mt-0.5">Filters the dashboard / control-tower to that mess only. You stay logged in as admin.</p>
          </div>
          <div className="max-h-[300px] overflow-y-auto py-1">
            <Row
              icon={<MapPin className="h-4 w-4" />}
              label="HQ · all branches"
              sub="default · sees everything"
              active={!asMessId}
              onClick={() => pick(null)}
              testid="branch-switcher-all"
            />
            {loading && (
              <div className="px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading branches…
              </div>
            )}
            {!loading && (messes || []).map((m) => (
              <Row
                key={m.mess_id}
                icon={<MapPin className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-300" />}
                label={m.name}
                sub={`${m.city || ""}${m.is_franchise ? " · franchise" : " · corporate"}`}
                active={asMessId === m.mess_id}
                onClick={() => pick(m.mess_id)}
                testid={`branch-switcher-${m.slug || m.mess_id}`}
              />
            ))}
            {!loading && messes && messes.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted-foreground">No branches yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, sub, active, onClick, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors ${active ? "bg-primary/5" : ""}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-sm truncate">{label}</span>
        {sub && <span className="block text-[11px] text-muted-foreground truncate">{sub}</span>}
      </span>
      {active && <Check className="h-4 w-4 text-primary shrink-0" />}
    </button>
  );
}

// Tiny chevron helper for the pill — keeps AdminLayout's import surface small.
export function PillChevron() {
  return <ChevronDown className="h-3 w-3 opacity-70" />;
}
