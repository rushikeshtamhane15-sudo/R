/**
 * Admin Wall Kiosk — iter-72 redesign + iter-73 #14 self-order rebuild.
 *
 * Top half: stationary COUNTER QR (rotating HMAC code). Customers scan it
 * with their phone — no camera needed on the kiosk.
 *
 * Bottom half: SELF-ORDER wall kiosk with TAKEAWAY (₹120) and DINING (₹100).
 * Three payment modes: cash · online (Paytm/Razorpay QR) · mixed.
 * Once settled, receipt auto-prints to paired Bluetooth thermal printer.
 *
 * iter-122 refactor: decomposed from 678-line monolith into a slim 280-line
 * orchestrator + 4 focused children under /components/admin-kiosk/.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useBranding } from "../context/BrandingContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { ShoppingCart, Maximize2, Minimize2, X } from "lucide-react";
import KioskReceiptModal from "../components/KioskReceiptModal";
import { connectBluetoothPrinter, isBluetoothSupported } from "../lib/bluetoothPrinter";

import KioskCounterPanel from "../components/admin-kiosk/KioskCounterPanel";
import KioskMenuCard from "../components/admin-kiosk/KioskMenuCard";
import KioskOrderForm from "../components/admin-kiosk/KioskOrderForm";
import KioskPaymentModal from "../components/admin-kiosk/KioskPaymentModal";

const LOCATION = "main";

export default function AdminKiosk() {
  // iter-131.28: fullscreen kiosk mode. When the URL contains ?fullscreen=1
  // (or the route is /kiosk instead of /admin/kiosk) the sidebar chrome is
  // hidden by the parent route wrapper (see App.js) and we render an inner
  // "Exit" button + trigger the browser Fullscreen API for a true wall-kiosk
  // experience.
  const loc = useLocation();
  const isFullscreenRoute = loc.pathname === "/kiosk";
  const branding = useBranding();
  const kioskLogoUrl = branding?.kioskLogoUrl || branding?.brandLogoUrl || branding?.headerLogoUrl || "";
  const [browserFs, setBrowserFs] = useState(false);
  const requestFs = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setBrowserFs(true);
    } catch { /* user may deny */ }
  };
  const exitFs = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* noop */ }
    setBrowserFs(false);
  };
  useEffect(() => {
    const onFsChange = () => setBrowserFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  // Auto-enter browser fullscreen the first time /kiosk is opened (only if the
  // user gesture-navigated here — which is the case from the Open Kiosk button).
  useEffect(() => {
    if (isFullscreenRoute && !document.fullscreenElement) {
      // requestFullscreen must run from a gesture; try once, ignore errors.
      requestFs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreenRoute]);

  // iter-131.30: activeSlot is stricter than activeMealNow — "off" means
  // we're outside BOTH windows (early-morning/afternoon/late-night) and both
  // Lunch/Dinner tabs should render disabled.
  const activeSlot = React.useMemo(() => {
    const now = new Date();
    const ist = new Date(now.getTime() + (330 - now.getTimezoneOffset()) * 60_000);
    const m = ist.getHours() * 60 + ist.getMinutes();
    if (m >= 12 * 60 && m <= 15 * 60) return "lunch";
    if (m >= 19 * 60 && m <= 22 * 60) return "dinner";
    return "off";
  }, []);
  const [, setSlotTick] = useState(0); // re-render every minute so activeSlot recomputes
  useEffect(() => { const id = setInterval(() => setSlotTick((t) => t + 1), 60_000); return () => clearInterval(id); }, []);

  /* ---------------- TOP: Counter QR ---------------- */
  // iter-131.29: auto-select meal by IST clock. Lunch 12:00–15:00, Dinner
  // 19:00–22:00; outside slots we default to whichever slot is next.
  const activeMealNow = React.useMemo(() => {
    const now = new Date();
    const ist = new Date(now.getTime() + (330 - now.getTimezoneOffset()) * 60_000);
    const m = ist.getHours() * 60 + ist.getMinutes();
    if (m >= 12 * 60 && m <= 15 * 60) return "lunch";
    if (m >= 19 * 60 && m <= 22 * 60) return "dinner";
    // Off-window: pick the next upcoming slot
    if (m < 12 * 60) return "lunch";
    if (m < 19 * 60) return "dinner";
    return "lunch"; // late night → tomorrow's lunch
  }, []);
  const [meal, setMeal] = useState(activeMealNow);
  // Re-sync when the clock crosses a slot boundary (every 60 s).
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const ist = new Date(now.getTime() + (330 - now.getTimezoneOffset()) * 60_000);
      const m = ist.getHours() * 60 + ist.getMinutes();
      let next = "lunch";
      if (m >= 12 * 60 && m <= 15 * 60) next = "lunch";
      else if (m >= 19 * 60 && m <= 22 * 60) next = "dinner";
      else if (m < 12 * 60) next = "lunch";
      else if (m < 19 * 60) next = "dinner";
      setMeal((prev) => prev === next ? prev : next);
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  const [counter, setCounter] = useState(null);
  const loadCounter = useCallback(async () => {
    try {
      const r = await api.get(`/counter/qr?meal=${meal}&location=${LOCATION}`);
      setCounter(r.data);
    } catch (e) { console.warn("[AdminKiosk] /counter/qr fetch failed", e); }
  }, [meal]);
  useEffect(() => { loadCounter(); const id = setInterval(loadCounter, 25_000); return () => clearInterval(id); }, [loadCounter]);

  /* ---------------- Mess-menu order state ---------------- */
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState("today");
  const [orderMeal, setOrderMeal] = useState("lunch");
  const [service, setService] = useState("takeaway");
  const [qty, setQty] = useState(1);
  const [paymentMethod, setPaymentMethodRaw] = useState("cash");
  const [cashAmount, setCashAmount] = useState(0);
  const [onlineAmount, setOnlineAmount] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [pendingOrder, setPendingOrder] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const printedFor = useRef(new Set());

  const loadMenu = useCallback(async () => {
    try {
      const r = await api.get("/mess-menu/today?include_next=1");
      setData(r.data);
      setCfg(r.data?.config || null);
    } catch (e) { console.warn("[AdminKiosk] /mess-menu/today fetch failed", e); }
  }, []);
  useEffect(() => { loadMenu(); const id = setInterval(loadMenu, 60_000); return () => clearInterval(id); }, [loadMenu]);

  const active = tab === "today" ? data?.current : data?.next;
  const activeDate = tab === "today" ? data?.today : data?.tomorrow;
  const priceFor = useCallback((svc) => Number(cfg?.[`price_${svc}`] || 0), [cfg]);
  const total = useMemo(() => priceFor(service) * qty, [service, qty, priceFor]);

  // Auto-balance helpers (mutating qty/service/payment-mode all re-pin amounts).
  const setPaymentMethod = (next) => {
    setPaymentMethodRaw(next);
    if (next === "cash") { setCashAmount(total); setOnlineAmount(0); }
    else if (next === "online") { setCashAmount(0); setOnlineAmount(total); }
    else { const half = Math.floor(total / 2); setCashAmount(half); setOnlineAmount(total - half); }
  };
  const setCash = (n) => {
    const cash = Math.max(0, Math.min(total, Number(n) || 0));
    setCashAmount(cash);
    setOnlineAmount(Math.max(0, total - cash));
  };
  const setQtySafe = (n) => {
    const newQty = typeof n === "function" ? n(qty) : n;
    setQty(newQty);
    const newTotal = priceFor(service) * newQty;
    if (paymentMethod === "cash") { setCashAmount(newTotal); setOnlineAmount(0); }
    else if (paymentMethod === "online") { setCashAmount(0); setOnlineAmount(newTotal); }
    else { const half = Math.floor(newTotal / 2); setCashAmount(half); setOnlineAmount(newTotal - half); }
  };
  const setServiceSafe = (s) => {
    setService(s);
    const newTotal = Number(cfg?.[`price_${s}`] || 0) * qty;
    if (paymentMethod === "cash") { setCashAmount(newTotal); setOnlineAmount(0); }
    else if (paymentMethod === "online") { setCashAmount(0); setOnlineAmount(newTotal); }
    else { const half = Math.floor(newTotal / 2); setCashAmount(half); setOnlineAmount(newTotal - half); }
  };

  /* ---------------- Bluetooth admin toggle ---------------- */
  const [btCfg, setBtCfg] = useState(null);
  const [btStatus, setBtStatus] = useState(() => (
    typeof window !== "undefined" && window.__efcBtPrinter ? "connected" : "idle"
  ));
  const loadBtCfg = useCallback(async () => {
    try { const r = await api.get("/admin/kiosk/bt-config"); setBtCfg(r.data); }
    catch (e) { setBtCfg({ enabled: false }); console.warn("[AdminKiosk] bt-config fetch failed", e); }
  }, []);
  useEffect(() => { loadBtCfg(); }, [loadBtCfg]);

  /* iter-131.31: Paytm retired — kiosk now uses Razorpay Dynamic UPI QR only.
     We lock the provider to "razorpay" and try to persist it once on mount so
     any legacy DB value migrates. The toggle UI is gone; users see one option. */
  const [qrProvider, setQrProviderState] = useState("razorpay");
  const loadQrProvider = useCallback(async () => {
    try {
      const r = await api.get("/admin/kiosk/qr-provider");
      if (r.data?.provider && r.data.provider !== "razorpay") {
        // Migrate legacy paytm setting to razorpay silently.
        try { await api.put("/admin/kiosk/qr-provider", { provider: "razorpay" }); } catch { /* ignore */ }
      }
      setQrProviderState("razorpay");
    } catch (e) { setQrProviderState("razorpay"); console.warn("[AdminKiosk] qr-provider fetch failed", e); }
  }, []);
  useEffect(() => { loadQrProvider(); }, [loadQrProvider]);
  const setQrProvider = async () => { /* no-op — provider locked to razorpay */ };

  const setBtEnabled = async (enabled) => {
    try {
      const r = await api.put("/admin/kiosk/bt-config", { enabled });
      setBtCfg(r.data);
      if (!enabled && typeof window !== "undefined") {
        try { window.__efcBtPrinter?.disconnect(); }
        catch (e) { console.warn("[AdminKiosk] bt printer disconnect failed", e); }
        window.__efcBtPrinter = null;
        setBtStatus("idle");
      }
      toast.success(enabled ? "Bluetooth printing ON" : "Bluetooth printing OFF");
    } catch { toast.error("Could not save"); }
  };

  const ensurePrinter = useCallback(async () => {
    if (typeof window === "undefined") return null;
    if (window.__efcBtPrinter) return window.__efcBtPrinter;
    if (!isBluetoothSupported()) { toast.error("Bluetooth not supported in this browser"); return null; }
    try {
      setBtStatus("connecting");
      const printer = await connectBluetoothPrinter();
      window.__efcBtPrinter = printer;
      printer.device.addEventListener("gattserverdisconnected", () => {
        if (window.__efcBtPrinter === printer) window.__efcBtPrinter = null;
        setBtStatus("idle");
        toast.message("Printer disconnected — pair again next print");
      });
      setBtStatus("connected");
      toast.success(`Paired with ${printer.name}`);
      return printer;
    } catch (e) {
      setBtStatus("idle");
      toast.error(e?.message || "Could not pair printer");
      return null;
    }
  }, []);

  /* iter-74 #1: poll Razorpay QR every 4s while modal is open. */
  useEffect(() => {
    if (!pendingOrder?.razorpayQrId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || !pendingOrder?.order?.order_id) return;
      try {
        const r = await api.get(`/admin/kiosk/order/${pendingOrder.order.order_id}/payment-status`);
        if (cancelled) return;
        if (r.data?.online_paid) {
          if (pendingOrder.order.payment_method === "mixed") {
            setPendingOrder((prev) => prev ? { ...prev, order: { ...prev.order, online_paid: true } } : prev);
          } else if (r.data.settled) {
            const rcpt = { order: r.data.order, qrDataUrl: pendingOrder.qrDataUrl, qrText: pendingOrder.qrText };
            setReceipt(rcpt);
            const orderId = rcpt.order.order_id;
            if (btCfg?.enabled && !printedFor.current.has(orderId)) {
              const printer = await ensurePrinter();
              if (printer) {
                try { await printer.printReceipt(rcpt.order, rcpt.qrText); printedFor.current.add(orderId); }
                catch (e) { console.warn("[AdminKiosk] auto-print failed (user can re-print)", e); }
              }
            }
            setPendingOrder(null);
            setQty(1); setService("takeaway"); setPaymentMethodRaw("cash"); setCashAmount(0); setOnlineAmount(0);
            toast.success("Payment received · receipt printed");
          }
        }
      } catch (e) { /* keep polling — transient */ void e; }
    };
    const id = setInterval(tick, 4000);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [pendingOrder, btCfg?.enabled, ensurePrinter]);

  const resetOrderForm = () => {
    setQty(1); setService("takeaway"); setPaymentMethod("cash");
    setCashAmount(0); setOnlineAmount(0); setPendingOrder(null);
  };

  const confirmPayment = useCallback(async (target, flags) => {
    const obj = target || pendingOrder;
    if (!obj?.order) return;
    try {
      const r = await api.post("/admin/kiosk/order/confirm-payment", {
        order_id: obj.order.order_id,
        online_paid: !!flags.online_paid,
        cash_received: !!flags.cash_received,
      });
      if (r.data?.settled) {
        toast.success("Payment confirmed");
        const rcpt = { order: r.data.order, qrDataUrl: obj.qrDataUrl, qrText: obj.qrText };
        setReceipt(rcpt);
        const orderId = rcpt.order.order_id;
        if (btCfg?.enabled && !printedFor.current.has(orderId)) {
          const printer = await ensurePrinter();
          if (printer) {
            try { await printer.printReceipt(rcpt.order, rcpt.qrText); printedFor.current.add(orderId); toast.success("Receipt printed"); }
            catch { toast.error("Auto-print failed — use the modal Print button"); }
          }
        }
        setPendingOrder(null);
        resetOrderForm();
      } else {
        setPendingOrder((prev) => prev ? { ...prev, order: r.data.order } : prev);
        toast.message("Awaiting remaining payment");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Confirm failed");
    }
  }, [pendingOrder, btCfg?.enabled, ensurePrinter]);

  const placeOrder = async () => {
    if (!active || (!active.lunch && !active.dinner)) { toast.error("No menu for selected day"); return; }
    if (paymentMethod === "mixed" && (cashAmount + onlineAmount) !== total) {
      toast.error(`Cash + Online must equal ₹${total}`); return;
    }
    setPlacing(true);
    try {
      const r = await api.post("/admin/kiosk/order", {
        service, qty, date: activeDate, meal_type: orderMeal,
        payment_method: paymentMethod,
        cash_amount: cashAmount,
        online_amount: onlineAmount,
      });
      const order = r.data?.order;
      toast.success(`Order placed · ₹${order?.total || total} · ${paymentMethod.toUpperCase()}`);
      setLastOrder(order);
      setPendingOrder({
        order,
        qrDataUrl: r.data?.qr_data_url || "",
        qrText: r.data?.qr_text || "",
        upiQrText: r.data?.upi_qr_text || "",
        upiVpa: r.data?.upi_vpa || "",
        provider: r.data?.qr_provider || "paytm",
        razorpayQrImageUrl: r.data?.razorpay_qr_image_url || "",
        razorpayQrId: r.data?.razorpay_qr_id || "",
      });
      if (paymentMethod === "cash") {
        await confirmPayment(
          { order, qrText: r.data?.qr_text, qrDataUrl: r.data?.qr_data_url, upiQrText: "", upiVpa: "" },
          { cash_received: true },
        );
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not place order");
    } finally { setPlacing(false); }
  };

  const cancelPending = () => {
    setPendingOrder(null);
    toast.message("Cancelled — start a new order");
  };

  return (
    <div
      className={`min-h-screen text-white grid gap-3 p-4 kiosk-lights-shell ${isFullscreenRoute ? "grid-rows-[3fr_4fr]" : "grid-rows-[5fr_3fr]"}`}
      style={{ background: "hsl(0, 76%, 45%)" }}
      data-testid="admin-kiosk-page"
      data-kiosk-fs={isFullscreenRoute ? "1" : "0"}
    >
      <KioskCounterPanel
        meal={meal} setMeal={setMeal} counter={counter} activeSlot={activeSlot} kioskLogoUrl={kioskLogoUrl}
        qrProvider={qrProvider} onSetQrProvider={setQrProvider}
        btCfg={btCfg} btStatus={btStatus}
        onSetBtEnabled={setBtEnabled} onPairPrinter={ensurePrinter}
      />

      <section className="rounded-3xl border border-white/25 bg-black/45 backdrop-blur-sm overflow-hidden flex flex-col" data-testid="kiosk-order-panel">
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/12">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center justify-center rounded-xl bg-white/15 text-white ${isFullscreenRoute ? "h-11 w-11" : "h-8 w-8"}`}>
              <ShoppingCart className={isFullscreenRoute ? "h-6 w-6" : "h-4 w-4"} />
            </span>
            <div>
              <p className={`tracking-[0.18em] uppercase font-bold text-white/80 ${isFullscreenRoute ? "text-sm" : "text-[10px]"}`}>Wall kiosk · self-order</p>
              <p className={`font-display font-extrabold ${isFullscreenRoute ? "text-2xl sm:text-3xl" : "text-base sm:text-lg"}`}>Tap. Pay. Print.</p>
            </div>
          </div>
          <div className="inline-flex bg-white/12 rounded-full p-1 gap-1" data-testid="kiosk-day-toggle">
            <button type="button" onClick={() => setTab("today")} className={`rounded-full font-extrabold ${isFullscreenRoute ? "px-6 h-12 text-base" : "px-4 h-9 text-xs"} ${tab === "today" ? "bg-white text-black" : "text-white/80"}`} data-testid="kiosk-day-today">Today</button>
            <button type="button" onClick={() => setTab("tomorrow")} className={`rounded-full font-extrabold ${isFullscreenRoute ? "px-6 h-12 text-base" : "px-4 h-9 text-xs"} ${tab === "tomorrow" ? "bg-white text-black" : "text-white/80"}`} data-testid="kiosk-day-tomorrow">Tomorrow</button>
          </div>
          {/* iter-131.28: fullscreen kiosk mode toggle */}
          {isFullscreenRoute ? (
            <div className="flex items-center gap-2 ml-2">
              {browserFs ? (
                <button type="button" onClick={exitFs} className="inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-white/15 text-white hover:bg-white/25 text-sm font-extrabold" data-testid="kiosk-exit-browser-fs">
                  <Minimize2 className="h-4 w-4" /> Exit fullscreen
                </button>
              ) : (
                <button type="button" onClick={requestFs} className="inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-white/15 text-white hover:bg-white/25 text-sm font-extrabold" data-testid="kiosk-enter-browser-fs">
                  <Maximize2 className="h-4 w-4" /> Fullscreen
                </button>
              )}
              <Link to="/admin/kiosk" className="inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-white text-primary hover:bg-white/90 text-sm font-extrabold" data-testid="kiosk-close-kiosk">
                <X className="h-4 w-4" /> Close
              </Link>
            </div>
          ) : (
            <Link to="/kiosk" className="inline-flex items-center gap-1.5 h-9 px-3 ml-2 rounded-full bg-white text-primary hover:bg-white/90 text-xs font-extrabold" data-testid="kiosk-open-fullscreen">
              <Maximize2 className="h-3.5 w-3.5" /> Open kiosk mode
            </Link>
          )}
        </div>

        <div className={`flex-1 p-4 grid gap-3 overflow-auto items-start ${isFullscreenRoute ? "grid-cols-[2fr_3fr]" : "sm:grid-cols-[3fr_2fr]"}`}>
          <KioskMenuCard active={active} activeDate={activeDate} tab={tab} cfg={cfg} isFullscreen={isFullscreenRoute} />
          <KioskOrderForm
            active={active}
            orderMeal={orderMeal} setOrderMeal={setOrderMeal}
            service={service} setServiceSafe={setServiceSafe}
            priceFor={priceFor}
            qty={qty} setQtySafe={setQtySafe}
            paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
            cashAmount={cashAmount} onlineAmount={onlineAmount} setCash={setCash}
            total={total} placing={placing} pendingOrder={pendingOrder}
            onPlaceOrder={placeOrder} onResetForm={resetOrderForm}
            lastOrder={lastOrder} receipt={receipt}
            onReopenReceipt={() => setReceipt(receipt ? { ...receipt } : null)}
            isFullscreen={isFullscreenRoute}
          />
        </div>
      </section>

      <KioskPaymentModal
        pendingOrder={pendingOrder}
        onConfirm={(flags) => confirmPayment(null, flags)}
        onCancel={cancelPending}
      />

      {receipt && (
        <KioskReceiptModal
          order={receipt.order}
          qrDataUrl={receipt.qrDataUrl}
          qrText={receipt.qrText}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}
