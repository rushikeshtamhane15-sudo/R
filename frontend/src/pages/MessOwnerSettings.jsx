/**
 * MessOwnerSettings — iter-143 · efoodtech SaaS.
 *
 * Scoped to a mess owner (role=franchise_owner or admin). Lets them:
 *   • Update their mess branding (tagline, hero copy, chip tags)
 *   • Upload their own logo (shown on login mess-picker)
 *   • Save their OWN Razorpay Key ID + Secret so payments land directly
 *     into their bank account. Falls back to platform keys until saved.
 *
 * Corresponds 1:1 with backend /api/mess-owner/* endpoints.
 */
import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import {
  Building2, Save, Upload, CheckCircle2, AlertTriangle, ShieldCheck,
  Trash2, KeyRound, Loader2, Plus, X, RefreshCcw, Sparkles,
} from "lucide-react";

export default function MessOwnerSettings() {
  const { user } = useAuth();
  const [mess, setMess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable branding
  const [tagline, setTagline] = useState("");
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [tagChips, setTagChips] = useState([]);
  const [chipDraft, setChipDraft] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  // Razorpay
  const [rzpKeyId, setRzpKeyId] = useState("");
  const [rzpSecret, setRzpSecret] = useState("");
  const [rzpStatus, setRzpStatus] = useState(null);
  const [rzpChecking, setRzpChecking] = useState(false);
  const [rzpSaving, setRzpSaving] = useState(false);

  const [logoUploading, setLogoUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        api.get("/mess-owner/me"),
        api.get("/mess-owner/razorpay-status"),
      ]);
      const m = r.data?.mess || {};
      setMess(m);
      setTagline(m.tagline || "");
      setHeroTitle(m.hero_title || "");
      setHeroSubtitle(m.hero_subtitle || "");
      setTagChips(Array.isArray(m.tag_chips) ? m.tag_chips : []);
      setPaymentNote(m.payment_note || "");
      setRzpStatus(s.data || null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load your mess settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (!user) return <Navigate to="/login" replace />;
  if (!["admin", "franchise_owner"].includes(user.role))
    return <Navigate to="/" replace />;

  const saveBranding = async () => {
    setSaving(true);
    try {
      const r = await api.patch("/mess-owner/settings", {
        tagline: tagline.trim(),
        hero_title: heroTitle.trim(),
        hero_subtitle: heroSubtitle.trim(),
        tag_chips: tagChips,
        payment_note: paymentNote.trim(),
      });
      setMess(r.data?.mess || mess);
      toast.success("Branding saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/mess-owner/logo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setMess((m) => ({ ...(m || {}), logo_url: r.data?.logo_url }));
      toast.success("Logo updated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Logo upload failed");
    } finally {
      setLogoUploading(false);
    }
  };

  const saveRazorpay = async () => {
    if (!rzpKeyId.trim() || !rzpSecret.trim()) { toast.error("Enter both Key ID and Key Secret"); return; }
    setRzpSaving(true);
    try {
      const r = await api.post("/mess-owner/razorpay-keys", {
        razorpay_key_id: rzpKeyId.trim(),
        razorpay_key_secret: rzpSecret.trim(),
      });
      setRzpStatus({ ok: true, status: "live", detail: "Payments will land directly in your Razorpay account.", razorpay_configured: true, key_id_masked: r.data?.key_id_masked });
      setRzpKeyId("");
      setRzpSecret("");
      toast.success("Razorpay connected — payments now go to your account");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save keys");
    } finally {
      setRzpSaving(false);
    }
  };

  const removeRazorpay = async () => {
    if (!window.confirm("Remove your Razorpay keys? Payments will fall back to the platform account until you re-connect.")) return;
    try {
      await api.delete("/mess-owner/razorpay-keys");
      setRzpStatus({ ok: false, status: "not_configured", detail: "Not configured. Payments use the platform account.", razorpay_configured: false });
      toast.success("Razorpay keys removed");
    } catch (e) { toast.error(e?.response?.data?.detail || "Remove failed"); }
  };

  const recheckRazorpay = async () => {
    setRzpChecking(true);
    try {
      const s = await api.get("/mess-owner/razorpay-status");
      setRzpStatus(s.data || null);
      toast.success("Refreshed");
    } catch (e) { toast.error("Check failed"); }
    finally { setRzpChecking(false); }
  };

  const addChip = () => {
    const v = chipDraft.trim();
    if (!v) return;
    if (tagChips.length >= 16) { toast.error("Max 16 chips"); return; }
    setTagChips([...tagChips, v]);
    setChipDraft("");
  };

  const removeChip = (i) => setTagChips(tagChips.filter((_, idx) => idx !== i));

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6" data-testid="mess-owner-settings">
      {/* Header */}
      <div className="rounded-2xl bg-primary text-white p-5 shadow-lg" data-testid="mess-owner-header">
        <div className="flex items-center gap-4">
          {mess?.logo_url ? (
            <img src={mess.logo_url} alt="" className="h-14 w-14 rounded-xl object-cover border border-white/30" />
          ) : (
            <div className="h-14 w-14 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <Building2 className="h-7 w-7" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest font-bold text-white/70">Mess Owner Portal</div>
            <div className="text-xl font-extrabold truncate">{mess?.name}</div>
            <div className="text-[11px] font-mono text-white/70 mt-0.5">
              {mess?.mess_id} · {mess?.city}{mess?.state ? ` · ${mess.state}` : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Logo */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5" data-testid="mess-logo-card">
        <h3 className="font-display font-extrabold text-lg text-slate-900">Mess logo</h3>
        <p className="text-xs text-slate-500 mt-1">Shown on the login mess picker and receipts. Under 2 MB. JPG / PNG / WebP.</p>
        <div className="mt-4 flex items-center gap-4">
          {mess?.logo_url ? (
            <img src={mess.logo_url} alt="" className="h-16 w-16 rounded-xl object-cover border border-slate-200" />
          ) : (
            <div className="h-16 w-16 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center border border-slate-200">
              <Building2 className="h-7 w-7" />
            </div>
          )}
          <label className="inline-flex items-center gap-2 cursor-pointer rounded-xl bg-secondary hover:bg-secondary/90 text-white font-semibold text-sm px-4 py-2.5" data-testid="upload-logo-btn">
            {logoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {logoUploading ? "Uploading…" : "Upload logo"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} disabled={logoUploading} />
          </label>
        </div>
      </section>

      {/* Branding */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4" data-testid="mess-branding-card">
        <div>
          <h3 className="font-display font-extrabold text-lg text-slate-900">Branding & tagline</h3>
          <p className="text-xs text-slate-500 mt-1">Your mess's own story. Shown to subscribers on their dashboard.</p>
        </div>

        <div>
          <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500">Tagline</label>
          <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Home-style meals · fresh daily"
            className="mt-1 rounded-xl" data-testid="tagline-input" />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500">Hero title</label>
            <Input value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} placeholder="Welcome to Mangal Mess"
              className="mt-1 rounded-xl" data-testid="hero-title-input" />
          </div>
          <div>
            <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500">Hero subtitle</label>
            <Input value={heroSubtitle} onChange={(e) => setHeroSubtitle(e.target.value)} placeholder="30-day meal pass · 2 meals per day"
              className="mt-1 rounded-xl" data-testid="hero-subtitle-input" />
          </div>
        </div>

        <div>
          <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500">Feature tags <span className="ml-1 normal-case tracking-normal font-normal text-slate-400">(chips shown on plans page)</span></label>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="tag-chips-list">
            {tagChips.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold" data-testid={`tag-chip-${i}`}>
                {c}
                <button onClick={() => removeChip(i)} className="hover:text-red-600" aria-label="Remove">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Input value={chipDraft} onChange={(e) => setChipDraft(e.target.value)} placeholder="e.g. 100% pure veg"
              className="rounded-xl" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addChip())} data-testid="tag-chip-input" />
            <Button type="button" onClick={addChip} className="rounded-xl bg-slate-100 text-slate-900 hover:bg-slate-200" data-testid="add-tag-chip">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>

        <div>
          <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500">Payment receipt note</label>
          <Textarea value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="e.g. GSTIN 27AABCU9603R1ZM · Thank you for subscribing"
            className="mt-1 rounded-xl min-h-[70px]" data-testid="payment-note-input" />
        </div>

        <Button onClick={saveBranding} disabled={saving} className="w-full rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold h-11" data-testid="save-branding-btn">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save branding
        </Button>
      </section>

      {/* Razorpay */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4" data-testid="razorpay-card">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center">
            <KeyRound className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display font-extrabold text-lg text-slate-900">Your Razorpay account</h3>
            <p className="text-xs text-slate-500 mt-1">Save your own keys so subscription payments land <span className="font-semibold text-primary">directly in your bank</span>. We never share your secret with anyone.</p>
          </div>
        </div>

        {/* Status pill */}
        {rzpStatus?.razorpay_configured && rzpStatus?.ok && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start gap-2" data-testid="rzp-status-live">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-bold text-emerald-900">Live — {rzpStatus.key_id_masked}</div>
              <div className="text-xs text-emerald-800">{rzpStatus.detail}</div>
            </div>
            <button onClick={recheckRazorpay} disabled={rzpChecking} className="text-xs text-emerald-800 hover:text-emerald-900 inline-flex items-center gap-1" data-testid="rzp-recheck-btn">
              {rzpChecking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />} Recheck
            </button>
          </div>
        )}
        {rzpStatus?.razorpay_configured && !rzpStatus?.ok && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2" data-testid="rzp-status-error">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-bold text-red-900">Razorpay error</div>
              <div className="text-xs text-red-800">{rzpStatus.detail}</div>
            </div>
          </div>
        )}
        {!rzpStatus?.razorpay_configured && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2" data-testid="rzp-status-missing">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <div className="font-bold">Not connected yet</div>
              <div className="text-xs">Payments currently use the platform Razorpay. Add your own keys below and payments will land straight in your account.</div>
            </div>
          </div>
        )}

        {/* Add keys form (always shown so owner can rotate) */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500">Razorpay Key ID</label>
            <Input value={rzpKeyId} onChange={(e) => setRzpKeyId(e.target.value)} placeholder="rzp_live_xxxxxxxxxxxxxx"
              className="mt-1 rounded-xl font-mono text-sm" data-testid="rzp-key-id-input" autoComplete="off" />
          </div>
          <div>
            <label className="block text-[10px] tracking-overline uppercase font-bold text-slate-500">Razorpay Key Secret</label>
            <Input type="password" value={rzpSecret} onChange={(e) => setRzpSecret(e.target.value)} placeholder="Paste secret"
              className="mt-1 rounded-xl font-mono text-sm" data-testid="rzp-key-secret-input" autoComplete="off" />
          </div>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed">
          Get keys from <a href="https://dashboard.razorpay.com/app/keys" target="_blank" rel="noreferrer" className="font-semibold text-secondary underline">dashboard.razorpay.com → API Keys</a>. We validate them with Razorpay live before saving.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={saveRazorpay} disabled={rzpSaving} className="flex-1 rounded-xl bg-secondary hover:bg-secondary/90 text-white font-semibold h-11" data-testid="save-rzp-btn">
            {rzpSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            Validate & save
          </Button>
          {rzpStatus?.razorpay_configured && (
            <Button onClick={removeRazorpay} variant="outline" className="rounded-xl border-red-200 text-red-600 hover:bg-red-50" data-testid="remove-rzp-btn">
              <Trash2 className="h-4 w-4 mr-2" /> Remove keys
            </Button>
          )}
        </div>
      </section>

      {/* iter-147 · Per-mess CMS editors (footer, announcement, contact, kiosk voice) */}
      <PerMessCMSEditors mess={mess} onSave={load} />

      {/* iter-147 · Featured slot-1 payment (₹499 · 30 days) */}
      <FeaturedPromoCard mess={mess} onDone={load} />
    </div>
  );
}

function PerMessCMSEditors({ mess, onSave }) {
  const [footer, setFooter] = useState(mess?.footer_text || "");
  const [announce, setAnnounce] = useState(mess?.announcement_text || "");
  const [cPhone, setCPhone] = useState(mess?.contact_phone || "");
  const [cEmail, setCEmail] = useState(mess?.contact_email || "");
  const [cAddr, setCAddr] = useState(mess?.contact_address || "");
  const [cHours, setCHours] = useState(mess?.contact_hours || "");
  const [voice, setVoice] = useState(mess?.kiosk_voice_name || "");
  const [lang, setLang] = useState(mess?.kiosk_voice_lang || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFooter(mess?.footer_text || "");
    setAnnounce(mess?.announcement_text || "");
    setCPhone(mess?.contact_phone || "");
    setCEmail(mess?.contact_email || "");
    setCAddr(mess?.contact_address || "");
    setCHours(mess?.contact_hours || "");
    setVoice(mess?.kiosk_voice_name || "");
    setLang(mess?.kiosk_voice_lang || "");
  }, [mess]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/mess-owner/settings", {
        footer_text: footer.trim(),
        announcement_text: announce.trim(),
        contact_phone: cPhone.trim(), contact_email: cEmail.trim(),
        contact_address: cAddr.trim(), contact_hours: cHours.trim(),
        kiosk_voice_name: voice.trim(), kiosk_voice_lang: lang.trim(),
      });
      toast.success("CMS saved");
      onSave?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4" data-testid="per-mess-cms-editors">
      <h3 className="font-display font-extrabold text-lg text-slate-900">Your page copy</h3>
      <p className="text-xs text-slate-500 -mt-2">Only affects your mess. Falls back to platform default when empty.</p>

      <div>
        <label className="block text-[10px] tracking-widest uppercase font-bold text-slate-500">Announcement bar</label>
        <Input value={announce} onChange={(e) => setAnnounce(e.target.value)} placeholder="e.g. Diwali sweets free tomorrow!"
          className="mt-1 rounded-xl" data-testid="announce-input" />
      </div>

      <div>
        <label className="block text-[10px] tracking-widest uppercase font-bold text-slate-500">Footer text</label>
        <Textarea value={footer} onChange={(e) => setFooter(e.target.value)} rows={2}
          placeholder="© 2026 Your Mess · Made with 💛 in Pune" className="mt-1 rounded-xl"
          data-testid="footer-input" />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] tracking-widest uppercase font-bold text-slate-500">Contact phone</label>
          <Input value={cPhone} onChange={(e) => setCPhone(e.target.value)} className="mt-1 rounded-xl" data-testid="contact-phone-input" />
        </div>
        <div>
          <label className="block text-[10px] tracking-widest uppercase font-bold text-slate-500">Contact email</label>
          <Input value={cEmail} onChange={(e) => setCEmail(e.target.value)} className="mt-1 rounded-xl" data-testid="contact-email-input" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[10px] tracking-widest uppercase font-bold text-slate-500">Contact address</label>
          <Textarea value={cAddr} onChange={(e) => setCAddr(e.target.value)} rows={2} className="mt-1 rounded-xl" data-testid="contact-address-input" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[10px] tracking-widest uppercase font-bold text-slate-500">Contact hours</label>
          <Input value={cHours} onChange={(e) => setCHours(e.target.value)} placeholder="Mon-Sat · 9am-10pm" className="mt-1 rounded-xl" data-testid="contact-hours-input" />
        </div>
        <div>
          <label className="block text-[10px] tracking-widest uppercase font-bold text-slate-500">Kiosk voice</label>
          <Input value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="e.g. en-IN-NeerjaNeural" className="mt-1 rounded-xl" data-testid="kiosk-voice-input" />
        </div>
        <div>
          <label className="block text-[10px] tracking-widest uppercase font-bold text-slate-500">Kiosk language</label>
          <Input value={lang} onChange={(e) => setLang(e.target.value)} placeholder="en-IN | hi-IN | mr-IN" className="mt-1 rounded-xl" data-testid="kiosk-lang-input" />
        </div>
      </div>

      <Button onClick={save} disabled={saving} className="w-full rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold h-11" data-testid="save-cms-btn">
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Save page copy
      </Button>
    </section>
  );
}

