import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Loader2, Banknote, KeyRound, Send, UserCheck, RefreshCw } from "lucide-react";

/**
 * AdminCashCollections — admin/staff can:
 *   - See pending cash orders + customer details
 *   - Assign a specific staff (admin-only)
 *   - Resend OTP
 *   - Verify OTP & collect cash (admin OR staff)
 */
export default function AdminCashCollections() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [me, setMe] = useState(null);

  // Per-row UI state
  const [otpInputs, setOtpInputs] = useState({});  // {order_id: "1234"}
  const [slipInputs, setSlipInputs] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const [list, staffR, meR] = await Promise.all([
        api.get("/admin/payments/pending-cash"),
        api.get("/admin/payments/staff-roster").catch(() => ({ data: { staff: [] } })),
        api.get("/auth/me").catch(() => ({ data: null })),
      ]);
      setRows(list.data.rows || []);
      setCount(list.data.count || 0);
      setTotal(list.data.total_amount || 0);
      setStaff(staffR.data.staff || []);
      setMe(meR.data);
    } catch (e) { toast.error("Load failed"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const isAdmin = me?.role === "admin";

  const assign = async (orderId, staffId) => {
    if (!staffId) return;
    try {
      await api.post("/admin/payments/cash-collect/assign", { order_id: orderId, staff_user_id: staffId });
      toast.success("Staff assigned");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Assign failed"); }
  };

  const resend = async (orderId) => {
    try {
      const r = await api.post("/admin/payments/cash-collect/resend-otp", { order_id: orderId });
      toast.success(`OTP resent${r.data.dev_otp ? ` · DEV OTP=${r.data.dev_otp}` : ""}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Resend failed"); }
  };

  const verify = async (orderId) => {
    const otp = (otpInputs[orderId] || "").trim();
    if (!otp || otp.length !== 6) { toast.error("Enter 6-digit OTP"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/staff/cash-collect/verify-otp", {
        order_id: orderId,
        otp,
        deposit_slip_no: (slipInputs[orderId] || "").trim() || null,
      });
      toast.success(`Cash collected · Slip ${r.data.deposit_slip_no}`);
      setOtpInputs({ ...otpInputs, [orderId]: "" });
      setSlipInputs({ ...slipInputs, [orderId]: "" });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Verify failed"); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 sm:p-8 space-y-6" data-testid="admin-cash-collections">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary">Payments</p>
          <h1 className="font-display font-extrabold text-3xl mt-1">Pending cash collections</h1>
          <p className="text-sm text-muted-foreground mt-1">Collect cash from subscribers and verify with their OTP. {isAdmin ? "" : "Staff view — assign-action disabled for staff."}</p>
        </div>
        <Button variant="outline" onClick={load} className="rounded-full" data-testid="refresh-btn"><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4" data-testid="stat-count">
          <p className="text-[11px] tracking-overline uppercase font-bold text-muted-foreground">Pending</p>
          <p className="font-display font-extrabold text-3xl tabular-nums mt-1">{count}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4" data-testid="stat-total">
          <p className="text-[11px] tracking-overline uppercase font-bold text-muted-foreground">Total cash to collect</p>
          <p className="font-display font-extrabold text-3xl tabular-nums mt-1">₹{(total || 0).toFixed(0)}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center text-muted-foreground py-10" data-testid="empty">No pending cash orders.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.order_id} className="rounded-2xl border border-border bg-card p-5" data-testid={`cash-row-${r.order_id}`}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="min-w-0">
                  <p className="font-display font-bold text-lg">{r.plan_name}</p>
                  <p className="text-sm text-muted-foreground">{r.customer_name} · <a href={`tel:${r.customer_phone}`} className="underline">{r.customer_phone}</a></p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Order {r.order_id} · {r.created_at?.slice(0, 10)}</p>
                  {r.assigned_staff_name && (
                    <p className="text-xs mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-secondary/10 text-secondary px-2 py-0.5"><UserCheck className="h-3 w-3" /> Assigned: {r.assigned_staff_name}</p>
                  )}
                </div>
                <span className="font-display font-extrabold text-2xl tabular-nums text-primary"><Banknote className="inline h-5 w-5 mr-1" />₹{Number(r.amount).toFixed(0)}</span>
              </div>

              <div className="mt-4 grid md:grid-cols-3 gap-2 items-end">
                {isAdmin && (
                  <div className="md:col-span-1">
                    <label className="block text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Assign staff</label>
                    <select className="w-full mt-1 h-9 rounded-xl border border-input bg-background px-2 text-sm" defaultValue={r.assigned_staff_id || ""} onChange={(e) => assign(r.order_id, e.target.value)} data-testid={`assign-${r.order_id}`}>
                      <option value="">— select —</option>
                      {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name || s.phone} ({s.role})</option>)}
                    </select>
                  </div>
                )}
                <div className={isAdmin ? "md:col-span-1" : "md:col-span-2"}>
                  <label className="block text-[10px] tracking-overline uppercase font-bold text-muted-foreground">OTP (subscriber's)</label>
                  <Input
                    inputMode="numeric" maxLength={6}
                    value={otpInputs[r.order_id] || ""}
                    onChange={(e) => setOtpInputs({ ...otpInputs, [r.order_id]: e.target.value.replace(/\D/g, "") })}
                    placeholder="6-digit OTP"
                    className="h-9 rounded-xl mt-1 font-display tracking-widest text-center"
                    data-testid={`otp-input-${r.order_id}`}
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="block text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Slip # (opt.)</label>
                  <Input value={slipInputs[r.order_id] || ""} onChange={(e) => setSlipInputs({ ...slipInputs, [r.order_id]: e.target.value })} className="h-9 rounded-xl mt-1" placeholder="auto" data-testid={`slip-input-${r.order_id}`} />
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <Button onClick={() => verify(r.order_id)} disabled={submitting} className="rounded-full" data-testid={`verify-${r.order_id}`}>
                  <KeyRound className="h-3.5 w-3.5 mr-1.5" /> Verify & collect
                </Button>
                <Button onClick={() => resend(r.order_id)} variant="outline" className="rounded-full" data-testid={`resend-${r.order_id}`}>
                  <Send className="h-3.5 w-3.5 mr-1.5" /> Resend OTP
                </Button>
                {(r.cash_otp_attempts || 0) > 0 && (
                  <span className="text-[11px] text-muted-foreground">Attempts: {r.cash_otp_attempts}/5</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
