import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useBranding } from "../context/BrandingContext";
import { Upload, RotateCcw, Loader2 } from "lucide-react";

/**
 * /admin/branding — swap the app-wide brand logo AND the site-header logo
 * without a redeploy. Each slot is independently uploadable and resettable.
 *
 * Storage: both slots persist as base64 data URLs in Mongo
 * (`app_settings["branding_settings_v1"]`).
 *
 * Excluded from these swaps:
 *   · The green Pure-Veg / FSSAI certification badge (hand-drawn SVG).
 *   · The splash screen logo (keeps its own bundled asset for animation
 *     isolation — swap that via `frontend/public/brand-logo.jpg`).
 */
const SLOT_META = [
  {
    slot: "brand",
    title: "Brand logo (app icon)",
    subtitle: "Shows in Footer, Restaurant hero, Kiosk, and admin surfaces.",
    urlKey: "brandLogoUrl",
    customKey: "isCustom",
    updatedKey: "brandUpdatedAt",
  },
  {
    slot: "header",
    title: "Header logo (top navigation)",
    subtitle: "Shows in the sticky navigation bar on every page.",
    urlKey: "headerLogoUrl",
    customKey: "isHeaderCustom",
    updatedKey: "headerUpdatedAt",
  },
];

function LogoUploaderCard({ slot, title, subtitle, url, isCustom, updatedAt, busySlot, setBusySlot, refresh }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const busy = busySlot === slot;

  const onPick = () => inputRef.current?.click();

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/(jpe?g|png|webp)$/i.test(f.type)) {
      toast.error("Please pick a JPG, PNG, or WEBP");
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      toast.error("Logo file is too large (max 2 MB)");
      return;
    }
    const fr = new FileReader();
    fr.onload = () => setPreview(fr.result);
    fr.readAsDataURL(f);

    setBusySlot(slot);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post(`/admin/branding/logo?slot=${slot}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await refresh();
      toast.success(`${title} updated.`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Upload failed");
    } finally {
      setBusySlot(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onReset = async () => {
    if (!isCustom) return;
    if (!window.confirm(`Revert ${title.toLowerCase()} to the bundled default?`)) return;
    setBusySlot(slot);
    try {
      await api.post(`/admin/branding/reset?slot=${slot}`);
      setPreview(null);
      await refresh();
      toast.success("Reverted to bundled default.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reset failed");
    } finally {
      setBusySlot(null);
    }
  };

  const displaySrc = preview || url;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm" data-testid={`admin-branding-card-${slot}`}>
      <div>
        <p className="text-base font-extrabold" data-testid={`admin-branding-title-${slot}`}>{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <div className="mt-4 flex items-start gap-6 flex-wrap">
        <div className="flex flex-col items-center gap-2">
          <div className="h-28 w-28 rounded-2xl bg-primary/10 ring-1 ring-primary/20 overflow-hidden flex items-center justify-center">
            <img
              src={displaySrc}
              alt={`${title} preview`}
              className="max-h-[86%] max-w-[86%] object-contain"
              data-testid={`admin-branding-preview-${slot}`}
            />
          </div>
          <p className="text-[10px] text-muted-foreground tracking-overline uppercase font-bold">
            {isCustom ? "Custom (uploaded)" : "Bundled default"}
          </p>
          {isCustom && updatedAt && (
            <p className="text-[10px] text-muted-foreground">
              Updated {new Date(updatedAt).toLocaleString("en-IN")}
            </p>
          )}
        </div>
        <div className="flex-1 min-w-[220px] space-y-3">
          <p className="text-xs text-muted-foreground">JPG · PNG · WEBP · max 2 MB · square works best.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onPick}
              disabled={busy}
              data-testid={`admin-branding-upload-btn-${slot}`}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-primary text-primary-foreground font-extrabold text-sm shadow-sm hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy ? "Uploading…" : "Upload"}
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={busy || !isCustom}
              data-testid={`admin-branding-reset-btn-${slot}`}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-border bg-background font-extrabold text-sm hover:bg-muted disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              Reset to default
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onFile}
              className="hidden"
              data-testid={`admin-branding-file-input-${slot}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminBranding() {
  const branding = useBranding();
  const [busySlot, setBusySlot] = useState(null);

  useEffect(() => { branding.refresh(); }, [branding.refresh]);

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="admin-branding-page">
      <div>
        <h1 className="text-2xl font-display font-extrabold" data-testid="admin-branding-heading">Brand & Header logos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Two independent slots. Upload once — the change is instant across the app and every page&apos;s footer.
        </p>
      </div>

      {SLOT_META.map((s) => (
        <LogoUploaderCard
          key={s.slot}
          slot={s.slot}
          title={s.title}
          subtitle={s.subtitle}
          url={branding[s.urlKey]}
          isCustom={branding[s.customKey]}
          updatedAt={branding[s.updatedKey]}
          busySlot={busySlot}
          setBusySlot={setBusySlot}
          refresh={branding.refresh}
        />
      ))}

      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-xs font-bold uppercase tracking-overline text-muted-foreground">Excluded by design</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The green Pure-Veg / FSSAI certification tag stays fixed (regulated symbol). The splash screen keeps its own bundled asset for animation isolation.
        </p>
      </div>
    </div>
  );
}
