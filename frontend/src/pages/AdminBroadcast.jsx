// iter-138.p · Admin WhatsApp broadcast — one-tap holiday/mess-off notices.
//
// The admin composes a short message (defaults are pre-filled with a sensible
// holiday template) and either taps the individual "WhatsApp" button on any
// row OR the big "Open WhatsApp for all filtered" button which sequentially
// pops open a wa.me tab for every filtered subscriber. wa.me deep-links open
// the WhatsApp app / WhatsApp Web with the message pre-typed and the phone
// number preselected — the admin just presses "Send" once per contact.
//
// We deliberately go the wa.me route instead of Meta Cloud API because that
// route needs a pre-approved template per message shape, and this page is
// for ad-hoc, human-authored notices.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Loader2, MessageSquare, Send, Users, Utensils, Coffee, ChevronsRight } from "lucide-react";

const DEFAULT_MESSAGE = (
  "Namaste! 🙏\n\n" +
  "efoodcare mess will be *closed* tomorrow on account of holiday.\n" +
  "Regular tiffin + dining service resumes the day after.\n\n" +
  "Sorry for the inconvenience — thank you for understanding.\n" +
  "— Team efoodcare · ghar se accha khana"
);

const CATEGORY_TABS = [
  { id: "all",    label: "All subscribers",   icon: Users },
  { id: "tiffin", label: "Tiffin only",       icon: Coffee },
  { id: "dining", label: "Dining only",       icon: Utensils },
  { id: "both",   label: "Both (T + D)",      icon: ChevronsRight },
];

function _waLink(phone, message) {
  const p = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
  const normalised = p.length === 10 ? `91${p}` : p;
  return `https://wa.me/${normalised}?text=${encodeURIComponent(message)}`;
}

