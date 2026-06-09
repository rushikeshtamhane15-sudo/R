import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "./ui/sheet";
import { Wallet, IndianRupee, ArrowDownLeft, ArrowUpRight, Pause, Receipt, Loader2 } from "lucide-react";

export default function WalletPill({ trigger, alwaysShow = false, compact = false }) {
  const [data, setData] = useState(null);
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchWallet = async () => {
    try { const r = await api.get("/my/wallet"); setData(r.data); }
    catch { setData({ wallet_balance: 0, subscription: null, paused_days: 0 }); }
  };
  const fetchTxns = async () => {
    setLoading(true);
    try { const r = await api.get("/my/wallet/transactions"); setTxns(r.data.transactions || []); }
    catch { setTxns([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchWallet(); }, []);
  useEffect(() => { if (open) { fetchWallet(); fetchTxns(); } }, [open]);

  const balance = data?.subscription ? Math.round(data.subscription.wallet_balance) : Math.round(data?.wallet_balance || 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || (
          <button
            type="button"
            data-testid="wallet-pill"
            className={`flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 transition-colors border border-white/30 text-primary-foreground ${compact ? "px-2 py-1" : "px-3.5 py-2"}`}
          >
            <Wallet className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2} />
            <span className={`font-display font-bold flex items-center ${compact ? "text-xs" : "text-sm"}`} data-testid="wallet-pill-balance">
              <IndianRupee className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} strokeWidth={2.5} />
              {balance.toLocaleString("en-IN")}
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
        <div className="mt-6 rounded-2xl bg-primary text-primary-foreground p-6">
          <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">Current balance</p>
          <p className="font-display font-extrabold text-5xl mt-2 leading-none flex items-center">
            <IndianRupee className="h-7 w-7" strokeWidth={2.5} />{balance.toLocaleString("en-IN")}
          </p>
          {data?.subscription && (
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm pt-5 border-t border-white/15">
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">Per day</p>
                <p className="font-display font-bold text-lg mt-1">₹{Math.round(data.subscription.per_day_amount)}</p>
              </div>
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70 flex items-center gap-1"><Pause className="h-3 w-3" /> Paused</p>
                <p className="font-display font-bold text-lg mt-1">{data.subscription.paused_days} days</p>
              </div>
            </div>
          )}
          {!data?.subscription && (
            <p className="text-xs text-primary-foreground/80 mt-3">No active plan yet — subscribe to load your wallet.</p>
          )}
        </div>

        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground mt-6 mb-3">Transactions</p>
        <div className="space-y-2 pr-1" data-testid="wallet-transactions">
          {loading && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {!loading && txns.length === 0 && <p className="text-sm text-muted-foreground">No transactions yet.</p>}
          {txns.map((t) => <TxnRow key={t.txn_id} t={t} />)}
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
