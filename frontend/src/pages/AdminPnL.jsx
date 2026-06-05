import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, Save, Calculator, IndianRupee, Sparkles } from "lucide-react";

const EXPENSE_FIELDS = [
  { key: "salary",      label: "Salaries (employees)" },
  { key: "rent",        label: "Rent" },
  { key: "electricity", label: "Electricity bill" },
  { key: "loan_emi",    label: "Loan EMI" },
  { key: "other",       label: "Other recurring" },
];

// iter-65 #8: P&L resets on the 6th of each month (5th = last day of cycle).
function currentCycleYM(d = new Date()) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (d.getDate() >= 6) return `${y}-${String(m).padStart(2, "0")}`;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}
function prevCycleYM(ym) {
  const [y, m] = ym.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}
function nextCycleYM(ym) {
  const [y, m] = ym.split("-").map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export default function AdminPnL() {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("cycle"); // cycle | days
  const [days, setDays] = useState(30);
  const [cycle, setCycle] = useState(() => currentCycleYM());
  const [exp, setExp] = useState({ salary: 0, rent: 0, electricity: 0, loan_emi: 0, other: 0 });
  const [savingExp, setSavingExp] = useState(false);
  const [editingExp, setEditingExp] = useState(false);

  const load = async () => {
    try {
      const q = mode === "cycle"
        ? `cycle=${encodeURIComponent(cycle)}`
        : `days=${days}`;
      const r = await api.get(`/admin/pnl/daily?${q}`);
      setData(r.data);
      setExp({ ...exp, ...(r.data.expenses || {}) });
    } catch { toast.error("Could not load P&L"); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [mode, days, cycle]);

  const saveExp = async () => {
    setSavingExp(true);
    try {
      await api.put("/admin/pnl/expenses", {
        salary: Number(exp.salary) || 0,
        rent: Number(exp.rent) || 0,
        electricity: Number(exp.electricity) || 0,
        loan_emi: Number(exp.loan_emi) || 0,
        other: Number(exp.other) || 0,
      });
      toast.success("Monthly expenses saved");
      setEditingExp(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSavingExp(false); }
  };

  // iter-65 #8: "Flash net profit on 6th" — when today is the 6th, the
  // user lands here looking for last cycle's net. We surface a banner.
  const today = new Date();
  const isFlashDay = today.getDate() === 6 && mode === "cycle" && cycle === currentCycleYM(today);
  const prevYm = prevCycleYM(currentCycleYM(today));
  const [flashPrev, setFlashPrev] = useState(null);
  useEffect(() => {
    if (!isFlashDay) { setFlashPrev(null); return; }
    (async () => {
      try { const r = await api.get(`/admin/pnl/daily?cycle=${encodeURIComponent(prevYm)}`); setFlashPrev(r.data?.summary || null); }
      catch { /* noop */ }
    })();
  }, [isFlashDay, prevYm]);

  if (!data) return <div className="p-12 text-center text-muted-foreground">Loading P&L…</div>;

  const summary = data.summary || {};
  const config = data.config || {};
  const cy = data.cycle || {};

  return (
    <div className="space-y-6" data-testid="admin-pnl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight flex items-center gap-2">
            <Calculator className="h-6 w-6 text-primary" /> Profit & loss
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Per-day revenue (subs + restaurant) minus expenses (raw material + salary + rent + electricity + loan EMI).</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="inline-flex rounded-full bg-muted/50 p-1 gap-1" data-testid="pnl-mode-toggle">
            <button type="button" onClick={() => setMode("cycle")} className={`px-3 h-8 rounded-full text-xs font-semibold ${mode === "cycle" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`} data-testid="pnl-mode-cycle">Billing cycle</button>
            <button type="button" onClick={() => setMode("days")} className={`px-3 h-8 rounded-full text-xs font-semibold ${mode === "days" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`} data-testid="pnl-mode-days">Last N days</button>
          </div>
          {mode === "cycle" ? (
            <div className="inline-flex items-center gap-2">
              <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => setCycle(prevCycleYM(cycle))} data-testid="pnl-cycle-prev">←</Button>
              <span className="font-mono text-xs tabular-nums px-2 inline-flex items-center h-8 rounded-md border border-border bg-card" data-testid="pnl-cycle-label">
                6 {new Date(`${cycle}-06`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
              </span>
              <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => setCycle(nextCycleYM(cycle))} data-testid="pnl-cycle-next">→</Button>
              <Button size="sm" variant="ghost" className="rounded-full h-8 text-xs" onClick={() => setCycle(currentCycleYM())} data-testid="pnl-cycle-now">This cycle</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              {[7, 30, 60, 90].map((d) => (
                <Button key={d} size="sm" variant={days === d ? "default" : "outline"} className="rounded-full" onClick={() => setDays(d)} data-testid={`pnl-days-${d}`}>{d}d</Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* iter-65 #8: Flash banner on the 6th — last cycle's net is celebrated/regretted */}
      {flashPrev && (
        <div
          className={`rounded-2xl p-4 border ${flashPrev.is_profit ? "bg-emerald-50 border-emerald-300 text-emerald-900" : "bg-rose-50 border-rose-300 text-rose-900"}`}
          data-testid="pnl-prev-cycle-flash"
        >
          <p className="text-[10px] tracking-overline uppercase font-bold opacity-80 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Previous cycle ({prevYm}) closed</p>
          <p className="font-display font-extrabold text-2xl mt-1.5 tabular-nums">
            {flashPrev.is_profit ? "Net profit · +" : "Net loss · -"}₹{Math.abs(flashPrev.net || 0).toLocaleString("en-IN")}
          </p>
          <p className="text-xs mt-0.5 opacity-80 tabular-nums">Revenue ₹{Math.round(flashPrev.total_revenue || 0).toLocaleString("en-IN")} − Expense ₹{Math.round(flashPrev.total_expense || 0).toLocaleString("en-IN")}</p>
        </div>
      )}

      {/* Top-line summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total revenue" value={summary.total_revenue} accent />
        <Stat label="Total expense" value={summary.total_expense} />
        <Stat label={summary.is_profit ? "Net profit" : "Net loss"} value={Math.abs(summary.net || 0)} positive={summary.is_profit} negative={!summary.is_profit} icon={summary.is_profit ? TrendingUp : TrendingDown} />
        <Stat label="Days tracked" value={summary.days || days} raw />
      </div>

      {/* Expense config */}
      <section className="rounded-2xl border border-border bg-card p-5" data-testid="pnl-expense-config">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className="font-display font-extrabold flex items-center gap-2"><IndianRupee className="h-4 w-4 text-primary" /> Monthly fixed expenses</p>
            <p className="text-xs text-muted-foreground">Daily fixed cost = monthly ÷ 30 = <b className="font-mono">₹{(config.daily_fixed || 0).toFixed(2)}</b>. Daily raw material cost = <b className="font-mono">₹{(config.daily_raw_material || 0).toFixed(2)}</b> (auto-computed).</p>
          </div>
          {!editingExp ? (
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditingExp(true)} data-testid="pnl-edit-exp">Edit</Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setEditingExp(false); load(); }}>Cancel</Button>
              <Button size="sm" onClick={saveExp} disabled={savingExp} className="rounded-full bg-primary hover:bg-primary/90" data-testid="pnl-save-exp">
                <Save className="h-3.5 w-3.5 mr-1.5" /> {savingExp ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {EXPENSE_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{f.label}</span>
              {editingExp ? (
                <Input type="number" min={0} step={100} value={exp[f.key]} onChange={(e) => setExp({ ...exp, [f.key]: e.target.value })} className="mt-1 font-mono tabular-nums" data-testid={`exp-${f.key}`} />
              ) : (
                <p className="font-mono text-base font-bold mt-1 tabular-nums" data-testid={`exp-readonly-${f.key}`}>₹{Number(exp[f.key] || 0).toLocaleString("en-IN")}</p>
              )}
            </label>
          ))}
        </div>
      </section>

      {/* Daily breakdown */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] tracking-overline uppercase font-bold text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-right px-4 py-3">Subs ₹</th>
                <th className="text-right px-4 py-3">Restaurant ₹</th>
                <th className="text-right px-4 py-3">Revenue ₹</th>
                <th className="text-right px-4 py-3">Raw mat ₹</th>
                <th className="text-right px-4 py-3">Fixed ₹</th>
                <th className="text-right px-4 py-3">Net ₹</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.slice().reverse().map((r) => (
                <tr key={r.date} className={r.net >= 0 ? "" : "bg-rose-50 dark:bg-rose-950/20"} data-testid={`pnl-row-${r.date}`}>
                  <td className="px-4 py-2 font-mono text-xs">{r.date}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{r.sub_revenue.toFixed(0)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{r.rest_revenue.toFixed(0)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums font-bold">{r.total_revenue.toFixed(0)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">{r.raw_material_cost.toFixed(0)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">{r.fixed_cost.toFixed(0)}</td>
                  <td className={`px-4 py-2 text-right font-mono tabular-nums font-extrabold ${r.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {r.net >= 0 ? "+" : ""}{r.net.toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* iter-65 #8: Breakeven projection (mock, editable) */}
      <BreakevenProjection
        defaultMonthlyFixed={config.monthly_fixed || 0}
        defaultDailyRaw={config.daily_raw_material || 0}
        cycleNet={summary.net || 0}
      />
    </div>
  );
}

function BreakevenProjection({ defaultMonthlyFixed, defaultDailyRaw, cycleNet }) {
  const [mFixed, setMFixed] = useState(defaultMonthlyFixed);
  const [dRaw, setDRaw] = useState(defaultDailyRaw);
  const [revPerDay, setRevPerDay] = useState(2000);

  useEffect(() => { setMFixed(defaultMonthlyFixed); }, [defaultMonthlyFixed]);
  useEffect(() => { setDRaw(defaultDailyRaw); }, [defaultDailyRaw]);

  const proj = useMemo(() => {
    const monthlyFixed = Number(mFixed || 0);
    const dailyRaw = Number(dRaw || 0);
    const rev = Number(revPerDay || 0);
    const dailyFixed = monthlyFixed / 30;
    const dailyNet = rev - dailyRaw - dailyFixed;
    const breakevenDays = dailyNet > 0 ? Math.ceil(monthlyFixed / dailyNet) : null;
    const monthlyNet = dailyNet * 30;
    return { dailyFixed, dailyNet, breakevenDays, monthlyNet };
  }, [mFixed, dRaw, revPerDay]);

  return (
    <section className="rounded-2xl border border-border bg-card p-5" data-testid="pnl-projection">
      <p className="font-display font-extrabold flex items-center gap-2"><Calculator className="h-4 w-4 text-primary" /> Breakeven projection</p>
      <p className="text-xs text-muted-foreground">Mock calculator — change the numbers to see how many days it takes to recover this month's fixed costs.</p>
      <div className="mt-3 grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Monthly fixed ₹</span>
          <Input type="number" min={0} step={500} value={mFixed} onChange={(e) => setMFixed(e.target.value)} className="mt-1 font-mono tabular-nums" data-testid="proj-fixed" />
        </label>
        <label className="block">
          <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Daily raw mat ₹</span>
          <Input type="number" min={0} step={100} value={dRaw} onChange={(e) => setDRaw(e.target.value)} className="mt-1 font-mono tabular-nums" data-testid="proj-raw" />
        </label>
        <label className="block">
          <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Projected revenue/day ₹</span>
          <Input type="number" min={0} step={100} value={revPerDay} onChange={(e) => setRevPerDay(e.target.value)} className="mt-1 font-mono tabular-nums" data-testid="proj-rev" />
        </label>
      </div>
      <div className="mt-4 grid sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-xl bg-muted/40 p-3" data-testid="proj-daily-net">
          <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Daily net</p>
          <p className={`font-display font-extrabold text-xl mt-1 tabular-nums ${proj.dailyNet >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{proj.dailyNet >= 0 ? "+" : ""}₹{Math.round(proj.dailyNet).toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-xl bg-muted/40 p-3" data-testid="proj-monthly-net">
          <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Projected monthly net</p>
          <p className={`font-display font-extrabold text-xl mt-1 tabular-nums ${proj.monthlyNet >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{proj.monthlyNet >= 0 ? "+" : ""}₹{Math.round(proj.monthlyNet).toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-xl bg-primary/10 border border-primary/30 p-3" data-testid="proj-breakeven">
          <p className="text-[10px] tracking-overline uppercase font-bold text-primary">Breakeven in</p>
          <p className="font-display font-extrabold text-xl mt-1 tabular-nums">
            {proj.breakevenDays != null ? `${proj.breakevenDays} day${proj.breakevenDays !== 1 ? "s" : ""}` : "—"}
          </p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-3">Reference: current cycle net so far = <b className="font-mono">{cycleNet >= 0 ? "+" : ""}₹{Math.round(cycleNet).toLocaleString("en-IN")}</b>.</p>
    </section>
  );
}

function Stat({ label, value, accent, positive, negative, raw, icon: Icon }) {
  return (
    <div className={`rounded-2xl border p-4 ${
      accent ? "bg-primary/5 border-primary/20" :
      positive ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/40" :
      negative ? "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/40" :
      "border-border bg-card"
    }`} data-testid={`pnl-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p>
        {Icon && <Icon className={`h-3.5 w-3.5 ${positive ? "text-emerald-600" : negative ? "text-rose-600" : "text-muted-foreground"}`} />}
      </div>
      <p className="font-display font-extrabold text-2xl sm:text-3xl mt-2 tabular-nums">
        {raw ? value : `₹${Math.round(value || 0).toLocaleString("en-IN")}`}
      </p>
    </div>
  );
}