export default function AdminBroadcast() {
  const [category, setCategory] = useState("all");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(() => {
    try { return localStorage.getItem("efc.broadcast.msg") || DEFAULT_MESSAGE; } catch { return DEFAULT_MESSAGE; }
  });
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/admin/broadcast/audience?category=${category}`);
      setRows(r.data?.users || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load audience");
    } finally { setLoading(false); }
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows;
  const counts = useMemo(() => {
    let tiffin = 0, dining = 0, both = 0;
    for (const r of rows) {
      const t = r.categories?.includes("tiffin");
      const d = r.categories?.includes("dining");
      if (t && d) both += 1; else if (t) tiffin += 1; else if (d) dining += 1;
    }
    return { total: rows.length, tiffin, dining, both };
  }, [rows]);

  const saveMessage = (m) => {
    setMessage(m);
    try { localStorage.setItem("efc.broadcast.msg", m); } catch { /* noop */ }
  };

  const sendOne = (row) => {
    // Personalise the greeting with the recipient's name so it doesn't
    // read as a mass-blast.
    const first = String(row.name || "").split(" ")[0] || "";
    const personal = first ? message.replace(/^Namaste!/, `Namaste ${first}!`) : message;
    const url = _waLink(row.phone, personal);
    window.open(url, "_blank", "noopener");
  };

  const sendAll = async () => {
    if (!filtered.length) { toast.info("No one to send to"); return; }
    if (!window.confirm(`Open a WhatsApp tab for ${filtered.length} contact(s)? You'll need to press Send once in each tab.`)) return;
    setSending(true);
    // Fire tabs with a small stagger so the browser doesn't block them all.
    for (let i = 0; i < filtered.length; i += 1) {
      const row = filtered[i];
      const first = String(row.name || "").split(" ")[0] || "";
      const personal = first ? message.replace(/^Namaste!/, `Namaste ${first}!`) : message;
      const url = _waLink(row.phone, personal);
      // Delay each tab open by ~350ms — most desktops allow the popups when
      // they're time-spaced from a single user gesture.
      // eslint-disable-next-line no-loop-func
      setTimeout(() => { window.open(url, "_blank", "noopener"); }, i * 350);
    }
    setTimeout(() => { setSending(false); toast.success(`Queued ${filtered.length} WhatsApp tabs`); }, filtered.length * 350 + 500);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-broadcast-page">
      <div>
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Broadcast</p>
        <h1 className="font-display font-extrabold text-3xl mt-1 flex items-center gap-2">
          <MessageSquare className="h-7 w-7 text-primary" /> WhatsApp broadcast
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compose a short message (holiday notice, menu change, weather delay) and send it to every currently-active subscriber in one tap. Uses WhatsApp&apos;s own <code className="text-xs bg-muted px-1 rounded">wa.me</code> deep-link — the message opens pre-typed on your phone/desktop, you just press Send.
        </p>
      </div>

      {/* Category filter */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="broadcast-category-tabs">
        {CATEGORY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCategory(t.id)}
            data-testid={`broadcast-cat-${t.id}`}
            className={`flex items-center justify-center gap-2 h-11 rounded-xl border-2 font-extrabold text-sm uppercase tracking-[0.14em] transition-colors ${
              category === t.id ? "border-primary bg-primary text-white" : "border-black/10 bg-background text-foreground hover:border-primary/40"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Message editor */}
      <div className="rounded-2xl card-3d p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">Message · WhatsApp formatting supported (*bold*, _italic_)</p>
          <button type="button" onClick={() => saveMessage(DEFAULT_MESSAGE)} className="text-[11px] font-bold text-primary hover:underline" data-testid="broadcast-reset-msg">
            Reset to default
          </button>
        </div>
        <textarea
          value={message}
          onChange={(e) => saveMessage(e.target.value)}
          rows={7}
          className="w-full rounded-xl border-2 border-black/10 bg-white p-3 text-sm text-foreground font-medium focus:outline-none focus:border-primary/60"
          placeholder="Namaste! …"
          data-testid="broadcast-message"
        />
        <p className="text-[11px] text-muted-foreground">
          Tip: the greeting <code className="text-xs bg-muted px-1 rounded">Namaste!</code> at the start is auto-personalised to <code className="text-xs bg-muted px-1 rounded">Namaste &lt;first name&gt;!</code> for every recipient.
        </p>
      </div>

      {/* Send-all */}
      <div className="rounded-2xl bg-primary/8 border-2 border-primary/25 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-primary">Broadcast summary</p>
          <p className="text-sm text-foreground mt-1">
            <span className="font-extrabold">{counts.total}</span> people in <span className="font-extrabold">{CATEGORY_TABS.find((t) => t.id === category)?.label}</span> · <span className="tabular-nums">{counts.tiffin} tiffin</span> · <span className="tabular-nums">{counts.dining} dining</span> · <span className="tabular-nums">{counts.both} both</span>
          </p>
        </div>
        <Button
          onClick={sendAll}
          disabled={sending || !filtered.length}
          className="h-12 px-6 rounded-full bg-primary hover:bg-primary/90 text-white font-extrabold"
          data-testid="broadcast-send-all"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Send className="h-5 w-5 mr-2" />}
          Open WhatsApp for {filtered.length}
        </Button>
      </div>

      {/* Audience table */}
      <div className="rounded-2xl border border-black/10 bg-white overflow-hidden">
        <div className="bg-muted/40 px-4 py-2 grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground border-b">
          <div>Name</div>
          <div>Phone</div>
          <div>Category</div>
          <div className="text-right">Action</div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading audience…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No subscribers match this filter.</div>
        ) : (
          <ul className="divide-y max-h-[600px] overflow-auto" data-testid="broadcast-audience-list">
            {filtered.map((row) => (
              <li
                key={row.user_id}
                className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center px-4 py-2.5 hover:bg-muted/30"
                data-testid={`broadcast-row-${row.user_id}`}
              >
                <div className="text-sm font-bold text-foreground truncate">{row.name}</div>
                <div className="text-sm text-muted-foreground tabular-nums truncate">+91 {row.phone.slice(-10)}</div>
                <div className="flex gap-1">
                  {row.categories?.includes("tiffin") && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-300 px-2 h-6 text-[10px] font-extrabold uppercase tracking-[0.14em]">Tiffin</span>
                  )}
                  {row.categories?.includes("dining") && (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 px-2 h-6 text-[10px] font-extrabold uppercase tracking-[0.14em]">Dining</span>
                  )}
                </div>
                <div className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendOne(row)}
                    className="h-8 rounded-full text-xs font-extrabold border-primary/40 text-primary hover:bg-primary/10"
                    data-testid={`broadcast-send-${row.user_id}`}
                  >
                    <Send className="h-3.5 w-3.5 mr-1.5" /> WhatsApp
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
