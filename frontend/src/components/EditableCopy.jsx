import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { Pencil, Check, X, Loader2 } from "lucide-react";

/**
 * EditableCopy — iter-181
 *
 * Full-page copy editor for the super-admin. Every meaningful string on
 * Landing / Benefits / Pricing is wrapped in `<EditableText>` which reads
 * from a shared context (`useEditableCopy`). When the admin toggles Edit
 * Mode, each text becomes a contentEditable span; blur saves via
 * `POST /api/admin/content/{key}`.
 *
 * Backing store: existing `app_content` CMS. `key` per page:
 *   Landing  → "home_copy"
 *   Benefits → "benefits_copy"
 *   Pricing  → "pricing_copy"
 *
 * The `defaults` prop is a nested object; `<EditableText path="hero.h1">`
 * uses dot notation to look up the string. Missing keys silently fall back
 * to the default so a partial CMS payload can't blank the page.
 */
const CopyCtx = createContext(null);

// Deep-get helper.
function get(obj, path) {
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
// Immutable deep-set — returns a new object.
function set(obj, path, val) {
  const keys = String(path).split(".");
  const next = Array.isArray(obj) ? [...obj] : { ...(obj || {}) };
  let cur = next;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cur[k] = (cur[k] && typeof cur[k] === "object") ? (Array.isArray(cur[k]) ? [...cur[k]] : { ...cur[k] }) : {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = val;
  return next;
}

export function EditableCopyProvider({ contentKey, defaults, children }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [remote, setRemote] = useState({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get(`/content/${contentKey}`);
        // Backend wraps CMS body under `.copy` when we save that key;
        // support both flat and nested shapes for resilience.
        const d = r?.data || {};
        setRemote(d?.copy && typeof d.copy === "object" ? d.copy : d);
      } catch { /* keep defaults */ }
    })();
  }, [contentKey]);

  const getText = useCallback((path) => {
    const v = get(remote, path);
    return v == null || v === "" ? get(defaults, path) : v;
  }, [remote, defaults]);

  const saveText = useCallback(async (path, value) => {
    const nextRemote = set(remote, path, value);
    setRemote(nextRemote);
    setSaving(true);
    try {
      await api.post(`/admin/content/${contentKey}`, { copy: nextRemote });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  }, [remote, contentKey]);

  const ctx = { isAdmin, editing, setEditing, getText, saveText, saving };
  return <CopyCtx.Provider value={ctx}>{children}</CopyCtx.Provider>;
}

export function useEditableCopy() {
  const c = useContext(CopyCtx);
  if (!c) throw new Error("useEditableCopy must be inside <EditableCopyProvider>");
  return c;
}

/**
 * <EditableText path="hero.h1" as="h1" className="..." /> — renders the
 * resolved text. Admin in edit mode gets a dashed outline + contentEditable;
 * blur commits the change.
 */
export function EditableText({ path, as: Tag = "span", className = "", multiline = false, ...rest }) {
  const { isAdmin, editing, getText, saveText } = useEditableCopy();
  const text = getText(path);

  if (!isAdmin || !editing) {
    return <Tag className={className} {...rest}>{text}</Tag>;
  }

  const onBlur = (e) => {
    const next = (multiline ? e.currentTarget.innerText : e.currentTarget.innerText.replace(/\s+/g, " ")).trim();
    if (next !== text) saveText(path, next);
  };

  return (
    <Tag
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onBlur={onBlur}
      className={`${className} outline outline-2 outline-dashed outline-amber-400 outline-offset-2 rounded-sm px-0.5 bg-amber-50/30 focus:outline-solid focus:bg-white`}
      data-editable-path={path}
      {...rest}
    >
      {text}
    </Tag>
  );
}

/**
 * <EditPageToggle /> — floating admin-only button that toggles edit mode
 * for the wrapping EditableCopyProvider. Position controlled by className.
 */
export function EditPageToggle({ className = "" }) {
  const { isAdmin, editing, setEditing, saving } = useEditableCopy();
  if (!isAdmin) return null;
  return (
    <button
      onClick={() => setEditing((v) => !v)}
      className={`fixed z-[70] bottom-24 right-4 h-11 rounded-full px-4 font-black text-xs shadow-lg flex items-center gap-2 transition ${editing ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-900 text-white hover:bg-slate-800"} ${className}`}
      data-testid="edit-page-toggle"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
      {saving ? "Saving…" : editing ? "Done editing" : "Edit page"}
    </button>
  );
}
