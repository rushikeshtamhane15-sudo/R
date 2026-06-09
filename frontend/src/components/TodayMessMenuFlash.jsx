import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  ChefHat, Sun, Moon, Sunrise, ShoppingCart, Truck, Utensils, Package,
  Loader2, Minus, Plus, Banknote, ScanLine, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";
import MenuPushBanner from "./MenuPushBanner";
import CartSaverBanner from "./CartSaverBanner";

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = resolve;
    document.body.appendChild(s);
  });
}

/**
 * splitMenuItems — iter-79 #3
 * Convert a free-text mess menu string like
 *   "Dal bhaji + bhendi sabji + 5 roti + rice + salad"
 * into a clean array of trimmed items
 *   ["Dal bhaji", "bhendi sabji", "5 roti", "rice", "salad"]
 * so each item can be rendered as a bullet in the menu card instead of
 * one long line that wraps awkwardly. Splits on "+" or "," and drops
 * empty fragments.
 */
function splitMenuItems(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[+,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}


/**
 * TodayMessMenuFlash — iter-62 → iter-73.
 *
 * iter-73 batch:
 *   #1 / #3 — slimmer container + tighter toggle buttons
 *   #9      — persist order intent, auto-fire after login (no more dashboard loop)
 *   #10     — full payment-mode picker (online / cash / wallet — no partial)
 *   #12     — delivery service requires valid +91 Indian 10-digit mobile
 */
const SERVICE_TABS = [
  { id: "delivery", label: "Delivery", icon: Truck },
  { id: "takeaway", label: "Takeaway", icon: Package },
  { id: "dining", label: "Dining", icon: Utensils },
];
const PAY_TABS = [
  { id: "online", label: "Online", icon: ScanLine },
  { id: "cash",   label: "Cash",   icon: Banknote },
  { id: "wallet", label: "Wallet", icon: Wallet },
];

const PENDING_KEY = "efc_pending_mess_order_v1";

export default function TodayMessMenuFlash({ compact = false }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("today"); // today | tomorrow
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderMeal, setOrderMeal] = useState("lunch");
  const [service, setService] = useState("delivery");
  const [qty, setQty] = useState(1);
  const [payMethod, setPayMethod] = useState("online");
  const [phone, setPhone] = useState("");
  const [placing, setPlacing] = useState(false);
  // iter-74 #10: on-spot OTP for delivery (no /login redirect needed)
  const [otpMode, setOtpMode] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const autoFiredRef = useRef(false);

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/mess-menu/today?include_next=1"); setData(r.data); }
      catch { setData(null); }
    })();
  }, []);

  // iter-77 #9: auto-fill phone from logged-in user's profile so delivery
  // doesn't ask them to re-type a number we already have on file.
  useEffect(() => {
    if (!user || phone) return;
    const raw = String(user.phone || "").replace(/\D/g, "");
    const ten = raw.startsWith("91") && raw.length > 10 ? raw.slice(-10) : raw;
    if (ten.length === 10) setPhone(ten);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  useEffect(() => {
    // iter-73 #9: when the user just logged in (or already had a pending mess
    // order in sessionStorage), re-hydrate the form and auto-fire the order
    // straight into Razorpay/place — no more bouncing off /dashboard.
    if (!user || !data || autoFiredRef.current) return;
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); } catch { /* noop */ }
    if (!pending) return;
    autoFiredRef.current = true;
    sessionStorage.removeItem(PENDING_KEY);
    // Defer state restore + fire to the next microtask so we exit the effect
    // body cleanly before any setState happens.
    queueMicrotask(() => {
      setOrderOpen(true);
      if (pending.tab) setTab(pending.tab);
      if (pending.meal) setOrderMeal(pending.meal);
      if (pending.service) setService(pending.service);
      if (pending.qty) setQty(pending.qty);
      if (pending.payMethod) setPayMethod(pending.payMethod);
      if (pending.phone) setPhone(pending.phone);
      setTimeout(() => { placeOrderInternal({ ...pending, fromAutoFire: true }); }, 80);
    });
  }, [user, data]);

  if (!data) return null;
  const today = data.current;
  const next = data.next;
  const cfg = data.config || {
    bg_gradient_from: "#047857", bg_gradient_mid: "#059669", bg_gradient_to: "#065f46",
    text_color: "#ecfdf5", price_delivery: 140, price_takeaway: 120, price_dining: 100,
    order_enabled: true,
  };
  const bothEmpty = !today && !next;

  const active = tab === "today" ? today : next;
  const activeDate = tab === "today" ? data.today : data.tomorrow;
  const cardLabel = active
    ? (tab === "today"
        ? `Today's mess menu · ${new Date(activeDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`
        : `Tomorrow's preview · ${new Date(activeDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`)
    : "";

  const priceFor = (svc) => Number(cfg[`price_${svc}`] || 0);
  const total = priceFor(service) * qty;

  // === Phone validation (iter-73 #12) ===================================
  const cleanIndianMobile = (raw) => {
    const digits = String(raw || "").replace(/\D/g, "");
    const stripped = digits.startsWith("91") && digits.length > 10 ? digits.slice(-10) : digits;
    if (stripped.length !== 10) return null;
    if (!/^[6-9]/.test(stripped)) return null;
    return stripped;
  };

  const placeOrderInternal = async (override = null) => {
    const src = override || {
      service, qty, meal: orderMeal, date: activeDate, payMethod, phone, tab,
    };
    if (src.service === "delivery") {
      const valid = cleanIndianMobile(src.phone);
      if (!valid) {
        toast.error("Enter a valid +91 Indian mobile number for delivery");
        return;
      }
      src.phone = valid;
    }
    setPlacing(true);
    try {
      const r = await api.post("/mess-menu/order", {
        service: src.service,
        qty: src.qty,
        date: src.date,
        meal_type: src.meal,
        payment_method: src.payMethod,
        phone: src.phone || null,
      });
      const checkout = r.data?.checkout;
      const order = r.data?.order;
      // iter-73 #10: cash & wallet flows finish server-side; only online → Razorpay
      if (!checkout) {
        toast.success(`Order placed · ${src.payMethod.toUpperCase()} · ₹${order?.total || total}`);
        setOrderOpen(false); setQty(1); setPhone("");
        return;
      }
      if (checkout.mock) {
        await api.post("/mess-menu/order/verify", {
          order_id: checkout.order_id, razorpay_payment_id: "pay_mock", razorpay_signature: "sig",
        });
        toast.success(`Order placed · ₹${checkout.amount}`);
        setOrderOpen(false); setQty(1); setPhone("");
      } else {
        await loadRazorpay();
        const rzp = new window.Razorpay({
          key: checkout.key_id,
          amount: checkout.amount_paise,
          currency: checkout.currency || "INR",
          order_id: checkout.order_id,
          name: checkout.name || "efoodcare",
          description: checkout.description || "",
          prefill: checkout.prefill || {},
          theme: { color: "#047857" },
          handler: async (res) => {
            try {
              await api.post("/mess-menu/order/verify", {
                order_id: res.razorpay_order_id,
                razorpay_payment_id: res.razorpay_payment_id,
                razorpay_signature: res.razorpay_signature,
              });
              toast.success(`Order paid · ₹${checkout.amount}`);
              setOrderOpen(false); setQty(1); setPhone("");
            } catch { toast.error("Verify failed"); }
          },
          modal: { ondismiss: () => toast.message("Checkout cancelled") },
        });
        rzp.open();
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not place order");
    } finally {
      setPlacing(false);
    }
  };

  const placeOrder = async () => {
    // iter-73 #12 follow-up: validate +91 phone BEFORE the auth gate so
    // logged-out users with bad numbers see the toast immediately instead
    // of bouncing through login and discovering the failure server-side.
    if (service === "delivery") {
      const valid = cleanIndianMobile(phone);
      if (!valid) {
        toast.error("Enter a valid +91 Indian mobile number for delivery");
        return;
      }
    }
    if (!user) {
      // iter-74 #10: on-spot OTP login for delivery orders (we already
      // have the user's mobile number from the form). Skip the /login
      // redirect entirely; send OTP, prompt inline, finish in 1 tap.
      if (service === "delivery") {
        const valid = cleanIndianMobile(phone);
        const p91 = `+91${valid}`;
        setOtpSending(true);
        try {
          await api.post("/auth/send-otp", { phone: p91 });
          toast.success("OTP sent to +91 " + valid);
          setOtpMode(true);
        } catch (e) {
          toast.error(e?.response?.data?.detail || "Could not send OTP");
        } finally { setOtpSending(false); }
        return;
      }
      // iter-73 #9: takeaway/dining keep the sessionStorage+/login redirect
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({
          service, qty, meal: orderMeal, date: activeDate, payMethod, phone, tab,
        }));
      } catch { /* no-op */ }
      const back = location.pathname + (location.search || "");
      navigate(`/login?next=${encodeURIComponent(back)}`);
      return;
    }
    return placeOrderInternal();
  };

  // iter-74 #10: verify the on-spot OTP, log the user in via AuthContext,
  // then continue straight into placeOrderInternal — no /login redirect.
  const verifyOnSpotOtp = async () => {
    const valid = cleanIndianMobile(phone);
    if (!valid) { toast.error("Phone number missing"); return; }
    if (otpValue.trim().length < 4) { toast.error("Enter the OTP"); return; }
    setOtpSending(true);
    try {
      const r = await api.post("/auth/verify-otp", {
        phone: `+91${valid}`,
        otp: otpValue.trim(),
      });
      setUser(r.data.user);
      toast.success("Welcome to efoodcare");
      setOtpMode(false);
      setOtpValue("");
      // Fire the order now — user is authenticated, phone is validated.
      await placeOrderInternal();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invalid OTP");
    } finally { setOtpSending(false); }
  };

  const resendOnSpotOtp = async () => {
    const valid = cleanIndianMobile(phone);
    if (!valid) return;
    setOtpSending(true);
    try {
      await api.post("/auth/send-otp", { phone: `+91${valid}` });
      toast.success("OTP re-sent");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not resend");
    } finally { setOtpSending(false); }
  };

  return (
    <div className={compact ? "" : "mt-3"} data-testid="mess-menu-flash">
      <MenuPushBanner />
      <CartSaverBanner
        onResume={(b) => {
          if (b.meal_type) setOrderMeal(b.meal_type);
          if (b.service) setService(b.service);
          if (b.qty) setQty(b.qty);
          if (data && b.date === data.tomorrow) setTab("tomorrow");
          else setTab("today");
          setOrderOpen(true);
        }}
      />
      {bothEmpty ? (
        <div className="rounded-2xl border border-dashed border-border bg-gradient-to-br from-muted/30 to-muted/10 px-4 py-5 text-center" data-testid="menu-flash-empty-both">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary mb-1.5">
            <ChefHat className="h-4 w-4" />
          </div>
          <p className="text-sm font-display font-bold text-foreground">Mess menu coming soon</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Our chef is still planning the week — check back shortly for lunch &amp; dinner.</p>
        </div>
      ) : (
      <>
      {/* iter-73 #3: slimmer Today / Tomorrow toggle tabs */}
      <div className="inline-flex flex-row bg-muted/50 rounded-full p-0.5 gap-0.5 mb-1.5" data-testid="menu-tab-group">
        <button
          type="button" onClick={() => setTab("today")}
          className={`px-3 sm:px-4 h-7 rounded-full text-[11px] font-bold transition-colors ${tab === "today" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="menu-tab-today"
        >Today&apos;s menu</button>
        <button
          type="button" onClick={() => setTab("tomorrow")}
          className={`px-3 sm:px-4 h-7 rounded-full text-[11px] font-bold transition-colors ${tab === "tomorrow" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="menu-tab-tomorrow"
        >Tomorrow&apos;s menu</button>
      </div>

      {active ? (
        <div
          /* iter-79 #3: professional mess-menu card.
             — Vertical "LUNCH" / "DINNER" badge headers (pill chips) instead
               of inline text+icon, so each meal reads like a restaurant menu
               section header.
             — Menu items split on "+" / "," into a real bullet list — no
               more awkward inline string wrapping across 4 narrow lines.
             — Centered divider is a thin gold seam with a tiny diamond,
               giving the card a printed-menu feel.
             — Slight inner glow + grain noise preserved. */
          className="rounded-2xl px-3 pt-2.5 pb-3 overflow-hidden relative bg-gradient-to-br from-emerald-700 via-emerald-600 to-emerald-800"
          style={{
            color: cfg.text_color,
            boxShadow: "0 14px 30px -10px rgba(5,95,70,0.55), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 2px rgba(0,0,0,0.2)",
          }}
        >
          <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.08] bg-[radial-gradient(circle_at_20%_20%,_white_2px,_transparent_2px),radial-gradient(circle_at_80%_60%,_white_1.5px,_transparent_1.5px)] bg-[length:36px_36px,_54px_54px]" />
          {/* Header row: chef-hat + date */}
          <div className="flex items-center gap-2 z-10 relative">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/22 shrink-0">
              {tab === "today" ? <ChefHat className="h-3.5 w-3.5" /> : <Sunrise className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display font-extrabold text-[13px] sm:text-[15px] leading-tight tracking-tight" data-testid="mess-card-heading">{cardLabel}</p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase font-bold opacity-75 bg-white/15 rounded-full px-2 py-0.5">Today's Special</span>
          </div>

          {/* Decorative gold seam separator between header and menu */}
          <div className="mt-2 z-10 relative flex items-center gap-2 opacity-70">
            <span className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-300/60 to-amber-300/60" />
            <span className="w-1.5 h-1.5 rotate-45 bg-amber-300/80 shadow-sm" />
            <span className="flex-1 h-px bg-gradient-to-l from-transparent via-amber-300/60 to-amber-300/60" />
          </div>

          {/* Two-column menu — LUNCH | DINNER as printed-menu sections */}
          <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] gap-x-2 z-10 relative">
            {/* LUNCH column */}
            <div className="py-1" data-testid="mess-lunch-col">
              <div className="flex items-center gap-1.5 mb-1">
                <Sun className="h-3 w-3 text-amber-200 shrink-0" />
                <span className="text-[9.5px] tracking-[0.22em] uppercase font-extrabold text-amber-200">Lunch</span>
              </div>
              {active.lunch ? (
                <ul className="space-y-0.5">
                  {splitMenuItems(active.lunch).map((it, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px] leading-snug font-semibold">
                      <span aria-hidden className="mt-1 inline-block h-1 w-1 rounded-full bg-white/60 shrink-0" />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[11px] opacity-60 italic">Off today</span>
              )}
            </div>

            {/* Centered vertical seam between columns */}
            <div className="flex flex-col items-center justify-stretch self-stretch" aria-hidden>
              <span className="flex-1 w-px bg-gradient-to-b from-transparent via-amber-300/60 to-transparent" />
              <span className="w-1.5 h-1.5 rotate-45 bg-amber-300/80 my-1" />
              <span className="flex-1 w-px bg-gradient-to-t from-transparent via-amber-300/60 to-transparent" />
            </div>

            {/* DINNER column */}
            <div className="py-1" data-testid="mess-dinner-col">
              <div className="flex items-center gap-1.5 mb-1">
                <Moon className="h-3 w-3 text-blue-200 shrink-0" />
                <span className="text-[9.5px] tracking-[0.22em] uppercase font-extrabold text-blue-200">Dinner</span>
              </div>
              {active.dinner ? (
                <ul className="space-y-0.5">
                  {splitMenuItems(active.dinner).map((it, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px] leading-snug font-semibold">
                      <span aria-hidden className="mt-1 inline-block h-1 w-1 rounded-full bg-white/60 shrink-0" />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[11px] opacity-60 italic">Off today</span>
              )}
            </div>
          </div>

          {active.note && (
            <p className="mt-2 text-[10px] sm:text-[11px] italic opacity-85 z-10 relative flex items-start gap-1">
              <span className="text-amber-300">★</span>
              <span>{active.note}</span>
            </p>
          )}

          {/* inline Order Now */}
          {cfg.order_enabled !== false && (active.lunch || active.dinner) && (
            <div className="mt-2.5 z-10 relative">
              {!orderOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setOrderOpen(true);
                    const initialMeal = active.lunch ? "lunch" : "dinner";
                    setOrderMeal(initialMeal);
                    if (user) {
                      api.post("/mess-menu/order-intent", {
                        service,
                        qty,
                        meal_type: initialMeal,
                        date: activeDate,
                        menu_text: active[initialMeal] || "",
                        total: priceFor(service) * qty,
                      }).catch(() => { /* fire & forget */ });
                    }
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-white text-emerald-800 px-4 h-8 text-xs font-extrabold shadow hover:bg-white/95 transition-colors"
                  data-testid="menu-order-now"
                >
                  <ShoppingCart className="h-3.5 w-3.5" /> Order this menu
                </button>
              ) : (
                <div className="rounded-xl bg-white/12 backdrop-blur-sm p-2 space-y-1.5" data-testid="menu-order-form">
                  {/* meal toggle */}
                  {active.lunch && active.dinner && (
                    <div className="inline-flex rounded-full bg-black/15 p-0.5 gap-0.5">
                      <button type="button" onClick={() => setOrderMeal("lunch")} className={`px-2.5 h-6 rounded-full text-[10px] font-bold ${orderMeal === "lunch" ? "bg-white text-emerald-900" : "text-white/80"}`} data-testid="order-meal-lunch">Lunch</button>
                      <button type="button" onClick={() => setOrderMeal("dinner")} className={`px-2.5 h-6 rounded-full text-[10px] font-bold ${orderMeal === "dinner" ? "bg-white text-emerald-900" : "text-white/80"}`} data-testid="order-meal-dinner">Dinner</button>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1.5">
                    {SERVICE_TABS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setService(s.id)}
                        data-testid={`order-svc-${s.id}`}
                        className={`inline-flex flex-col items-center justify-center gap-0 px-1 py-1 rounded-lg text-[10px] font-extrabold tracking-wide leading-tight ${service === s.id ? "bg-white text-emerald-900" : "bg-white/10 text-white/85 hover:bg-white/20"}`}
                      >
                        <span className="inline-flex items-center gap-1"><s.icon className="h-3 w-3" /> {s.label}</span>
                        <span className="tabular-nums text-[10px] opacity-90">₹{priceFor(s.id)}</span>
                      </button>
                    ))}
                  </div>

                  {/* iter-73 #10: payment method picker (online / cash / wallet) */}
                  <div className="grid grid-cols-3 gap-1.5" data-testid="order-pay-row">
                    {PAY_TABS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPayMethod(p.id)}
                        data-testid={`order-pay-${p.id}`}
                        className={`inline-flex items-center justify-center gap-1 px-1 py-1 rounded-lg text-[10px] font-extrabold tracking-wide ${payMethod === p.id ? "bg-white text-emerald-900" : "bg-white/10 text-white/85 hover:bg-white/20"}`}
                      >
                        <p.icon className="h-3 w-3" /> {p.label}
                      </button>
                    ))}
                  </div>

                  {/* iter-73 #12: +91 phone input only for delivery */}
                  {service === "delivery" && (
                    <div className="flex items-stretch rounded-lg border border-white/30 bg-white/10 overflow-hidden" data-testid="order-phone-wrap">
                      <span className="flex items-center gap-1 px-2 text-[11px] font-bold text-white/90 border-r border-white/25">
                        <span aria-hidden>🇮🇳</span> +91
                      </span>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        placeholder="10-digit mobile"
                        inputMode="numeric"
                        className="flex-1 bg-transparent text-white placeholder-white/60 text-[11px] font-bold h-7 px-2 outline-none"
                        data-testid="order-phone"
                        maxLength={10}
                      />
                    </div>
                  )}

                  {/* qty + total + place */}
                  <div className="flex items-center gap-2">
                    <div className="inline-flex items-center rounded-full bg-white/15 text-white">
                      <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} data-testid="order-qty-dec" className="h-7 w-7 inline-flex items-center justify-center hover:bg-white/10 rounded-l-full"><Minus className="h-3 w-3" /></button>
                      <span className="px-2.5 text-sm font-extrabold tabular-nums" data-testid="order-qty">{qty}</span>
                      <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} data-testid="order-qty-inc" className="h-7 w-7 inline-flex items-center justify-center hover:bg-white/10 rounded-r-full"><Plus className="h-3 w-3" /></button>
                    </div>
                    <div className="flex-1 text-right text-white font-extrabold text-sm tabular-nums" data-testid="order-total">₹{total}</div>
                    <button
                      type="button"
                      onClick={placeOrder}
                      disabled={placing}
                      data-testid="order-place"
                      className="inline-flex items-center gap-1 rounded-full bg-white text-emerald-800 px-3 h-7 text-[11px] font-extrabold shadow hover:bg-white/95 disabled:opacity-60"
                    >
                      {placing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Place order
                    </button>
                  </div>
                  <button type="button" onClick={() => setOrderOpen(false)} className="text-[10px] text-white/70 hover:text-white" data-testid="order-cancel">Cancel</button>

                  {/* iter-74 #10: inline OTP collector for delivery orders.
                      Triggered when a logged-out user clicks Place Order
                      with service=delivery — we send an OTP to the phone
                      they already entered and verify in-place. Total: 1
                      tap once the OTP arrives. */}
                  {otpMode && (
                    <div className="rounded-lg bg-emerald-950/40 border border-white/20 p-2 space-y-1.5" data-testid="order-otp-block">
                      <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold text-white/85">
                        Verify +91 {cleanIndianMobile(phone) || "..."} · 1-tap login
                      </p>
                      <input
                        value={otpValue}
                        onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="Enter OTP"
                        inputMode="numeric"
                        maxLength={6}
                        autoFocus
                        className="w-full bg-white text-emerald-900 placeholder-emerald-900/50 text-[13px] font-extrabold tracking-[0.25em] text-center rounded-lg h-9 px-2 outline-none"
                        data-testid="order-otp-input"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={verifyOnSpotOtp}
                          disabled={otpSending || placing}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-full bg-white text-emerald-900 px-3 h-7 text-[11px] font-extrabold shadow disabled:opacity-60"
                          data-testid="order-otp-verify"
                        >
                          {(otpSending || placing) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Verify &amp; place order
                        </button>
                        <button
                          type="button"
                          onClick={resendOnSpotOtp}
                          disabled={otpSending}
                          className="text-[10px] text-white/80 hover:text-white underline disabled:opacity-50"
                          data-testid="order-otp-resend"
                        >Resend</button>
                        <button
                          type="button"
                          onClick={() => { setOtpMode(false); setOtpValue(""); }}
                          className="text-[10px] text-white/60 hover:text-white"
                          data-testid="order-otp-cancel"
                        >Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-4 text-center" data-testid="menu-empty">
          <p className="text-xs text-muted-foreground">
            {tab === "today"
              ? "Today&apos;s menu hasn&apos;t been published yet — check back soon."
              : "Tomorrow&apos;s menu hasn&apos;t been planned yet. Try again later."}
          </p>
        </div>
      )}
      </>
      )}
    </div>
  );
}
