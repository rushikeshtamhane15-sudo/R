/**
 * AdminNoticesBanner — iter-101
 *
 * Surfaces in-app notices that an admin pushed for this user (manual wallet
 * adjustment, manually-assigned subscription, etc.) so the user always knows
 * exactly what changed on their account.
 *
 * Backend:
 *   GET  /api/auth/notices            → { notices: [...], unread: N }
 *   POST /api/auth/notices/ack {all:true}  → marks all as read
 */
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Bell, X, Wallet as WalletIcon, BadgeCheck } from "lucide-react";

const KIND_META = {
  wallet_adjust: { icon: WalletIcon, accent: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  subscription_assigned: { icon: BadgeCheck, accent: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
};

export default function AdminNoticesBanner({ onAcknowledged }) {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/auth/notices", { params: { only_unread: true } });
      setNotices(r.data?.notices || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const dismissAll = async () => {
    setDismissing(true);
    try {
      await api.post("/auth/notices/ack", { all: true });
      setNotices([]);
      onAcknowledged && onAcknowledged();
    } catch { /* silent */ }
    finally { setDismissing(false); }
  };

  if (loading || notices.length === 0) return null;

  return (
    <div className="mb-6 space-y-2" data-testid="admin-notices-banner">
      {notices.map((n) => {
        const meta = KIND_META[n.kind] || KIND_META.wallet_adjust;
        const Icon = meta.icon;
        return (
          <div
            key={n.notice_id}
            className={`rounded-2xl border-2 px-4 py-3 flex items-start gap-3 ${meta.accent}`}
            data-testid={`admin-notice-${n.kind}`}
          >
            <span className="inline-flex h-9 w-9 rounded-xl bg-white/60 items-center justify-center shrink-0">
              <Icon className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold leading-tight">{n.title}</p>
              <p className="text-[12px] mt-1 leading-relaxed opacity-90">{n.body}</p>
              <p className="text-[10px] opacity-60 mt-1">{new Date(n.ts).toLocaleString("en-IN")}</p>
            </div>
          </div>
        );
      })}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={dismissAll}
          disabled={dismissing}
          className="text-[11px] font-bold text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-muted/60 transition-colors"
          data-testid="admin-notices-dismiss-all"
        >
          <X className="h-3 w-3" /> {dismissing ? "Dismissing…" : "Got it · dismiss all"}
        </button>
      </div>
    </div>
  );
}

// Tiny header pill (for places like AppHeader) — exports separately so it
// can be composed elsewhere without rendering the full banner.
export function AdminNoticesPill() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/auth/notices", { params: { only_unread: true } });
        if (alive) setUnread(r.data?.unread || 0);
      } catch { /* silent */ }
    })();
    return () => { alive = false; };
  }, []);
  if (!unread) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground text-[10px] font-extrabold px-2 py-0.5" data-testid="admin-notices-pill">
      <Bell className="h-3 w-3" /> {unread}
    </span>
  );
}
