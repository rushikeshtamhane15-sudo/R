import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { User as UserIcon, Phone, Bike, Wallet, IndianRupee, LogOut, Save, ShieldCheck } from "lucide-react";

/**
 * Rider account page — basic profile + wallet snapshot + logout.
 * Rider-only chrome (BottomNav handles nav, no Header).
 */
export default function RiderAccount() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: "", phone: "" });
  const [me, setMe] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => { if (user && user.role !== "rider") navigate("/"); }, [user, navigate]);

  useEffect(() => {
    api.get("/rider/me")
      .then((r) => setMe(r.data))
      .catch((e) => setLoadErr(e?.response?.data?.detail || "Could not load rider data"));
  }, []);

  useEffect(() => {
    if (user) setForm({ name: user.name || "", phone: user.phone || "" });
  }, [user]);

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const r = await api.post("/auth/profile", { name: form.name.trim() });
      setUser(r.data);
      toast.success("Profile updated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
    toast.success("Logged out");
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-28" data-testid="rider-account">
      <header className="bg-foreground text-background">
        <div className="max-w-2xl mx-auto px-5 py-6 flex items-center gap-3">
          <span className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
            <Bike className="h-6 w-6 text-primary" />
          </span>
          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold opacity-70">efoodcare rider</p>
            <h1 className="font-display font-extrabold text-xl tracking-tight">{user?.name || "Rider"}</h1>
            <p className="text-xs opacity-80 mt-0.5">{user?.phone}</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 pt-5 space-y-4">
        {loadErr && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 text-destructive p-4 text-sm" data-testid="rider-account-error">
            {loadErr}
          </div>
        )}

        {/* Wallet snapshot */}
        <section className="rounded-2xl border border-border bg-card p-5 grid grid-cols-2 gap-4" data-testid="rider-account-stats">
          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> Wallet
            </p>
            <p className="font-display font-extrabold text-2xl mt-1 text-emerald-600 tabular-nums">₹{Number(me?.wallet_balance ?? 0).toFixed(0)}</p>
          </div>
          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <IndianRupee className="h-3 w-3" /> Cash pending
            </p>
            <p className="font-display font-extrabold text-2xl mt-1 tabular-nums">₹{Number(me?.cash_pending ?? 0).toFixed(0)}</p>
          </div>
        </section>

        {/* Profile form */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground mb-3 flex items-center gap-1.5">
            <UserIcon className="h-3 w-3" /> Profile
          </p>

          <label className="block">
            <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Name</span>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Your name"
              className="mt-1.5"
              data-testid="rider-account-name"
            />
          </label>

          <label className="block mt-3">
            <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1">
              <Phone className="h-3 w-3" /> Phone (verified)
            </span>
            <Input value={form.phone} disabled className="mt-1.5 bg-muted" data-testid="rider-account-phone" />
          </label>

          <Button
            onClick={save}
            disabled={saving}
            className="rounded-full mt-5 bg-primary hover:bg-primary/90 w-full sm:w-auto"
            data-testid="rider-account-save"
          >
            <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save changes"}
          </Button>
        </section>

        {/* Earnings split */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" /> Per-delivery payout
          </p>
          <p className="font-display font-extrabold text-xl tabular-nums">₹{Number(me?.per_delivery_inr ?? 50).toFixed(0)} <span className="text-sm font-normal text-muted-foreground">/ order</span></p>
          <p className="text-[11px] text-muted-foreground mt-1">Auto-credited to your wallet on every successful delivery.</p>
        </section>

        {/* Danger / logout */}
        <section className="rounded-2xl border border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/30 p-5">
          <p className="text-xs tracking-overline uppercase font-bold text-rose-700 dark:text-rose-300">Session</p>
          <p className="text-sm text-foreground/80 mt-1">Sign out of this device. You'll need OTP to log back in.</p>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="rounded-full mt-3 border-rose-300 text-rose-700 hover:bg-rose-100"
            data-testid="rider-account-logout"
          >
            <LogOut className="h-4 w-4 mr-1.5" /> Logout
          </Button>
        </section>
      </main>
    </div>
  );
}
