// AdminWalletTopup — small visual blocks: profile banner, user snapshot, reconcile, history.
import React from "react";
import { Button } from "../ui/button";
import {
  User as UserIcon, Phone, Mail, GitMerge, History, Loader2, Plus, Minus,
} from "lucide-react";

export function ProfileIncompleteBanner({ profileStatus }) {
  if (!profileStatus || profileStatus.complete) return null;
  return (
    <div className="rounded-2xl border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 p-4" data-testid="profile-incomplete-banner">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 rounded-xl bg-amber-500/20 text-amber-700 items-center justify-center shrink-0">
          <UserIcon className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-amber-900 dark:text-amber-100">
            Profile incomplete — finish it before adjusting this user
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-200/90 mt-1 leading-relaxed">
            Missing: <span className="font-mono font-bold">{profileStatus.missing.join(", ")}</span>.
            Ask the user to fill these in (Account → Profile) before you topup their wallet, assign a subscription, or reconcile.
          </p>
        </div>
      </div>
    </div>
  );
}

export function UserSnapshotCard({ user }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-12 w-12 rounded-2xl items-center justify-center bg-primary text-primary-foreground text-sm font-extrabold">
          {(user.name || user.email || "?").slice(0, 2).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-extrabold text-xl tracking-tight" data-testid="wallet-topup-user-name">{user.name || user.email || "Unnamed user"}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {user.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {user.phone}</span>}
            {user.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {user.email}</span>}
            {user.role && <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" /> {user.role}</span>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground font-bold">Wallet</p>
          <p className="font-display font-extrabold text-2xl tabular-nums" data-testid="wallet-topup-current-balance">₹{Number(user.wallet_balance || 0).toLocaleString("en-IN")}</p>
        </div>
      </div>
    </div>
  );
}

export function ReconcileCard({ profileBlocked, onReconcile }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="reconcile-card">
      <div className="flex items-start gap-2">
        <span className="inline-flex h-9 w-9 rounded-xl bg-amber-500/10 text-amber-600 items-center justify-center"><GitMerge className="h-4 w-4" /></span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-extrabold">Reconcile wallet ↔ meals</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Use when the wallet balance and meals-left have drifted apart (usually from a pre-iter-104 admin override).
            The system will re-sync them so <span className="font-mono">wallet ≈ meals_left × ₹/meal</span> again.
          </p>
        </div>
      </div>
      <div className="mt-3 grid sm:grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={() => onReconcile("meals")} disabled={profileBlocked} className="rounded-full" data-testid="reconcile-meals-truth">
          Trust meals · fix wallet
        </Button>
        <Button type="button" variant="outline" onClick={() => onReconcile("wallet")} disabled={profileBlocked} className="rounded-full" data-testid="reconcile-wallet-truth">
          Trust wallet · fix meals
        </Button>
      </div>
    </div>
  );
}

export function WalletHistoryCard({ history }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-extrabold">Recent adjustments</h3>
      </div>
      {!history ? (
        <p className="text-xs text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Loading…</p>
      ) : (history.overrides?.length === 0 && history.transactions?.length === 0) ? (
        <p className="text-xs text-muted-foreground">No transactions yet for this user.</p>
      ) : (
        <ul className="divide-y divide-border max-h-64 overflow-y-auto" data-testid="wallet-history-list">
          {(history.overrides || []).slice(0, 20).map((o) => (
            <li key={o.audit_id} className="py-2 flex items-start gap-2">
              <span className={`inline-flex h-6 w-6 rounded-full items-center justify-center shrink-0 ${o.delta >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
                {o.delta >= 0 ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold">
                  {o.delta >= 0 ? "+" : "−"}₹{Math.abs(o.delta).toLocaleString("en-IN")}
                  {o.extend_days ? ` · +${o.extend_days}d` : ""}
                  {(() => {
                    // iter-98: signed meals delta (positive=restored, negative=deducted)
                    const md = o.meals_delta ?? (o.restore_meals || 0);
                    if (!md) return null;
                    return md > 0 ? ` · +${md} meals` : ` · ${md} meals`;
                  })()}
                </p>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{o.reason}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(o.ts).toLocaleString("en-IN")} · by {o.admin_email}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
