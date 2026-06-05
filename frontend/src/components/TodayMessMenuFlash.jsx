import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ChefHat, Sun, Moon, Sunrise, ShoppingCart, Truck, Utensils, Package, Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
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
 * TodayMessMenuFlash — iter-62 #8, iter-63 #7 (Today/Tomorrow toggle),
 * iter-65 #11 (admin-editable BG + inline Order Now with qty + service).
 *
 * Reads /api/mess-menu/today?include_next=1 → also gets a CMS `config`
 * object with the gradient colours + per-service prices.
 */

const SERVICE_TABS = [
  { id: "delivery", label: "Delivery", icon: Truck },
  { id: "takeaway", label: "Takeaway", icon: Package },
  { id: "dining", label: "Dining", icon: Utensils },
];

export default function TodayMessMenuFlash({ compact = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("today"); // today | tomorrow
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderMeal, setOrderMeal] = useState("lunch");
  const [service, setService] = useState("delivery");
  const [qty, setQty] = useState(1);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/mess-menu/today?include_next=1"); setData(r.data); }
      catch { setData(null); }
    })();
  }, []);
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

  const placeOrder = async () => {
    if (!user) {
      try { sessionStorage.setItem("efc_pending_action_v1", "/dashboard"); } catch { /* no-op */ }
      navigate(`/login?next=${encodeURIComponent("/dashboard")}`);
      return;
    }
    setPlacing(true);
    try {
      const r = await api.post("/mess-menu/order", {
        service, qty, date: activeDate, meal_type: orderMeal,
      });
      const checkout = r.data?.checkout;
      // iter-66 #2: chain straight into Razorpay (or auto-verify mock orders)
      if (!checkout) { toast.error("Order created but checkout failed"); return; }
      if (checkout.mock) {
        await api.post("/mess-menu/order/verify", {
          order_id: checkout.order_id, razorpay_payment_id: "pay_mock", razorpay_signature: "sig",
        });
        toast.success(`Order placed · ₹${checkout.amount}`);
        setOrderOpen(false); setQty(1);
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
              setOrderOpen(false); setQty(1);
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

  return (
    <div className={compact ? "" : "mt-4"} data-testid="mess-menu-flash">
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
        <div className="rounded-2xl border border-dashed border-border bg-gradient-to-br from-muted/30 to-muted/10 px-4 py-6 text-center" data-testid="menu-flash-empty-both">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
            <ChefHat className="h-5 w-5" />
          </div>
          <p className="text-sm font-display font-bold text-foreground">Mess menu coming soon</p>
          <p className="text-xs text-muted-foreground mt-1">Our chef is still planning the week — check back shortly for lunch &amp; dinner.</p>
        </div>
      ) : (
      <>
      {/* iter-63 #7: Today / Tomorrow horizontal toggle tabs */}
      <div className="inline-flex flex-row bg-muted/50 rounded-full p-1 gap-1 mb-2" data-testid="menu-tab-group">
        <button
          type="button" onClick={() => setTab("today")}
          className={`px-4 sm:px-5 h-8 rounded-full text-xs font-bold transition-colors ${tab === "today" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="menu-tab-today"
        >Today's menu</button>
        <button
          type="button" onClick={() => setTab("tomorrow")}
          className={`px-4 sm:px-5 h-8 rounded-full text-xs font-bold transition-colors ${tab === "tomorrow" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid="menu-tab-tomorrow"
        >Tomorrow's menu</button>
      </div>

      {active ? (
        <div
          className="rounded-2xl p-3.5 sm:p-4 overflow-hidden relative"
          style={{
            background: `linear-gradient(145deg, ${cfg.bg_gradient_from} 0%, ${cfg.bg_gradient_mid} 45%, ${cfg.bg_gradient_to} 100%)`,
            color: cfg.text_color,
            boxShadow: "0 10px 24px -10px rgba(5,95,70,0.45), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 2px rgba(0,0,0,0.18)",
          }}
        >
          <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(transparent_50%,_rgba(255,255,255,1)_50%)] bg-[length:100%_3px]" />
          <div className="flex items-center gap-2 z-10 relative">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/22 shrink-0">
              {tab === "today" ? <ChefHat className="h-3.5 w-3.5" /> : <Sunrise className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0">
              <p className="text-[9px] tracking-[0.18em] uppercase font-extrabold opacity-85">{cardLabel}</p>
            </div>
          </div>
          <div className="mt-2 grid sm:grid-cols-2 gap-2 z-10 relative">
            {active.lunch && (
              <div className="flex items-start gap-1.5 bg-white/8 rounded-xl px-2.5 py-2">
                <Sun className="h-3.5 w-3.5 text-amber-200 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] tracking-[0.16em] uppercase font-bold opacity-75">Lunch</p>
                  <p className="text-[12px] sm:text-[13px] font-bold leading-snug">{active.lunch}</p>
                </div>
              </div>
            )}
            {active.dinner && (
              <div className="flex items-start gap-1.5 bg-white/8 rounded-xl px-2.5 py-2">
                <Moon className="h-3.5 w-3.5 text-blue-200 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] tracking-[0.16em] uppercase font-bold opacity-75">Dinner</p>
                  <p className="text-[12px] sm:text-[13px] font-bold leading-snug">{active.dinner}</p>
                </div>
              </div>
            )}
          </div>
          {active.note && (
            <p className="mt-2 text-[10px] sm:text-[11px] italic opacity-85 z-10 relative">★ {active.note}</p>
          )}

          {/* iter-65 #11: inline Order Now */}
          {cfg.order_enabled !== false && (active.lunch || active.dinner) && (
            <div className="mt-3 z-10 relative">
              {!orderOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setOrderOpen(true);
                    const initialMeal = active.lunch ? "lunch" : "dinner";
                    setOrderMeal(initialMeal);
                    // iter-68: log the intent so we can resurrect it later
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
                  className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-white text-emerald-800 px-4 h-9 text-xs font-extrabold shadow hover:bg-white/95 transition-colors"
                  data-testid="menu-order-now"
                >
                  <ShoppingCart className="h-3.5 w-3.5" /> Order this menu
                </button>
              ) : (
                <div className="rounded-xl bg-white/12 backdrop-blur-sm p-2.5 space-y-2" data-testid="menu-order-form">
                  {/* meal toggle */}
                  {active.lunch && active.dinner && (
                    <div className="inline-flex rounded-full bg-black/15 p-1 gap-1">
                      <button type="button" onClick={() => setOrderMeal("lunch")} className={`px-3 h-7 rounded-full text-[10px] font-bold ${orderMeal === "lunch" ? "bg-white text-emerald-900" : "text-white/80"}`} data-testid="order-meal-lunch">Lunch</button>
                      <button type="button" onClick={() => setOrderMeal("dinner")} className={`px-3 h-7 rounded-full text-[10px] font-bold ${orderMeal === "dinner" ? "bg-white text-emerald-900" : "text-white/80"}`} data-testid="order-meal-dinner">Dinner</button>
                    </div>
                  )}
                  {/* service tabs */}
                  <div className="flex gap-1.5">
                    {SERVICE_TABS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setService(s.id)}
                        data-testid={`order-svc-${s.id}`}
                        className={`flex-1 inline-flex items-center justify-center gap-1 px-2 h-8 rounded-lg text-[10px] font-extrabold tracking-wide ${service === s.id ? "bg-white text-emerald-900" : "bg-white/10 text-white/85 hover:bg-white/20"}`}
                      >
                        <s.icon className="h-3 w-3" /> {s.label}
                        <span className="ml-1 opacity-90 tabular-nums">₹{priceFor(s.id)}</span>
                      </button>
                    ))}
                  </div>
                  {/* qty + total + place */}
                  <div className="flex items-center gap-2">
                    <div className="inline-flex items-center rounded-full bg-white/15 text-white">
                      <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} data-testid="order-qty-dec" className="h-8 w-8 inline-flex items-center justify-center hover:bg-white/10 rounded-l-full"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="px-3 text-sm font-extrabold tabular-nums" data-testid="order-qty">{qty}</span>
                      <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} data-testid="order-qty-inc" className="h-8 w-8 inline-flex items-center justify-center hover:bg-white/10 rounded-r-full"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="flex-1 text-right text-white font-extrabold text-sm tabular-nums" data-testid="order-total">₹{total}</div>
                    <button
                      type="button"
                      onClick={placeOrder}
                      disabled={placing}
                      data-testid="order-place"
                      className="inline-flex items-center gap-1.5 rounded-full bg-white text-emerald-800 px-3.5 h-8 text-[11px] font-extrabold shadow hover:bg-white/95 disabled:opacity-60"
                    >
                      {placing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Place order
                    </button>
                  </div>
                  <button type="button" onClick={() => setOrderOpen(false)} className="text-[10px] text-white/70 hover:text-white" data-testid="order-cancel">Cancel</button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-5 text-center" data-testid="menu-empty">
          <p className="text-xs text-muted-foreground">
            {tab === "today"
              ? "Today's menu hasn't been published yet — check back soon."
              : "Tomorrow's menu hasn't been planned yet. Try again later."}
          </p>
        </div>
      )}
      </>
      )}
    </div>
  );
}
