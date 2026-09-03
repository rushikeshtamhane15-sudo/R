/* WalletPage — full-page wallet transactions history.
 * iter-131.24: Deep-linked from the hamburger drawer "Wallet & transactions"
 * row and hub tiles. Mirrors the WalletPill drawer layout in a page shell so
 * users can review their balance and history without a modal.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { TxnRow } from "../components/WalletPill";
import { Wallet, IndianRupee, Pause, Loader2, ChevronLeft, ChevronRight, ArrowLeft, Sparkles } from "lucide-react";

function LabelForSub(sub) {
  const svc = (sub?.service_type || sub?.category || "plan").toLowerCase();
  const map = { tiffin: "Tiffin", dining: "Dining", delivery: "Delivery" };
  const nice = map[svc] || (svc.charAt(0).toUpperCase() + svc.slice(1));
  return sub?.plan_name || nice;
}

/** iter-140.h — formats a joining ribbon like:
 *    "You joined on Aug 18 with ₹2,800 · 14 days left"
 *  Draws the joining date + plan amount from the `joining_credit` ledger
 *  row and pairs it with the calendar-days-remaining number so subscribers
 *  see a friendly "here's where you started · here's what's left" line at
 *  the very top of their wallet page. */
function JoiningRibbon({ joiningTxn, sub, daysLeft }) {
  if (!joiningTxn) return null;
  const startDate = joiningTxn.start_date || String(joiningTxn.created_at || "").slice(0, 10);
  const amount = Math.round(Number(joiningTxn.amount || 0));
  let prettyDate = startDate;
  try {
    const d = new Date(`${startDate}T00:00:00+05:30`);
    prettyDate = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { /* keep ISO */ }
  const daysLine = Number.isFinite(daysLeft)
    ? ` · ${Math.max(0, daysLeft)} day${daysLeft === 1 ? "" : "s"} left`
    : "";
  const planLabel = sub?.plan_name || LabelForSub(sub) || "your plan";
  return (
    <div
      className="mb-3 rounded-2xl border-2 border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3 flex items-start gap-3"
      data-testid="wallet-joining-ribbon"
    >
      <span className="mt-0.5 h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
        <Sparkles className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] tracking-[0.16em] uppercase font-bold text-primary/80">Your plan · {planLabel}</p>
        <p className="text-sm font-extrabold mt-0.5 leading-snug">
          You joined on <span data-testid="wallet-joining-date">{prettyDate}</span> with <span data-testid="wallet-joining-amount">₹{amount.toLocaleString("en-IN")}</span>{daysLine}
        </p>
      </div>
    </div>
  );
}

export default function WalletPage() {
  const [subs, setSubs] = useState([]);
  const [merged, setMerged] = useState(0);
  // iter-140.d — residual user-level balance so a subscriber still sees
  // their money even when every sub has expired (e.g. admin deducted the
  // last meal via override). `/my/subscriptions` returns 0 in that case,
  // but `users.wallet_balance` still holds the residual — that's the ONE
  // source of truth for "cash left with me".
  const [userBalance, setUserBalance] = useState(0);
  const [txnsByScope, setTxnsByScope] = useState({});
  const [loading, setLoading] = useState(false);
  const [slide, setSlide] = useState(0);

  const fetchSubs = async () => {
    try {
      const [subsRes, walletRes] = await Promise.all([
        api.get("/my/subscriptions"),
        api.get("/my/wallet").catch(() => ({ data: {} })),
      ]);
      setSubs(subsRes.data.subscriptions || []);
      setMerged(Number(subsRes.data.merged_wallet_balance || 0));
      setUserBalance(Number(walletRes.data?.wallet_balance || 0));
    } catch {
      setSubs([]);
      setMerged(0);
      setUserBalance(0);
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

  // iter-140.d — always trust the user-level wallet as the display value.
  // `merged` (sum of active subs) can be less than the user-level balance
  // when a sub has expired but residual money is still parked on the user
  // doc — surface that so subscribers don't panic that their money vanished.
  const balanceDisplay = Math.round(Math.max(
    userBalance || 0,
    merged || subs.reduce((sum, s) => sum + Number(s.wallet_balance || 0), 0),
  ));

  const slides = useMemo(() => {
    if (subs.length <= 1) {
      const only = subs[0];
      return [{
        key: "single",
        title: only ? LabelForSub(only) : "My wallet",
        sub: only || null,
        // If a sub exists, its wallet_balance is the per-plan number; if not,
        // fall back to the user-level residual so the tile isn't ₹0.
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
  // iter-140.h — pick the joining_credit ledger row for the current slide's
  // sub so we can render the "You joined on <date> with ₹X" ribbon.
  const joiningTxn = useMemo(() => {
    if (!current?.sub) return null;
    return currentTxns.find((t) => t.kind === "joining_credit") || null;
  }, [current, currentTxns]);
  // iter-140.h — calendar days left on the current sub (same formula the
  // dashboard uses so the ribbon and hero stat agree).
  const currentDaysLeft = useMemo(() => {
    const sub = current?.sub;
    if (!sub || !sub.end_date) return null;
    const end = new Date(sub.end_date);
    const now = new Date();
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.round((endDay - nowDay) / 86400000));
  }, [current]);

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

        <JoiningRibbon joiningTxn={joiningTxn} sub={current?.sub} daysLeft={currentDaysLeft} />

        <div className="rounded-2xl bg-primary text-primary-foreground p-6 shadow-lg" data-testid={`wallet-page-card-${current?.key || "empty"}`}>
          <p className="text-[10px] tracking-widest uppercase font-bold text-primary-foreground/70 flex items-center gap-2">
            {current?.isMerged ? "Combined balance" : "Current balance"}
            {current?.sub && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 font-extrabold tracking-wider">
                {LabelForSub(current.sub)}
              </span>
            )}
          </p>          <p className="font-display font-extrabold text-5xl mt-2 leading-none flex items-center" data-testid="wallet-page-balance">
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
            balanceDisplay > 0 ? (
              <p className="text-xs text-primary-foreground/80 mt-3" data-testid="wallet-residual-note">
                Your subscription has ended but this residual is safe with you. Subscribe again and this balance carries over.
              </p>
            ) : (
              <p className="text-xs text-primary-foreground/80 mt-3">No active plan yet — subscribe to load your wallet.</p>
            )
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
