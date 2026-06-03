import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Loader2, Wallet, Check, AlertCircle, MapPin, Phone as PhoneIcon, User as UserIcon, Sparkles, Receipt, Banknote, CreditCard, SplitSquareHorizontal, Clock } from "lucide-react";

const PLATFORM_FEE_PCT = 2.0;
const MIN_PARTIAL_FRACTION = 0.5;

export default function Checkout() {
  const navigate = useNavigate();
  const { planId } = useParams();
  const [params] = useSearchParams();
  const { user, checkAuth } = useAuth();
  const [plan, setPlan] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("idle");

  // Payment mode: "online_full" | "partial" | "cash"
  const [payMode, setPayMode] = useState("online_full");
  const [partialDown, setPartialDown] = useState(0);
  // Cash success state
  const [cashSuccess, setCashSuccess] = useState(null); // {order_id, dev_otp, amount}

  const isCustom = planId === "custom";
  const days = isCustom ? Math.max(1, Math.min(90, Number(params.get("days") || 1))) : null;
  const customServiceType = isCustom ? (params.get("service") || "dining") : null;
  const customTiffinSize = isCustom ? (params.get("tiffin_size") || "full") : null;

  useEffect(() => {
    if (isCustom) {
      (async () => {
        try {
          const r = await api.get(`/plans/custom/preview?days=${days}&service_type=${customServiceType}${customTiffinSize ? `&tiffin_size=${customTiffinSize}` : ""}`);
          const label = customServiceType === "tiffin" ? `Custom ${customTiffinSize === "half" ? "Half" : "Full"} Tiffin` : "Custom Dining";
          setPlan({
            plan_id: `custom_${customServiceType}_${days}d`,
            name: `${label} — ${days} day${days > 1 ? "s" : ""}`,
            description: `${r.data.meals} meals across ${days} day${days > 1 ? "s" : ""} · pay ₹${r.data.meal_price} per meal`,
            amount: r.data.amount,
            currency: "INR",
            duration_days: days,
            meals: r.data.meals,
          });
        } catch { toast.error("Could not load custom plan"); navigate("/plans"); }
      })();
    } else {
      (async () => {
        try {
          const r = await api.get("/plans");
          const found = r.data.plans.find((p) => p.plan_id === planId);
          if (!found) { toast.error("Plan not found"); navigate("/plans"); return; }
          setPlan(found);
        } catch { toast.error("Could not load plan"); }
      })();
    }
  }, [planId, isCustom, days, navigate, customServiceType, customTiffinSize]);

  useEffect(() => {
    const next = isCustom ? `/checkout/custom?days=${days}` : `/checkout/${planId}`;
    if (user && (!user.name || !user.phone || !user.address || !user.photo_url)) {
      navigate(`/profile?next=${encodeURIComponent(next)}`);
    }
  }, [user, navigate, planId, isCustom, days]);

  const fees = useMemo(() => {
    if (!plan) return null;
    const base = Number(plan.amount);
    const minDown = Math.ceil(base * MIN_PARTIAL_FRACTION);
    return { base, minDown };
  }, [plan]);

  // For mix mode
  const [mixOnline, setMixOnline] = useState(0);
  const [mixCash, setMixCash] = useState(0);

  useEffect(() => {
    if (payMode === "mix" && fees) {
      // Init: 50/50 split as a sensible default
      const half = Math.round(fees.base / 2);
      setMixOnline(half);
      setMixCash(fees.base - half);
    }
  }, [payMode, fees]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Initialise partial-down to min when user toggles to partial
  useEffect(() => {
    if (payMode === "partial" && fees && (!partialDown || partialDown < fees.minDown)) {
      setPartialDown(fees.minDown);
    }
  }, [payMode, fees]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveBase = useMemo(() => {
    if (!fees) return 0;
    if (payMode === "partial") return Math.max(fees.minDown, Math.min(Number(partialDown || 0), fees.base));
    return fees.base;
  }, [payMode, partialDown, fees]);

  const finalFees = useMemo(() => {
    if (!fees) return null;
    const base = payMode === "partial" ? effectiveBase : fees.base;
    const fee = Math.round(base * PLATFORM_FEE_PCT) / 100;
    const total = Math.round((base + fee) * 100) / 100;
    // Iter-54 #2: ₹200 partial surcharge added to pending balance
    const PARTIAL_SURCHARGE = 200;
    const surcharge = payMode === "partial" ? PARTIAL_SURCHARGE : 0;
    const pending = payMode === "partial" ? Math.max(0, Math.round((fees.base - base) * 100) / 100) + surcharge : 0;
    return { base, fee, total, pending, surcharge, planTotal: fees.base };
  }, [fees, effectiveBase, payMode]);

  // ---- Submit handlers ----
  const submitCash = async () => {
    setSubmitting(true); setStatus("creating");
    try {
      const body = isCustom
        ? { days, service_type: customServiceType, tiffin_size: customTiffinSize }
        : { plan_id: planId };
      const r = await api.post("/payments/cash-order", body);
      setCashSuccess({ order_id: r.data.order_id, dev_otp: r.data.dev_otp, amount: r.data.amount, plan_name: r.data.plan_name });
      setStatus("success");
      toast.success("Cash order created · staff will collect cash");
    } catch (e) {
      setStatus("error");
      const detail = e?.response?.data?.detail || "Could not create cash order";
      toast.error(detail);
      const next = isCustom ? `/checkout/custom?days=${days}` : `/checkout/${planId}`;
      if (e?.response?.status === 400 && /Profile incomplete/i.test(detail)) {
        navigate(`/profile?next=${encodeURIComponent(next)}`);
      } else if (e?.response?.status === 400 && /(service area|pin your delivery|cannot deliver)/i.test(detail)) {
        setTimeout(() => navigate(`/profile?next=${encodeURIComponent(next)}&pickLocation=1`), 800);
      }
    } finally { setSubmitting(false); }
  };

  const submitOnline = async () => {
    setSubmitting(true); setStatus("creating");
    try {
      let orderRes;
      if (payMode === "mix") {
        const body = isCustom
          ? { days, service_type: customServiceType, tiffin_size: customTiffinSize, online_amount: mixOnline, cash_amount: mixCash }
          : { plan_id: planId, online_amount: mixOnline, cash_amount: mixCash };
        orderRes = await api.post("/payments/mix-order", body);
      } else if (payMode === "partial") {
        const body = isCustom
          ? { days, service_type: customServiceType, tiffin_size: customTiffinSize, down_payment: effectiveBase }
          : { plan_id: planId, down_payment: effectiveBase };
        orderRes = await api.post("/payments/partial-order", body);
      } else {
        orderRes = isCustom
          ? await api.post("/payments/custom-order", { days, service_type: customServiceType, tiffin_size: customTiffinSize })
          : await api.post("/payments/order", { plan_id: planId });
      }
      const order = orderRes.data;
      if (order.mock) {
        setStatus("verifying");
        const verify = await api.post("/payments/verify", {
          order_id: order.order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock_signature",
        });
        if (verify.data.ok) { setStatus("success"); toast.success("Payment successful!"); await checkAuth?.(); setTimeout(() => navigate("/dashboard"), 1200); }
        else { setStatus("error"); toast.error("Verification failed"); }
      } else {
        await loadRazorpayScript();
        setStatus("paying");
        const options = {
          key: order.key_id, amount: order.amount_paise, currency: order.currency,
          order_id: order.order_id, name: "efoodcare",
          description: `${order.plan_name} — ghar se achha khana`,
          prefill: order.prefill, theme: { color: "#a02323" },
          handler: async (res) => {
            setStatus("verifying");
            try {
              const verify = await api.post("/payments/verify", {
                order_id: res.razorpay_order_id,
                razorpay_payment_id: res.razorpay_payment_id,
                razorpay_signature: res.razorpay_signature,
              });
              if (verify.data.ok) { setStatus("success"); toast.success("Payment successful!"); await checkAuth?.(); setTimeout(() => navigate("/dashboard"), 1200); }
              else { setStatus("error"); toast.error("Verification failed"); }
            } catch (e) { setStatus("error"); toast.error(e?.response?.data?.detail || "Verification failed"); }
          },
          modal: { ondismiss: () => { setStatus("idle"); setSubmitting(false); } },
        };
        const rzp = new window.Razorpay(options);
        rzp.open();
      }
    } catch (e) {
      setStatus("error");
      const detail = e?.response?.data?.detail || "Payment failed";
      toast.error(detail);
      const next = isCustom ? `/checkout/custom?days=${days}` : `/checkout/${planId}`;
      if (e?.response?.status === 400 && /Profile incomplete/i.test(detail)) {
        navigate(`/profile?next=${encodeURIComponent(next)}`);
      } else if (e?.response?.status === 400 && /(service area|pin your delivery|cannot deliver)/i.test(detail)) {
        setTimeout(() => navigate(`/profile?next=${encodeURIComponent(next)}&pickLocation=1`), 800);
      }
    } finally { setSubmitting(false); }
  };

  const handlePay = () => (payMode === "cash" ? submitCash() : submitOnline());

  if (!plan || !user || !finalFees) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  if (cashSuccess) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-14 text-center" data-testid="cash-pending-confirm">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:p-8">
          <Clock className="h-10 w-10 text-amber-600 mx-auto" />
          <h1 className="font-display font-extrabold text-xl sm:text-2xl mt-3 text-amber-900">Cash payment pending</h1>
          <p className="text-sm text-amber-800 mt-2">Hand over <span className="font-bold">₹{cashSuccess.amount?.toFixed?.(2)}</span> cash to our staff.</p>
          <div className="mt-4 rounded-xl bg-white border border-amber-200 p-3 sm:p-4 text-left text-sm">
            <p className="text-[10px] sm:text-xs uppercase tracking-overline font-bold text-amber-700">Your OTP (share with staff)</p>
            <p className="font-display font-extrabold text-2xl sm:text-3xl tabular-nums mt-1 text-amber-900" data-testid="cash-otp">{cashSuccess.dev_otp || "Sent on WhatsApp / SMS"}</p>
            <p className="text-[11px] text-muted-foreground mt-2 break-all">Order id: <span className="font-mono">{cashSuccess.order_id}</span></p>
          </div>
          <Button onClick={() => navigate("/dashboard")} className="rounded-full mt-6" data-testid="cash-go-dashboard">Go to dashboard</Button>
        </div>
      </div>
    );
  }

  const perDay = (plan.amount / plan.duration_days).toFixed(0);
  const backNext = isCustom ? `/checkout/custom?days=${days}` : `/checkout/${planId}`;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10" data-testid="checkout-page">
      <p className="text-[10px] sm:text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">{isCustom && <Sparkles className="h-3.5 w-3.5" />} Checkout</p>
      <h1 className="font-display font-extrabold text-2xl sm:text-3xl md:text-4xl tracking-tight mt-2">Review & pay</h1>

      <div className="mt-6 sm:mt-8 grid md:grid-cols-5 gap-4 sm:gap-6">
        <div className="md:col-span-3 bg-card rounded-2xl border border-border p-4 sm:p-6">
          <p className="text-[10px] sm:text-xs tracking-overline uppercase font-bold text-muted-foreground">Plan</p>
          <div className="mt-3 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-3">
            <h2 className="font-display font-extrabold text-2xl break-words">{plan.name}</h2>
            <span className="font-display font-extrabold text-3xl whitespace-nowrap">₹{fees.base.toFixed(0)}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
          <ul className="mt-5 space-y-2 text-sm">
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> {plan.meals} meals across {plan.duration_days} day{plan.duration_days > 1 ? "s" : ""}</li>
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> ₹{perDay} per day wallet deduction</li>
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Auto-pause on 3+ inactive days</li>
          </ul>

          {/* Payment mode selector */}
          <div className="mt-6 border-t border-border pt-5" data-testid="payment-mode">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Payment mode</p>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: "online_full", label: "Pay fully online", icon: CreditCard, hint: "UPI, card, netbanking" },
                { id: "partial",     label: "Pay 50%+ now",     icon: SplitSquareHorizontal, hint: "Online · settle rest later" },
                { id: "mix",         label: "Mix online + cash", icon: SplitSquareHorizontal, hint: "Split payment in one go" },
                { id: "cash",        label: "Pay in cash",     icon: Banknote, hint: "Hand cash to staff with OTP" },
              ].map((m) => (
                <button key={m.id} type="button" onClick={() => setPayMode(m.id)}
                  data-testid={`pay-mode-${m.id}`}
                  className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${payMode === m.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                  <m.icon className={`h-4 w-4 ${payMode === m.id ? "text-primary" : "text-muted-foreground"}`} />
                  <p className="font-semibold text-xs mt-1.5">{m.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{m.hint}</p>
                </button>
              ))}
            </div>

            {payMode === "mix" && fees && (
              <div className="mt-4 rounded-xl bg-muted/30 border border-border p-4" data-testid="mix-block">
                <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Mix online + cash</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Online now</span>
                    <Input type="number" min={1} max={fees.base - 1} value={mixOnline}
                           onChange={(e) => {
                             const v = Math.max(1, Math.min(fees.base - 1, Number(e.target.value) || 0));
                             setMixOnline(v);
                             setMixCash(Math.round((fees.base - v) * 100) / 100);
                           }}
                           className="mt-1 rounded-xl tabular-nums" data-testid="mix-online-input" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Cash to staff (via OTP)</span>
                    <Input type="number" min={1} max={fees.base - 1} value={mixCash}
                           onChange={(e) => {
                             const v = Math.max(1, Math.min(fees.base - 1, Number(e.target.value) || 0));
                             setMixCash(v);
                             setMixOnline(Math.round((fees.base - v) * 100) / 100);
                           }}
                           className="mt-1 rounded-xl tabular-nums" data-testid="mix-cash-input" />
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Pay ₹{Number(mixOnline).toFixed(0)} online + ₹{Number(mixCash).toFixed(0)} cash to staff via OTP. Total ₹{fees.base.toFixed(0)}.
                  Cash portion gets ₹200 partial-payment surcharge added to your pending balance.
                </p>
              </div>
            )}

            {payMode === "partial" && (
              <div className="mt-4 rounded-xl bg-muted/30 border border-border p-4" data-testid="partial-down-block">
                <label className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Down payment now (any amount ≥ 50%)</label>
                <div className="mt-2 flex items-center gap-3">
                  <Input
                    type="number"
                    min={fees.minDown}
                    max={fees.base}
                    value={partialDown}
                    onChange={(e) => setPartialDown(Math.max(fees.minDown, Math.min(fees.base, Number(e.target.value) || 0)))}
                    className="rounded-xl font-display font-bold text-lg w-36"
                    data-testid="partial-down-input"
                  />
                  <input
                    type="range"
                    min={fees.minDown}
                    max={fees.base}
                    step={50}
                    value={partialDown}
                    onChange={(e) => setPartialDown(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Minimum ₹{fees.minDown.toFixed(0)} (50% of ₹{fees.base.toFixed(0)}). Pending ₹{(fees.base - effectiveBase).toFixed(0)} can be settled later online or in cash.</p>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Delivery details</p>
            <div className="mt-3 space-y-2 text-sm">
              <p className="flex items-center gap-2"><UserIcon className="h-3.5 w-3.5 text-muted-foreground" /> {user.name}</p>
              <p className="flex items-center gap-2"><PhoneIcon className="h-3.5 w-3.5 text-muted-foreground" /> {user.phone}</p>
              <p className="flex items-start gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground mt-1" /> <span className="whitespace-pre-line">{user.address}</span></p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate(`/profile?next=${encodeURIComponent(backNext)}`)} className="rounded-full mt-3" data-testid="edit-profile-button">Edit</Button>
          </div>
        </div>

        <div className="md:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-2xl p-5" data-testid="bill-summary">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5" /> Bill summary
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground break-words min-w-0">{plan.name}</dt>
                <dd className="font-semibold tabular-nums whitespace-nowrap">₹{finalFees.planTotal.toFixed(2)}</dd>
              </div>
              {payMode === "partial" && (
                <>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-muted-foreground">Paying now</dt>
                    <dd className="font-semibold tabular-nums text-primary" data-testid="partial-now-amt">₹{finalFees.base.toFixed(2)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-muted-foreground">Partial-payment surcharge</dt>
                    <dd className="font-semibold tabular-nums text-amber-800" data-testid="partial-surcharge">+ ₹{finalFees.surcharge.toFixed(2)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-muted-foreground">Pending balance (incl. surcharge)</dt>
                    <dd className="font-semibold tabular-nums text-amber-700" data-testid="partial-pending-amt">₹{finalFees.pending.toFixed(2)}</dd>
                  </div>
                </>
              )}
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">Platform fee ({PLATFORM_FEE_PCT}%)</dt>
                <dd className="font-semibold tabular-nums" data-testid="platform-fee">₹{finalFees.fee.toFixed(2)}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-3 mt-3">
                <dt className="font-semibold">{payMode === "cash" ? "Cash to hand over" : "Total payable now"}</dt>
                <dd className="font-display font-extrabold text-xl tabular-nums" data-testid="total-payable">₹{finalFees.total.toFixed(2)}</dd>
              </div>
            </dl>
          </div>

          <div className="bg-primary text-primary-foreground rounded-2xl p-6" data-testid="wallet-preview">
            <Wallet className="h-5 w-5 text-primary-foreground/70" strokeWidth={1.75} />
            <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70 mt-3">Wallet load</p>
            <p className="font-display font-extrabold text-4xl mt-2 leading-none">₹{finalFees.base.toFixed(0)}</p>
            <p className="text-xs text-primary-foreground/80 mt-3">Ticks down by ₹{perDay}/day</p>
          </div>

          {user?.role === "admin" && (
            <div className="bg-secondary/10 border border-secondary/20 rounded-2xl p-4 text-sm flex items-start gap-3" data-testid="mock-payment-notice">
              <AlertCircle className="h-4 w-4 text-secondary mt-0.5 shrink-0" />
              <p className="text-secondary-foreground/80">
                <span className="font-bold">Razorpay demo mode.</span> Add <code className="bg-muted/60 px-1 rounded">RAZORPAY_KEY_ID</code> & <code className="bg-muted/60 px-1 rounded">SECRET</code> in backend .env to enable live UPI.
              </p>
            </div>
          )}

          <Button onClick={handlePay} disabled={submitting || status === "success"} data-testid="pay-button" className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 font-semibold text-base">
            {status === "idle" && (payMode === "cash" ? `Confirm cash · ₹${finalFees.total.toFixed(0)}` : `Pay ₹${finalFees.total.toFixed(2)}`)}
            {status === "creating" && <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating order…</>}
            {status === "paying" && <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Opening Razorpay…</>}
            {status === "verifying" && <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Verifying…</>}
            {status === "success" && <><Check className="h-4 w-4 mr-2" /> Done!</>}
            {status === "error" && "Retry"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
}
