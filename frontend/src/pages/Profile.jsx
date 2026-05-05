import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { MapPin, User as UserIcon, Phone, CheckCircle2, Camera, Trash2 } from "lucide-react";

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

  useEffect(() => {
    if (user) setForm({
      name: user.name || "",
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
    <div className="max-w-2xl mx-auto px-6 md:px-8 lg:px-12 py-10" data-testid="profile-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Your details</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">
        {next ? "Complete profile before checkout" : "Profile"}
      </h1>
      {next && (
        <p className="text-muted-foreground mt-3 text-sm">A selfie/photo, name, phone and delivery address are required. We'll save them for your subscription and future checkouts.</p>
      )}
      {isComplete && !next && (
        <div className="mt-4 flex items-center gap-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" /> Profile complete
        </div>
      )}

      <div className="mt-8 bg-card rounded-2xl border border-border p-6 space-y-5">
        {/* Photo */}
        <div>
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><Camera className="h-3 w-3" /> Selfie / Photo (required)</label>
          <div className="mt-3 flex items-start gap-4 flex-wrap">
            <div className="h-28 w-28 rounded-2xl border-2 border-dashed border-border bg-muted/40 overflow-hidden flex items-center justify-center" data-testid="photo-preview">
              {form.photo_url ? (
                <img src={form.photo_url} alt="profile" className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-7 w-7 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input ref={cameraInputRef} type="file" accept="image/*" capture="user" onChange={(e) => onPickFile(e, "camera")} className="hidden" data-testid="camera-input" />
              <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => onPickFile(e, "file")} className="hidden" data-testid="file-input" />
              <Button type="button" onClick={() => cameraInputRef.current?.click()} className="rounded-full bg-primary hover:bg-primary/90" data-testid="take-selfie-button">
                <Camera className="h-4 w-4 mr-2" /> Take selfie
              </Button>
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="rounded-full" data-testid="upload-photo-button">
                Upload from gallery
              </Button>
              {form.photo_url && (
                <Button type="button" variant="outline" onClick={removePhoto} className="rounded-full text-destructive hover:text-destructive" data-testid="remove-photo-button">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">We compress and crop to ~720px. Used for staff verification at the counter.</p>
        </div>

        <div>
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><UserIcon className="h-3 w-3" /> Full name</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-2 rounded-xl" data-testid="profile-name" placeholder="e.g. Aman Gupta" />
        </div>
        <div>
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" /> Phone</label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-2 rounded-xl" data-testid="profile-phone" placeholder="+91 98XXXXXXXX" />
        </div>
        <div>
          <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Delivery address</label>
          <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-2 rounded-xl" data-testid="profile-address" placeholder="Flat / house no., street, city, pincode" rows={3} />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={save} disabled={submitting} className="rounded-full bg-primary hover:bg-primary/90 flex-1 min-w-[200px]" data-testid="save-profile-button">
            {submitting ? "Saving…" : next ? "Save & continue to checkout" : "Save profile"}
          </Button>
          {!next && <Link to="/dashboard"><Button variant="outline" className="rounded-full">Back</Button></Link>}
        </div>
      </div>
    </div>
  );
}
