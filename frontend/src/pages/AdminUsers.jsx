import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Trash2, Search, Wallet, Bike } from "lucide-react";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [walletTarget, setWalletTarget] = useState(null);

  const load = async () => {
    try { const r = await api.get("/admin/users"); setUsers(r.data.users || []); }
    catch { toast.error("Failed to load users"); }
  };
  useEffect(() => { load(); }, []);

  const setUserRole = async () => {
    try {
      await api.post("/admin/role", { email, role });
      toast.success(`Role updated to ${role}`);
      setEmail("");
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

  return (
    <div data-testid="admin-users-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Users</p>
      <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-2">Users & roles</h1>

      <div className="mt-6 grid lg:grid-cols-3 gap-6">
        <div className="bg-card rounded-2xl border border-border p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">All users · {users.length}</p>
            <div className="relative w-56">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="rounded-full h-9 pl-9 text-sm" data-testid="user-search" />
            </div>
          </div>
          <div className="mt-4 max-h-[60vh] overflow-auto divide-y divide-border">
            {filtered.map((u) => {
              const isMe = me && u.user_id === me.user_id;
              return (
                <div key={u.user_id} className="flex items-center justify-between py-3 text-sm gap-3" data-testid={`user-row-${u.user_id}`}>
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
                        toast.success(`${u.name || u.user_id} is now an eFoodCare rider`);
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
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Assign role by email</p>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@email.com" className="mt-3 rounded-xl" data-testid="role-email-input" />
          <div className="mt-3 flex flex-wrap gap-2">
            {["subscriber", "staff", "admin", "rider", "delivery_boy"].map((r) => (
              <Button key={r} variant={role === r ? "default" : "outline"} size="sm" onClick={() => setRole(r)} className="rounded-full capitalize text-xs" data-testid={`role-option-${r}`}>{r.replace("_", " ")}</Button>
            ))}
          </div>
          <Button onClick={setUserRole} className="mt-4 w-full rounded-full bg-primary hover:bg-primary/90" data-testid="save-role-button">Save role</Button>

          <div className="border-t border-border mt-5 pt-4">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground mb-2">Quick: Promote to rider</p>
            <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">Click the bike icon on any row to instantly mark them as an eFoodCare rider — they'll get rider-only login redirect + dashboard.</p>
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
