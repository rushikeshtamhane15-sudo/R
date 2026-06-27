// AdminWalletTopup — credit/debit form (direction, amount, reason, advanced sub adjust).
import React from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  IndianRupee, Loader2, Plus, Minus, ShieldCheck, Sparkles, CalendarDays,
} from "lucide-react";

const QUICK_AMOUNTS = [100, 500, 1000, 2500];

export default function WalletAdjustForm({
  direction, setDirection,
  amount, setAmount,
  reason, setReason,
  extendDays, setExtendDays,
  mealsDelta, setMealsDelta,
  saving, profileBlocked, onApply,
}) {
  const disabled = saving || (!amount && !extendDays && !mealsDelta) || !reason.trim() || profileBlocked;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Direction</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setDirection("credit")}
          className={`rounded-xl border-2 px-3 py-2.5 flex items-center justify-center gap-2 text-sm font-extrabold transition-colors ${direction === "credit" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-border hover:border-emerald-400"}`}
          data-testid="wallet-direction-credit"
        >
          <Plus className="h-4 w-4" /> Credit (top-up)
        </button>
        <button
          type="button"
          onClick={() => setDirection("debit")}
          className={`rounded-xl border-2 px-3 py-2.5 flex items-center justify-center gap-2 text-sm font-extrabold transition-colors ${direction === "debit" ? "border-destructive bg-destructive/5 text-destructive" : "border-border hover:border-destructive/60"}`}
          data-testid="wallet-direction-debit"
        >
          <Minus className="h-4 w-4" /> Debit (deduct)
        </button>
      </div>

      <div className="mt-4">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Amount (₹)</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAmount(String(a))}
              className={`rounded-full text-xs font-bold px-3 h-8 border-2 transition-colors ${String(amount) === String(a) ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary"}`}
              data-testid={`wallet-amount-quick-${a}`}
            >
              ₹{a}
            </button>
          ))}
        </div>
        <div className="relative mt-2 max-w-xs">
          <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="number" min={0} step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter custom amount"
            className="pl-9 rounded-xl text-base font-display font-bold"
            data-testid="wallet-amount-input"
          />
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Reason (audit log)</p>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          placeholder="e.g. paid cash to manager · goodwill credit · refund #12"
          className="mt-2 rounded-xl"
          maxLength={500}
          data-testid="wallet-reason-input"
        />
      </div>

      <details className="mt-4 group" data-testid="wallet-adv-toggle">
        <summary className="cursor-pointer text-xs font-extrabold text-primary inline-flex items-center gap-1 select-none">
          <Sparkles className="h-3 w-3" /> Advanced: also adjust subscription
        </summary>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Days (+ extend / − deduct)</p>
            <Stepper
              value={extendDays}
              onChange={setExtendDays}
              min={-365} max={365}
              decTestId="wallet-days-dec" incTestId="wallet-days-inc" inputTestId="wallet-extend-days"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Pushes the sub end-date forward (+) or pulls it back (−).</p>
          </div>
          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Meals (+ restore / − deduct)</p>
            <Stepper
              value={mealsDelta}
              onChange={setMealsDelta}
              min={-300} max={300}
              decTestId="wallet-meals-dec" incTestId="wallet-meals-inc" inputTestId="wallet-meals-delta"
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Applies to the user&apos;s active subscription (if any). Positive = restore meals (lowers <code>meals_used</code>),
          negative = deduct meals (raises <code>meals_used</code>, e.g. user ate extra for a friend).
        </p>
      </details>

      <div className="mt-5 flex gap-2">
        <Button
          onClick={onApply}
          disabled={disabled}
          className="rounded-full bg-primary hover:bg-primary/90 flex-1 h-11"
          data-testid="wallet-apply-button"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
          {saving ? "Applying…" : `Apply ${direction === "credit" ? "+" : "−"}₹${Number(amount || 0).toLocaleString("en-IN")}`}
        </Button>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, min, max, decTestId, incTestId, inputTestId }) {
  return (
    <div className="mt-1 flex items-stretch rounded-xl border border-input bg-background overflow-hidden">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, Number(value || 0) - 1))}
        className="px-3 hover:bg-red-500/10 text-red-600 font-extrabold"
        aria-label="Decrement"
        data-testid={decTestId}
      >−</button>
      <Input
        type="number" min={min} max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-none border-0 text-center font-bold"
        data-testid={inputTestId}
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, Number(value || 0) + 1))}
        className="px-3 hover:bg-emerald-500/10 text-emerald-600 font-extrabold"
        aria-label="Increment"
        data-testid={incTestId}
      >+</button>
    </div>
  );
}
