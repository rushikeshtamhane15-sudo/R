/**
 * AdminWalletTopup — iter-79 Batch C #7.
 *
 * Self-contained admin tool to manually credit/debit a user's wallet
 * without a Razorpay payment. Used when:
 *   • A subscriber pays cash to the manager and needs the wallet topped up.
 *   • Admin offers a goodwill credit / refund after a complaint.
 *   • Manual correction of a wallet balance.
 *
 * Backend (already exists):
 *   GET  /api/admin/users                          → user directory
 *   GET  /api/admin/users/{id}/wallet-history      → past txns + admin overrides
 *   POST /api/admin/users/{id}/wallet-adjust       → {delta, reason, extend_days, restore_meals}
 */
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Wallet, Search, IndianRupee, ChevronRight, Loader2, History, Plus, Minus,
  Phone, Mail, User as UserIcon, CalendarDays, Sparkles, ShieldCheck,
} from "lucide-react";

const QUICK_AMOUNTS = [100, 500, 1000, 2500];

export default function AdminWalletTopup() {
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  // Adjust form
  const [direction, setDirection] = useState("credit"); // credit | debit
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [extendDays, setExtendDays] = useState(0);
  const [restoreMeals, setRestoreMeals] = useState(0);
  const [saving, setSaving] = useState(false);

  // History panel
  const [history, setHistory] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setUsersLoading(true);
      try {
        const r = await api.get("/admin/users");
        if (!cancelled) setUsers(r.data?.users || []);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Could not load users");
      } finally { if (!cancelled) setUsersLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, 100);
    return users.filter((u) => (
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q)
    )).slice(0, 100);
  }, [users, query]);

  const loadHistory = async (uid) => {
    setHistory(null);
    try {
      const r = await api.get(`/admin/users/${uid}/wallet-history`);
      setHistory(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "History failed"); }
  };

  const pickUser = (u) => {
    setSelected(u);
    setDirection("credit");
    setAmount("");
    setReason("");
    setExtendDays(0);
    setRestoreMeals(0);
    loadHistory(u.user_id);
  };

  const apply = async () => {
    if (!selected) return;
    const amt = Number(amount || 0);
    if (!amt && !extendDays && !restoreMeals) {
      toast.error("Enter an amount or a sub adjustment"); return;
    }
    if (!reason.trim()) {
      toast.error("Reason is required for the audit log"); return;
    }
    setSaving(true);
    try {
      const delta = direction === "credit" ? amt : -amt;
      const r = await api.post(`/admin/users/${selected.user_id}/wallet-adjust`, {
        delta,
        reason: reason.trim(),
        extend_days: Number(extendDays) || 0,
        restore_meals: Number(restoreMeals) || 0,
      });
      const newBal = r.data?.after?.user_wallet ?? null;
      toast.success(`Wallet adjusted${newBal != null ? ` — new balance ₹${newBal}` : ""}`);
      // Refresh local list + history
      setUsers((prev) => prev.map((u) => u.user_id === selected.user_id ? { ...u, wallet_balance: newBal ?? u.wallet_balance } : u));
      setSelected((s) => s ? { ...s, wallet_balance: newBal ?? s.wallet_balance } : s);
      setAmount(""); setReason(""); setExtendDays(0); setRestoreMeals(0);
      loadHistory(selected.user_id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Adjust failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8" data-testid="admin-wallet-topup">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Finance · admin tool</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Manual wallet top-up</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed max-w-2xl">
        Credit or debit any user&apos;s wallet without going through Razorpay. Useful when a subscriber pays cash to the manager, when issuing a goodwill credit, or correcting a balance. Every adjustment is audit-logged with your email and the reason.
      </p>

      <div className="mt-8 grid lg:grid-cols-5 gap-6">
        {/* LEFT — user search + list */}
        <div className="lg:col-span-2 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, phone or email…"
              className="pl-9 rounded-xl"
              data-testid="wallet-topup-search"
            />
          </div>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {usersLoading ? (
              <div className="p-6 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No users match &quot;{query}&quot;</div>
            ) : (
              <ul className="max-h-[460px] overflow-y-auto divide-y divide-border" data-testid="wallet-topup-userlist">
                {filtered.map((u) => {
                  const active = selected?.user_id === u.user_id;
                  return (
                    <li key={u.user_id}>
                      <button
                        type="button"
                        onClick={() => pickUser(u)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-muted/50 flex items-center gap-3 transition-colors ${active ? "bg-primary/8" : ""}`}
                        data-testid={`wallet-user-${u.user_id}`}
                      >
                        <span className={`inline-flex h-8 w-8 rounded-full items-center justify-center text-[10px] font-extrabold ${active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                          {(u.name || u.email || u.phone || "?").slice(0, 2).toUpperCase()}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">{u.name || u.email || u.phone || u.user_id}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{u.phone || u.email}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground font-bold">Wallet</p>
                          <p className="text-sm font-display font-extrabold tabular-nums">₹{Number(u.wallet_balance || 0).toLocaleString("en-IN")}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Showing first 100 matches. Refine search to narrow further.</p>
        </div>

        {/* RIGHT — selected user + adjust form */}
        <div className="lg:col-span-3">
          {!selected ? (
            <div className="rounded-2xl border-2 border-dashed border-border bg-card/50 p-10 text-center text-muted-foreground">
              <Wallet className="h-7 w-7 mx-auto mb-2 opacity-60" />
              <p className="text-sm font-bold">Select a user to top-up their wallet</p>
              <p className="text-xs mt-1">Find them by phone, name or email on the left.</p>
            </div>
          ) : (
            <div className="space-y-4" data-testid="wallet-topup-form">
              {/* User snapshot */}
              <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-12 w-12 rounded-2xl items-center justify-center bg-primary text-primary-foreground text-sm font-extrabold">
                    {(selected.name || selected.email || "?").slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-display font-extrabold text-xl tracking-tight" data-testid="wallet-topup-user-name">{selected.name || selected.email || "Unnamed user"}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {selected.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {selected.phone}</span>}
                      {selected.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {selected.email}</span>}
                      {selected.role && <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" /> {selected.role}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground font-bold">Wallet</p>
                    <p className="font-display font-extrabold text-2xl tabular-nums" data-testid="wallet-topup-current-balance">₹{Number(selected.wallet_balance || 0).toLocaleString("en-IN")}</p>
                  </div>
                </div>
              </div>

              {/* Credit / Debit toggle */}
              <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Direction</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDirection("credit")}
                    className={`rounded-xl border-2 px-3 py-2.5 flex items-center justify-center gap-2 text-sm font-extrabold transition-colors ${direction === "credit" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-border hover:border-emerald-400"}`}
                    data-testid="wallet-direction-credit"
                  >
                    <Plus className="h-4 w-4" /> Credit (top-up)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection("debit")}
                    className={`rounded-xl border-2 px-3 py-2.5 flex items-center justify-center gap-2 text-sm font-extrabold transition-colors ${direction === "debit" ? "border-destructive bg-destructive/5 text-destructive" : "border-border hover:border-destructive/60"}`}
                    data-testid="wallet-direction-debit"
                  >
                    <Minus className="h-4 w-4" /> Debit (deduct)
                  </button>
                </div>

                {/* Amount */}
                <div className="mt-4">
                  <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Amount (₹)</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {QUICK_AMOUNTS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setAmount(String(a))}
                        className={`rounded-full text-xs font-bold px-3 h-8 border-2 transition-colors ${String(amount) === String(a) ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary"}`}
                        data-testid={`wallet-amount-quick-${a}`}
                      >
                        ₹{a}
                      </button>
                    ))}
                  </div>
                  <div className="relative mt-2 max-w-xs">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="number" min={0} step="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Enter custom amount"
                      className="pl-9 rounded-xl text-base font-display font-bold"
                      data-testid="wallet-amount-input"
                    />
                  </div>
                </div>

                {/* Reason */}
                <div className="mt-4">
                  <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Reason (audit log)</p>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, 500))}
                    placeholder="e.g. paid cash to manager · goodwill credit · refund #12"
                    className="mt-2 rounded-xl"
                    maxLength={500}
                    data-testid="wallet-reason-input"
                  />
                </div>

                {/* Optional sub adjustments */}
                <details className="mt-4 group" data-testid="wallet-adv-toggle">
                  <summary className="cursor-pointer text-xs font-extrabold text-primary inline-flex items-center gap-1 select-none">
                    <Sparkles className="h-3 w-3" /> Advanced: also adjust subscription
                  </summary>
                  <div className="mt-3 grid sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Extend end-date (days)</p>
                      <Input type="number" min={0} max={365} value={extendDays} onChange={(e) => setExtendDays(e.target.value)} className="mt-1 rounded-xl" data-testid="wallet-extend-days" />
                    </div>
                    <div>
                      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Restore meals</p>
                      <Input type="number" min={0} max={300} value={restoreMeals} onChange={(e) => setRestoreMeals(e.target.value)} className="mt-1 rounded-xl" data-testid="wallet-restore-meals" />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">Applies to the user&apos;s active subscription (if any). Restoring meals lowers `meals_used` so they can attend again.</p>
                </details>

                <div className="mt-5 flex gap-2">
                  <Button
                    onClick={apply}
                    disabled={saving || (!amount && !extendDays && !restoreMeals) || !reason.trim()}
                    className="rounded-full bg-primary hover:bg-primary/90 flex-1 h-11"
                    data-testid="wallet-apply-button"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                    {saving ? "Applying…" : `Apply ${direction === "credit" ? "+" : "−"}₹${Number(amount || 0).toLocaleString("en-IN")}`}
                  </Button>
                </div>
              </div>

              {/* History */}
              <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-extrabold">Recent adjustments</h3>
                </div>
                {!history ? (
                  <p className="text-xs text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Loading…</p>
                ) : (history.overrides?.length === 0 && history.transactions?.length === 0) ? (
                  <p className="text-xs text-muted-foreground">No transactions yet for this user.</p>
                ) : (
                  <ul className="divide-y divide-border max-h-64 overflow-y-auto" data-testid="wallet-history-list">
                    {(history.overrides || []).slice(0, 20).map((o) => (
                      <li key={o.audit_id} className="py-2 flex items-start gap-2">
                        <span className={`inline-flex h-6 w-6 rounded-full items-center justify-center shrink-0 ${o.delta >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
                          {o.delta >= 0 ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold">
                            {o.delta >= 0 ? "+" : "−"}₹{Math.abs(o.delta).toLocaleString("en-IN")}
                            {o.extend_days ? ` · +${o.extend_days}d` : ""}
                            {o.restore_meals ? ` · +${o.restore_meals} meals` : ""}
                          </p>
                          <p className="text-[11px] text-muted-foreground line-clamp-2">{o.reason}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(o.ts).toLocaleString("en-IN")} · by {o.admin_email}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
