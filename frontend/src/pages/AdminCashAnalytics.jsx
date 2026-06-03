import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Loader2, Banknote, Building2, RefreshCw, Check, AlertTriangle, Upload } from "lucide-react";

/**
 * AdminCashAnalytics — iter-55 #11 + iter-56 #4
 * Stat tiles + bank-account CMS + deposit screenshot OCR verification.
 */
export default function AdminCashAnalytics() {
  const [totals, setTotals] = useState(null);
  const [pending, setPending] = useState([]);
  const [selected, setSelected] = useState({});
  const [utr, setUtr] = useState("");
  const [proof, setProof] = useState(null);
  const [bank, setBank] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [t, p, b] = await Promise.all([
        api.get("/admin/payments/cash-totals"),
        api.get("/admin/payments/cash-pending-deposit"),
        api.get("/admin/bank-account").catch(() => ({ data: null })),
      ]);
      setTotals(t.data);
      setPending(p.data.rows || []);
      setBank(b.data);
    } catch (e) { toast.error("Load failed"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = (oid) => setSelected({ ...selected, [oid]: !selected[oid] });
  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const selectedSum = pending.filter((r) => selected[r.order_id]).reduce((s, r) => s + Number(r.amount || 0), 0);

  const uploadProof = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { toast.error("Max 4 MB"); return; }
    const fd = new FormData(); fd.append("file", f);
    setUploading(true);
    try {
      const r = await api.post("/admin/payments/upload-deposit-proof", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setProof(r.data);
      toast.success("Screenshot uploaded");
    } catch (e) { toast.error(e?.response?.data?.detail || "Upload failed"); }
    setUploading(false);
    e.target.value = "";
  };

  const verifyDeposit = async () => {
    if (selectedIds.length === 0) { toast.error("Select at least one order"); return; }
    if (!utr.trim()) { toast.error("Enter UTR / reference"); return; }
    if (!proof?.url) { toast.error("Upload payment screenshot first"); return; }
    if (!bank?.account_no) { toast.error("Save your bank account details first"); return; }
    setSubmitting(true); setVerifyResult(null);
    try {
      const r = await api.post("/admin/payments/verify-deposit", {
        order_ids: selectedIds, utr: utr.trim(), screenshot_url: proof.url,
      });
      if (r.data.auto_approved) {
        toast.success(`Auto-verified · ${r.data.updated} orders deposited`);
        setSelected({}); setUtr(""); setProof(null);
        load();
      } else {
        setVerifyResult(r.data);
        toast.error("Mismatch — fix and try again");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Verification failed");
      setVerifyResult({ status: "error", message: e?.response?.data?.detail });
    }
    setSubmitting(false);
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const bankSaved = bank?.account_no;
  const deposited = (totals?.all_time || 0) - (totals?.pending_bank_deposit || 0);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6" data-testid="admin-cash-analytics">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs tracking-overline uppercase font-bold text-secondary">Payments</p>
          <h1 className="font-display font-extrabold text-xl sm:text-2xl md:text-3xl mt-1 leading-tight">Cash analytics & deposits</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Daily / monthly / yearly cash collected · pending vs. deposited in bank.</p>
        </div>
        <Button variant="outline" onClick={load} className="rounded-full" data-testid="refresh-btn"><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 sm:gap-3">
        <Stat label="Today" value={totals?.today} testid="cash-today" />
        <Stat label="This month" value={totals?.month} testid="cash-month" />
        <Stat label="This year" value={totals?.year} testid="cash-year" />
        <Stat label="Pending deposit" value={totals?.pending_bank_deposit} sub={`${totals?.pending_bank_deposit_count || 0} orders pending`} testid="cash-pending-bank" tone="warn" icon={AlertTriangle} />
        <Stat label="Deposited in bank" value={deposited} sub="reconciled total" testid="cash-deposited" icon={Building2} />
      </div>

      <BankAccountCard bank={bank} onSaved={(b) => setBank(b)} />

      <div className="rounded-2xl card-3d p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><Banknote className="h-4 w-4" /> Cash to deposit ({pending.length})</h2>
          {pending.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected(selectedIds.length === pending.length ? {} : Object.fromEntries(pending.map((r) => [r.order_id, true])))}>
              {selectedIds.length === pending.length && selectedIds.length > 0 ? "Clear all" : "Select all"}
            </Button>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3">No pending bank deposits — all collected cash is reconciled.</p>
        ) : (
          <>
            <div className="divide-y divide-border">
              {pending.map((r) => (
                <label key={r.order_id} className="py-2 flex items-center gap-3 cursor-pointer" data-testid={`pending-deposit-${r.order_id}`}>
                  <input type="checkbox" checked={!!selected[r.order_id]} onChange={() => toggle(r.order_id)} className="h-4 w-4" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{r.plan_name}</p>
                    <p className="text-[11px] text-muted-foreground">{r.customer_name} · {r.customer_phone} · slip {r.deposit_slip_no || "—"} · {r.collected_at?.slice(0, 10)}</p>
                    {r.deposit_status === "review" && <p className="text-[10px] text-red-700 font-bold mt-0.5">! Re-deposit needed — last verification failed</p>}
                  </div>
                  <span className="font-display font-bold tabular-nums whitespace-nowrap">₹{Number(r.amount).toFixed(0)}</span>
                </label>
              ))}
            </div>

            <div className="mt-5 border-t border-border pt-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
              <label className="block">
                <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">UTR / Reference #</span>
                <Input value={utr} onChange={(e) => setUtr(e.target.value.replace(/\s/g, ""))} placeholder="UTR12345..." className="mt-1 h-9 rounded-xl font-mono" data-testid="utr-input" />
              </label>
              <label className="block">
                <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Payment screenshot</span>
                <div className="mt-1 flex items-center gap-2">
                  <label className="inline-flex items-center gap-1 px-2.5 h-9 rounded-xl border border-input text-xs font-semibold cursor-pointer hover:bg-muted">
                    {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} {proof ? "Replace" : "Upload"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadProof} className="hidden" data-testid="proof-upload" />
                  </label>
                  {proof?.url && <img src={proof.url} alt="proof" className="h-9 w-9 rounded-md border border-border object-cover" data-testid="proof-thumb" />}
                </div>
              </label>
              <div className="text-right md:pl-3 md:border-l md:border-border">
                <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Selected total</p>
                <p className="font-display font-bold tabular-nums text-lg">₹{selectedSum.toFixed(0)}</p>
                <Button onClick={verifyDeposit} disabled={submitting || !bankSaved} className="rounded-full w-full mt-2" data-testid="verify-deposit-btn">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />} Verify & mark deposited
                </Button>
                {!bankSaved && <p className="text-[10px] text-amber-700 mt-1">Save bank details first</p>}
              </div>
            </div>

            {verifyResult && !verifyResult.auto_approved && (
              <div className="mt-3 rounded-xl border-2 border-destructive bg-destructive/5 p-3 text-sm" data-testid="verify-failure-box">
                <p className="font-bold text-destructive">Verification failed — re-deposit required.</p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-foreground/90 list-disc pl-5">
                  {(verifyResult.reasons || []).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                {verifyResult.message && <p className="mt-2 text-xs">{verifyResult.message}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BankAccountCard({ bank, onSaved }) {
  const [form, setForm] = useState({ holder_name: "", account_no: "", ifsc: "", bank_name: "" });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (bank) setForm({ holder_name: bank.holder_name || "", account_no: bank.account_no || "", ifsc: bank.ifsc || "", bank_name: bank.bank_name || "" }); }, [bank]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/admin/bank-account", form);
      toast.success("Bank details saved");
      onSaved?.(r.data);
      setEditing(false);
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    setSaving(false);
  };

  return (
    <div className="rounded-2xl card-3d p-5" data-testid="bank-account-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><Building2 className="h-4 w-4" /> Company bank account</h2>
          <p className="text-xs text-muted-foreground">Used to auto-verify deposit screenshots — last 4 digits must match the OCR text.</p>
        </div>
        {!editing && bank?.account_no && (
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditing(true)}>Edit</Button>
        )}
      </div>
      {(!bank?.account_no || editing) ? (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input value={form.holder_name} onChange={(e) => setForm({ ...form, holder_name: e.target.value })} placeholder="Account holder name" className="rounded-xl" data-testid="bank-holder" />
          <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="Bank name (e.g. HDFC)" className="rounded-xl" data-testid="bank-name" />
          <Input value={form.account_no} onChange={(e) => setForm({ ...form, account_no: e.target.value.replace(/\D/g, "").slice(0, 24) })} placeholder="Account number" className="rounded-xl font-mono" data-testid="bank-account-no" />
          <Input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase().slice(0, 20) })} placeholder="IFSC" className="rounded-xl font-mono" data-testid="bank-ifsc" />
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={save} disabled={saving} className="rounded-full" data-testid="bank-save">{saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />} Save</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-sm grid grid-cols-2 gap-2">
          <p><span className="text-[10px] uppercase tracking-overline text-muted-foreground block">Holder</span>{bank.holder_name}</p>
          <p><span className="text-[10px] uppercase tracking-overline text-muted-foreground block">Bank</span>{bank.bank_name}</p>
          <p className="font-mono"><span className="text-[10px] uppercase tracking-overline text-muted-foreground block font-sans">Account</span>{"\u2022".repeat(4)} {bank.account_last4}</p>
          <p className="font-mono"><span className="text-[10px] uppercase tracking-overline text-muted-foreground block font-sans">IFSC</span>{bank.ifsc}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, tone, testid }) {
  const ring = tone === "warn" ? "card-3d card-3d-amber" : "card-3d";
  return (
    <div className={`p-3 sm:p-4 ${ring}`} data-testid={testid}>
      <div className="flex items-center justify-between gap-1">
        <p className="text-[9px] sm:text-[10px] tracking-overline uppercase font-bold text-muted-foreground truncate">{label}</p>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </div>
      <p className="font-display font-extrabold text-lg sm:text-2xl tabular-nums mt-1 leading-tight">{"\u20B9"}{Number(value || 0).toFixed(0)}</p>
      {sub && <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-1 leading-tight">{sub}</p>}
    </div>
  );
}