function FeaturedPromoCard({ mess, onDone }) {
  const [busy, setBusy] = useState(false);
  const featuredUntil = mess?.featured_until ? new Date(mess.featured_until).toLocaleDateString() : null;

  const buy = async () => {
    setBusy(true);
    try {
      const r = await api.post("/mess-owner/featured/create-order");
      const orderResp = r.data;
      // If Razorpay SDK is available in-page (it is on other checkout screens),
      // open checkout. Else fall back to a devMock verify path.
      if (window.Razorpay && !orderResp.mock) {
        const rzp = new window.Razorpay({
          key: orderResp.key_id, amount: orderResp.amount_paise, currency: orderResp.currency,
          name: "efoodtech · Featured slot", description: `Featured for ${orderResp.plan_days} days`,
          order_id: orderResp.order_id, prefill: orderResp.prefill,
          handler: async (resp) => {
            try {
              await api.post("/mess-owner/featured/verify", { order_id: orderResp.order_id, payment_id: resp.razorpay_payment_id, signature: resp.razorpay_signature });
              toast.success("You're featured! 🎉");
              onDone?.();
            } catch (e) { toast.error(e?.response?.data?.detail || "Verification failed"); }
          },
          theme: { color: "#a02323" },
        });
        rzp.open();
      } else {
        // dev / mock path — verify immediately with the mock order
        await api.post("/mess-owner/featured/verify", { order_id: orderResp.order_id });
        toast.success("Featured activated (dev mode)");
        onDone?.();
      }
    } catch (e) { toast.error(e?.response?.data?.detail || "Order failed"); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5" data-testid="featured-promo-card">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-amber-500 text-white flex items-center justify-center">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display font-extrabold text-lg text-slate-900">Get pinned to slot #1</h3>
          <p className="text-xs text-slate-600 mt-1">Featured messes always show at the TOP of the Nearby page for users in your area — a proven boost for new subscriptions.</p>
          {mess?.is_featured && featuredUntil ? (
            <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1.5" data-testid="featured-until-badge">
              ✓ Featured until {featuredUntil}
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-3">
              <div>
                <div className="text-2xl font-extrabold text-slate-900">₹499</div>
                <div className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">for 30 days</div>
              </div>
              <Button onClick={buy} disabled={busy} className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold" data-testid="buy-featured-btn">
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Get featured now
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
