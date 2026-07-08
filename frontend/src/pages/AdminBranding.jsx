import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useBranding } from "../context/BrandingContext";
import { Upload, RotateCcw, Loader2 } from "lucide-react";

/**
 * /admin/branding — swap the app-wide brand logo icon without a redeploy.
 *
 * · Uploaded file is optimised to WebP and stored as a base64 data URL in
 *   Mongo (see routes/branding.py — same pattern as landing promotions).
 * · Header keeps its own logo constant (HEADER_LOGO_URL) — this page does
 *   NOT touch it, by product decision.
 * · Pure-Veg certification tag uses a hand-drawn SVG (PureVegMark), also
 *   unaffected by this uploader.
 */
export default function AdminBranding() {
  const { brandLogoUrl, isCustom, updatedAt, refresh } = useBranding();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { refresh(); }, [refresh]);

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
    // Local preview
    const fr = new FileReader();
    fr.onload = () => setPreview(fr.result);
    fr.readAsDataURL(f);

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post("/admin/branding/logo", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await refresh();
      toast.success("Brand logo updated. It shows everywhere except site header + pure-veg tag.");
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Upload failed";
      toast.error(String(msg));
    } finally {
      setBusy(false);
      // Clear file input so the same file can be picked again if needed.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onReset = async () => {
    if (!isCustom) return;
    if (!window.confirm("Revert brand logo to the bundled default?")) return;
    setBusy(true);
    try {
      await api.post("/admin/branding/reset");
      setPreview(null);
      await refresh();
      toast.success("Reverted to bundled brand logo.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const displaySrc = preview || brandLogoUrl;

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="admin-branding-page">
      <div>
        <h1 className="text-2xl font-display font-extrabold" data-testid="admin-branding-heading">Brand logo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Update the app-wide brand mark. Used everywhere except the site header and the pure-veg FSSAI tag.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-6 flex-wrap">
          <div className="flex flex-col items-center gap-2">
            <div className="h-32 w-32 rounded-2xl bg-primary/10 ring-1 ring-primary/20 overflow-hidden flex items-center justify-center">
              {/* Big preview */}
              <img
                src={displaySrc}
                alt="Brand logo preview"
                className="max-h-[86%] max-w-[86%] object-contain"
                data-testid="admin-branding-preview"
              />
            </div>
            <p className="text-[10px] text-muted-foreground tracking-overline uppercase font-bold">
              {isCustom ? "Custom (uploaded)" : "Bundled default"}
            </p>
            {updatedAt && isCustom && (
              <p className="text-[10px] text-muted-foreground">
                Updated {new Date(updatedAt).toLocaleString("en-IN")}
              </p>
            )}
          </div>

          <div className="flex-1 min-w-[220px] space-y-3">
            <div>
              <p className="text-sm font-semibold">Upload a new logo</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                JPG · PNG · WEBP · max 2 MB · square works best (e.g., 512×512).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onPick}
                disabled={busy}
                data-testid="admin-branding-upload-btn"
                className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-primary text-primary-foreground font-extrabold text-sm shadow-sm hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy ? "Uploading…" : "Upload logo"}
              </button>
              <button
                type="button"
                onClick={onReset}
                disabled={busy || !isCustom}
                data-testid="admin-branding-reset-btn"
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
                data-testid="admin-branding-file-input"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-xs font-bold uppercase tracking-overline text-muted-foreground">Where it appears</p>
        <ul className="mt-1 grid sm:grid-cols-2 gap-x-6 gap-y-0.5 text-sm text-muted-foreground list-disc list-inside">
          <li>Footer brand block</li>
          <li>Restaurant hero card</li>
          <li>Kiosk header (e-Meal Pass)</li>
          <li>Splash screen (uses a fixed frame — not affected)</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Excluded by design: the top navigation &ldquo;efoodcare&rdquo; wordmark, and the green Pure-Veg / FSSAI certification tag.
        </p>
      </div>
    </div>
  );
}
