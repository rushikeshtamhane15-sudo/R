import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { MapPin, User as UserIcon, Phone, CheckCircle2, Camera, Trash2, AlertTriangle } from "lucide-react";
import SEO from "../components/SEO";

const MAX_DIM = 720;
const QUALITY = 0.7;

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, MAX_DIM / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            const r2 = new FileReader();
            r2.onload = () => resolve(r2.result);
            r2.onerror = reject;
            r2.readAsDataURL(blob);
          },
          "image/jpeg",
          QUALITY,
        );
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Profile() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: "", phone: "", address: "", photo_url: "" });
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const next = new URLSearchParams(location.search).get("next");
  const reason = new URLSearchParams(location.search).get("reason");
  const isFranchiseOnboard = reason === "franchise-onboard";

  useEffect(() => {
    if (user) setForm({
      // iter-111: pre-fill the name ONLY for users who've already completed
      // onboarding (signalled by a non-empty address). For brand-new users
      // the field stays empty so they type a real name intentionally — the
      // iter-110 fallback (email-local-part / phone / "Member") in
      // doc_to_user keeps the auth path alive but is NEVER used as the
      // pre-fill source.
      name: (user.address && user.name) ? user.name : "",
      phone: user.phone || "",
      address: user.address || "",
      photo_url: user.photo_url || "",
    });
  }, [user]);

  const onPickFile = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please pick an image"); return; }
    try {
      const dataUrl = await compressImage(file);
      setForm((f) => ({ ...f, photo_url: dataUrl }));
      toast.success(`${type === "camera" ? "Selfie" : "Photo"} ready`);
    } catch { toast.error("Could not read image"); }
    e.target.value = "";
  };

  const removePhoto = () => setForm({ ...form, photo_url: "" });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.delete("/auth/me");
      toast.success("Account deleted. We'll miss you.");
      setUser(null);
      navigate("/", { replace: true });
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not delete account"); }
    finally { setDeleting(false); }
  };

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) {
      toast.error("Name, phone and address are required");
      return;
    }
    if (!form.photo_url) {
      toast.error("Please add a selfie or photo before continuing");
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

  const isComplete = user?.name && user?.phone && user?.address && user?.photo_url;

  return (
    <div className="min-h-screen bg-muted/30 pb-20" data-testid="profile-page">
      <SEO title="My account" path="/profile" includeBusinessSchema={false} description="Manage your efoodcare profile, delivery address and subscription details." />

      {/* Native-mobile-app hero — red gradient with avatar, name and role pill centered */}
      <div
        className="relative text-primary-foreground overflow-hidden"
        style={{
          background: "linear-gradient(150deg, #c92626 0%, #a02323 55%, #7a1a1a 100%)",
        }}
        data-testid="profile-hero"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full opacity-30"
          style={{ background: "radial-gradient(circle at center, rgba(255,255,255,0.35) 0%, transparent 65%)" }}
        />
        <div className="relative max-w-2xl mx-auto px-5 pt-6 pb-10 text-center">
          <p className="text-[10px] tracking-[0.18em] uppercase font-extrabold text-primary-foreground/85">My account</p>
          <div className="mt-4 inline-block relative">
            <div className="h-24 w-24 rounded-full bg-white/15 ring-4 ring-white/30 shadow-xl overflow-hidden flex items-center justify-center backdrop-blur-sm" data-testid="profile-hero-avatar">
              {form.photo_url ? (
                <img src={form.photo_url} alt={form.name || "You"} className="h-full w-full object-cover" />
              ) : (
                <UserIcon className="h-10 w-10 text-white/85" />
              )}
            </div>
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 inline-flex h-9 w-9 rounded-full bg-white text-primary ring-4 ring-primary shadow-md items-center justify-center"
              aria-label="Change photo"
              data-testid="hero-change-photo"
            >
              <Camera className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          <h1 className="mt-4 font-display font-extrabold text-2xl leading-tight truncate" data-testid="profile-hero-name">
            {form.name || "Complete your account"}
          </h1>
          {(form.phone || user?.phone) && (
            <p className="text-sm text-primary-foreground/85 mt-1 tabular-nums">+91 {(form.phone || user.phone).replace(/^\+?91/, "")}</p>
          )}
          <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 backdrop-blur-sm px-2.5 py-1 text-[9px] tracking-overline uppercase font-extrabold ring-1 ring-white/25">
              {user?.role || "guest"}
            </span>
            {isComplete && !next && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/25 backdrop-blur-sm px-2.5 py-1 text-[9px] tracking-overline uppercase font-extrabold ring-1 ring-emerald-300/40">
                <CheckCircle2 className="h-2.5 w-2.5" /> Verified
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 -mt-6 relative z-10 space-y-3">
        {isFranchiseOnboard && (
          <div className="rounded-2xl bg-amber-50 border border-amber-300 px-4 py-3 shadow-sm" data-testid="franchise-onboard-banner">
            <p className="text-sm font-bold text-amber-900">Your branch dashboard is one step away</p>
            <p className="text-xs text-amber-800 mt-1 leading-relaxed">A complete profile (name, phone, delivery address) is required before you can manage your franchise. Fill the fields below and tap Save — we&apos;ll redirect you to your console.</p>
          </div>
        )}
        {next && !isFranchiseOnboard && (
          <div className="rounded-2xl bg-primary/8 border border-primary/25 px-4 py-3 shadow-sm">
            <p className="text-sm font-bold text-primary">Almost there</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">A selfie/photo, name, phone and delivery address are required before checkout. We&apos;ll save them for future orders too.</p>
          </div>
        )}

        {/* Personal info — iOS-style grouped list */}
        <SectionLabel icon={UserIcon} label="Personal info" />
        <div className="bg-card rounded-2xl overflow-hidden shadow-sm border border-black/5">
          <FieldRow icon={UserIcon} label="Full name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value.replace(/[^A-Za-z\.\'\- ]/g, "") })}
              className="w-full h-9 text-right text-sm font-semibold bg-transparent outline-none placeholder:text-muted-foreground/60"
              data-testid="profile-name"
              placeholder="Enter full name"
              maxLength={50}
            />
          </FieldRow>
          <FieldRow icon={Phone} label="Phone" border>
            <div className="inline-flex items-center gap-1 text-sm font-semibold">
              <span className="text-muted-foreground text-xs">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={form.phone.replace(/^\+?91/, "").replace(/\D/g, "").slice(0, 10)}
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                className="w-32 h-9 text-right text-sm font-semibold bg-transparent outline-none placeholder:text-muted-foreground/60 tabular-nums"
                data-testid="profile-phone"
                placeholder="98XXXXXXXX"
              />
            </div>
          </FieldRow>
        </div>

        <SectionLabel icon={Camera} label="Photo" hint="Used at the counter for verification" />
        <div className="bg-card rounded-2xl px-4 py-3 shadow-sm border border-black/5 flex items-center gap-3">
          <div className="h-14 w-14 rounded-xl bg-muted/40 border-2 border-dashed border-border overflow-hidden flex items-center justify-center shrink-0" data-testid="photo-preview">
            {form.photo_url ? (
              <img src={form.photo_url} alt="profile" className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <input ref={cameraInputRef} type="file" accept="image/*" capture="user" onChange={(e) => onPickFile(e, "camera")} className="hidden" data-testid="camera-input" />
            <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => onPickFile(e, "file")} className="hidden" data-testid="file-input" />
            <Button type="button" size="sm" onClick={() => cameraInputRef.current?.click()} className="rounded-full h-8 px-3 bg-primary hover:bg-primary/90 text-xs" data-testid="take-selfie-button">
              <Camera className="h-3.5 w-3.5 mr-1" /> Take selfie
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="rounded-full h-8 px-3 text-xs ml-1" data-testid="upload-photo-button">
              Upload
            </Button>
            {form.photo_url && (
              <Button type="button" size="sm" variant="outline" onClick={removePhoto} className="rounded-full h-8 px-3 text-xs ml-1 text-destructive hover:text-destructive" data-testid="remove-photo-button">
                <Trash2 className="h-3 w-3 mr-1" /> Remove
              </Button>
            )}
          </div>
        </div>

        <SectionLabel icon={MapPin} label="Delivery address" hint="Min 10 chars — area + city works for delivery" />
        <div className="bg-card rounded-2xl px-4 py-3 shadow-sm border border-black/5">
          <Textarea
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-0 text-sm resize-none"
            data-testid="profile-address"
            placeholder="Flat / house no., street, area, city, pincode"
            rows={3}
            maxLength={300}
          />
        </div>

        <div className="pt-2 flex gap-2 flex-wrap">
          <Button onClick={save} disabled={submitting} className="rounded-full h-12 bg-primary hover:bg-primary/90 flex-1 min-w-[200px] font-bold shadow-md" data-testid="save-profile-button">
            {submitting ? "Saving…" : next ? "Save & continue to checkout" : "Save changes"}
          </Button>
          {!next && <Link to="/dashboard"><Button variant="outline" className="rounded-full h-12">Back</Button></Link>}
        </div>

        {!next && (
          <div className="pt-6 mt-4" data-testid="danger-zone">
            <SectionLabel icon={AlertTriangle} label="Privacy zone" />
            <div className="bg-card rounded-2xl px-4 py-4 shadow-sm border border-destructive/20">
              <h3 className="font-display font-extrabold text-sm text-destructive">Delete my account</h3>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                Permanently removes your profile, subscription, wallet history, attendance and deliveries. Cannot be undone.
              </p>
              <Button onClick={() => setDeleteOpen(true)} variant="outline" size="sm" className="mt-3 rounded-full text-destructive hover:bg-destructive/5 border-destructive/30" data-testid="delete-account-button">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete my account
              </Button>
            </div>
          </div>
        )}
      </div>

      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !deleting && setDeleteOpen(false)} data-testid="delete-account-modal">
          <div className="bg-card rounded-3xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="inline-flex h-11 w-11 rounded-xl bg-destructive/10 text-destructive items-center justify-center"><AlertTriangle className="h-5 w-5" /></div>
            <h3 className="font-display font-extrabold text-2xl mt-4">Delete account?</h3>
            <p className="text-sm text-muted-foreground mt-2">
              We&apos;ll permanently remove everything tied to <b className="text-foreground">{user?.name}</b> — subscription, wallet, attendance, deliveries, history. <span className="text-destructive font-semibold">This cannot be undone.</span>
            </p>
            <p className="text-xs text-muted-foreground mt-4">Type <b className="text-foreground">DELETE</b> to confirm:</p>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="mt-2 rounded-xl" data-testid="confirm-delete-text" autoFocus />
            <div className="mt-6 flex gap-3 justify-end">
              <Button variant="outline" className="rounded-full" onClick={() => setDeleteOpen(false)} disabled={deleting} data-testid="cancel-delete">Cancel</Button>
              <Button
                className="rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={deleteAccount}
                disabled={deleting || confirmText !== "DELETE"}
                data-testid="confirm-delete"
              >
                {deleting ? "Deleting…" : "Delete forever"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// iter-131.20: native-app style grouped-list helpers.
function SectionLabel({ icon: Icon, label, hint }) {
  return (
    <div className="px-4 pt-4 pb-1">
      <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold text-muted-foreground flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground/80 mt-0.5">{hint}</p>}
    </div>
  );
}

function FieldRow({ icon: Icon, label, border, children }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${border ? "border-t border-border/60" : ""}`}>
      <span className="inline-flex h-8 w-8 rounded-lg bg-muted text-secondary items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="text-xs font-bold text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 min-w-0 text-right">{children}</div>
    </div>
  );
}
