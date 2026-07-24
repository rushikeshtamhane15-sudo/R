import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { MapPin, User as UserIcon, Phone, CheckCircle2, Camera, Trash2, AlertTriangle, Receipt as ReceiptIcon, Wallet as WalletIcon, ScanLine as ScanLineIcon, Store as StoreIcon, Bike as BikeIcon, Info as InfoIcon, Fingerprint as FingerprintIcon, Phone as PhoneIcon, MessageCircle as MessageCircleIcon, Lock as LockIcon, RefreshCw as RefreshCwIcon, FileText as FileTextIcon, LogOut as LogOutIcon, ChevronRight as ChevronRightIcon, Pencil as PencilIcon, QrCode as QrCodeIcon, MapPin as MapPinIcon, Gift as GiftIcon, Banknote as BanknoteIcon, Star as StarIcon, Newspaper as NewspaperIcon, ChefHat as ChefHatIcon, Bell as BellIcon, SlidersHorizontal as SlidersIcon } from "lucide-react";
import WalletPill from "../components/WalletPill";
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
  const { user, setUser, logout } = useAuth();
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

  // iter-131.21: `/profile` acts as a mobile-app-style Account HUB by default.
  // The full edit form is shown when the URL carries `?edit=1`, when a `next`
  // redirect target is set (checkout flow), or when the user is missing any
  // required field (auto-open editor for incomplete profiles).
  const editMode = new URLSearchParams(location.search).get("edit") === "1"
    || !!next
    || (user && (!user.name || !user.phone || !user.address || !user.photo_url));

  if (!editMode) {
    return <AccountHub user={user} onLogout={() => { logout(); navigate("/"); }} />;
  }
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

      <div className="max-w-2xl mx-auto px-4 -mt-6 relative z-10 space-y-4">
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

        {/* iter-131.24: progress meter — visually communicates completeness */}
        {(() => {
          const filled = [form.name, form.phone, form.address, form.photo_url].filter((v) => (v || "").toString().trim()).length;
          const pct = Math.round((filled / 4) * 100);
          return (
            <div className="rounded-2xl bg-white border border-black/5 shadow-sm px-4 py-3" data-testid="profile-progress">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Profile completeness</p>
                <p className="text-sm font-display font-extrabold text-primary tabular-nums">{filled}/4</p>
              </div>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                  data-testid="profile-progress-bar"
                />
              </div>
            </div>
          );
        })()}

        {/* One consolidated card — Personal info + Photo + Address grouped */}
        <div className="bg-card rounded-2xl overflow-hidden shadow-sm border border-black/5" data-testid="profile-form-card">
          <div className="px-4 pt-3.5 pb-1">
            <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold text-muted-foreground flex items-center gap-1.5">
              <UserIcon className="h-3 w-3" /> Personal info
            </p>
          </div>
          <FieldRow icon={UserIcon} label="Full name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value.replace(/[^A-Za-z.'\- ]/g, "") })}
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

          <div className="border-t border-border/60 px-4 pt-3.5 pb-1">
            <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold text-muted-foreground flex items-center gap-1.5">
              <Camera className="h-3 w-3" /> Photo <span className="normal-case text-[10px] font-normal text-muted-foreground/70">· counter verification</span>
            </p>
          </div>
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="h-14 w-14 rounded-xl bg-muted/40 border-2 border-dashed border-border overflow-hidden flex items-center justify-center shrink-0" data-testid="photo-preview">
              {form.photo_url ? (
                <img src={form.photo_url} alt="profile" className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
              <input ref={cameraInputRef} type="file" accept="image/*" capture="user" onChange={(e) => onPickFile(e, "camera")} className="hidden" data-testid="camera-input" />
              <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => onPickFile(e, "file")} className="hidden" data-testid="file-input" />
              <Button type="button" size="sm" onClick={() => cameraInputRef.current?.click()} className="rounded-full h-8 px-3 bg-primary hover:bg-primary/90 text-xs" data-testid="take-selfie-button">
                <Camera className="h-3.5 w-3.5 mr-1" /> Selfie
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="rounded-full h-8 px-3 text-xs" data-testid="upload-photo-button">
                Upload
              </Button>
              {form.photo_url && (
                <Button type="button" size="sm" variant="outline" onClick={removePhoto} className="rounded-full h-8 px-3 text-xs text-destructive hover:text-destructive" data-testid="remove-photo-button">
                  <Trash2 className="h-3 w-3 mr-1" /> Remove
                </Button>
              )}
            </div>
          </div>

          <div className="border-t border-border/60 px-4 pt-3.5 pb-1">
            <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-3 w-3" /> Delivery address <span className="normal-case text-[10px] font-normal text-muted-foreground/70">· area + city</span>
            </p>
          </div>
          <div className="px-4 pb-3.5 pt-1">
            <Textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="border border-border/60 rounded-xl px-3 text-sm resize-none focus-visible:ring-1 focus-visible:ring-primary"
              data-testid="profile-address"
              placeholder="Flat / house no., street, area, city, pincode"
              rows={3}
              maxLength={300}
            />
          </div>
        </div>

        <div className="pt-1 flex gap-2 flex-wrap">
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

// iter-131.22: Account HUB — mirrors the pass-scan-mobile app screenshots
// exactly. Structure: "My account" title + edit fab, hero card (avatar + name
// + phone), 2 big square tiles (E-MEAL PASS · WALLET), then grouped sections
// My subscription → Orders & payments → Discover → Security → Support → Log
// out → version footer.
function AccountHub({ user, onLogout }) {
  const navigate = useNavigate();
  const [walletBalance, setWalletBalance] = useState(0);
  const [fingerprint, setFingerprint] = useState(() => {
    try { return localStorage.getItem("efc_biometric_lock") === "1"; } catch { return false; }
  });
  const missing = [];
  if (!user?.name) missing.push("name");
  if (!user?.phone) missing.push("phone");
  if (!user?.address) missing.push("address");
  if (!user?.photo_url) missing.push("photo");
  const incomplete = missing.length > 0;
  useEffect(() => {
    let cancel = false;
    api.get("/my/subscriptions").then((r) => {
      if (cancel) return;
      const subs = r.data?.subscriptions || [];
      setWalletBalance(subs.reduce((s, x) => s + (x.wallet_balance || 0), 0));
    }).catch(() => {});
    return () => { cancel = true; };
  }, []);
  const toggleFingerprint = () => {
    setFingerprint((v) => {
      const nv = !v;
      try { localStorage.setItem("efc_biometric_lock", nv ? "1" : "0"); } catch { /* storage blocked */ }
      toast.success(nv ? "Fingerprint lock enabled" : "Fingerprint lock disabled");
      return nv;
    });
  };

  return (
    <div className="min-h-screen bg-muted/10 pb-24" data-testid="account-hub">
      <SEO title="My account" path="/profile" includeBusinessSchema={false} description="Your efoodcare account." />

      <div className="max-w-md mx-auto px-4 pt-5 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="font-display font-extrabold text-3xl">My account</h1>
          <button
            type="button"
            onClick={() => navigate("/profile?edit=1")}
            className="h-11 w-11 rounded-full ring-1 ring-black/10 bg-white flex items-center justify-center hover:bg-accent/50"
            aria-label="Edit profile"
            data-testid="hub-edit-fab"
          >
            <PencilIcon className="h-4 w-4" />
          </button>
        </div>

        {/* iter-131.24: incomplete-profile nudge — mandatory before subscribing */}
        {incomplete && (
          <div className="rounded-2xl bg-amber-50 border border-amber-300 p-4 shadow-sm" data-testid="hub-incomplete-banner">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 rounded-full bg-amber-100 text-amber-700 items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-display font-extrabold text-base text-amber-900">Complete your profile</p>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  Add your {missing.join(", ")} to unlock subscriptions and checkout. It takes under a minute.
                </p>
                <Button
                  onClick={() => navigate("/profile?edit=1")}
                  className="mt-3 rounded-full h-9 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
                  data-testid="hub-incomplete-cta"
                >
                  Complete now →
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Hero card — avatar + name + phone */}
        <div className="rounded-2xl bg-white ring-1 ring-black/5 p-4 flex items-center gap-4 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)]" data-testid="hub-hero-card">
          {user?.photo_url || user?.picture ? (
            <img src={user.photo_url || user.picture} alt={user.name} className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-primary text-white flex items-center justify-center font-display font-extrabold text-2xl" data-testid="hub-hero-avatar">
              {(user?.name || "G")[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-display font-extrabold text-xl leading-tight truncate" data-testid="hub-hero-name">{user?.name || "Guest"}</p>
            {user?.phone && <p className="text-sm text-muted-foreground mt-0.5 tabular-nums">+91 {(user.phone).replace(/^\+?91/, "")}</p>}
          </div>
        </div>

        {/* Two big tiles: E-MEAL PASS · WALLET */}
        <div className="grid grid-cols-2 gap-3" data-testid="hub-big-tiles">
          <Link to="/dashboard" className="rounded-2xl bg-white ring-1 ring-black/5 p-4 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-transform" data-testid="hub-tile-emeal">
            <QrCodeIcon className="h-6 w-6 text-primary" strokeWidth={2} />
            <p className="mt-2 text-[10px] tracking-[0.14em] uppercase font-extrabold text-muted-foreground">E-Meal Pass</p>
            <p className="font-display font-extrabold text-2xl mt-1">View</p>
          </Link>
          <Link to="/wallet" className="rounded-2xl bg-white ring-1 ring-black/5 p-4 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-transform block" data-testid="hub-tile-wallet">
            <WalletIcon className="h-6 w-6 text-primary" strokeWidth={2} />
            <p className="mt-2 text-[10px] tracking-[0.14em] uppercase font-extrabold text-muted-foreground">Wallet</p>
            <p className="font-display font-extrabold text-2xl mt-1 tabular-nums">₹{Math.round(walletBalance).toLocaleString("en-IN")}</p>
          </Link>
        </div>

        <HubSection label="My subscription" testid="hub-section-subscription">
          <HubRow icon={QrCodeIcon} label="My e-meal pass" to="/dashboard" testid="hub-row-emeal" />
          <HubRow icon={ReceiptIcon} label="Order history" to="/restaurant/orders" testid="hub-row-history" />
          <HubRow icon={MapPinIcon} label="Address book" to="/profile?edit=1" testid="hub-row-address" />
          <HubRow icon={WalletIcon} label="Wallet & top-up" to="/wallet" testid="hub-row-wallet-top" />
          <HubRow icon={GiftIcon} label="Refer & earn" to="/contact?subject=refer" testid="hub-row-refer" />
          <HubRow icon={BanknoteIcon} label="Request refund" to="/contact?subject=refund" testid="hub-row-refund-req" />
          <HubRow icon={StarIcon} label="Rate your meals" to="/contact?subject=rate" testid="hub-row-rate" />
          <HubRow icon={NewspaperIcon} label="Blog" to="/about" testid="hub-row-blog" />
          <HubRow icon={ChefHatIcon} label="Today&apos;s mess menu" to="/dashboard" testid="hub-row-mess-menu" />
          <HubRow icon={BellIcon} label="Subscription plans" to="/plans" testid="hub-row-plans" />
          <HubRow icon={SlidersIcon} label="Tiffin preferences" to="/dashboard" testid="hub-row-tiffin-prefs" />
        </HubSection>

        <HubSection label="Orders & payments" testid="hub-section-orders">
          <HubRow icon={ReceiptIcon} label="My orders" to="/restaurant/orders" testid="hub-row-orders" />
          <HubRow icon={WalletIcon} label="Wallet & transactions" to="/wallet" testid="hub-row-wallet" />
          <HubRow icon={ScanLineIcon} label="Scan & redeem" to="/self-scan" testid="hub-row-scan" />
        </HubSection>

        <HubSection label="Discover" testid="hub-section-discover">
          <HubRow icon={StoreIcon} label="Our branches" to="/contact" testid="hub-row-branches" />
          <HubRow icon={BikeIcon} label="Become a rider" to="/become-a-rider" testid="hub-row-rider" />
          <HubRow icon={InfoIcon} label="About efoodcare" to="/about" testid="hub-row-about" />
        </HubSection>

        <HubSection label="Security" testid="hub-section-security">
          <button
            type="button"
            onClick={toggleFingerprint}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-card ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_10px_-6px_rgba(0,0,0,0.06)] text-left"
            data-testid="hub-row-fingerprint"
          >
            <span className="inline-flex h-10 w-10 rounded-full bg-primary/8 text-primary items-center justify-center shrink-0">
              <FingerprintIcon className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-foreground leading-tight">Lock app with fingerprint</p>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">Use Touch ID / Face ID at app launch</p>
            </div>
            <span className={`inline-flex h-6 w-11 rounded-full transition-colors shrink-0 ${fingerprint ? "bg-primary" : "bg-muted"}`}>
              <span className={`h-5 w-5 rounded-full bg-white shadow mt-0.5 transition-transform ${fingerprint ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </span>
          </button>
        </HubSection>

        <HubSection label="Support" testid="hub-section-support">
          <HubRow icon={PhoneIcon} label="Contact us" to="/contact" testid="hub-row-contact" />
          <HubRow icon={MessageCircleIcon} label="WhatsApp us" to="/contact?ch=whatsapp" testid="hub-row-whatsapp" />
          <HubRow icon={LockIcon} label="Privacy policy" to="/privacy" testid="hub-row-privacy" />
          <HubRow icon={RefreshCwIcon} label="Refund policy" to="/refund" testid="hub-row-refund" />
        </HubSection>

        <button
          type="button"
          onClick={onLogout}
          className="w-full h-12 rounded-2xl border-2 border-primary/30 text-primary font-bold flex items-center justify-center gap-2 hover:bg-primary/5 transition-colors mt-2"
          data-testid="hub-logout"
        >
          <LogOutIcon className="h-4 w-4" /> Log out
        </button>

        <p className="text-center text-[11px] text-muted-foreground mt-3" data-testid="hub-version">
          efoodcare · Dining Pass Scan · v1.0
        </p>
      </div>
    </div>
  );
}

function HubSection({ label, testid, children }) {
  return (
    <div data-testid={testid}>
      <p className="text-[13px] font-bold text-muted-foreground/90 px-1 mb-2">{label}</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function HubRow({ icon: Icon, label, to, testid }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-card ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_10px_-6px_rgba(0,0,0,0.06)] hover:bg-accent/40 transition-colors"
      data-testid={testid}
    >
      <span className="inline-flex h-10 w-10 rounded-full bg-primary/8 text-primary items-center justify-center shrink-0">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="flex-1 text-[15px] font-bold text-foreground">{label}</span>
      <ChevronRightIcon className="h-4 w-4 text-muted-foreground/70 shrink-0" />
    </Link>
  );
}
