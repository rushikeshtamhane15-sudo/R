import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");

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

  return (
    <div data-testid="admin-users-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Users</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Users & roles</h1>

      <div className="mt-6 grid lg:grid-cols-3 gap-6">
        <div className="bg-card rounded-2xl border border-border p-6 lg:col-span-2">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">All users</p>
          <div className="mt-4 max-h-[60vh] overflow-auto divide-y divide-border">
            {users.map((u) => (
              <div key={u.user_id} className="flex items-center justify-between py-3 text-sm" data-testid={`user-row-${u.user_id}`}>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email || u.phone || "—"}</p>
                </div>
                <span className="text-[10px] tracking-overline uppercase font-bold text-primary bg-primary/10 px-2 py-1 rounded-full ml-2">{u.role}</span>
              </div>
            ))}
            {users.length === 0 && <p className="text-sm text-muted-foreground">No users yet.</p>}
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
    </div>
  );
}
