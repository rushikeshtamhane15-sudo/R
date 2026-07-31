import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  ChefHat, Sun, Moon, Sunrise, ShoppingCart,
  Loader2, Minus, Plus, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";
import MenuPushBanner from "./MenuPushBanner";
import CartSaverBanner from "./CartSaverBanner";
import {
  splitMenuItems, loadRazorpay, cleanIndianMobile,
  SERVICE_TABS, PAY_TABS, PENDING_KEY,
  MEAL_WINDOWS_IST, isMealWindowOpen,
} from "./messMenuHelpers";

// iter-134.l — format HH:MM (24h) → h/hh:mm am/pm for the mess-menu time badges.
function fmt12(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hh = ((h + 11) % 12) + 1;
  return m === 0 ? `${hh}${ampm}` : `${hh}:${String(m).padStart(2, "0")}${ampm}`;
}

/**
 * TodayMessMenuFlash — iter-62 → iter-122.
 *
 * iter-122 refactor pass: helpers (splitMenuItems, loadRazorpay,
 * cleanIndianMobile, service/pay tab consts, PENDING_KEY) moved to
 * `./messMenuHelpers.js`. Empty catches now log via console.warn.
 * Array-index list keys replaced with content-derived stable keys.
 * A full top-to-bottom component split is intentionally deferred —
 * this file is on every subscriber's dashboard, so we change it
 * incrementally with regression testing between each pass.
 */

