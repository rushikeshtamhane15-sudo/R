import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { MessageCircle, RefreshCw, Loader2, Send, Eye, EyeOff, CheckCircle2, AlertTriangle, HelpCircle } from "lucide-react";

const KIND_LABEL = {
  registration: "Welcome",
  payment_success: "Payment success",
  expiry_reminder: "Expiry reminder",
  restaurant_order: "Restaurant order",
  delivery_otp: "Delivery OTP",
};

function StatusBadge({ status }) {
  if (status === "live")
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-overline uppercase text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-3 w-3" /> Sent</span>;
  if (status === "stub_mode")
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-overline uppercase text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/50 px-2 py-0.5 rounded-full"><HelpCircle className="h-3 w-3" /> Stub</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-overline uppercase text-red-700 bg-red-50 dark:text-red-200 dark:bg-red-950/50 px-2 py-0.5 rounded-full"><AlertTriangle className="h-3 w-3" /> Error</span>;
}

export default function AdminWhatsAppOutbox() {
  const [data, setData] = useState({ events: [], counts: null, loading: true });
  const [resending, setResending] = useState(null);
  const [previewIdx, setPreviewIdx] = useState(null);

  const load = async () => {
    setData((s) => ({ ...s, loading: true }));
    try {
      const r = await api.get("/admin/whatsapp/outbox?limit=50");
      setData({ events: r.data?.events || [], counts: r.data?.counts || null, loading: false });
    } catch { toast.error("Could not load outbox"); setData({ events: [], counts: null, loading: false }); }
  };
  useEffect(() => { load(); }, []);

  const resend = async (e, idx) => {
    setResending(idx);
    try {
      const vars_ = { ...(e.vars || {}) };
      delete vars_.preview_html;
      const r = await api.post("/admin/whatsapp/resend", { phone: e.phone, kind: e.kind, vars: vars_ });
      if (r.data?.stub_mode) toast.message("Stub mode — re-logged in outbox (set MSG91_WA_AUTH_KEY for live)");
      else toast.success("Re-sent via MSG91 WhatsApp");
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Resend failed"); }
    finally { setResending(null); }
  };

  const counts = data.counts || { total: 0, live_sent: 0, stub_logged: 0, errored: 0, stub_mode_now: true };

  return (
    <div className="space-y-5" data-testid="wa-outbox-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-1 leading-tight">Message outbox</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Last 50 outbound WhatsApp events. Click <Eye className="h-3 w-3 inline" /> to preview the branded message, <Send className="h-3 w-3 inline" /> to re-send.</p>
        </div>
        <Button variant="outline" onClick={load} className="rounded-full" data-testid="wa-refresh-btn">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="wa-counts">
        <div className="rounded-2xl bg-muted/40 px-4 py-3"><p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Total</p><p className="font-display font-extrabold text-2xl mt-0.5">{counts.total}</p></div>
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3"><p className="text-[10px] tracking-overline uppercase font-bold text-emerald-700 dark:text-emerald-300">Live sent</p><p className="font-display font-extrabold text-2xl mt-0.5 text-emerald-900 dark:text-emerald-100">{counts.live_sent}</p></div>
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 px-4 py-3"><p className="text-[10px] tracking-overline uppercase font-bold text-amber-700 dark:text-amber-300">Stub logged</p><p className="font-display font-extrabold text-2xl mt-0.5 text-amber-900 dark:text-amber-100">{counts.stub_logged}</p></div>
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/40 px-4 py-3"><p className="text-[10px] tracking-overline uppercase font-bold text-red-700 dark:text-red-300">Errored</p><p className="font-display font-extrabold text-2xl mt-0.5 text-red-900 dark:text-red-100">{counts.errored}</p></div>
      </div>

      {counts.stub_mode_now && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-100" data-testid="wa-stub-banner">
          <p className="font-bold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> WhatsApp is in STUB mode</p>
          <p className="text-xs mt-1 opacity-90">Set <code className="font-mono">MSG91_WA_AUTH_KEY</code> + the 5 template-id env vars and restart backend to flip live. Approved templates needed at MSG91 dashboard first.</p>
        </div>
      )}

      {/* Events list */}
      {data.loading ? (
        <div className="text-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 inline mr-2 animate-spin" /> Loading…</div>
      ) : data.events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground" data-testid="wa-empty">
          <MessageCircle className="h-7 w-7 mx-auto mb-3 opacity-50" />
          No WhatsApp messages logged yet. Trigger one (e.g. register a new user) to see it here.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="min-w-full text-sm" data-testid="wa-events-table">
            <thead>
              <tr className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground border-b border-border">
                <th className="text-left py-2 px-2 font-bold">When</th>
                <th className="text-left py-2 px-2 font-bold">Phone</th>
                <th className="text-left py-2 px-2 font-bold">Kind</th>
                <th className="text-left py-2 px-2 font-bold">Status</th>
                <th className="text-right py-2 px-2 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e, idx) => (
                <React.Fragment key={`${e.ts}-${idx}`}>
                  <tr className="border-b border-border/50 hover:bg-muted/30" data-testid={`wa-event-${idx}`}>
                    <td className="py-2 px-2 whitespace-nowrap text-muted-foreground text-xs">{new Date(e.ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="py-2 px-2 font-mono text-xs">{e.phone}</td>
                    <td className="py-2 px-2 text-xs font-semibold">{KIND_LABEL[e.kind] || e.kind}</td>
                    <td className="py-2 px-2"><StatusBadge status={e.status} /></td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" onClick={() => setPreviewIdx(previewIdx === idx ? null : idx)} aria-label="Preview" data-testid={`wa-preview-${idx}`}>
                        {previewIdx === idx ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => resend(e, idx)} disabled={resending === idx} aria-label="Resend" data-testid={`wa-resend-${idx}`}>
                        {resending === idx ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 text-primary" />}
                      </Button>
                    </td>
                  </tr>
                  {previewIdx === idx && e.vars?.preview_html && (
                    <tr><td colSpan={5} className="px-2 pb-3 pt-1">
                      <div className="bg-muted/40 rounded-xl p-3" data-testid={`wa-preview-html-${idx}`} dangerouslySetInnerHTML={{ __html: e.vars.preview_html }} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
