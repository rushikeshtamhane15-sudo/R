import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Users, Calendar, IndianRupee, Check, Settings } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [roleEmail, setRoleEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState("staff");

  const load = async () => {
    try {
      const [s, u, a] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/admin/users"),
        api.get("/admin/attendance/today"),
      ]);
      setStats(s.data);
      setUsers(u.data.users || []);
      setAttendance(a.data.attendance || []);
    } catch (e) {
      toast.error("Failed to load admin data");
    }
  };

  useEffect(() => { load(); }, []);

  const setRole = async () => {
    try {
      await api.post("/admin/role", { email: roleEmail, role: selectedRole });
      toast.success(`Role updated to ${selectedRole}`);
      setRoleEmail("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  if (!stats) return <div className="p-12 text-center text-muted-foreground">Loading admin…</div>;

  const cards = [
    { label: "Total users", value: stats.total_users, icon: Users },
    { label: "Active subs", value: stats.active_subscriptions, icon: Check },
    { label: "Today's check-ins", value: stats.today_attendance, icon: Calendar },
    { label: "Revenue", value: `₹${Math.round(stats.revenue).toLocaleString("en-IN")}`, icon: IndianRupee },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-10" data-testid="admin-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Control room</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Admin overview</h1>
        </div>
        <Link to="/admin/plans" data-testid="manage-plans-link">
          <Button variant="outline" className="rounded-full"><Settings className="h-4 w-4 mr-2" /> Manage plans</Button>
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="stat-cards">
        {cards.map((c, idx) => (
          <div key={c.label} className="bg-card rounded-2xl border border-black/5 p-6" data-testid={`stat-card-${idx}`}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{c.label}</p>
              <c.icon className="h-4 w-4 text-primary" strokeWidth={1.75} />
            </div>
            <p className="font-display font-extrabold text-3xl md:text-4xl mt-3">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card rounded-2xl border border-black/5 p-6" data-testid="attendance-trend">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Attendance · last 7 days</p>
          <div className="h-64 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.attendance_trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-black/5 p-6" data-testid="role-management">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Assign role</p>
          <Input
            className="mt-3 rounded-xl"
            placeholder="user@email.com"
            value={roleEmail}
            onChange={(e) => setRoleEmail(e.target.value)}
            data-testid="role-email-input"
          />
          <div className="mt-3 flex gap-2">
            {["subscriber", "staff", "admin"].map((r) => (
              <Button
                key={r}
                type="button"
                variant={selectedRole === r ? "default" : "outline"}
                size="sm"
                className="rounded-full capitalize flex-1"
                onClick={() => setSelectedRole(r)}
                data-testid={`role-option-${r}`}
              >
                {r}
              </Button>
            ))}
          </div>
          <Button onClick={setRole} className="mt-4 w-full rounded-full bg-primary hover:bg-primary/90" data-testid="save-role-button">
            Save role
          </Button>
        </div>
      </div>

      <div className="mt-8 grid lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-2xl border border-black/5 p-6" data-testid="today-attendance-list">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today's check-ins</p>
          <div className="mt-4 max-h-80 overflow-auto divide-y divide-black/5">
            {attendance.length === 0 && <p className="text-sm text-muted-foreground">No check-ins yet.</p>}
            {attendance.map((r) => (
              <div key={r.att_id} className="flex items-center justify-between py-3 text-sm">
                <span className="font-semibold">{r.user_name}</span>
                <span className="text-xs text-muted-foreground capitalize">{r.meal_type} · {r.method}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-black/5 p-6" data-testid="users-list">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Users</p>
          <div className="mt-4 max-h-80 overflow-auto divide-y divide-black/5">
            {users.map((u) => (
              <div key={u.user_id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-semibold">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <span className="text-[10px] tracking-overline uppercase font-bold text-primary bg-primary/10 px-2 py-1 rounded-full">{u.role}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
