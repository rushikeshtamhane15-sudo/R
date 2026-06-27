// AdminWalletTopup — manual subscription assignment block.
import React from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  ClipboardList, Loader2, ShieldCheck, Package,
} from "lucide-react";

export default function AssignSubscriptionCard({
  plans,
  assignOpen, setAssignOpen,
  assignMode, setAssignMode,
  assignPlanId, onPickPlan,
  assignName, setAssignName,
  assignDays, setAssignDays,
  assignMeals, setAssignMeals,
  assignAmount, setAssignAmount,
  assignService, setAssignService,
  assignStartDate, setAssignStartDate,
  assignReason, setAssignReason,
  assigning, profileBlocked, onApply,
}) {
  const disabled = assigning || !assignReason.trim() || (assignMode === "plan" && !assignPlanId) || profileBlocked;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="assign-sub-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 rounded-xl bg-indigo-500/10 text-indigo-600 items-center justify-center"><ClipboardList className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-extrabold">Assign subscription manually</h3>
            <p className="text-[11px] text-muted-foreground">For walk-in / cash customers who can&apos;t use the app themselves.</p>
          </div>
        </div>
        <Button
          type="button"
          variant={assignOpen ? "outline" : "default"}
          size="sm"
          className="rounded-full"
          onClick={() => setAssignOpen((v) => !v)}
          data-testid="assign-sub-toggle"
        >
          {assignOpen ? "Close" : "Open"}
        </Button>
      </div>

      {assignOpen && (
        <div className="mt-4 space-y-3" data-testid="assign-sub-form">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAssignMode("plan")}
              className={`rounded-xl border-2 px-3 py-2 text-xs font-extrabold transition-colors ${assignMode === "plan" ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-border hover:border-indigo-400"}`}
              data-testid="assign-mode-plan"
            >From existing plan</button>
            <button
              type="button"
              onClick={() => setAssignMode("custom")}
              className={`rounded-xl border-2 px-3 py-2 text-xs font-extrabold transition-colors ${assignMode === "custom" ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-border hover:border-indigo-400"}`}
              data-testid="assign-mode-custom"
            >Custom plan</button>
          </div>

          {assignMode === "plan" && (
            <div>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground inline-flex items-center gap-1"><Package className="h-3 w-3" /> Pick a plan</p>
              <select
                value={assignPlanId}
                onChange={(e) => onPickPlan(e.target.value)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                data-testid="assign-plan-select"
              >
                <option value="">— Select an active plan —</option>
                {plans.filter((p) => p.active !== false).map((p) => (
                  <option key={p.plan_id} value={p.plan_id}>
                    {p.name} · {p.duration_days}d · {p.meals} meals · ₹{p.amount}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">You can still tweak days / meals / amount below if this customer&apos;s deal is non-standard.</p>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Plan name</p>
              <Input value={assignName} onChange={(e) => setAssignName(e.target.value.slice(0, 80))} className="mt-1 rounded-xl" placeholder="e.g. Walk-in 30 day" data-testid="assign-name-input" />
            </div>
            <div>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Service type</p>
              <select
                value={assignService}
                onChange={(e) => setAssignService(e.target.value)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                data-testid="assign-service-select"
              >
                <option value="dining">Dining (eat-in)</option>
                <option value="tiffin">Tiffin (home delivery)</option>
              </select>
            </div>
            <div>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Duration (days)</p>
              <Input type="number" min={1} max={365} value={assignDays} onChange={(e) => setAssignDays(e.target.value)} className="mt-1 rounded-xl" data-testid="assign-days-input" />
            </div>
            <div>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Total meals</p>
              <Input type="number" min={1} max={2000} value={assignMeals} onChange={(e) => setAssignMeals(e.target.value)} className="mt-1 rounded-xl" data-testid="assign-meals-input" />
            </div>
            <div>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Amount (₹)</p>
              <Input type="number" min={0} step="1" value={assignAmount} onChange={(e) => setAssignAmount(e.target.value)} className="mt-1 rounded-xl" data-testid="assign-amount-input" />
            </div>
            <div>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Start date (optional)</p>
              <Input type="date" value={assignStartDate} onChange={(e) => setAssignStartDate(e.target.value)} className="mt-1 rounded-xl" data-testid="assign-startdate-input" />
            </div>
          </div>

          <div>
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Reason (audit log)</p>
            <Input
              value={assignReason}
              onChange={(e) => setAssignReason(e.target.value.slice(0, 500))}
              placeholder="e.g. cash paid to manager · walk-in onboarded"
              className="mt-1 rounded-xl"
              maxLength={500}
              data-testid="assign-reason-input"
            />
          </div>

          <p className="text-[10px] text-muted-foreground">
            Any existing active subscription on this user will be marked expired and replaced.
            ₹{Number(assignAmount || 0).toLocaleString("en-IN")} will be credited to their wallet, and they&apos;ll see an in-app notice on next login.
          </p>

          <Button
            onClick={onApply}
            disabled={disabled}
            className="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white w-full h-10"
            data-testid="assign-apply-button"
          >
            {assigning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            {assigning ? "Assigning…" : `Assign · ₹${Number(assignAmount || 0).toLocaleString("en-IN")} / ${assignDays || 0}d / ${assignMeals || 0} meals`}
          </Button>
        </div>
      )}
    </div>
  );
}
