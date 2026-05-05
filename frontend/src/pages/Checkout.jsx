import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Loader2, Check, AlertCircle, MapPin, Phone as PhoneIcon, User as UserIcon, Sparkles, ScanLine, Smartphone, IndianRupee, RefreshCw } from "lucide-react";

export default function Checkout() {
  const navigate = useNavigate();
  const { planId } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [plan, setPlan] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | creating | awaiting | success | error
  const [order, setOrder] = useState(null); // { order_id, qr_image_base64, qr_data, amount, mock, auto_success_in_secs }
  const [seconds, setSeconds] = useState(null);
  const pollRef = useRef(null);
  const timerRef = useRef(null);

  const isCustom = planId === "custom";
  const days = isCustom ? Math.max(1, Math.min(90, Number(params.get("days") || 1))) : null;

  useEffect(() => {
    if (isCustom) {
      (async () => {
        try {
          const r = await api.get(`/plans/custom/preview?days=${days}`);
          setPlan({
            plan_id: `custom_${days}d`,
            name: `Custom — ${days} day${days > 1 ? "s" : ""}`,
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

  // Cleanup any running timers when component unmounts or order resets
  useEffect(() => () => stopPolling(), []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const startCheckout = async () => {
    setSubmitting(true); setStatus("creating");
    try {
      const r = isCustom
        ? await api.post("/payments/paytm/custom-order", { days })
        : await api.post("/payments/paytm/order", { plan_id: planId });
      setOrder(r.data);
      setStatus("awaiting");
      setSeconds(r.data.expires_in_seconds || 900);

      // Countdown tick
      timerRef.current = setInterval(() => {
        setSeconds((s) => (s > 0 ? s - 1 : 0));
      }, 1000);

      // Poll payment status
      const orderId = r.data.order_id;
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.get(`/payments/paytm/status/${orderId}`);
          if (s.data.status === "paid") {
            stopPolling();
            setStatus("success");
            toast.success("Payment received — activating subscription…");
            setTimeout(() => navigate("/dashboard"), 1200);
          } else if (s.data.status === "failed") {
            stopPolling();
            setStatus("error");
            toast.error("Payment failed");
          }
        } catch (e) {
          // keep polling on transient errors
        }
      }, 2500);
    } catch (e) {
      setStatus("error");
      const msg = e?.response?.data?.detail || "Payment setup failed";
      toast.error(msg);
      if (e?.response?.status === 400 && /Profile incomplete/.test(msg)) {
        const next = isCustom ? `/checkout/custom?days=${days}` : `/checkout/${planId}`;
        navigate(`/profile?next=${encodeURIComponent(next)}`);
      }
    } finally { setSubmitting(false); }
  };

  const retry = () => {
    stopPolling();
    setOrder(null);
    setStatus("idle");
  };

  if (!plan || !user) return <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const perDay = (plan.amount / plan.duration_days).toFixed(0);
  const backNext = isCustom ? `/checkout/custom?days=${days}` : `/checkout/${planId}`;
  const mmss = seconds == null ? null : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10" data-testid="checkout-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">{isCustom && <Sparkles className="h-3.5 w-3.5" />} Checkout</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Review & pay</h1>

      <div className="mt-8 grid md:grid-cols-5 gap-6">
        <div className="md:col-span-3 bg-card rounded-2xl border border-border p-6">
          <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Plan</p>
          <div className="mt-3 flex items-baseline justify-between">
            <h2 className="font-display font-extrabold text-2xl">{plan.name}</h2>
            <span className="font-display font-extrabold text-3xl">₹{plan.amount.toFixed(0)}</span>
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

        <div className="md:col-span-2">
          {status === "idle" && (
            <div className="space-y-4" data-testid="paytm-intro">
              <div className="bg-primary text-primary-foreground rounded-2xl p-6">
                <IndianRupee className="h-5 w-5 text-primary-foreground/70" strokeWidth={1.75} />
                <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70 mt-3">You'll pay</p>
                <p className="font-display font-extrabold text-4xl mt-2 leading-none">₹{plan.amount.toFixed(0)}</p>
                <p className="text-xs text-primary-foreground/80 mt-3">Pay with any UPI app — Paytm, GPay, PhonePe, BHIM.</p>
              </div>
              <Button onClick={startCheckout} disabled={submitting} data-testid="pay-button" className="w-full h-12 rounded-full bg-primary hover:bg-primary/90 font-semibold text-base">
                <ScanLine className="h-4 w-4 mr-2" /> Show Paytm QR
              </Button>
            </div>
          )}

          {status === "creating" && (
            <div className="bg-card rounded-2xl border border-border p-8 text-center" data-testid="paytm-creating">
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground mt-3">Generating Paytm QR…</p>
            </div>
          )}

          {status === "awaiting" && order && (
            <div className="bg-card rounded-2xl border border-border p-5 space-y-4" data-testid="paytm-qr">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">Scan to pay</p>
                  <p className="font-display font-extrabold text-2xl leading-tight">₹{plan.amount.toFixed(0)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Expires</p>
                  <p className="font-mono font-bold text-sm tabular-nums">{mmss ?? "—"}</p>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-white p-4 flex items-center justify-center">
                {order.qr_image_base64 ? (
                  <img
                    src={`data:image/png;base64,${order.qr_image_base64}`}
                    alt="Paytm QR"
                    className="w-full max-w-[260px] aspect-square"
                    data-testid="paytm-qr-image"
                  />
                ) : (
                  <div className="text-xs text-muted-foreground">QR unavailable</div>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                <Smartphone className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Open Paytm / GPay / PhonePe, scan this QR, pay ₹{plan.amount.toFixed(0)}. We'll activate your subscription automatically.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="paytm-polling-indicator">
                <Loader2 className="h-3 w-3 animate-spin" /> Waiting for payment…
              </div>
              {order.mock && (
                <div className="bg-secondary/10 border border-secondary/20 rounded-xl p-3 text-xs flex items-start gap-2" data-testid="paytm-mock-notice">
                  <AlertCircle className="h-3.5 w-3.5 text-secondary mt-0.5 shrink-0" />
                  <span><b>Demo mode.</b> Add <code className="bg-muted/60 px-1 rounded">PAYTM_MERCHANT_ID</code> & <code className="bg-muted/60 px-1 rounded">PAYTM_MERCHANT_KEY</code> in backend .env to enable real Paytm QR. This demo auto-activates after a few seconds.</span>
                </div>
              )}
              <Button onClick={retry} variant="outline" size="sm" className="rounded-full" data-testid="paytm-cancel">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Cancel & retry
              </Button>
            </div>
          )}

          {status === "success" && (
            <div className="bg-primary text-primary-foreground rounded-2xl p-8 text-center" data-testid="paytm-success">
              <Check className="h-10 w-10 mx-auto" strokeWidth={2.25} />
              <p className="font-display font-extrabold text-2xl mt-3">Paid!</p>
              <p className="text-sm text-primary-foreground/80 mt-1">Activating your subscription…</p>
            </div>
          )}

          {status === "error" && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-6 text-sm text-destructive-foreground space-y-3" data-testid="paytm-error">
              <p className="font-semibold">Payment failed</p>
              <Button onClick={retry} className="rounded-full bg-primary hover:bg-primary/90" data-testid="retry-pay">Retry</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
