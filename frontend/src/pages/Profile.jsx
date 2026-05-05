import React, { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { MapPin, User as UserIcon, Phone, CheckCircle2 } from "lucide-react";

export default function Profile() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [submitting, setSubmitting] = useState(false);

  const next = new URLSearchParams(location.search).get("next");

  useEffect(() => {
    if (user) setForm({ name: user.name || "", phone: user.phone || "", address: user.address || "" });
  }, [user]);

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) {
      toast.error("All fields required");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post("/auth/profile", form);
      setUser(r.data.user);
      toast.success("Profile saved");
      if (next) navigate(next, { replace: true });
      else navigate("/dashboard");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSubmitting(false); }
  };

  const isComplete = user?.name && user?.phone && user?.address;

  return (
    <div className="max-w-2xl mx-auto px-6 md:px-8 lg:px-12 py-10" data-testid="profile-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Your details</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">
        {next ? "Complete profile before checkout" : "Profile"}
      </h1>
      {next && (
        <p className="text-muted-foreground mt-3 text-sm">Name, phone and delivery address are required. We'll save them for your subscription and future checkouts.</p>
      )}
      {isComplete && !next && (
        <div className="mt-4 flex items-center gap-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" /> Profile complete
        </div>
      )}

      <div className="mt-8 bg-card rounded-2xl border border-black/5 p-6 space-y-5">
        <div>
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><UserIcon className="h-3 w-3" /> Full name</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-2 rounded-xl" data-testid="profile-name" placeholder="e.g. Aman Gupta" />
        </div>
        <div>
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" /> Phone (with country code)</label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-2 rounded-xl" data-testid="profile-phone" placeholder="+91 98XXXXXXXX" />
        </div>
        <div>
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Delivery address</label>
          <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-2 rounded-xl" data-testid="profile-address" placeholder="Flat / house no., street, city, pincode" rows={3} />
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={submitting} className="rounded-full bg-primary hover:bg-primary/90 flex-1" data-testid="save-profile-button">
            {submitting ? "Saving…" : next ? "Save & continue to checkout" : "Save profile"}
          </Button>
          {!next && (
            <Link to="/dashboard"><Button variant="outline" className="rounded-full">Back</Button></Link>
          )}
        </div>
      </div>
    </div>
  );
}
