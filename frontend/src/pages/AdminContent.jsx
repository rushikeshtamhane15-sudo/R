import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Save, RotateCcw, ArrowLeft } from "lucide-react";

// Declarative schemas — simple, matches DEFAULT_CONTENT on backend
const SCHEMAS = {
  footer: {
    title: "Footer",
    description: "Brand identity block + copyright shown at the bottom of every page.",
    fields: [
      { key: "brand_name", label: "Brand name (white text on red footer)", type: "input" },
      { key: "tagline", label: "Tagline", type: "input" },
      { key: "promise", label: "Promise line", type: "textarea", rows: 3 },
      { key: "corporate_address", label: "Corporate address", type: "textarea", rows: 3 },
      { key: "support_phone", label: "Support phone", type: "input" },
      { key: "email", label: "Email", type: "input" },
      { key: "website", label: "Website URL", type: "input" },
      { key: "copyright", label: "Copyright line", type: "input" },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    description: "Public page at /privacy — write your full policy here.",
    fields: [
      { key: "title", label: "Page title", type: "input" },
      { key: "last_updated", label: "Last updated date (e.g., Feb 2026)", type: "input" },
      { key: "body", label: "Body text", type: "textarea", rows: 18 },
    ],
  },
  refund: {
    title: "Refund Policy",
    description: "Public page at /refund — write your full refund policy here.",
    fields: [
      { key: "title", label: "Page title", type: "input" },
      { key: "last_updated", label: "Last updated date", type: "input" },
      { key: "body", label: "Body text", type: "textarea", rows: 18 },
    ],
  },
  contact: {
    title: "Contact Us page",
    description: "Public page at /contact — every label, heading, and CTA text below is editable. Branch-specific data (address, phone, manager) auto-pulls from the Mess directory; edit those at /admin/messes.",
    fields: [
      { key: "title", label: "Page heading", type: "input" },
      { key: "overline", label: "Eyebrow / overline (above heading)", type: "input" },
      { key: "intro", label: "Intro paragraph", type: "textarea", rows: 3 },
      { key: "hours", label: "Business hours line", type: "input" },
      // Location-aware labels
      { key: "nearest_label", label: "Pill label when GPS resolved", type: "input" },
      { key: "default_label", label: "Pill label when GPS denied", type: "input" },
      { key: "perm_hint", label: "Hint shown when GPS is denied", type: "input" },
      { key: "cta_directions", label: "Map CTA — Get directions button label", type: "input" },
      { key: "distance_suffix", label: "Distance pill suffix (e.g. 'km away')", type: "input" },
      // Row labels (left side info card)
      { key: "label_branch", label: "Row label: Branch", type: "input" },
      { key: "label_address", label: "Row label: Address", type: "input" },
      { key: "label_phone", label: "Row label: Phone", type: "input" },
      { key: "label_whatsapp", label: "Row label: WhatsApp", type: "input" },
      { key: "whatsapp_value", label: "WhatsApp row body text", type: "input" },
      { key: "label_email", label: "Row label: Email", type: "input" },
      { key: "label_manager", label: "Row label: Branch manager", type: "input" },
      { key: "label_fssai", label: "Row label: FSSAI", type: "input" },
      { key: "label_hours", label: "Row label: Hours", type: "input" },
      // Legacy CMS-only fallbacks (used only when no Mess exists)
      { key: "company", label: "Fallback company name", type: "input" },
      { key: "address", label: "Fallback address", type: "textarea", rows: 3 },
      { key: "phone", label: "Fallback phone", type: "input" },
      { key: "email", label: "Fallback email", type: "input" },
      { key: "map_embed_src", label: "Fallback Google Maps embed URL", type: "textarea", rows: 3 },
    ],
  },
  login: {
    title: "Login & Sign up page",
    description: "All text on the /login page. Keep it short and friendly.",
    fields: [
      { key: "title_line1", label: "Hero title — line 1", type: "input" },
      { key: "title_line2", label: "Hero title — line 2", type: "input" },
      { key: "form_overline", label: "Form section overline", type: "input" },
      { key: "form_heading", label: "Form heading", type: "input" },
      { key: "form_subheading", label: "Form subheading", type: "input" },
      { key: "phone_label", label: "Phone field label", type: "input" },
      { key: "phone_placeholder", label: "Phone field placeholder", type: "input" },
      { key: "name_label", label: "Name field label", type: "input" },
      { key: "name_optional_label", label: "Name field — optional suffix", type: "input" },
      { key: "name_placeholder", label: "Name field placeholder", type: "input" },
      { key: "cta_label", label: "Primary CTA button label", type: "input" },
      { key: "or_divider", label: "Or divider text", type: "input" },
      { key: "google_label", label: "Google button label", type: "input" },
      { key: "terms_prefix", label: "Terms text prefix", type: "input" },
      { key: "terms_separator", label: "Terms text separator (between Privacy & Refund)", type: "input" },
      { key: "verify_overline", label: "Verify screen — overline", type: "input" },
      { key: "verify_heading", label: "Verify screen — heading", type: "input" },
      { key: "verify_cta_label", label: "Verify screen — CTA button", type: "input" },
      { key: "resend_prompt", label: "Resend OTP — prompt text", type: "input" },
      { key: "resend_label", label: "Resend OTP — link text", type: "input" },
      // === Icon badge (iter-48) ===
      { key: "icon_show", label: "Show login icon badge", type: "boolean" },
      { key: "icon_color", label: "Login icon foreground color (hex)", type: "color" },
      { key: "icon_bg_color_start", label: "Login icon bg gradient — start (hex)", type: "color" },
      { key: "icon_bg_color_end", label: "Login icon bg gradient — end (hex)", type: "color" },
      // === Marquee (iter-51) ===
      { key: "marquee_show", label: "Show 'bad stuff' marquee below header", type: "boolean" },
      { key: "marquee_pills", label: "Marquee pill labels (pipe-separated, e.g. '0% Ajinomoto|0% Maida|…')", type: "textarea", rows: 3 },
      { key: "marquee_bg_color", label: "Marquee background color (hex)", type: "color" },
      { key: "marquee_text_color", label: "Marquee text color (hex)", type: "color" },
      { key: "marquee_pill_bg_color", label: "Marquee pill background (CSS color)", type: "input" },
      { key: "marquee_pill_border_color", label: "Marquee pill border (CSS color)", type: "input" },
      { key: "marquee_speed_seconds", label: "Marquee scroll speed in seconds (4–60, lower = faster)", type: "input" },
    ],
  },
  announcement: {
    title: "Announcement marquee",
    description: "Scrolling bar shown right under the header on every page. Toggle it on/off, change colours and speed.",
    fields: [
      { key: "enabled", label: "Show announcement bar", type: "boolean" },
      { key: "text", label: "Message (Hindi/English/anything)", type: "textarea", rows: 4 },
      { key: "bg_color", label: "Background colour (hex e.g. #FACC15)", type: "color" },
      { key: "text_color", label: "Text colour (hex e.g. #1F2937)", type: "color" },
      { key: "speed_seconds", label: "Scroll speed in seconds (lower = faster, 10–180)", type: "input" },
    ],
  },
  about: {
    title: "About us page",
    description: "iter-75 #3 — full CMS for the /about page. Edit copy, bg/text colours per section.",
    fields: [
      // Hero
      { key: "hero_bg_from", label: "Hero — gradient FROM colour", type: "color" },
      { key: "hero_bg_to", label: "Hero — gradient TO colour", type: "color" },
      { key: "hero_text_color", label: "Hero — text colour", type: "color" },
      { key: "hero_overline", label: "Hero overline (tiny uppercase text above headline)", type: "input" },
      { key: "hero_headline", label: "Hero H1 headline", type: "textarea", rows: 3 },
      { key: "hero_lede", label: "Hero lede paragraph", type: "textarea", rows: 4 },
      { key: "cta_primary_label", label: "Primary CTA label", type: "input" },
      { key: "cta_primary_to", label: "Primary CTA target (route)", type: "input" },
      { key: "cta_secondary_label", label: "Secondary CTA label", type: "input" },
      { key: "cta_secondary_to", label: "Secondary CTA target (route)", type: "input" },
      // Stats (small cards)
      { key: "stats_bg", label: "Stat cards — background (CSS color, e.g. rgba(255,255,255,0.10))", type: "input" },
      { key: "stats_text_color", label: "Stat cards — text colour", type: "color" },
      { key: "stat_1_value", label: "Stat 1 value", type: "input" }, { key: "stat_1_label", label: "Stat 1 label", type: "input" },
      { key: "stat_2_value", label: "Stat 2 value", type: "input" }, { key: "stat_2_label", label: "Stat 2 label", type: "input" },
      { key: "stat_3_value", label: "Stat 3 value", type: "input" }, { key: "stat_3_label", label: "Stat 3 label", type: "input" },
      { key: "stat_4_value", label: "Stat 4 value", type: "input" }, { key: "stat_4_label", label: "Stat 4 label", type: "input" },
      // Promise
      { key: "promise_bg", label: "Promise section — bg colour", type: "color" },
      { key: "promise_text_color", label: "Promise section — text colour", type: "color" },
      { key: "promise_heading", label: "Promise section heading", type: "textarea", rows: 2 },
      { key: "promise_1_title", label: "Promise 1 — title", type: "input" }, { key: "promise_1_body", label: "Promise 1 — body", type: "textarea", rows: 3 },
      { key: "promise_2_title", label: "Promise 2 — title", type: "input" }, { key: "promise_2_body", label: "Promise 2 — body", type: "textarea", rows: 3 },
      { key: "promise_3_title", label: "Promise 3 — title", type: "input" }, { key: "promise_3_body", label: "Promise 3 — body", type: "textarea", rows: 3 },
      { key: "promise_4_title", label: "Promise 4 — title", type: "input" }, { key: "promise_4_body", label: "Promise 4 — body", type: "textarea", rows: 3 },
      // Timeline
      { key: "timeline_bg", label: "Timeline section — bg colour", type: "color" },
      { key: "timeline_text_color", label: "Timeline section — text colour", type: "color" },
      { key: "timeline_heading", label: "Timeline section heading", type: "textarea", rows: 2 },
      { key: "tl_1_year", label: "Year 1", type: "input" }, { key: "tl_1_title", label: "Year 1 title", type: "input" }, { key: "tl_1_body", label: "Year 1 body", type: "textarea", rows: 2 },
      { key: "tl_2_year", label: "Year 2", type: "input" }, { key: "tl_2_title", label: "Year 2 title", type: "input" }, { key: "tl_2_body", label: "Year 2 body", type: "textarea", rows: 2 },
      { key: "tl_3_year", label: "Year 3", type: "input" }, { key: "tl_3_title", label: "Year 3 title", type: "input" }, { key: "tl_3_body", label: "Year 3 body", type: "textarea", rows: 2 },
      { key: "tl_4_year", label: "Year 4", type: "input" }, { key: "tl_4_title", label: "Year 4 title", type: "input" }, { key: "tl_4_body", label: "Year 4 body", type: "textarea", rows: 2 },
      // Founder
      { key: "founder_bg", label: "Founder section — bg colour", type: "color" },
      { key: "founder_text_color", label: "Founder section — text colour", type: "color" },
      { key: "founder_quote", label: "Founder pull-quote", type: "textarea", rows: 2 },
      { key: "founder_body", label: "Founder body", type: "textarea", rows: 5 },
      { key: "founder_name", label: "Founder name", type: "input" },
      { key: "founder_role", label: "Founder role", type: "input" },
      // Visit us
      { key: "visit_bg_from", label: "Visit us — gradient FROM", type: "color" },
      { key: "visit_bg_to", label: "Visit us — gradient TO", type: "color" },
      { key: "visit_text_color", label: "Visit us — text colour", type: "color" },
      { key: "visit_heading", label: "Visit us heading", type: "textarea", rows: 2 },
      { key: "visit_body", label: "Visit us body", type: "textarea", rows: 3 },
      { key: "visit_address", label: "Visit us address", type: "textarea", rows: 2 },
      { key: "visit_phone", label: "Visit us phone", type: "input" },
      { key: "visit_email", label: "Visit us email", type: "input" },
    ],
  },
  privacy: {
    title: "Privacy policy",
    description: "iter-75 #7 — fully drafted. Edit the title, effective date, intro, contact and each section's heading + body.",
    fields: [
      { key: "title", label: "Page title", type: "input" },
      { key: "effective_date", label: "Effective date", type: "input" },
      { key: "intro", label: "Intro paragraph", type: "textarea", rows: 4 },
      { key: "sections", label: "Sections (JSON array of {heading, body})", type: "textarea", rows: 18 },
      { key: "contact_block", label: "Contact block (bottom of page)", type: "textarea", rows: 4 },
    ],
  },
  refund: {
    title: "Refund & cancellation policy",
    description: "iter-75 #7 — fully drafted. Edit the title, effective date, intro, contact and each section's heading + body.",
    fields: [
      { key: "title", label: "Page title", type: "input" },
      { key: "effective_date", label: "Effective date", type: "input" },
      { key: "intro", label: "Intro paragraph", type: "textarea", rows: 4 },
      { key: "sections", label: "Sections (JSON array of {heading, body})", type: "textarea", rows: 18 },
      { key: "contact_block", label: "Contact block (bottom of page)", type: "textarea", rows: 4 },
    ],
  },
};

export default function AdminContent() {
  const { contentKey } = useParams();
  const navigate = useNavigate();
  const schema = SCHEMAS[contentKey];
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!schema) return;
    (async () => {
      try {
        const r = await api.get(`/content/${contentKey}`);
        // iter-75: privacy/refund 'sections' is an array — stringify for
        // the textarea so admins can edit JSON, parsed back on save.
        const out = { ...(r.data || {}) };
        if (Array.isArray(out.sections)) out.sections = JSON.stringify(out.sections, null, 2);
        setData(out);
      }
      catch { toast.error("Failed to load content"); }
    })();
  }, [contentKey, schema]);

  if (!schema) return <div className="text-muted-foreground">Unknown content key.</div>;
  if (!data) return <div className="text-muted-foreground">Loading…</div>;

  const update = (k, v) => setData({ ...data, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...data };
      // iter-75: parse the sections JSON back to an array before save.
      if (typeof payload.sections === "string") {
        try { payload.sections = JSON.parse(payload.sections); }
        catch { toast.error("Sections JSON is invalid — fix syntax and try again"); setSaving(false); return; }
      }
      await api.post(`/admin/content/${contentKey}`, { data: payload });
      toast.success("Saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Reset this page to default content?")) return;
    try {
      const r = await api.post(`/admin/content/${contentKey}/reset`);
      setData(r.data);
      toast.success("Reset to default");
    } catch (e) { toast.error("Reset failed"); }
  };

  return (
    <div data-testid={`admin-content-${contentKey}`}>
      <Link to="/admin" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> Back to admin</Link>
      <p className="text-xs tracking-overline uppercase font-bold text-secondary mt-4">Admin · Content</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Edit: {schema.title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{schema.description}</p>

      <div className="mt-6 bg-card rounded-2xl border border-border p-6 space-y-5">
        {schema.fields.map((f) => (
          <div key={f.key}>
            <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">{f.label}</label>
            {f.type === "textarea" ? (
              <Textarea
                rows={f.rows || 5}
                value={data[f.key] ?? ""}
                onChange={(e) => update(f.key, e.target.value)}
                className="mt-2 rounded-xl"
                data-testid={`field-${f.key}`}
              />
            ) : f.type === "boolean" ? (
              <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!data[f.key]}
                  onChange={(e) => update(f.key, e.target.checked)}
                  className="h-4 w-4 accent-primary"
                  data-testid={`field-${f.key}`}
                />
                <span className="text-sm text-foreground">{data[f.key] ? "Enabled" : "Disabled"}</span>
              </label>
            ) : f.type === "color" ? (
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="color"
                  value={(data[f.key] || "#000000").startsWith("#") ? data[f.key] : "#000000"}
                  onChange={(e) => update(f.key, e.target.value)}
                  className="h-10 w-12 rounded-lg cursor-pointer border border-input bg-background"
                />
                <Input
                  value={data[f.key] ?? ""}
                  onChange={(e) => update(f.key, e.target.value)}
                  className="rounded-xl flex-1 font-mono"
                  data-testid={`field-${f.key}`}
                />
              </div>
            ) : (
              <Input
                value={data[f.key] ?? ""}
                onChange={(e) => update(f.key, e.target.value)}
                className="mt-2 rounded-xl"
                data-testid={`field-${f.key}`}
              />
            )}
          </div>
        ))}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={save} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="save-content-button">
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={reset} variant="outline" className="rounded-full" data-testid="reset-content-button">
            <RotateCcw className="h-4 w-4 mr-2" /> Reset to default
          </Button>
          {contentKey !== "footer" && (
            <Button onClick={() => navigate(`/${contentKey}`)} variant="outline" className="rounded-full">
              Preview page →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
