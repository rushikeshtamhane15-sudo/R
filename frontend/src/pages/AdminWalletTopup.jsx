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
 *   POST /api/admin/users/{id}/wallet-adjust       → {delta, reason, extend_days, meals_delta}
 */
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Wallet, Search, IndianRupee, ChevronRight, Loader2, History, Plus, Minus,
  Phone, Mail, User as UserIcon, CalendarDays, Sparkles, ShieldCheck,
  ClipboardList, Package, GitMerge,
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
  // iter-98: rename + add direction for meals (positive = restore, negative = deduct).
  const [mealsDelta, setMealsDelta] = useState(0);
  // Removed: const [restoreMeals, setRestoreMeals]
  const [saving, setSaving] = useState(false);

  // History panel
  const [history, setHistory] = useState(null);

  // iter-101: Assign subscription state
  const [plans, setPlans] = useState([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMode, setAssignMode] = useState("plan"); // "plan" | "custom"
  const [assignPlanId, setAssignPlanId] = useState("");
  const [assignName, setAssignName] = useState("");
  const [assignDays, setAssignDays] = useState(30);
  const [assignMeals, setAssignMeals] = useState(60);
  const [assignAmount, setAssignAmount] = useState(2600);
  const [assignService, setAssignService] = useState("dining");
  const [assignStartDate, setAssignStartDate] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [assigning, setAssigning] = useState(false);

  // iter-106: profile-status guard — admin can't adjust wallet / assign sub
  // until the selected user has filled in name + phone + address.
  const [profileStatus, setProfileStatus] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/admin/plans");
        setPlans(r.data?.plans || []);
      } catch { /* non-critical for the rest of the page */ }
    })();
  }, []);

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
    setMealsDelta(0);
    loadHistory(u.user_id);
    // iter-106: fetch profile-status so the UI can show a warning + block
    // wallet/assign/reconcile buttons until the user completes their profile.
    setProfileStatus(null);
    api.get(`/admin/users/${u.user_id}/profile-status`)
      .then((r) => setProfileStatus(r.data))
      .catch(() => setProfileStatus({ complete: true, missing: [], required: [] }));
  };

  const apply = async () => {
    if (!selected) return;
    const amt = Number(amount || 0);
    if (!amt && !extendDays && !mealsDelta) {
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
        meals_delta: Number(mealsDelta) || 0,
      });
      const newBal = r.data?.after?.user_wallet ?? null;
      toast.success(`Wallet adjusted${newBal != null ? ` — new balance ₹${newBal}` : ""}`);
      setUsers((prev) => prev.map((u) => u.user_id === selected.user_id ? { ...u, wallet_balance: newBal ?? u.wallet_balance } : u));
      setSelected((s) => s ? { ...s, wallet_balance: newBal ?? s.wallet_balance } : s);
      setAmount(""); setReason(""); setExtendDays(0); setMealsDelta(0);
      loadHistory(selected.user_id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Adjust failed");
    } finally { setSaving(false); }
  };

  const onPickPlan = (planId) => {
    setAssignPlanId(planId);
    const p = plans.find((x) => x.plan_id === planId);
    if (p) {
      setAssignName(p.name || "");
      setAssignDays(Number(p.duration_days || 30));
      setAssignMeals(Number(p.meals || 60));
      setAssignAmount(Number(p.amount || 0));
      setAssignService((p.service_type || p.category || "dining").toLowerCase().includes("tiffin") ? "tiffin" : "dining");
    }
  };

  const applyAssign = async () => {
    if (!selected) return;
    if (!assignReason.trim()) { toast.error("Reason is required for the audit log"); return; }
    if (assignMode === "plan" && !assignPlanId) { toast.error("Pick a plan"); return; }
    if (assignMode === "custom") {
      if (!assignName.trim()) { toast.error("Plan name is required"); return; }
      if (!assignDays || assignDays < 1) { toast.error("Days must be ≥ 1"); return; }
      if (!assignMeals || assignMeals < 1) { toast.error("Meals must be ≥ 1"); return; }
      if (assignAmount === "" || Number(assignAmount) < 0) { toast.error("Amount must be ≥ 0"); return; }
    }
    setAssigning(true);
    try {
      const body = {
        reason: assignReason.trim(),
        service_type: assignService,
        replace_active: true,
      };
      if (assignMode === "plan") {
        body.plan_id = assignPlanId;
        // allow inline override of the chosen plan template
        if (assignName.trim()) body.name = assignName.trim();
        if (assignDays) body.duration_days = Number(assignDays);
        if (assignMeals) body.meals = Number(assignMeals);
        if (assignAmount !== "") body.amount = Number(assignAmount);
      } else {
        body.name = assignName.trim();
        body.duration_days = Number(assignDays);
        body.meals = Number(assignMeals);
        body.amount = Number(assignAmount);
      }
      if (assignStartDate) body.start_date = assignStartDate;
      const r = await api.post(`/admin/users/${selected.user_id}/assign-subscription`, body);
      const newWallet = r.data?.user_wallet;
      toast.success(`Subscription assigned · ${r.data?.subscription?.plan_name || ""}`);
      if (newWallet != null) {
        setUsers((prev) => prev.map((u) => u.user_id === selected.user_id ? { ...u, wallet_balance: newWallet } : u));
        setSelected((s) => s ? { ...s, wallet_balance: newWallet } : s);
      }
      setAssignReason("");
      setAssignOpen(false);
      loadHistory(selected.user_id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Assign failed");
    } finally { setAssigning(false); }
  };

  // iter-105: one-button reconcile if wallet ↔ meals_left drifted
  const reconcile = async (source_of_truth) => {
    if (!selected) return;
    const reason = window.prompt(
      `Reconcile from ${source_of_truth === "meals" ? "MEALS counter (recompute wallet)" : "WALLET balance (recompute meals)"} — enter a reason for the audit log:`,
      "Re-sync wallet ↔ meals after historical drift",
    );
    if (!reason || !reason.trim()) return;
    try {
      const r = await api.post(`/admin/users/${selected.user_id}/reconcile-subscription`, {
        source_of_truth, reason: reason.trim(),
      });
      const a = r.data?.audit;
      toast.success(
        `Reconciled · wallet ₹${a.before.wallet_balance} → ₹${a.after.wallet_balance} · meals left ${a.before.meals_left} → ${a.after.meals_left}`,
      );
      if (r.data?.user_wallet != null) {
        setUsers((prev) => prev.map((u) => u.user_id === selected.user_id ? { ...u, wallet_balance: r.data.user_wallet } : u));
        setSelected((s) => s ? { ...s, wallet_balance: r.data.user_wallet } : s);
      }
      loadHistory(selected.user_id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reconcile failed");
    }
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
              {/* iter-106: Profile-incomplete guard banner */}
              {profileStatus && !profileStatus.complete && (
                <div className="rounded-2xl border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 p-4" data-testid="profile-incomplete-banner">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-9 w-9 rounded-xl bg-amber-500/20 text-amber-700 items-center justify-center shrink-0">
                      <UserIcon className="h-4 w-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-extrabold text-amber-900 dark:text-amber-100">
                        Profile incomplete — finish it before adjusting this user
                      </p>
                      <p className="text-xs text-amber-800/90 dark:text-amber-200/90 mt-1 leading-relaxed">
                        Missing: <span className="font-mono font-bold">{profileStatus.missing.join(", ")}</span>.
                        Ask the user to fill these in (Account → Profile) before you topup their wallet, assign a subscription, or reconcile.
                      </p>
                    </div>
                  </div>
                </div>
              )}

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
                      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Days (+ extend / − deduct)</p>
                      <div className="mt-1 flex items-stretch rounded-xl border border-input bg-background overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setExtendDays(Math.max(-365, Number(extendDays || 0) - 1))}
                          className="px-3 hover:bg-red-500/10 text-red-600 font-extrabold"
                          aria-label="Deduct one day"
                          data-testid="wallet-days-dec"
                        >−</button>
                        <Input
                          type="number"
                          min={-365}
                          max={365}
                          value={extendDays}
                          onChange={(e) => setExtendDays(e.target.value)}
                          className="rounded-none border-0 text-center font-bold"
                          data-testid="wallet-extend-days"
                        />
                        <button
                          type="button"
                          onClick={() => setExtendDays(Math.min(365, Number(extendDays || 0) + 1))}
                          className="px-3 hover:bg-emerald-500/10 text-emerald-600 font-extrabold"
                          aria-label="Extend one day"
                          data-testid="wallet-days-inc"
                        >+</button>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Pushes the sub end-date forward (+) or pulls it back (−).</p>
                    </div>
                    <div>
                      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Meals (+ restore / − deduct)</p>
                      <div className="mt-1 flex items-stretch rounded-xl border border-input bg-background overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setMealsDelta(Math.max(-300, Number(mealsDelta || 0) - 1))}
                          className="px-3 hover:bg-red-500/10 text-red-600 font-extrabold"
                          aria-label="Deduct one meal"
                          data-testid="wallet-meals-dec"
                        >−</button>
                        <Input
                          type="number"
                          min={-300}
                          max={300}
                          value={mealsDelta}
                          onChange={(e) => setMealsDelta(e.target.value)}
                          className="rounded-none border-0 text-center font-bold"
                          data-testid="wallet-meals-delta"
                        />
                        <button
                          type="button"
                          onClick={() => setMealsDelta(Math.min(300, Number(mealsDelta || 0) + 1))}
                          className="px-3 hover:bg-emerald-500/10 text-emerald-600 font-extrabold"
                          aria-label="Restore one meal"
                          data-testid="wallet-meals-inc"
                        >+</button>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Applies to the user&apos;s active subscription (if any). Positive = restore meals (lowers <code>meals_used</code>),
                    negative = deduct meals (raises <code>meals_used</code>, e.g. user ate extra for a friend).
                  </p>
                </details>

                <div className="mt-5 flex gap-2">
                  <Button
                    onClick={apply}
                    disabled={saving || (!amount && !extendDays && !mealsDelta) || !reason.trim() || (profileStatus && !profileStatus.complete)}
                    className="rounded-full bg-primary hover:bg-primary/90 flex-1 h-11"
                    data-testid="wallet-apply-button"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                    {saving ? "Applying…" : `Apply ${direction === "credit" ? "+" : "−"}₹${Number(amount || 0).toLocaleString("en-IN")}`}
                  </Button>
                </div>
              </div>

              {/* iter-101: Manual subscription assignment */}
              <div className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="assign-sub-card">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-9 w-9 rounded-xl bg-indigo-500/10 text-indigo-600 items-center justify-center"><ClipboardList className="h-4 w-4" /></span>
                    <div>
                      <h3 className="text-sm font-extrabold">Assign subscription manually</h3>
                      <p className="text-[11px] text-muted-foreground">For walk-in / cash customers who can&apos;t use the app themselves.</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={assignOpen ? "outline" : "default"}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setAssignOpen((v) => !v)}
                    data-testid="assign-sub-toggle"
                  >
                    {assignOpen ? "Close" : "Open"}
                  </Button>
                </div>

                {assignOpen && (
                  <div className="mt-4 space-y-3" data-testid="assign-sub-form">
                    {/* Mode toggle */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAssignMode("plan")}
                        className={`rounded-xl border-2 px-3 py-2 text-xs font-extrabold transition-colors ${assignMode === "plan" ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-border hover:border-indigo-400"}`}
                        data-testid="assign-mode-plan"
                      >From existing plan</button>
                      <button
                        type="button"
                        onClick={() => setAssignMode("custom")}
                        className={`rounded-xl border-2 px-3 py-2 text-xs font-extrabold transition-colors ${assignMode === "custom" ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-border hover:border-indigo-400"}`}
                        data-testid="assign-mode-custom"
                      >Custom plan</button>
                    </div>

                    {assignMode === "plan" && (
                      <div>
                        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground inline-flex items-center gap-1"><Package className="h-3 w-3" /> Pick a plan</p>
                        <select
                          value={assignPlanId}
                          onChange={(e) => onPickPlan(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                          data-testid="assign-plan-select"
                        >
                          <option value="">— Select an active plan —</option>
                          {plans.filter((p) => p.active !== false).map((p) => (
                            <option key={p.plan_id} value={p.plan_id}>
                              {p.name} · {p.duration_days}d · {p.meals} meals · ₹{p.amount}
                            </option>
                          ))}
                        </select>
                        <p className="text-[10px] text-muted-foreground mt-1">You can still tweak days / meals / amount below if this customer&apos;s deal is non-standard.</p>
                      </div>
                    )}

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Plan name</p>
                        <Input value={assignName} onChange={(e) => setAssignName(e.target.value.slice(0, 80))} className="mt-1 rounded-xl" placeholder="e.g. Walk-in 30 day" data-testid="assign-name-input" />
                      </div>
                      <div>
                        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Service type</p>
                        <select
                          value={assignService}
                          onChange={(e) => setAssignService(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                          data-testid="assign-service-select"
                        >
                          <option value="dining">Dining (eat-in)</option>
                          <option value="tiffin">Tiffin (home delivery)</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Duration (days)</p>
                        <Input type="number" min={1} max={365} value={assignDays} onChange={(e) => setAssignDays(e.target.value)} className="mt-1 rounded-xl" data-testid="assign-days-input" />
                      </div>
                      <div>
                        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Total meals</p>
                        <Input type="number" min={1} max={2000} value={assignMeals} onChange={(e) => setAssignMeals(e.target.value)} className="mt-1 rounded-xl" data-testid="assign-meals-input" />
                      </div>
                      <div>
                        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Amount (₹)</p>
                        <Input type="number" min={0} step="1" value={assignAmount} onChange={(e) => setAssignAmount(e.target.value)} className="mt-1 rounded-xl" data-testid="assign-amount-input" />
                      </div>
                      <div>
                        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Start date (optional)</p>
                        <Input type="date" value={assignStartDate} onChange={(e) => setAssignStartDate(e.target.value)} className="mt-1 rounded-xl" data-testid="assign-startdate-input" />
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Reason (audit log)</p>
                      <Input
                        value={assignReason}
                        onChange={(e) => setAssignReason(e.target.value.slice(0, 500))}
                        placeholder="e.g. cash paid to manager · walk-in onboarded"
                        className="mt-1 rounded-xl"
                        maxLength={500}
                        data-testid="assign-reason-input"
                      />
                    </div>

                    <p className="text-[10px] text-muted-foreground">
                      Any existing active subscription on this user will be marked expired and replaced.
                      ₹{Number(assignAmount || 0).toLocaleString("en-IN")} will be credited to their wallet, and they&apos;ll see an in-app notice on next login.
                    </p>

                    <Button
                      onClick={applyAssign}
                      disabled={assigning || !assignReason.trim() || (assignMode === "plan" && !assignPlanId) || (profileStatus && !profileStatus.complete)}
                      className="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white w-full h-10"
                      data-testid="assign-apply-button"
                    >
                      {assigning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                      {assigning ? "Assigning…" : `Assign · ₹${Number(assignAmount || 0).toLocaleString("en-IN")} / ${assignDays || 0}d / ${assignMeals || 0} meals`}
                    </Button>
                  </div>
                )}
              </div>

              {/* iter-105: Reconcile drift */}
              <div className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="reconcile-card">
                <div className="flex items-start gap-2">
                  <span className="inline-flex h-9 w-9 rounded-xl bg-amber-500/10 text-amber-600 items-center justify-center"><GitMerge className="h-4 w-4" /></span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-extrabold">Reconcile wallet ↔ meals</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                      Use when the wallet balance and meals-left have drifted apart (usually from a pre-iter-104 admin override).
                      The system will re-sync them so <span className="font-mono">wallet ≈ meals_left × ₹/meal</span> again.
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid sm:grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => reconcile("meals")}
                    disabled={profileStatus && !profileStatus.complete}
                    className="rounded-full"
                    data-testid="reconcile-meals-truth"
                  >
                    Trust meals · fix wallet
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => reconcile("wallet")}
                    disabled={profileStatus && !profileStatus.complete}
                    className="rounded-full"
                    data-testid="reconcile-wallet-truth"
                  >
                    Trust wallet · fix meals
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
                            {(() => {
                              // iter-98: history shows signed meals delta (positive=restored, negative=deducted)
                              const md = o.meals_delta ?? (o.restore_meals || 0);
                              if (!md) return null;
                              return md > 0 ? ` · +${md} meals` : ` · ${md} meals`;
                            })()}
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
