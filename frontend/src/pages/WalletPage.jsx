/* WalletPage — full-page wallet transactions history.
 * iter-131.24: Deep-linked from the hamburger drawer "Wallet & transactions"
 * row and hub tiles. Mirrors the WalletPill drawer layout in a page shell so
 * users can review their balance and history without a modal.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { TxnRow } from "../components/WalletPill";
import { Wallet, IndianRupee, Pause, Loader2, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";

function LabelForSub(sub) {
  const svc = (sub?.service_type || sub?.category || "plan").toLowerCase();
  const map = { tiffin: "Tiffin", dining: "Dining", delivery: "Delivery" };
  const nice = map[svc] || (svc.charAt(0).toUpperCase() + svc.slice(1));
  return sub?.plan_name || nice;
}

export default function WalletPage() {
  const [subs, setSubs] = useState([]);
  const [merged, setMerged] = useState(0);
  const [txnsByScope, setTxnsByScope] = useState({});
  const [loading, setLoading] = useState(false);
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
      const m = (await api.get("/my/wallet/transactions")).data.transactions || [];
      const scoped = { merged: m };
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
  useEffect(() => { if (subs.length >= 0) fetchTxns(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [subs.length]);

  const balanceDisplay = Math.round(merged || subs.reduce((sum, s) => sum + Number(s.wallet_balance || 0), 0));

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
    <div className="min-h-screen bg-background pb-24" data-testid="wallet-page">
      <div className="max-w-md mx-auto px-4 pt-4">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary mb-3" data-testid="wallet-back-link">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        <div className="flex items-center gap-2 mb-4">
          <span className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Wallet className="h-4 w-4" />
          </span>
          <h1 className="font-display font-extrabold text-2xl" data-testid="wallet-page-title">My wallet</h1>
        </div>

        {slides.length > 1 && (
          <div className="mb-3 flex items-center justify-between" data-testid="wallet-page-slider-nav">
            <button
              type="button"
              onClick={() => setSlide((s) => Math.max(0, s - 1))}
              disabled={clampedSlide === 0}
              className="h-9 w-9 inline-flex items-center justify-center rounded-full bg-muted disabled:opacity-40 hover:bg-muted/80"
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
              aria-label="Next plan"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="rounded-2xl bg-primary text-primary-foreground p-6 shadow-lg" data-testid={`wallet-page-card-${current?.key || "empty"}`}>
          <p className="text-[10px] tracking-widest uppercase font-bold text-primary-foreground/70 flex items-center gap-2">
            {current?.isMerged ? "Combined balance" : "Current balance"}
            {current?.sub && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 font-extrabold tracking-wider">
                {LabelForSub(current.sub)}
              </span>
            )}
          </p>
          <p className="font-display font-extrabold text-5xl mt-2 leading-none flex items-center" data-testid="wallet-page-balance">
            <IndianRupee className="h-7 w-7" strokeWidth={2.5} />
            {Math.round(current?.balance || 0).toLocaleString("en-IN")}
          </p>
          {current?.sub && (
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm pt-5 border-t border-white/15">
              <div>
                <p className="text-[10px] tracking-widest uppercase font-bold text-primary-foreground/70">Per day</p>
                <p className="font-display font-bold text-lg mt-1">₹{Math.round(current.sub.per_day_amount || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] tracking-widest uppercase font-bold text-primary-foreground/70 flex items-center gap-1"><Pause className="h-3 w-3" /> Paused</p>
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

        <p className="text-xs tracking-widest uppercase font-bold text-muted-foreground mt-6 mb-3">
          Transactions {current?.sub && <span className="ml-1 text-primary/80">· {LabelForSub(current.sub)} only</span>}
        </p>
        <div className="space-y-2" data-testid="wallet-page-transactions">
          {loading && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {!loading && currentTxns.length === 0 && <p className="text-sm text-muted-foreground">No transactions yet.</p>}
          {currentTxns.map((t) => <TxnRow key={t.txn_id} t={t} />)}
        </div>
      </div>
    </div>
  );
}
