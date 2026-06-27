// AdminWalletTopup — left column: search input + user picker list.
// Extracted from AdminWalletTopup.jsx (iter-122) — see /memory/PRD.md.
import React, { useMemo } from "react";
import { Input } from "../ui/input";
import { Loader2, Search, ChevronRight } from "lucide-react";

export default function UserSearchList({
  users, usersLoading, query, setQuery, selectedId, onPick,
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, 100);
    return users.filter((u) => (
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q)
    )).slice(0, 100);
  }, [users, query]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, phone or email…"
          className="pl-9 rounded-xl"
          data-testid="wallet-topup-search"
        />
      </div>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {usersLoading ? (
          <div className="p-6 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">No users match &quot;{query}&quot;</div>
        ) : (
          <ul className="max-h-[460px] overflow-y-auto divide-y divide-border" data-testid="wallet-topup-userlist">
            {filtered.map((u) => {
              const active = selectedId === u.user_id;
              return (
                <li key={u.user_id}>
                  <button
                    type="button"
                    onClick={() => onPick(u)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-muted/50 flex items-center gap-3 transition-colors ${active ? "bg-primary/8" : ""}`}
                    data-testid={`wallet-user-${u.user_id}`}
                  >
                    <span className={`inline-flex h-8 w-8 rounded-full items-center justify-center text-[10px] font-extrabold ${active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                      {(u.name || u.email || u.phone || "?").slice(0, 2).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{u.name || u.email || u.phone || u.user_id}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{u.phone || u.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground font-bold">Wallet</p>
                      <p className="text-sm font-display font-extrabold tabular-nums">₹{Number(u.wallet_balance || 0).toLocaleString("en-IN")}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Showing first 100 matches. Refine search to narrow further.</p>
    </div>
  );
}
