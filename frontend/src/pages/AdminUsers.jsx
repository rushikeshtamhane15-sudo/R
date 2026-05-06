import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Trash2, Search } from "lucide-react";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Users & roles</h1>

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
          <div className="mt-3 flex gap-2">
            {["subscriber", "staff", "admin"].map((r) => (
              <Button key={r} variant={role === r ? "default" : "outline"} size="sm" onClick={() => setRole(r)} className="rounded-full capitalize flex-1" data-testid={`role-option-${r}`}>{r}</Button>
            ))}
          </div>
          <Button onClick={setUserRole} className="mt-4 w-full rounded-full bg-primary hover:bg-primary/90" data-testid="save-role-button">Save role</Button>
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
    </div>
  );
}