export default function TodayMessMenuFlash({ compact = false }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  // iter-134.l — fetch admin-configured meal-slot windows so the mess-menu
  // container's time badges and "closed for today" messages stay in sync
  // with what the admin has set (falls back to defaults on cold start).
  const [mealSlots, setMealSlots] = useState({ lunch: { start: "12:00", end: "15:00" }, dinner: { start: "19:00", end: "22:00" } });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.get("/meal-slots");
        if (!cancelled && r?.data) setMealSlots(r.data);
      } catch { /* keep defaults */ }
    };
    load();
    const id = setInterval(load, 60_000);
    const onLocal = () => load();
    const onStorage = (e) => { if (e.key === "efc_meal_slots_updated_at") load(); };
    window.addEventListener("efc:meal-slots-updated", onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true; clearInterval(id);
      window.removeEventListener("efc:meal-slots-updated", onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const lunchLabel = `${fmt12(mealSlots.lunch?.start)} – ${fmt12(mealSlots.lunch?.end)}`;
  const dinnerLabel = `${fmt12(mealSlots.dinner?.start)} – ${fmt12(mealSlots.dinner?.end)}`;
  const [tab, setTab] = useState("today"); // today | tomorrow
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderMeal, setOrderMeal] = useState("lunch");
  // iter-131.10: full 3-way service picker restored — Delivery / Takeaway / Dining.
  const [service, setService] = useState("delivery");
  const [qty, setQty] = useState(1);
  const [payMethod, setPayMethod] = useState("online");
  const [phone, setPhone] = useState("");
  const [placing, setPlacing] = useState(false);
  // iter-131: add-ons + thali customisation
  const [extraRotis, setExtraRotis] = useState(0);
  const [excludedItems, setExcludedItems] = useState([]);
  // iter-74 #10: on-spot OTP for delivery (no /login redirect needed)
  const [otpMode, setOtpMode] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const autoFiredRef = useRef(false);

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/mess-menu/today?include_next=1"); setData(r.data); }
      catch (e) { setData(null); console.warn("[TodayMessMenuFlash] /mess-menu/today failed", e); }
    })();
  }, []);

  // iter-77 #9: auto-fill phone from logged-in user's profile so delivery
  // doesn't ask them to re-type a number we already have on file.
  useEffect(() => {
    if (!user || phone) return;
    const raw = String(user.phone || "").replace(/\D/g, "");
    const ten = raw.startsWith("91") && raw.length > 10 ? raw.slice(-10) : raw;
    if (ten.length === 10) setPhone(ten);
  }, [user, phone]);
  useEffect(() => {
    // iter-73 #9: when the user just logged in (or already had a pending mess
    // order in sessionStorage), re-hydrate the form and auto-fire the order
    // straight into Razorpay/place — no more bouncing off /dashboard.
    if (!user || !data || autoFiredRef.current) return;
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); }
    catch (e) { console.warn("[TodayMessMenuFlash] PENDING_KEY parse failed", e); }
    if (!pending) return;
    autoFiredRef.current = true;
    sessionStorage.removeItem(PENDING_KEY);
    // Defer state restore + fire to the next microtask so we exit the effect
    // body cleanly before any setState happens.
    queueMicrotask(() => {
      setOrderOpen(true);
      if (pending.tab) setTab(pending.tab);
      if (pending.meal) setOrderMeal(pending.meal);
      // iter-131: `service` is now always "delivery" — ignore any legacy
      // takeaway/dining value stashed in an older pending payload.
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
  // iter-131: extra roti add-on. Per roti price defaults to ₹10 (backend cfg).
  const extraRotiPrice = Number(cfg.price_extra_roti ?? 10);
  const extraRotisTotal = extraRotis * extraRotiPrice * qty;
  const total = priceFor(service) * qty + extraRotisTotal;

  // iter-131.6: CMS-driven tile layout. `item_layout` now controls whether
  // the LUNCH and DINNER tiles sit side-by-side (default, "horizontal") or
  // stacked one above the other ("list"). Items inside each tile flip
  // accordingly — vertical bullets read best in a narrow side-by-side
  // column; a 3-col horizontal grid reads best when the tile is full-width.
  const isHorizTiles = cfg.item_layout !== "list";
  const tileContainerClass = isHorizTiles
    ? "mt-1.5 z-10 relative grid grid-cols-2 gap-1.5 items-stretch"
    : "mt-1.5 z-10 relative space-y-1.5";
  const itemLayoutClass = isHorizTiles
    ? "mt-1.5 flex flex-col gap-y-0.5"
    : "mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5";
  const optOutLayoutClass = "mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5";

  // iter-131: meal-window awareness. For "today" tab, block picking a meal
  // whose IST window has already closed / not yet opened. "tomorrow" is
  // always pre-orderable.
  const mealDisabled = (m) => tab === "today" && !isMealWindowOpen(m);
  const mealBlocked = mealDisabled(orderMeal);

  // iter-131: available thali items for the currently-picked meal, used
  // to render the opt-out checkboxes. Recomputed when tab / meal changes.
  const thaliItems = active ? splitMenuItems(active[orderMeal] || "") : [];

  // Phone validation now imported from messMenuHelpers (cleanIndianMobile).

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
        extra_rotis: Number(src.extraRotis || extraRotis || 0),
        excluded_items: Array.isArray(src.excludedItems) ? src.excludedItems : excludedItems,
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
      } catch (e) { console.warn("[TodayMessMenuFlash] PENDING_KEY write failed", e); }
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
          // iter-131: service is fixed to delivery — ignore legacy resume value.
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
          /* iter-79 #3 / iter-83 #4: tighter vertical footprint —
             reduced outer padding + smaller header + slimmer inter-row
             gap so the card no longer dominates the mobile viewport.
             — LUNCH / DINNER badge headers with sun/moon icon.
             — Items split on "+" / "," into a real bullet list.
             — Centered gold-diamond seam between Lunch and Dinner. */
          className="rounded-2xl px-3 py-2 overflow-hidden relative bg-gradient-to-br from-emerald-700 via-emerald-600 to-emerald-800"
          style={{
            color: cfg.text_color,
            boxShadow: "0 12px 24px -10px rgba(5,95,70,0.5), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 2px rgba(0,0,0,0.2)",
          }}
        >
          <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.08] bg-[radial-gradient(circle_at_20%_20%,_white_2px,_transparent_2px),radial-gradient(circle_at_80%_60%,_white_1.5px,_transparent_1.5px)] bg-[length:36px_36px,_54px_54px]" />
          {/* Header row: chef-hat + date */}
          <div className="flex items-center gap-2 z-10 relative">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-lg bg-white/22 shrink-0">
              {tab === "today" ? <ChefHat className="h-3 w-3" /> : <Sunrise className="h-3 w-3" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display font-extrabold text-[12px] sm:text-[14px] leading-tight tracking-tight" data-testid="mess-card-heading">{cardLabel}</p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1 text-[9px] tracking-[0.18em] uppercase font-bold opacity-75 bg-white/15 rounded-full px-2 py-0.5">Today&apos;s Special</span>
          </div>

          {/* iter-93: Lunch (top) / Dinner (bottom) — pro layout.
              · Each meal sits in a soft ring-card with a uniform 2-col item grid
                (3-col on sm+) so items align consistently instead of wrap-jumbling.
              · Meal label shows service window (12-3 pm / 7-10 pm) for context.
              · Subtle gold mid-divider remains for visual rhythm. */}
          {/* iter-131.6: LUNCH + DINNER tiles. Layout swaps between
              side-by-side (default) and stacked based on CMS
              `item_layout`. See computed classes above. */}
          <div className={tileContainerClass} data-testid="mess-meal-grid">
            {/* LUNCH card */}
            <div data-testid="mess-lunch-col" className="rounded-xl bg-amber-500/10 ring-1 ring-amber-300/20 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 ring-1 ring-amber-300/40 flex-shrink-0">
                    <Sun className="h-3 w-3 text-amber-200" />
                  </span>
                  <span className="text-[10px] tracking-[0.22em] uppercase font-extrabold text-amber-200 truncate">Lunch</span>
                </div>
                <span className="text-[9px] uppercase tracking-[0.12em] text-amber-100/70 font-bold whitespace-nowrap flex-shrink-0">{lunchLabel}</span>
              </div>
              {active.lunch ? (
                <ul className={itemLayoutClass}>
                  {splitMenuItems(active.lunch).map((it, i) => (
                    <li key={`lunch-${it}-${i}`} className="flex items-center gap-1.5 text-[12px] leading-tight font-semibold min-w-0">
                      <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-amber-300/80 shrink-0" />
                      <span className="truncate">{it}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[11px] opacity-60 italic block mt-0.5">Off today</span>
              )}
            </div>

            {/* Mid-seam gold separator — only in stacked mode. */}
            {!isHorizTiles && (
              <div className="flex items-center gap-2 opacity-50" aria-hidden>
                <span className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-300/50 to-amber-300/50" />
                <span className="w-1 h-1 rotate-45 bg-amber-300/70" />
                <span className="flex-1 h-px bg-gradient-to-l from-transparent via-amber-300/50 to-amber-300/50" />
              </div>
            )}

            {/* DINNER card */}
            <div data-testid="mess-dinner-col" className="rounded-xl bg-blue-500/10 ring-1 ring-blue-300/20 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25 flex-shrink-0">
                    {/* iter-131.7: moon icon + label switched to WHITE per
                        brand refresh. */}
                    <Moon className="h-3 w-3 text-white" />
                  </span>
                  <span className="text-[10px] tracking-[0.22em] uppercase font-extrabold text-white truncate">Dinner</span>
                </div>
                {/* iter-131.7: force the time to render on a single line —
                    "PM" was wrapping onto a second row on narrow tiles. */}
                <span className="text-[9px] uppercase tracking-[0.12em] text-white/80 font-bold whitespace-nowrap flex-shrink-0">{dinnerLabel}</span>
              </div>
              {active.dinner ? (
                <ul className={itemLayoutClass}>
                  {splitMenuItems(active.dinner).map((it, i) => (
                    <li key={`dinner-${it}-${i}`} className="flex items-center gap-1.5 text-[12px] leading-tight font-semibold min-w-0">
                      <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-blue-300/80 shrink-0" />
                      <span className="truncate">{it}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[11px] opacity-60 italic block mt-0.5">Off today</span>
              )}
            </div>
          </div>

          {active.note && (
            <p className="mt-1 text-[10px] sm:text-[11px] italic opacity-85 z-10 relative flex items-start gap-1">
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
                    // iter-131: pick a meal that is actually openable given
                    // the current tab + IST time-window. Prefer the meal
                    // whose window is currently open; fall back to whatever
                    // menu the day has.
                    const bothTabs = tab === "today";
                    const lunchOk = active.lunch && (!bothTabs || isMealWindowOpen("lunch"));
                    const dinnerOk = active.dinner && (!bothTabs || isMealWindowOpen("dinner"));
                    const initialMeal = lunchOk ? "lunch" : dinnerOk ? "dinner" : (active.lunch ? "lunch" : "dinner");
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
                <div className="rounded-xl bg-white/12 backdrop-blur-sm p-2.5 space-y-2" data-testid="menu-order-form">
                  {/* iter-131: vertical meal picker.
                      Each meal shows: icon, label, IST window, "open/closed"
                      status, menu preview, radio-selected state. Clicking a
                      closed same-day meal shows a toast — pre-orders for
                      tomorrow are always allowed. */}
                  {(active.lunch || active.dinner) && (
                    <div className="flex flex-col gap-1.5" data-testid="order-meal-vertical">
                      {["lunch", "dinner"].filter((m) => !!active[m]).map((m) => {
                        const selected = orderMeal === m;
                        const disabled = mealDisabled(m);
                        const win = MEAL_WINDOWS_IST[m];
                        const Icon = m === "lunch" ? Sun : Moon;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              if (disabled) {
                                toast.error(`${m[0].toUpperCase() + m.slice(1)} is closed for today (open ${win.label} IST). Try tomorrow's menu.`);
                                return;
                              }
                              if (m !== orderMeal) {
                                // Reset per-meal customisations when switching so
                                // opt-outs from one meal don't leak into the other.
                                setExcludedItems([]);
                                setExtraRotis(0);
                              }
                              setOrderMeal(m);
                            }}
                            aria-pressed={selected}
                            aria-disabled={disabled}
                            data-testid={`order-meal-${m}`}
                            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all border ${
                              selected
                                ? "bg-white text-emerald-900 border-white shadow-sm"
                                : disabled
                                  ? "bg-white/5 text-white/50 border-white/10 cursor-not-allowed"
                                  : "bg-white/10 text-white/90 border-white/15 hover:bg-white/20"
                            }`}
                          >
                            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
                              selected ? "bg-emerald-100" : "bg-white/15"
                            }`}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] font-extrabold uppercase tracking-wider">{m}</span>
                                {/* iter-131.10: the pill next to the
                                    currently-selected meal uses the brand
                                    red (#b51a1a) + white text so it stands
                                    out as the active choice. Non-selected
                                    meals keep the neutral dark-green pill. */}
                                <span
                                  className="text-[9px] uppercase tracking-[0.15em] font-bold px-1.5 py-0.5 rounded-full text-white"
                                  style={{ backgroundColor: selected ? "#b51a1a" : "#064e3b" }}
                                >
                                  {disabled ? "Closed" : "Open"}
                                </span>
                                <span className="text-[9px] uppercase tracking-[0.15em] font-bold opacity-70 ml-auto">{win.label}</span>
                              </div>
                              <p className={`mt-0.5 text-[10.5px] leading-tight ${selected ? "text-emerald-900/80" : "opacity-75"} line-clamp-1`}>
                                {active[m]}
                              </p>
                            </div>
                            <span className={`inline-flex h-4 w-4 rounded-full border-2 shrink-0 ${
                              selected ? "bg-emerald-600 border-emerald-600" : "border-white/60"
                            }`} aria-hidden />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* iter-131.10: 3-tab service picker restored per user
                      request. Delivery keeps a phone field (below); the
                      other two rely on the kiosk / dine-in workflow. */}
                  <div className="grid grid-cols-3 gap-1.5" data-testid="order-service-row">
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

                  {/* iter-131: opt-out checkboxes for thali items.
                      Price stays the same — we just prep less food. */}
                  {thaliItems.length > 0 && (
                    <div className="rounded-lg bg-white/10 px-2.5 py-1.5" data-testid="order-thali-opts">
                      <p className="text-[10px] tracking-[0.16em] uppercase font-extrabold text-white/80">
                        Skip anything? <span className="opacity-70 normal-case tracking-normal font-semibold">(price stays same, saves food)</span>
                      </p>
                      <div className={optOutLayoutClass}>
                        {thaliItems.map((it) => {
                          const on = !excludedItems.includes(it);
                          return (
                            <label
                              key={it}
                              data-testid={`order-thali-item-${it.replace(/\s+/g, "-").toLowerCase()}`}
                              className={`flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer select-none ${on ? "text-white" : "text-white/50 line-through"}`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  setExcludedItems((prev) => (
                                    prev.includes(it)
                                      ? prev.filter((x) => x !== it)
                                      : [...prev, it]
                                  ));
                                }}
                                className="h-3 w-3 accent-emerald-400"
                              />
                              <span className="truncate">{it}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* iter-131: extra rotis add-on. ₹10 per roti (config). */}
                  <div className="flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5" data-testid="order-extra-roti">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-extrabold">Extra rotis</p>
                      <p className="text-[9.5px] opacity-75">₹{extraRotiPrice} each · added to total</p>
                    </div>
                    <div className="inline-flex items-center rounded-full bg-black/20 text-white">
                      <button type="button" onClick={() => setExtraRotis((n) => Math.max(0, n - 1))} data-testid="order-roti-dec" className="h-6 w-6 inline-flex items-center justify-center hover:bg-white/10 rounded-l-full disabled:opacity-40" disabled={extraRotis <= 0}><Minus className="h-3 w-3" /></button>
                      <span className="px-2 text-[13px] font-extrabold tabular-nums" data-testid="order-roti-qty">{extraRotis}</span>
                      <button type="button" onClick={() => setExtraRotis((n) => Math.min(20, n + 1))} data-testid="order-roti-inc" className="h-6 w-6 inline-flex items-center justify-center hover:bg-white/10 rounded-r-full"><Plus className="h-3 w-3" /></button>
                    </div>
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
                      onClick={() => {
                        if (mealBlocked) {
                          const label = orderMeal === "lunch" ? lunchLabel : dinnerLabel;
                          toast.error(`${orderMeal[0].toUpperCase() + orderMeal.slice(1)} closed for today (open ${label} IST). Pre-order via Tomorrow's menu.`);
                          return;
                        }
                        placeOrder();
                      }}
                      disabled={placing || mealBlocked}
                      data-testid="order-place"
                      className="inline-flex items-center gap-1 rounded-full bg-white text-emerald-800 px-3 h-7 text-[11px] font-extrabold shadow hover:bg-white/95 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {placing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : mealBlocked ? <Clock className="h-3.5 w-3.5" /> : null}
                      {mealBlocked ? "Closed for today" : "Place order"}
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
