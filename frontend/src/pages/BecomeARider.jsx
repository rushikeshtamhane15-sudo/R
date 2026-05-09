import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Bike, ChevronLeft, IndianRupee, Clock, CheckCircle2, XCircle, ShieldCheck, Send,
} from "lucide-react";

const STATUS = {
  pending:  { label: "Under review",   color: "bg-amber-100 text-amber-800",  icon: Clock },
  approved: { label: "Approved!",      color: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
  rejected: { label: "Rejected",       color: "bg-rose-100 text-rose-800",    icon: XCircle },
};

/**
 * Self-service rider application form.
 * Logged-in users submit; admin approves; on approval, user.role flips to 'rider'.
 */
export default function BecomeARider() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [existing, setExisting] = useState(null);
  const [form, setForm] = useState({
    full_name: user?.name || "",
    phone: user?.phone || "",
    licence_no: "",
    bike_number: "",
    bank_acc_last4: "",
    city: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) { navigate("/login?next=/become-a-rider"); return; }
    if (user.role === "rider") { navigate("/rider"); return; }
    api.get("/rider/apply/me")
      .then((r) => setExisting(r.data?.application || null))
      .catch(() => {});
  }, [user, navigate]);

  const submit = async () => {
    for (const k of ["full_name", "phone", "licence_no", "bike_number", "bank_acc_last4", "city"]) {
      if (!String(form[k] || "").trim()) { toast.error("All fields are required"); return; }
    }
    if (form.bank_acc_last4.length !== 4 || !/^\d{4}$/.test(form.bank_acc_last4)) {
      toast.error("Bank a/c last 4 must be 4 digits"); return;
    }
    if (!/^\d{10,15}$/.test(form.phone.replace(/\D/g, ""))) {
      toast.error("Enter a valid phone number"); return;
    }
    setSubmitting(true);
    try {
      const r = await api.post("/rider/apply", form);
      setExisting(r.data.application);
      toast.success("Application submitted · we'll review within 24h");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not submit application");
    } finally {
      setSubmitting(false);
    }
  };

  if (existing && existing.status !== "rejected") {
    const meta = STATUS[existing.status] || STATUS.pending;
    const Icon = meta.icon;
    return (
      <div className="min-h-screen bg-background pb-24" data-testid="rider-apply-status">
        <header className="bg-foreground text-background">
          <div className="max-w-2xl mx-auto px-5 py-7">
            <Link to="/restaurant" className="inline-flex items-center text-background/85 hover:text-background text-xs font-bold uppercase tracking-overline mb-3">
              <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
            </Link>
            <h1 className="font-display font-extrabold text-2xl tracking-tight">Rider application</h1>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-5 pt-6">
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-overline ${meta.color}`}>
              <Icon className="h-3.5 w-3.5" /> {meta.label}
            </span>
            <p className="font-mono text-xs text-muted-foreground mt-3">{existing.application_id}</p>
            <h2 className="font-display font-extrabold text-xl mt-4">
              {existing.status === "approved"
                ? "Welcome to the rider team!"
                : "Your application is under review"}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {existing.status === "approved"
                ? "Sign out and sign back in to access your rider dashboard."
                : "We'll notify you on WhatsApp once admin reviews your details (usually within 24 hours)."}
            </p>
            {existing.status === "approved" && (
              <Button asChild className="rounded-full mt-5 bg-primary hover:bg-primary/90" data-testid="goto-rider-dashboard">
                <Link to="/rider">Go to rider dashboard</Link>
              </Button>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24" data-testid="become-a-rider">
      <header className="bg-primary text-primary-foreground">
        <div className="max-w-2xl mx-auto px-5 py-7">
          <Link to="/restaurant" className="inline-flex items-center text-primary-foreground/85 hover:text-primary-foreground text-xs font-bold uppercase tracking-overline mb-3">
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Link>
          <p className="text-xs tracking-overline uppercase font-bold opacity-80 flex items-center gap-1.5"><Bike className="h-3.5 w-3.5" /> Earn with efoodcare</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-1.5">Become a rider</h1>
          <p className="text-sm opacity-90 mt-1.5">Flexible hours · ₹50 per delivery · daily payouts</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 pt-6 space-y-4">
        {/* Perks */}
        <section className="grid grid-cols-3 gap-3" data-testid="rider-perks">
          {[
            { icon: IndianRupee, label: "Daily payout", sub: "Razorpay direct" },
            { icon: Clock,       label: "Flexible",     sub: "Pick own slots" },
            { icon: ShieldCheck, label: "Safety",       sub: "Insurance + OTP" },
          ].map((p) => (
            <div key={p.label} className="rounded-2xl border border-border bg-card p-3 text-center">
              <p.icon className="h-5 w-5 mx-auto text-primary mb-1.5" strokeWidth={1.7} />
              <p className="text-xs font-display font-extrabold leading-tight">{p.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{p.sub}</p>
            </div>
          ))}
        </section>

        {/* Form */}
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3" data-testid="rider-apply-form">
          <p className="font-display font-extrabold">Your details</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name">
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="As per Aadhaar" data-testid="rider-apply-name" />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 15) })} placeholder="10-digit mobile" inputMode="numeric" data-testid="rider-apply-phone" />
            </Field>
            <Field label="Driving licence #">
              <Input value={form.licence_no} onChange={(e) => setForm({ ...form, licence_no: e.target.value.toUpperCase() })} placeholder="MH02 20231234567" data-testid="rider-apply-licence" />
            </Field>
            <Field label="Bike registration #">
              <Input value={form.bike_number} onChange={(e) => setForm({ ...form, bike_number: e.target.value.toUpperCase() })} placeholder="MH 14 AB 1234" data-testid="rider-apply-bike" />
            </Field>
            <Field label="Bank a/c last 4">
              <Input value={form.bank_acc_last4} onChange={(e) => setForm({ ...form, bank_acc_last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="4 digits" inputMode="numeric" maxLength={4} data-testid="rider-apply-bank4" />
            </Field>
            <Field label="City">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Pune" data-testid="rider-apply-city" />
            </Field>
          </div>

          <Button
            onClick={submit}
            disabled={submitting}
            size="lg"
            className="rounded-full w-full mt-2 bg-primary hover:bg-primary/90"
            data-testid="rider-apply-submit"
          >
            <Send className="h-4 w-4 mr-2" />
            {submitting ? "Submitting…" : "Submit application"}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            By submitting you agree to a manual verification process (24h SLA).
          </p>
        </section>
      </main>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
