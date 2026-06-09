/**
 * MessSwitcher — iter-76 #3.
 *
 * Auto-picks the closest active mess on first mount (using browser geo) and
 * shows a compact pill in the header. Tapping it opens a sheet with all
 * active branches sorted by distance — user can override.
 *
 * Storage:
 *   • localStorage('efc_user_mess_v1') — quick read for SSR/first paint
 *   • POST /api/me/mess (server-side persistence for logged-in users)
 */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "./ui/sheet";
import { Button } from "./ui/button";
import { Building2, MapPin, Loader2, Navigation, Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";

const STORAGE_KEY = "efc_user_mess_v1";

export default function MessSwitcher({ variant = "pill" }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
  });
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);

  /* === Hydrate from server if logged in ============================== */
  useEffect(() => {
    let alive = true;
    if (!user) return undefined;
    (async () => {
      try {
        const r = await api.get("/me/mess");
        if (!alive) return;
        if (r.data?.mess) {
          setCurrent(r.data.mess);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r.data.mess)); } catch { /* no-op */ }
        }
      } catch { /* fall back to localStorage */ }
    })();
    return () => { alive = false; };
  }, [user]);

  /* === Auto-pick by location on first ever load ====================== */
  useEffect(() => {
    if (current) return undefined;
    let alive = true;
    // Fallback timer: if geo is unavailable / denied within 4s, load the
    // default corporate mess so the pill always shows something.
    const fallbackTimer = setTimeout(async () => {
      if (!alive || current) return;
      try {
        const r = await api.get("/messes");
        const def = (r.data?.messes || []).find((m) => m.mess_id === r.data?.default_mess_id) || r.data?.messes?.[0];
        if (def && alive && !current) {
          setCurrent(def);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(def)); } catch { /* no-op */ }
        }
      } catch { /* keep null */ }
    }, 4000);
    if (typeof navigator === "undefined" || !navigator.geolocation) return () => { alive = false; clearTimeout(fallbackTimer); };
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await api.get(`/messes/nearby?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
          if (!alive) return;
          const closest = r.data?.messes?.[0];
          if (closest) {
            clearTimeout(fallbackTimer);
            setCurrent(closest);
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(closest)); } catch { /* no-op */ }
            if (user) { try { await api.post("/me/mess", { mess_id: closest.mess_id }); } catch { /* no-op */ } }
          }
        } catch { /* default mess remains */ }
      },
      () => {/* user denied — fallback timer will pick default */},
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 30 * 60 * 1000 },
    );
    return () => { alive = false; clearTimeout(fallbackTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/messes";
      // If geo is granted, ask for sorted-by-distance list instead.
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 4000 }));
          url = `/messes/nearby?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`;
        } catch { /* unauthorised — fall back to alphabetical */ }
      }
      const r = await api.get(url);
      setList(r.data?.messes || []);
    } catch { toast.error("Could not load branches"); }
    finally { setLoading(false); }
  }, []);

  const pick = async (m) => {
    setPicking(true);
    try {
      setCurrent(m);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch { /* no-op */ }
      if (user) {
        await api.post("/me/mess", { mess_id: m.mess_id });
      }
      toast.success(`Switched to ${m.name}`);
      setOpen(false);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not switch"); }
    finally { setPicking(false); }
  };

  if (!current && variant === "pill") {
    // first-paint placeholder — quietly absent
    return null;
  }

  const TriggerEl = variant === "pill" ? (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white px-2.5 h-7 text-[10.5px] font-extrabold tracking-wide max-w-[180px]"
      data-testid="mess-switcher-pill"
      onClick={() => loadList()}
    >
      <MapPin className="h-3 w-3 shrink-0" />
      <span className="truncate" title={current?.name}>{current?.city || current?.name?.split("·")?.[1]?.trim() || current?.name || "Pick branch"}</span>
    </button>
  ) : (
    <Button variant="ghost" className="rounded-full" data-testid="mess-switcher-btn" onClick={() => loadList()}>
      <MapPin className="h-4 w-4 mr-1.5" /> {current?.name || "Pick branch"}
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (o) loadList(); }}>
      <SheetTrigger asChild>{TriggerEl}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[80vh] overflow-y-auto" data-testid="mess-switcher-sheet">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display font-extrabold text-2xl flex items-center gap-2">
            <Navigation className="h-5 w-5 text-primary" /> Pick your branch
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">Closest to you first. Your subscription &amp; orders are scoped to the selected branch.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2.5" data-testid="mess-switcher-list">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading branches…</div>
          ) : list.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active branches yet.</p>
          ) : list.map((m) => {
            const selected = current?.mess_id === m.mess_id;
            return (
              <button
                key={m.mess_id}
                type="button"
                onClick={() => pick(m)}
                disabled={picking}
                className={`w-full text-left p-3.5 rounded-2xl border transition-colors ${selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                data-testid={`mess-switcher-item-${m.slug}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-extrabold text-base">{m.name}</span>
                  {m.is_franchise && <span className="text-[9px] tracking-[0.16em] uppercase font-extrabold rounded-full px-1.5 py-0.5 bg-fuchsia-500/15 text-fuchsia-700">Franchise</span>}
                  {typeof m.distance_km === "number" && (
                    <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{m.distance_km} km</span>
                  )}
                  {selected && <span className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] font-bold text-primary"><Check className="h-3 w-3" /> Current</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.address}, {m.city}</p>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
