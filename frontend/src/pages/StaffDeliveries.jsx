import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Truck, Sun, Moon, Loader2, RefreshCw, Phone, MapPin, Recycle, Search, Package,
} from "lucide-react";

export default function StaffDeliveries() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [meal, setMeal] = useState("lunch");
  const [size, setSize] = useState("all");      // all | full | half
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/staff/today-deliveries");
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load today's deliveries");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const counts = data?.counts || {};
  const rows = data?.rows || [];

  const filtered = useMemo(() => {
    return rows
      .filter((r) => r.meal_type === meal)
      .filter((r) => (size === "all" ? true : r.tiffin_size === size))
      .filter((r) => {
        if (!q.trim()) return true;
        const needle = q.toLowerCase();
        return (
          (r.name || "").toLowerCase().includes(needle) ||
          (r.phone || "").includes(q) ||
          (r.address || "").toLowerCase().includes(needle) ||
          (r.pincode || "").includes(q)
        );
      });
  }, [rows, meal, size, q]);

  const fullCount = filtered.filter((x) => x.tiffin_size === "full").length;
  const halfCount = filtered.filter((x) => x.tiffin_size === "half").length;

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading today's run…</div>;

  return (
    <div className="space-y-5" data-testid="staff-deliveries-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" /> Operations · today
          </p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-1">
            Today's tiffins · {data?.date}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Live packing list for lunch + dinner with full vs half splits. Read-only — delivery boys mark delivered from their app.
          </p>
        </div>
        <Button onClick={load} variant="outline" className="rounded-full" data-testid="refresh-deliveries">
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Lunch · full" value={counts.lunch?.full || 0} icon={Sun} />
        <Stat label="Lunch · half" value={counts.lunch?.half || 0} icon={Sun} accent />
        <Stat label="Dinner · full" value={counts.dinner?.full || 0} icon={Moon} />
        <Stat label="Dinner · half" value={counts.dinner?.half || 0} icon={Moon} accent />
      </div>

      <div className="rounded-2xl border border-border bg-primary/5 p-4 flex flex-wrap items-center gap-3" data-testid="totals-bar">
        <Package className="h-5 w-5 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Pack-out today</p>
          <p className="font-display font-extrabold text-xl mt-0.5">
            {counts.total_lunch} lunch + {counts.total_dinner} dinner = {(counts.total_lunch || 0) + (counts.total_dinner || 0)} tiffins
          </p>
        </div>
        {counts.outstanding_empties > 0 && (
          <div className="rounded-full bg-amber-200 text-amber-900 px-4 py-2 text-xs font-bold flex items-center gap-1.5" data-testid="outstanding-empties">
            <Recycle className="h-3.5 w-3.5" /> {counts.outstanding_empties} empties to collect
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex bg-muted rounded-full p-1" role="tablist">
          {[
            { id: "lunch", icon: Sun, label: "Lunch" },
            { id: "dinner", icon: Moon, label: "Dinner" },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                onClick={() => setMeal(m.id)}
                data-testid={`tab-${m.id}`}
                className={`px-4 h-9 rounded-full text-xs font-bold uppercase tracking-overline transition-colors flex items-center gap-1.5 ${meal === m.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {m.label}
              </button>
            );
          })}
        </div>
        <div className="inline-flex bg-muted rounded-full p-1" role="tablist">
          {[
            { id: "all", label: "All" },
            { id: "full", label: "Full" },
            { id: "half", label: "Half" },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setSize(s.id)}
              data-testid={`size-${s.id}`}
              className={`px-4 h-9 rounded-full text-xs font-bold uppercase tracking-overline transition-colors ${size === s.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone / pincode" className="rounded-full h-9 pl-9 text-sm" data-testid="search-deliveries" />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} rows · {fullCount}F + {halfCount}H</span>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="deliveries-table">
            <thead className="bg-muted/40 text-[10px] tracking-overline uppercase font-bold text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-left px-4 py-3">Address</th>
                <th className="text-left px-4 py-3">Pin</th>
                <th className="text-left px-4 py-3">Size</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Empties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No tiffins match the filters.</td></tr>
              )}
              {filtered.map((r, idx) => (
                <tr key={r.roster_id} className="hover:bg-muted/30" data-testid={`row-${r.roster_id}`}>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{r.name}</p>
                    {r.phone && <a href={`tel:${r.phone}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {r.phone}</a>}
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="text-xs text-muted-foreground line-clamp-2">{r.address || "—"}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.pincode || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] tracking-overline uppercase font-bold px-2 py-0.5 rounded-full ${r.tiffin_size === "full" ? "bg-primary/10 text-primary" : "bg-secondary/15 text-secondary"}`}>
                      {r.tiffin_size}
                    </span>
                    {/* Iter-52: per-user food preferences snapshot */}
                    {r.tiffin_preferences && (
                      <div className="mt-1.5 flex flex-wrap gap-1" data-testid={`prefs-${r.roster_id}`}>
                        {["rice", "dal", "chapati", "sabji"].map((k) => {
                          const on = r.tiffin_preferences[k] !== false;
                          return (
                            <span
                              key={k}
                              className={`text-[9px] tracking-wide font-bold px-1.5 py-0.5 rounded ${on ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700 line-through"}`}
                              title={`${k}: ${on ? "Yes" : "Skip"}`}
                            >
                              {on ? "✓" : "✗"} {k}
                            </span>
                          );
                        })}
                        {r.tiffin_preferences.chapati_count != null && r.tiffin_preferences.chapati !== false && (
                          <span className="text-[9px] tracking-wide font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                            {r.tiffin_preferences.chapati_count}× chapati
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] tracking-overline uppercase font-bold ${r.status === "delivered" ? "text-emerald-600" : r.status === "out" ? "text-amber-600" : r.status === "returned" ? "text-destructive" : "text-muted-foreground"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.tiffin_balance > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-700 text-xs font-bold">
                        <Recycle className="h-3 w-3" /> ×{r.tiffin_balance}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, accent }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "bg-secondary/10 border-secondary/20" : "bg-card border-border"}`} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-").replace(/·/g, "")}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <p className="font-display font-extrabold text-2xl sm:text-3xl mt-2" data-testid={`stat-value-${label.toLowerCase().replace(/\s+/g, "-").replace(/·/g, "")}`}>{value}</p>
    </div>
  );
}
