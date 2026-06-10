/**
 * AdminFranchiseOnboarding — iter-90.
 * One-tap form to promote a subscriber to a franchise owner and assign
 * them to a branch (mess). Calls PATCH /admin/messes/{mess_id}/owner with
 * {owner_phone}. Backend resolves the phone → user_id and promotes the
 * user to role=franchise_owner.
 */
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { UserPlus, Loader2, ShieldCheck, Building2, Phone, CheckCircle2 } from "lucide-react";

export default function AdminFranchiseOnboarding() {
  const [messes, setMesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [messId, setMessId] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/admin/messes");
        setMesses(r.data?.messes || []);
      } catch {
        toast.error("Could not load messes");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedMess = useMemo(
    () => messes.find((m) => m.mess_id === messId),
    [messId, messes],
  );

  const phoneDigits = phone.replace(/\D+/g, "");
  const canSubmit = phoneDigits.length === 10 && !!messId && !saving;

  const promote = async () => {
    if (!canSubmit) {
      toast.error("Enter a 10-digit phone and pick a branch");
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const res = await api.patch(`/admin/messes/${messId}/owner`, {
        owner_phone: phoneDigits,
      });
      const promoted = res?.data?.promoted_user_id;
      setResult({
        ok: true,
        user_id: promoted,
        mess: res?.data?.mess?.name || selectedMess?.name,
      });
      toast.success("Franchise owner assigned · ask them to LOG OUT and log back in.");
    } catch (e) {
      const detail = e?.response?.data?.detail || "Failed to assign owner";
      setResult({ ok: false, error: detail });
      toast.error(detail);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="franchise-onboarding-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · Franchise</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">
        Franchise onboarding
      </h1>
      <p className="text-muted-foreground mt-2 text-sm max-w-2xl">
        Promote a subscriber to franchise owner and assign them a branch in one click.
        The user must have logged in at least once via OTP on the app.
      </p>

      <div className="mt-6 max-w-2xl bg-card rounded-2xl border border-border p-5 sm:p-6 space-y-5" data-testid="franchise-onboarding-form">
        <div>
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" /> Franchise owner's 10-digit mobile
          </label>
          <Input
            type="tel"
            inputMode="numeric"
            maxLength={15}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9876543210"
            className="mt-1.5 h-11 text-base"
            data-testid="franchise-phone-input"
          />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            We'll look up the user by phone. They must already exist in the system (any role except admin/franchise_owner).
          </p>
        </div>

        <div>
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Assign to branch
          </label>
          {loading ? (
            <div className="mt-1.5 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading branches…
            </div>
          ) : (
            <select
              value={messId}
              onChange={(e) => setMessId(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              data-testid="franchise-mess-select"
            >
              <option value="">— Select a branch —</option>
              {messes.map((m) => (
                <option key={m.mess_id} value={m.mess_id}>
                  {m.name} · {m.city} {m.is_franchise ? "(franchise)" : "(corporate)"} {m.owner_user_id ? "· already owned" : ""}
                </option>
              ))}
            </select>
          )}
          {selectedMess?.owner_user_id && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">
              ⚠ This branch already has an owner. Assigning will replace them.
            </p>
          )}
        </div>

        <div className="pt-1 flex items-center gap-3">
          <Button
            onClick={promote}
            disabled={!canSubmit}
            className="rounded-full bg-primary h-11 px-6"
            data-testid="franchise-promote-btn"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
            Make franchise owner
          </Button>
          {result?.ok && (
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5" data-testid="franchise-promote-success">
              <CheckCircle2 className="h-4 w-4" /> Promoted to {result.mess}
            </span>
          )}
        </div>

        {result?.ok && result.user_id && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-sm">
            <p className="font-bold flex items-center gap-1.5 text-emerald-800 dark:text-emerald-200">
              <ShieldCheck className="h-4 w-4" /> Success
            </p>
            <p className="mt-1 text-emerald-800/90 dark:text-emerald-200/90">
              User <code className="bg-emerald-700/15 px-1 py-0.5 rounded text-xs">{result.user_id}</code> is now a franchise owner of <strong>{result.mess}</strong>.
            </p>
            <p className="text-[12px] text-emerald-800/80 dark:text-emerald-200/80 mt-1.5">
              Ask them to <strong>log out and log back in</strong> on their phone to load the Franchise Console at <code className="bg-emerald-700/15 px-1 py-0.5 rounded text-xs">/admin/control-tower</code>.
            </p>
          </div>
        )}
        {result?.ok === false && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-700 dark:text-red-300" data-testid="franchise-promote-error">
            {result.error}
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-muted-foreground max-w-2xl">
        Tip: after promoting, head to <a href="/admin/messes" className="underline">Messes & franchise</a> to control which admin pages this owner can access via the new <strong>Pages</strong> button.
      </p>
    </div>
  );
}
