import React, { useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Upload, Loader2, X, Image as ImageIcon, Video as VideoIcon, FileText } from "lucide-react";

/**
 * MediaUploader — iter-183 · drop-in file picker backed by Emergent Object Storage.
 *
 *   <MediaUploader
 *     accept="image/*"
 *     maxSizeMB={2}
 *     kind="logo"
 *     onUpload={(url, meta) => setLogoUrl(url)}
 *   />
 *
 * `onUpload` receives (public_url, full_metadata). `kind` is a free-form
 * label persisted in `media_files.kind` so admins can browse uploads by
 * category later (`logo`, `profile_photo`, `menu_poster`, `video`, …).
 */
export function MediaUploader({
  accept = "image/*", maxSizeMB = 2, kind = "misc",
  currentUrl = null, onUpload, className = "", label = "Upload file",
  testid = "media-uploader",
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(currentUrl);

  const pick = () => inputRef.current?.click();

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-pick of same filename
    if (!f) return;
    if (f.size > maxSizeMB * 1024 * 1024) {
      toast.error(`File too big — max ${maxSizeMB} MB`);
      return;
    }
    // Local preview.
    if (f.type.startsWith("image/")) setPreview(URL.createObjectURL(f));

    const form = new FormData();
    form.append("file", f);
    form.append("kind", kind);
    setUploading(true); setProgress(0);
    try {
      const r = await api.post("/media/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });
      const url = r.data?.url;
      if (url) {
        setPreview(url);
        toast.success("Uploaded");
        onUpload?.(url, r.data);
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally { setUploading(false); setProgress(0); }
  };

  const clear = () => { setPreview(null); onUpload?.(null, null); };

  const isImage = /image\//.test(accept);
  const isVideo = /video\//.test(accept);
  const Icon = isImage ? ImageIcon : isVideo ? VideoIcon : FileText;

  return (
    <div className={`inline-flex flex-col gap-2 ${className}`} data-testid={testid}>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onFile} data-testid={`${testid}-input`} />
      {preview && isImage && (
        <div className="relative group inline-block">
          <img src={preview} alt="" className="h-24 w-24 rounded-lg object-cover border border-slate-200 shadow-sm" data-testid={`${testid}-preview`} />
          <button type="button" onClick={clear} className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition" data-testid={`${testid}-clear`}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {preview && isVideo && (
        <video src={preview} className="h-32 rounded-lg border border-slate-200" controls data-testid={`${testid}-preview-video`} />
      )}
      <button
        type="button"
        onClick={pick}
        disabled={uploading}
        className="inline-flex items-center gap-2 rounded-full px-4 h-9 text-xs font-black bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
        data-testid={`${testid}-btn`}
      >
        {uploading ? (
          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading {progress}%</>
        ) : (
          <><Upload className="h-3.5 w-3.5" /> {label}</>
        )}
      </button>
      <p className="text-[10px] text-slate-400">Max {maxSizeMB} MB · {accept}</p>
    </div>
  );
}

/**
 * MediaImage — renders an image from a storage URL. If the URL is the
 * authenticated `/media/{path}` shape, it fetches as a blob with the JWT
 * header (playbook pattern for `<img>` tags that can't send Authorization).
 * Public URLs (Sora videos, unsplash, etc.) are rendered directly.
 */
export function MediaImage({ src, alt = "", className = "", ...rest }) {
  const [blobUrl, setBlobUrl] = React.useState(null);
  const needsAuth = typeof src === "string" && src.includes("/api/media/") && !src.includes("?auth=");
  React.useEffect(() => {
    if (!needsAuth) { setBlobUrl(null); return; }
    let cancel = false;
    (async () => {
      try {
        const r = await api.get(src.replace(/^.*\/api/, ""), { responseType: "blob" });
        if (!cancel) setBlobUrl(URL.createObjectURL(r.data));
      } catch { /* fallback to direct src */ }
    })();
    return () => { cancel = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return <img src={blobUrl || src} alt={alt} className={className} {...rest} />;
}
