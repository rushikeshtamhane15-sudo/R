import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "./ui/sheet";
import { Wallet, IndianRupee, ArrowDownLeft, ArrowUpRight, Pause, Receipt, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * WalletPill — header pill + wallet drawer.
 *
 * iter-131.12: dual-subscription support. When a user has two active plans
 * (e.g. tiffin + dining), the drawer becomes a horizontal slider of three
 * pages:
 *   · Slide 1 — Merged: total balance + full transaction history.
 *   · Slide 2 — Tiffin plan only (balance + tiffin-scoped txns).
 *   · Slide 3 — Dining plan only.
 * When only one active plan exists the slider collapses back to a single
 * page (legacy layout).
 *
 * The header pill balance always shows the SUM of all active plans'
 * `wallet_balance` fields.
 */

function LabelForSub(sub) {
  const svc = (sub?.service_type || sub?.category || "plan").toLowerCase();
  const map = { tiffin: "Tiffin", dining: "Dining", delivery: "Delivery" };
  const nice = map[svc] || (svc.charAt(0).toUpperCase() + svc.slice(1));
  return sub?.plan_name || nice;
}

export default function WalletPill({ trigger, alwaysShow = false, compact = false }) {
  const [subs, setSubs] = useState([]);
  const [merged, setMerged] = useState(0);
  const [txnsByScope, setTxnsByScope] = useState({}); // { "merged": [], "<sub_id>": [] }
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [slide, setSlide] = useState(0);

  const fetchSubs = async () => {
    try {
      const r = await api.get("/my/subscriptions");
      setSubs(r.data.subscriptions || []);
      setMerged(Number(r.data.merged_wallet_balance || 0));
    } catch {
      setSubs([]);
      setMerged(0);
    }
  };
  const fetchTxns = async () => {
    setLoading(true);
    try {
      const merged = (await api.get("/my/wallet/transactions")).data.transactions || [];
      const scoped = {};
      scoped.merged = merged;
      for (const s of subs) {
        const r = await api.get(`/my/wallet/transactions?sub_id=${encodeURIComponent(s.sub_id)}`);
        scoped[s.sub_id] = r.data.transactions || [];
      }
      setTxnsByScope(scoped);
    } catch {
      setTxnsByScope({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSubs(); }, []);
  useEffect(() => { if (open) { fetchSubs(); } }, [open]);
  useEffect(() => { if (open) { fetchTxns(); } }, [open, subs.length]);

  const balanceDisplay = Math.round(merged || subs.reduce((sum, s) => sum + Number(s.wallet_balance || 0), 0));

  // Build the list of slides the drawer will show. Always include the
  // merged slide when there are 2+ subs; otherwise show just the single
  // plan directly.
  const slides = useMemo(() => {
    if (subs.length <= 1) {
      const only = subs[0];
      return [{
        key: "single",
        title: only ? LabelForSub(only) : "My wallet",
        sub: only || null,
        balance: only ? Math.round(only.wallet_balance || 0) : balanceDisplay,
        txnKey: only ? only.sub_id : "merged",
      }];
    }
    return [
      { key: "merged", title: "All plans (merged)", sub: null, balance: balanceDisplay, txnKey: "merged", isMerged: true },
      ...subs.map((s) => ({
        key: s.sub_id,
        title: LabelForSub(s),
        sub: s,
        balance: Math.round(s.wallet_balance || 0),
        txnKey: s.sub_id,
      })),
    ];
  }, [subs, balanceDisplay]);

  const clampedSlide = Math.min(slide, slides.length - 1);
  const current = slides[clampedSlide] || slides[0];
  const currentTxns = current ? txnsByScope[current.txnKey] || [] : [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || (
          <button
            type="button"
            data-testid="wallet-pill"
            className={`flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 transition-colors border border-white/30 text-primary-foreground whitespace-nowrap ${compact ? "px-2.5 py-1" : "px-3.5 py-2"}`}
          >
            <Wallet className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2} />
            <span className={`font-display font-bold flex items-center ${compact ? "text-xs" : "text-sm"}`} data-testid="wallet-pill-balance">
              <IndianRupee className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} strokeWidth={2.5} />
              {balanceDisplay.toLocaleString("en-IN")}
            </span>
          </button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" data-testid="wallet-drawer">
        <SheetHeader>
          <SheetTitle className="font-display text-xl flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" /> My wallet
          </SheetTitle>
          <SheetDescription className="sr-only">Current wallet balance and full transaction history</SheetDescription>
        </SheetHeader>

        {/* Slide indicator + arrows — only when 2+ plans */}
        {slides.length > 1 && (
          <div className="mt-4 flex items-center justify-between" data-testid="wallet-slider-nav">
            <button
              type="button"
              onClick={() => setSlide((s) => Math.max(0, s - 1))}
              disabled={clampedSlide === 0}
              className="h-9 w-9 inline-flex items-center justify-center rounded-full bg-muted disabled:opacity-40 hover:bg-muted/80"
              data-testid="wallet-slider-prev"
              aria-label="Previous plan"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 flex justify-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSlide(i)}
                  data-testid={`wallet-slider-dot-${i}`}
                  aria-label={`Go to ${s.title}`}
                  className={`h-2 rounded-full transition-all ${i === clampedSlide ? "w-6 bg-primary" : "w-2 bg-muted-foreground/40 hover:bg-muted-foreground/70"}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSlide((s) => Math.min(slides.length - 1, s + 1))}
              disabled={clampedSlide >= slides.length - 1}
              className="h-9 w-9 inline-flex items-center justify-center rounded-full bg-muted disabled:opacity-40 hover:bg-muted/80"
              data-testid="wallet-slider-next"
              aria-label="Next plan"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Balance card for the current slide */}
        <div className="mt-4 rounded-2xl bg-primary text-primary-foreground p-6" data-testid={`wallet-card-${current?.key || "empty"}`}>
          <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70 flex items-center gap-2">
            {current?.isMerged ? "Combined balance" : "Current balance"}
            {current?.sub && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 font-extrabold tracking-wider">
                {LabelForSub(current.sub)}
              </span>
            )}
          </p>
          <p className="font-display font-extrabold text-5xl mt-2 leading-none flex items-center" data-testid="wallet-card-balance">
            <IndianRupee className="h-7 w-7" strokeWidth={2.5} />
            {Math.round(current?.balance || 0).toLocaleString("en-IN")}
          </p>
          {current?.sub && (
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm pt-5 border-t border-white/15">
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">Per day</p>
                <p className="font-display font-bold text-lg mt-1">₹{Math.round(current.sub.per_day_amount || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70 flex items-center gap-1"><Pause className="h-3 w-3" /> Paused</p>
                <p className="font-display font-bold text-lg mt-1">{current.sub.paused_days || 0} days</p>
              </div>
            </div>
          )}
          {current?.isMerged && (
            <p className="text-xs text-primary-foreground/80 mt-3">Combined across {slides.length - 1} active plans. Deductions still happen per plan — swipe to view one plan at a time.</p>
          )}
          {!current?.sub && !current?.isMerged && slides.length === 1 && (
            <p className="text-xs text-primary-foreground/80 mt-3">No active plan yet — subscribe to load your wallet.</p>
          )}
        </div>

        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground mt-6 mb-3">
          Transactions {current?.sub && <span className="ml-1 text-primary/80">· {LabelForSub(current.sub)} only</span>}
        </p>
        <div className="space-y-2 pr-1" data-testid="wallet-transactions">
          {loading && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {!loading && currentTxns.length === 0 && <p className="text-sm text-muted-foreground">No transactions yet.</p>}
          {currentTxns.map((t) => <TxnRow key={t.txn_id} t={t} />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TxnRow({ t }) {
  const isCredit = t.type === "credit";
  const isDebit = t.type === "debit";
  const isFee = t.type === "fee";
  const Icon = isCredit ? ArrowDownLeft : isDebit ? ArrowUpRight : isFee ? Receipt : Pause;
  const color = isCredit
    ? "text-primary bg-primary/10"
    : isDebit
      ? "text-destructive bg-destructive/10"
      : isFee
        ? "text-muted-foreground bg-muted"
        : "text-secondary bg-secondary/10";
  const sign = isCredit ? "+" : isDebit ? "−" : "";
  return (
    <div className="flex items-center justify-between rounded-xl border border-border p-3" data-testid={`txn-${t.txn_id}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${color}`}>
          <Icon className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{t.reason}</p>
          <p className="text-[11px] text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
        </div>
      </div>
      <div className="text-right shrink-0">
        {t.amount > 0 && (
          <p className={`font-display font-bold text-sm ${isCredit ? "text-primary" : isFee ? "text-muted-foreground" : "text-destructive"}`}>
            {sign}₹{Number(t.amount).toLocaleString("en-IN", { minimumFractionDigits: isFee ? 2 : 0, maximumFractionDigits: 2 })}
          </p>
        )}
        {!isFee && (
          <p className="text-[11px] text-muted-foreground">bal ₹{Math.round(t.balance_after).toLocaleString("en-IN")}</p>
        )}
      </div>
    </div>
  );
}
