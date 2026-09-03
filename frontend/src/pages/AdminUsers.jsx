import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Trash2, Search, Wallet, Bike, CheckSquare, Square, GitMerge, AlertTriangle } from "lucide-react";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("staff");
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [walletTarget, setWalletTarget] = useState(null);
  // iter-59 #4: bulk-select state. Stores a Set<user_id> of selected rows.
  const [selected, setSelected] = useState(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // iter-102: duplicate-account detection + merge
  const [duplicates, setDuplicates] = useState(null); // null = not yet scanned, [] = none, [...] = clusters
  const [scanning, setScanning] = useState(false);
  const [mergeCluster, setMergeCluster] = useState(null); // {shared_by, shared_value, users:[...]}

  const load = async () => {
    try { const r = await api.get("/admin/users"); setUsers(r.data.users || []); }
    catch { toast.error("Failed to load users"); }
  };
  useEffect(() => { load(); }, []);

  // iter-138.u — one-tap batch reconciler for the back-dated drift bug.
  // Walks every user whose active sub still has `no_pause_before` unmarked
  // as reconciled and deducts the 2 phantom-paused meals + ₹100.
  const [reconciling, setReconciling] = useState(false);
  const reconcileDrift = async () => {
    if (!window.confirm("Auto-reconcile every user whose back-dated sub still has the phantom-pause drift?\n\nEach affected user loses 2 meals + ₹100 · matches the iter-138.t deduction that was strictly-`<` skipped on assign-day.\n\nSafe to re-run — already-reconciled subs are skipped.")) return;
    setReconciling(true);
    try {
      const r = await api.post("/admin/reconcile-backdated-drift", {});
      const touched = r.data?.touched || 0;
      const skipped = r.data?.skipped || 0;
      if (touched === 0) toast.success("No drift left — every back-dated sub is already reconciled.");
      else toast.success(`Reconciled ${touched} user${touched === 1 ? "" : "s"} · skipped ${skipped}`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reconcile failed");
    } finally { setReconciling(false); }
  };

  // iter-140 — refund the double-deduction bug (per-scan + full-day at midnight).
  const [refunding, setRefunding] = useState(false);
  const [ddPreview, setDdPreview] = useState(null);   // { candidates, total } or null
  const previewDoubleDeduct = async () => {
    setRefunding(true);
    try {
      const r = await api.post("/admin/reconcile-double-deduct?dry_run=true", {});
      const cs = r.data?.candidates || [];
      const total = r.data?.total || 0;
      const totalMeals = r.data?.total_meals || 0;
      setDdPreview({ candidates: cs, total, totalMeals });
      if (cs.length === 0) toast.success("No pending double-deduct rows — every sub is clean.");
      else toast.warning(`Found ${cs.length} candidate day(s) · ₹${total.toFixed(2)} + ${totalMeals} meals pending`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preview failed");
    } finally { setRefunding(false); }
  };
  const applyDoubleDeductRefund = async () => {
    if (!window.confirm(`Refund every subscriber affected by the pre-iter-140 wallet double-deduction bug?\n\n• Past days with scans: refunds per_meal × scans to the sub wallet.\n• Today / future days where the midnight tick fired early: refunds the full per_day to both the user and sub wallets and restores 2 meals.\n\nIdempotent — under-refunded users are topped up on re-run.`)) return;
    setRefunding(true);
    try {
      const r = await api.post("/admin/reconcile-double-deduct", {});
      const touched = r.data?.touched || 0;
      const total = r.data?.total_refund || 0;
      if (touched === 0) toast.success("Nothing to refund — every double-deduct row already refunded.");
      else toast.success(`Refunded ${touched} user(s) · ₹${total.toFixed(2)} total`);
      setDdPreview(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Refund failed");
    } finally { setRefunding(false); }
  };

  // iter-102: scan for accounts that share email or phone with another account
  const scanDuplicates = async () => {
    setScanning(true);
    try {
      const r = await api.get("/admin/users/duplicates");
      setDuplicates(r.data?.clusters || []);
      const n = r.data?.clusters?.length || 0;
      toast[n ? "warning" : "success"](
        n ? `Found ${n} duplicate cluster${n === 1 ? "" : "s"} — review and merge below.` : "No duplicates — every account has a unique email + phone.",
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Scan failed");
    } finally { setScanning(false); }
  };

  const setUserRole = async () => {
    if (!email.trim() && !phone.trim()) { toast.error("Enter email or phone"); return; }
    try {
      const body = { role };
      if (email.trim()) body.email = email.trim();
      if (phone.trim()) body.phone = phone.trim();
      await api.post("/admin/role", body);
      toast.success(`Role updated to ${role}`);
      setEmail(""); setPhone("");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const removeUser = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/users/${confirmDelete.user_id}`);
      toast.success(`Deleted ${confirmDelete.name}`);
      setConfirmDelete(null);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not delete"); }
    finally { setDeleting(false); }
  };

  const filtered = users.filter((u) =>
    !q.trim() || (u.name || "").toLowerCase().includes(q.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(q.toLowerCase()) ||
    (u.phone || "").includes(q)
  );

  // ids of rows that can actually be selected (not me, not other admins)
  const selectableIds = useMemo(
    () => filtered.filter((u) => !(me && u.user_id === me.user_id) && u.role !== "admin").map((u) => u.user_id),
    [filtered, me],
  );
  const allFilteredSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleOne = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };
  const toggleAllFiltered = () => {
    setSelected((prev) => {
      if (allFilteredSelected) {
        // Deselect just the filtered set
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      selectableIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const runBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    try {
      const r = await api.post("/admin/users/bulk-delete", { user_ids: Array.from(selected) });
      const { deleted_count, skipped } = r.data || {};
      if (deleted_count > 0) toast.success(`Deleted ${deleted_count} user${deleted_count === 1 ? "" : "s"}`);
      if (skipped && skipped.length) toast.warning(`${skipped.length} skipped — see console`);
      console.log("[bulk-delete] skipped:", skipped);
      setBulkConfirmOpen(false);
      clearSelection();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bulk delete failed");
    } finally { setBulkDeleting(false); }
  };

  return (
    <div data-testid="admin-users-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Users</p>
      <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-2">Users & roles</h1>

      <div className="mt-6 grid lg:grid-cols-3 gap-6">
        <div className="bg-card rounded-2xl border border-border p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">All users · {users.length}</p>
            <div className="relative w-56">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="rounded-full h-9 pl-9 text-sm" data-testid="user-search" />
            </div>
          </div>

          {/* iter-59 #4: bulk-action toolbar — appears whenever any row is selected */}
          {selected.size > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20" data-testid="bulk-actions-toolbar">
              <p className="text-xs font-bold text-primary" data-testid="bulk-selected-count">
                {selected.size} selected
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="rounded-full h-8 text-xs" onClick={clearSelection} data-testid="bulk-clear">Clear</Button>
                <Button size="sm" variant="destructive" className="rounded-full h-8 text-xs" onClick={() => setBulkConfirmOpen(true)} data-testid="bulk-delete-btn">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete {selected.size}
                </Button>
              </div>
            </div>
          )}

          {/* Select-all row (only shown if any selectable rows exist) */}
          {selectableIds.length > 0 && (
            <button
              type="button"
              onClick={toggleAllFiltered}
              className="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              data-testid="bulk-select-all"
            >
              {allFilteredSelected
                ? <CheckSquare className="h-4 w-4 text-primary" />
                : <Square className="h-4 w-4" />
              }
              {allFilteredSelected ? "Deselect all" : `Select all ${selectableIds.length} on screen`}
            </button>
          )}

          <div className="mt-3 max-h-[60vh] overflow-auto divide-y divide-border">
            {filtered.map((u) => {
              const isMe = me && u.user_id === me.user_id;
              const canSelect = !isMe && u.role !== "admin";
              const isSelected = selected.has(u.user_id);
              return (
                <div key={u.user_id} className="flex items-center justify-between py-3 text-sm gap-3" data-testid={`user-row-${u.user_id}`}>
                  <button
                    type="button"
                    onClick={() => canSelect && toggleOne(u.user_id)}
                    disabled={!canSelect}
                    className={`shrink-0 ${canSelect ? "cursor-pointer hover:opacity-80" : "opacity-30 cursor-not-allowed"}`}
                    aria-label={isSelected ? "Deselect" : "Select"}
                    title={!canSelect ? "Cannot select admin or yourself" : (isSelected ? "Deselect" : "Select")}
                    data-testid={`select-user-${u.user_id}`}
                  >
                    {isSelected
                      ? <CheckSquare className="h-4 w-4 text-primary" />
                      : <Square className="h-4 w-4 text-muted-foreground" />
                    }
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{u.name} {isMe && <span className="text-[10px] tracking-overline uppercase font-bold text-secondary ml-1">you</span>}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email || u.phone || "—"}</p>
                  </div>
                  <span className={`text-[10px] tracking-overline uppercase font-bold px-2 py-1 rounded-full shrink-0 ${u.role === "admin" ? "bg-primary/10 text-primary" : u.role === "staff" ? "bg-secondary/15 text-secondary" : "bg-muted text-muted-foreground"}`}>{u.role}</span>
                  <Button
                    size="icon" variant="outline"
                    className="h-8 w-8 rounded-full text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    onClick={async () => {
                      try {
                        await api.post(`/admin/rider/${u.user_id}/promote`);
                        toast.success(`${u.name || u.user_id} is now an efoodcare rider`);
                        load();
                      } catch (e) { toast.error(e?.response?.data?.detail || "Could not promote"); }
                    }}
                    disabled={u.role === "rider" || u.role === "admin"}
                    title={u.role === "rider" ? "Already a rider" : u.role === "admin" ? "Demote first" : "Promote to rider"}
                    data-testid={`promote-rider-${u.user_id}`}
                  >
                    <Bike className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="outline"
                    className="h-8 w-8 rounded-full text-primary hover:bg-primary/5"
                    onClick={() => setWalletTarget(u)}
                    title="Adjust wallet · refund / extend / restore meals"
                    data-testid={`wallet-adjust-${u.user_id}`}
                  >
                    <Wallet className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="outline"
                    className="h-8 w-8 rounded-full text-destructive hover:bg-destructive/5"
                    onClick={() => setConfirmDelete(u)}
                    disabled={isMe || u.role === "admin"}
                    title={isMe ? "Use Profile → Delete account" : u.role === "admin" ? "Demote first" : "Delete user"}
                    data-testid={`delete-user-${u.user_id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            {filtered.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No users found.</p>}
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-6">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Assign role</p>
          <p className="text-[11px] text-muted-foreground mt-1">Provide email or phone (or both) — we match either field.</p>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@email.com" className="mt-3 rounded-xl" data-testid="role-email-input" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" className="mt-2 rounded-xl" inputMode="numeric" data-testid="role-phone-input" />
          <div className="mt-3 flex flex-wrap gap-2">
            {["subscriber", "staff", "admin", "rider", "delivery_boy"].map((r) => (
              <Button key={r} variant={role === r ? "default" : "outline"} size="sm" onClick={() => setRole(r)} className="rounded-full capitalize text-xs" data-testid={`role-option-${r}`}>{r.replace("_", " ")}</Button>
            ))}
          </div>
          <Button onClick={setUserRole} className="mt-4 w-full rounded-full bg-primary hover:bg-primary/90" data-testid="save-role-button">Save role</Button>

          <div className="border-t border-border mt-5 pt-4">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground mb-2">Quick: Promote to rider</p>
            <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">Click the bike icon on any row to instantly mark them as an efoodcare rider — they'll get rider-only login redirect + dashboard.</p>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !deleting && setConfirmDelete(null)} data-testid="confirm-delete-modal">
          <div className="bg-card rounded-3xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="inline-flex h-11 w-11 rounded-xl bg-destructive/10 text-destructive items-center justify-center"><Trash2 className="h-5 w-5" /></div>
            <h3 className="font-display font-extrabold text-2xl mt-4">Delete this user?</h3>
            <p className="text-sm text-muted-foreground mt-2">
              This permanently removes <b className="text-foreground">{confirmDelete.name}</b> and every record tied to them — subscription, wallet, attendance history, deliveries. <span className="text-destructive font-semibold">This cannot be undone.</span>
            </p>
            <div className="mt-6 flex gap-3 justify-end">
              <Button variant="outline" className="rounded-full" onClick={() => setConfirmDelete(null)} disabled={deleting} data-testid="cancel-delete-user">Cancel</Button>
              <Button className="rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={removeUser} disabled={deleting} data-testid="confirm-delete-user">
                {deleting ? "Deleting…" : "Yes, delete user"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {bulkConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !bulkDeleting && setBulkConfirmOpen(false)} data-testid="bulk-confirm-modal">
          <div className="bg-card rounded-3xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="inline-flex h-11 w-11 rounded-xl bg-destructive/10 text-destructive items-center justify-center"><Trash2 className="h-5 w-5" /></div>
            <h3 className="font-display font-extrabold text-2xl mt-4">Delete {selected.size} user{selected.size === 1 ? "" : "s"}?</h3>
            <p className="text-sm text-muted-foreground mt-2">
              All <b className="text-foreground">{selected.size}</b> selected accounts and every record tied to them — subscriptions, wallets, attendance, deliveries — will be erased. <span className="text-destructive font-semibold">This cannot be undone.</span>
            </p>
            <div className="mt-6 flex gap-3 justify-end">
              <Button variant="outline" className="rounded-full" onClick={() => setBulkConfirmOpen(false)} disabled={bulkDeleting} data-testid="cancel-bulk-delete">Cancel</Button>
              <Button className="rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={runBulkDelete} disabled={bulkDeleting} data-testid="confirm-bulk-delete">
                {bulkDeleting ? "Deleting…" : `Yes, delete ${selected.size}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* iter-102: Duplicate-accounts panel */}
      <div className="mt-6 bg-card rounded-2xl border border-border p-6" data-testid="duplicates-panel">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs tracking-overline uppercase font-bold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1.5">
              <GitMerge className="h-3.5 w-3.5" /> Duplicate accounts
            </p>
            <h2 className="font-display font-extrabold text-lg mt-1">Find &amp; merge users with the same email or phone</h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-prose leading-relaxed">
              Historical bug: a user who signed in via Google OAuth and later via OTP could end up with two separate rows.
              Admin wallet adjustments may have landed on one row while the user&apos;s session resolved to the other.
              This scan finds and lets you merge them — wallet balances sum, all subscriptions / transactions / overrides
              are rewritten to point at the surviving account.
            </p>
          </div>
          <Button
            onClick={scanDuplicates}
            disabled={scanning}
            className="rounded-full bg-amber-600 hover:bg-amber-700 text-white"
            data-testid="scan-duplicates-button"
          >
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        </div>

        {/* iter-138.u — auto-reconcile back-dated drift for every user in one tap. */}
        <div className="mt-4 rounded-xl bg-white/70 dark:bg-white/5 border-2 border-emerald-500/40 p-3 flex flex-col sm:flex-row sm:items-center gap-2" data-testid="reconcile-drift-panel">
          <div className="flex-1">
            <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Back-dated drift · one-tap batch fix</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Applies the iter-138.t assign-day correction (−2 meals, −₹100) to every user whose sub still carries the strict-{"<"} phantom pause. Idempotent — safe to re-run.
            </p>
          </div>
          <Button
            onClick={reconcileDrift}
            disabled={reconciling}
            className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-[0.14em]"
            data-testid="reconcile-drift-button"
          >
            {reconciling ? "Reconciling…" : "Reconcile all"}
          </Button>
        </div>

        {/* iter-140 — refund the double-deduct wallet bug (per-scan + midnight full-day). */}
        <div className="mt-4 rounded-xl bg-white/70 dark:bg-white/5 border-2 border-rose-500/40 p-3 flex flex-col sm:flex-row sm:items-center gap-2" data-testid="reconcile-double-deduct-panel">
          <div className="flex-1">
            <p className="text-xs font-bold text-rose-800 dark:text-rose-300">Wallet double-deduction refund · one-tap batch fix</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Refunds every dining subscriber charged twice under the old midnight-cron bug (per_meal on scan AND full per_day at 00:00 IST). Preview first — apply only when you’re happy. Idempotent, ledger-audited.
            </p>
            {ddPreview && ddPreview.candidates?.length > 0 && (
              <p className="mt-1 text-[11px] font-bold text-rose-700" data-testid="dd-preview-total">
                Pending refund: ₹{ddPreview.total.toFixed(2)} + {ddPreview.totalMeals || 0} meal(s) across {ddPreview.candidates.length} day(s)
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={previewDoubleDeduct}
              disabled={refunding}
              variant="outline"
              className="rounded-full text-xs uppercase tracking-[0.14em] font-extrabold border-rose-500 text-rose-700 hover:bg-rose-50"
              data-testid="dd-preview-button"
            >
              {refunding && !ddPreview ? "Scanning…" : "Preview"}
            </Button>
            <Button
              onClick={applyDoubleDeductRefund}
              disabled={refunding}
              className="rounded-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs uppercase tracking-[0.14em]"
              data-testid="dd-apply-button"
            >
              {refunding && ddPreview ? "Refunding…" : "Apply refund"}
            </Button>
          </div>
        </div>

        {duplicates !== null && duplicates.length === 0 && (
          <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2" data-testid="duplicates-empty">
            No duplicates found. Every account has a unique email and phone.
          </p>
        )}

        {duplicates && duplicates.length > 0 && (
          <div className="mt-4 space-y-3" data-testid="duplicates-list">
            {duplicates.map((cluster, idx) => (
              <div key={`${cluster.shared_by}-${cluster.shared_value}-${idx}`} className="rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-3" data-testid={`dup-cluster-${idx}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[10px] tracking-overline uppercase font-bold text-amber-700">
                      Shared {cluster.shared_by}
                    </p>
                    <p className="font-mono text-sm font-extrabold truncate">{cluster.shared_value}</p>
                    <p className="text-[11px] text-muted-foreground">{cluster.users.length} accounts</p>
                  </div>
                  <Button
                    size="sm"
                    className="rounded-full bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => setMergeCluster(cluster)}
                    data-testid={`open-merge-${idx}`}
                  >
                    <GitMerge className="h-3.5 w-3.5 mr-1.5" /> Review &amp; merge
                  </Button>
                </div>
                <div className="mt-2 grid sm:grid-cols-2 gap-2">
                  {cluster.users.map((u) => (
                    <div key={u.user_id} className="rounded-lg bg-card border border-border px-3 py-2 text-xs">
                      <p className="font-semibold truncate">{u.name || "—"}</p>
                      <p className="text-muted-foreground truncate">{u.email || u.phone || "—"} · ₹{Math.round(u.wallet_balance || 0)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {u.subs} subs · {u.txns} txns · {u.overrides} overrides · {u.attendance} scans
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {mergeCluster && (
        <MergeUsersModal
          cluster={mergeCluster}
          onClose={() => setMergeCluster(null)}
          onMerged={() => { setMergeCluster(null); scanDuplicates(); load(); }}
        />
      )}

      {walletTarget && (
        <WalletAdjustModal
          target={walletTarget}
          onClose={() => { setWalletTarget(null); load(); }}
          onSaved={(opts) => { if (!opts?.silent) { setWalletTarget(null); } load(); }}
        />
      )}
    </div>
  );
}

function WalletAdjustModal({ target, onClose, onSaved }) {
  const [delta, setDelta] = useState("");
  const [extendDays, setExtendDays] = useState(0);
  const [restoreMeals, setRestoreMeals] = useState(0);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState({ transactions: [], overrides: [] });

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get(`/admin/users/${target.user_id}/wallet-history`);
        setHistory(r.data || { transactions: [], overrides: [] });
      } catch {}
    })();
  }, [target.user_id]);

  const submit = async () => {
    if (!reason.trim()) { toast.error("Reason is required for the audit log"); return; }
    const numDelta = Number(delta || 0);
    if (!numDelta && !extendDays && !restoreMeals) { toast.error("Set at least one of: amount, extend days, restore meals"); return; }
    setSaving(true);
    try {
      const r = await api.post(`/admin/users/${target.user_id}/wallet-adjust`, {
        delta: numDelta,
        reason: reason.trim(),
        extend_days: Number(extendDays || 0),
        restore_meals: Number(restoreMeals || 0),
      });
      toast.success(`Saved · audit ${r.data.audit_id}`);
      // Keep modal open and refresh in place — admin can do follow-up adjustments and verify history.
      setDelta("");
      setExtendDays(0);
      setRestoreMeals(0);
      setReason("");
      try {
        const h = await api.get(`/admin/users/${target.user_id}/wallet-history`);
        setHistory(h.data || { transactions: [], overrides: [] });
      } catch {}
      onSaved?.({ silent: true });
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && onClose()} data-testid="wallet-adjust-modal">
      <div className="bg-card rounded-3xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="inline-flex h-11 w-11 rounded-xl bg-primary/10 text-primary items-center justify-center"><Wallet className="h-5 w-5" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">Wallet override</p>
            <h3 className="font-display font-extrabold text-2xl mt-0.5 truncate">{target.name}</h3>
            <p className="text-xs text-muted-foreground truncate">{target.email || target.phone || "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">User wallet today: <b className="text-foreground">₹{Math.round(target.wallet_balance || 0)}</b></p>
          </div>
        </div>

        <div className="mt-6 grid md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Amount (₹)</label>
            <Input type="number" step="0.01" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+500 credit · -200 debit" className="mt-1.5" data-testid="wallet-delta" />
            <p className="text-[10px] text-muted-foreground mt-1">Positive to credit, negative to debit. Hits both user.wallet and active sub.wallet.</p>
          </div>
          <div>
            <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Extend days</label>
            <Input type="number" min={0} value={extendDays} onChange={(e) => setExtendDays(e.target.value)} className="mt-1.5" data-testid="wallet-extend-days" />
            <p className="text-[10px] text-muted-foreground mt-1">Optional. Pushes the active sub end-date forward.</p>
          </div>
          <div>
            <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Restore meals</label>
            <Input type="number" min={0} value={restoreMeals} onChange={(e) => setRestoreMeals(e.target.value)} className="mt-1.5" data-testid="wallet-restore-meals" />
            <p className="text-[10px] text-muted-foreground mt-1">Optional. Reduces meals_used (never below 0).</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Reason · audit-logged</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Refund — failed delivery on 2026-02-03" className="mt-1.5" data-testid="wallet-reason" />
        </div>

        {/* iter-138.u — one-tap quick action: back-dated drift fix. */}
        <div className="mt-4 rounded-2xl bg-amber-50 border-2 border-amber-300 p-3 flex flex-col sm:flex-row sm:items-center gap-3" data-testid="wallet-fix-drift-panel">
          <div className="flex-1 text-xs text-amber-900">
            <p className="font-extrabold text-amber-900 tracking-[0.14em] uppercase text-[10px]">Back-dated drift</p>
            <p className="mt-0.5">If this user was manually assigned a back-dated subscription before the iter-138.t fix, tap here to subtract the 2 phantom-paused meals + ₹100 that were skipped on assign-day.</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setDelta("-100");
              setRestoreMeals(-2);
              setExtendDays(0);
              setReason((r) => r || "Fix iter-138.t back-dated drift · -2 meals / -₹100");
            }}
            className="h-10 rounded-full border-amber-500 text-amber-800 hover:bg-amber-100 font-extrabold text-xs uppercase tracking-[0.14em]"
            data-testid="wallet-fix-drift-btn"
          >
            Prefill drift fix
          </Button>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <Button variant="outline" className="rounded-full" onClick={onClose} disabled={saving} data-testid="wallet-cancel">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="wallet-save">
            {saving ? "Saving…" : "Save override"}
          </Button>
        </div>

        <div className="mt-7 border-t border-border pt-5">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Recent overrides</p>
          {history.overrides.length === 0 && <p className="text-xs text-muted-foreground mt-2">No overrides yet.</p>}
          <ul className="mt-3 space-y-2 max-h-48 overflow-auto">
            {history.overrides.map((o) => (
              <li key={o.audit_id} className="rounded-xl bg-muted/40 px-3 py-2 text-xs" data-testid={`override-${o.audit_id}`}>
                <p className="font-semibold">
                  <span className={o.delta >= 0 ? "text-emerald-600" : "text-destructive"}>
                    {o.delta >= 0 ? "+" : ""}₹{o.delta}
                  </span>
                  {o.extend_days ? <span className="ml-2">· +{o.extend_days}d</span> : null}
                  {o.restore_meals ? <span className="ml-2">· +{o.restore_meals} meals</span> : null}
                </p>
                <p className="text-muted-foreground mt-0.5 truncate">{o.reason}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">by {o.admin_email} · {new Date(o.ts).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}


// iter-102: pick which row survives, then merge the other(s) into it.
function MergeUsersModal({ cluster, onClose, onMerged }) {
  const [primaryId, setPrimaryId] = useState(cluster.users[0]?.user_id || "");
  const [reason, setReason] = useState("");
  const [merging, setMerging] = useState(false);

  const submit = async () => {
    if (!reason.trim()) { toast.error("Reason is required for the audit log"); return; }
    if (!primaryId) { toast.error("Pick a primary account to keep"); return; }
    const dupes = cluster.users.filter((u) => u.user_id !== primaryId);
    if (dupes.length === 0) { toast.error("Pick a different primary"); return; }
    setMerging(true);
    try {
      // Merge each duplicate into the primary one-by-one — keeps the
      // backend logic simple and gives us a per-merge audit row.
      for (const d of dupes) {
        await api.post(`/admin/users/${primaryId}/merge`, {
          duplicate_user_id: d.user_id,
          reason: reason.trim(),
        });
      }
      toast.success(`Merged ${dupes.length} account${dupes.length === 1 ? "" : "s"} into ${cluster.users.find((u) => u.user_id === primaryId)?.name || primaryId}.`);
      onMerged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Merge failed");
    } finally { setMerging(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !merging && onClose()} data-testid="merge-users-modal">
      <div className="bg-card rounded-3xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="inline-flex h-11 w-11 rounded-xl bg-amber-500/10 text-amber-600 items-center justify-center"><GitMerge className="h-5 w-5" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-overline uppercase font-bold text-amber-700">Merge duplicates</p>
            <h3 className="font-display font-extrabold text-2xl mt-0.5">Shared {cluster.shared_by}: {cluster.shared_value}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Pick which row to keep. All other rows are absorbed into it — wallet balances sum, every subscription /
              transaction / override is rewritten, then the duplicate rows are deleted.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {cluster.users.map((u) => {
            const isPrimary = primaryId === u.user_id;
            return (
              <button
                key={u.user_id}
                type="button"
                onClick={() => setPrimaryId(u.user_id)}
                className={`w-full text-left rounded-xl border-2 p-3 transition-colors ${isPrimary ? "border-emerald-500 bg-emerald-500/5" : "border-border hover:border-emerald-400"}`}
                data-testid={`merge-primary-${u.user_id}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{u.name || "—"}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email || "—"} · {u.phone || "—"}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      ₹{Math.round(u.wallet_balance || 0)} wallet · {u.subs} subs · {u.txns} txns · {u.overrides} overrides
                    </p>
                  </div>
                  {isPrimary && (
                    <span className="text-[10px] tracking-overline uppercase font-bold px-2 py-1 rounded-full bg-emerald-600 text-white shrink-0">
                      Keep this
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 flex gap-2 items-start">
          <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
            This cannot be undone. Make sure you&apos;ve picked the row the user should keep using — usually the one
            with the most recent activity (subscriptions / overrides).
          </p>
        </div>

        <div className="mt-4">
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Reason · audit-logged</label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. user reported wallet not visible — merged Google + OTP rows"
            className="mt-1.5"
            data-testid="merge-reason-input"
          />
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <Button variant="outline" className="rounded-full" onClick={onClose} disabled={merging} data-testid="merge-cancel">Cancel</Button>
          <Button
            onClick={submit}
            disabled={merging || !reason.trim()}
            className="rounded-full bg-amber-600 hover:bg-amber-700 text-white"
            data-testid="merge-confirm"
          >
            {merging ? "Merging…" : `Merge ${cluster.users.length - 1} into selected`}
          </Button>
        </div>
      </div>
    </div>
  );
}
