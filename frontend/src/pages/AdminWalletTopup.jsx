/**
 * AdminWalletTopup — iter-79 Batch C #7 · refactored iter-122.
 *
 * Self-contained admin tool to manually credit/debit a user's wallet
 * without a Razorpay payment. Used when:
 *   • A subscriber pays cash to the manager and needs the wallet topped up.
 *   • Admin offers a goodwill credit / refund after a complaint.
 *   • Manual correction of a wallet balance.
 *
 * iter-122 — decomposed from a 697-line monolith into a 230-line
 * orchestrator + five focused sub-components under
 * /components/admin-wallet/. All state stays here so handlers can
 * update derived UI (history reload, wallet balance refresh, etc.).
 *
 * Backend (already exists):
 *   GET  /api/admin/users                          → user directory
 *   GET  /api/admin/users/{id}/wallet-history      → past txns + admin overrides
 *   POST /api/admin/users/{id}/wallet-adjust       → {delta, reason, extend_days, meals_delta}
 *   POST /api/admin/users/{id}/assign-subscription
 *   POST /api/admin/users/{id}/reconcile-subscription
 *   GET  /api/admin/users/{id}/profile-status
 */
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Wallet } from "lucide-react";

import UserSearchList from "../components/admin-wallet/UserSearchList";
import WalletAdjustForm from "../components/admin-wallet/WalletAdjustForm";
import AssignSubscriptionCard from "../components/admin-wallet/AssignSubscriptionCard";
import {
  ProfileIncompleteBanner,
  UserSnapshotCard,
  ReconcileCard,
  WalletHistoryCard,
} from "../components/admin-wallet/WalletDetailBlocks";

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
  // iter-98: signed meals delta (positive = restore, negative = deduct)
  const [mealsDelta, setMealsDelta] = useState(0);
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
  const profileBlocked = !!(profileStatus && !profileStatus.complete);

  // --- Initial data fetches ------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/admin/plans");
        setPlans(r.data?.plans || []);
      } catch (e) { console.warn("[AdminWalletTopup] /admin/plans failed (non-fatal)", e); }
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

  // --- Helpers -------------------------------------------------------------
  const loadHistory = async (uid) => {
    setHistory(null);
    try {
      const r = await api.get(`/admin/users/${uid}/wallet-history`);
      setHistory(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "History failed"); }
  };

  const pickUser = (u) => {
    setSelected(u);
    setDirection("credit"); setAmount(""); setReason("");
    setExtendDays(0); setMealsDelta(0);
    loadHistory(u.user_id);
    setProfileStatus(null);
    api.get(`/admin/users/${u.user_id}/profile-status`)
      .then((r) => setProfileStatus(r.data))
      .catch(() => setProfileStatus({ complete: true, missing: [], required: [] }));
  };

  // --- Handlers ------------------------------------------------------------
  const applyWalletAdjust = async () => {
    if (!selected) return;
    const amt = Number(amount || 0);
    if (!amt && !extendDays && !mealsDelta) { toast.error("Enter an amount or a sub adjustment"); return; }
    if (!reason.trim()) { toast.error("Reason is required for the audit log"); return; }
    setSaving(true);
    try {
      const delta = direction === "credit" ? amt : -amt;
      const r = await api.post(`/admin/users/${selected.user_id}/wallet-adjust`, {
        delta, reason: reason.trim(),
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
      const body = { reason: assignReason.trim(), service_type: assignService, replace_active: true };
      if (assignMode === "plan") {
        body.plan_id = assignPlanId;
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
      setAssignReason(""); setAssignOpen(false);
      loadHistory(selected.user_id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Assign failed");
    } finally { setAssigning(false); }
  };

  // iter-105: one-button reconcile if wallet ↔ meals_left drifted
  const reconcile = async (source_of_truth) => {
    if (!selected) return;
    const reasonText = window.prompt(
      `Reconcile from ${source_of_truth === "meals" ? "MEALS counter (recompute wallet)" : "WALLET balance (recompute meals)"} — enter a reason for the audit log:`,
      "Re-sync wallet ↔ meals after historical drift",
    );
    if (!reasonText || !reasonText.trim()) return;
    try {
      const r = await api.post(`/admin/users/${selected.user_id}/reconcile-subscription`, {
        source_of_truth, reason: reasonText.trim(),
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

  // --- Render --------------------------------------------------------------
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8" data-testid="admin-wallet-topup">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Finance · admin tool</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Manual wallet top-up</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed max-w-2xl">
        Credit or debit any user&apos;s wallet without going through Razorpay. Useful when a subscriber pays cash to the manager, when issuing a goodwill credit, or correcting a balance. Every adjustment is audit-logged with your email and the reason.
      </p>

      <div className="mt-8 grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <UserSearchList
            users={users}
            usersLoading={usersLoading}
            query={query}
            setQuery={setQuery}
            selectedId={selected?.user_id}
            onPick={pickUser}
          />
        </div>

        <div className="lg:col-span-3">
          {!selected ? (
            <div className="rounded-2xl border-2 border-dashed border-border bg-card/50 p-10 text-center text-muted-foreground">
              <Wallet className="h-7 w-7 mx-auto mb-2 opacity-60" />
              <p className="text-sm font-bold">Select a user to top-up their wallet</p>
              <p className="text-xs mt-1">Find them by phone, name or email on the left.</p>
            </div>
          ) : (
            <div className="space-y-4" data-testid="wallet-topup-form">
              <ProfileIncompleteBanner profileStatus={profileStatus} />
              <UserSnapshotCard user={selected} />

              <WalletAdjustForm
                direction={direction} setDirection={setDirection}
                amount={amount} setAmount={setAmount}
                reason={reason} setReason={setReason}
                extendDays={extendDays} setExtendDays={setExtendDays}
                mealsDelta={mealsDelta} setMealsDelta={setMealsDelta}
                saving={saving}
                profileBlocked={profileBlocked}
                onApply={applyWalletAdjust}
              />

              <AssignSubscriptionCard
                plans={plans}
                assignOpen={assignOpen} setAssignOpen={setAssignOpen}
                assignMode={assignMode} setAssignMode={setAssignMode}
                assignPlanId={assignPlanId} onPickPlan={onPickPlan}
                assignName={assignName} setAssignName={setAssignName}
                assignDays={assignDays} setAssignDays={setAssignDays}
                assignMeals={assignMeals} setAssignMeals={setAssignMeals}
                assignAmount={assignAmount} setAssignAmount={setAssignAmount}
                assignService={assignService} setAssignService={setAssignService}
                assignStartDate={assignStartDate} setAssignStartDate={setAssignStartDate}
                assignReason={assignReason} setAssignReason={setAssignReason}
                assigning={assigning}
                profileBlocked={profileBlocked}
                onApply={applyAssign}
              />

              <ReconcileCard profileBlocked={profileBlocked} onReconcile={reconcile} />
              <WalletHistoryCard history={history} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
