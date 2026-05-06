import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Loader2, Wallet, Check, AlertCircle, MapPin, Phone as PhoneIcon, User as UserIcon, Sparkles, Receipt } from "lucide-react";

const PLATFORM_FEE_PCT = 2.0;

export default function Checkout() {
  const navigate = useNavigate();
  const { planId } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [plan, setPlan] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("idle");

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
  }, [planId, isCustom, days, navigate]);

  useEffect(() => {
    const next = isCustom ? `/checkout/custom?days=${days}` : `/checkout/${planId}`;
    if (user && (!user.name || !user.phone || !user.address || !user.photo_url)) {
      navigate(`/profile?next=${encodeURIComponent(next)}`);
    }
  }, [user, navigate, planId, isCustom, days]);

  const fees = useMemo(() => {
    if (!plan) return null;
    const base = Number(plan.amount);
    const fee = Math.round(base * PLATFORM_FEE_PCT) / 100;
    return { base, fee, total: Math.round((base + fee) * 100) / 100 };
  }, [plan]);

  const handlePay = async () => {
    setSubmitting(true); setStatus("creating");
    try {
      const orderRes = isCustom
        ? await api.post("/payments/custom-order", { days, service_type: customServiceType, tiffin_size: customTiffinSize })
        : await api.post("/payments/order", { plan_id: planId });
      const order = orderRes.data;

      if (order.mock) {
        setStatus("verifying");
        const verify = await api.post("/payments/verify", {
          order_id: order.order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock_signature",
        });
        if (verify.data.ok) { setStatus("success"); toast.success("Payment successful!"); setTimeout(() => navigate("/dashboard"), 1200); }
        else { setStatus("error"); toast.error("Verification failed"); }
      } else {
        await loadRazorpayScript();
        setStatus("paying");
        const options = {
          key: order.key_id, amount: order.amount_paise, currency: order.currency,
          order_id: order.order_id, name: "eFoodCare",
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
              if (verify.data.ok) { setStatus("success"); toast.success("Payment successful!"); setTimeout(() => navigate("/dashboard"), 1200); }
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
      toast.error(e?.response?.data?.detail || "Payment failed");
      if (e?.response?.status === 400 && /Profile incomplete/.test(e?.response?.data?.detail || "")) {
        const next = isCustom ? `/checkout/custom?days=${days}` : `/checkout/${planId}`;
        navigate(`/profile?next=${encodeURIComponent(next)}`);
      }
    } finally { setSubmitting(false); }
  };

  if (!plan || !user || !fees) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const perDay = (plan.amount / plan.duration_days).toFixed(0);
  const backNext = isCustom ? `/checkout/custom?days=${days}` : `/checkout/${planId}`;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10" data-testid="checkout-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">{isCustom && <Sparkles className="h-3.5 w-3.5" />} Checkout</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Review & pay</h1>

      <div className="mt-8 grid md:grid-cols-5 gap-6">
        <div className="md:col-span-3 bg-card rounded-2xl border border-border p-6">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Plan</p>
          <div className="mt-3 flex items-baseline justify-between">
            <h2 className="font-display font-extrabold text-2xl">{plan.name}</h2>
            <span className="font-display font-extrabold text-3xl">₹{fees.base.toFixed(0)}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
          <ul className="mt-5 space-y-2 text-sm">
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> {plan.meals} meals across {plan.duration_days} day{plan.duration_days > 1 ? "s" : ""}</li>
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> ₹{perDay} per day wallet deduction</li>
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Auto-pause on 3+ inactive days</li>
            {isCustom && <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Fixed price ₹70 per meal</li>}
          </ul>
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
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">{plan.name}</dt>
                <dd className="font-semibold tabular-nums">₹{fees.base.toFixed(2)}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">Platform fee ({PLATFORM_FEE_PCT}%)</dt>
                <dd className="font-semibold tabular-nums" data-testid="platform-fee">₹{fees.fee.toFixed(2)}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-3 mt-3">
                <dt className="font-semibold">Total payable</dt>
                <dd className="font-display font-extrabold text-xl tabular-nums" data-testid="total-payable">₹{fees.total.toFixed(2)}</dd>
              </div>
            </dl>
          </div>

          <div className="bg-primary text-primary-foreground rounded-2xl p-6" data-testid="wallet-preview">
            <Wallet className="h-5 w-5 text-primary-foreground/70" strokeWidth={1.75} />
            <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70 mt-3">Wallet load</p>
            <p className="font-display font-extrabold text-4xl mt-2 leading-none">₹{fees.base.toFixed(0)}</p>
            <p className="text-xs text-primary-foreground/80 mt-3">Ticks down by ₹{perDay}/day</p>
          </div>

          <div className="bg-secondary/10 border border-secondary/20 rounded-2xl p-4 text-sm flex items-start gap-3" data-testid="mock-payment-notice">
            <AlertCircle className="h-4 w-4 text-secondary mt-0.5 shrink-0" />
            <p className="text-secondary-foreground/80">
              <span className="font-bold">Razorpay demo mode.</span> Add <code className="bg-muted/60 px-1 rounded">RAZORPAY_KEY_ID</code> & <code className="bg-muted/60 px-1 rounded">SECRET</code> in backend .env to enable live UPI.
            </p>
          </div>

          <Button onClick={handlePay} disabled={submitting || status === "success"} data-testid="pay-button" className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 font-semibold text-base">
            {status === "idle" && `Pay ₹${fees.total.toFixed(2)}`}
            {status === "creating" && <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating order…</>}
            {status === "paying" && <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Opening Razorpay…</>}
            {status === "verifying" && <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Verifying…</>}
            {status === "success" && <><Check className="h-4 w-4 mr-2" /> Paid!</>}
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
