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
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { ShoppingCart } from "lucide-react";
import KioskReceiptModal from "../components/KioskReceiptModal";
import { connectBluetoothPrinter, isBluetoothSupported } from "../lib/bluetoothPrinter";

import KioskCounterPanel from "../components/admin-kiosk/KioskCounterPanel";
import KioskMenuCard from "../components/admin-kiosk/KioskMenuCard";
import KioskOrderForm from "../components/admin-kiosk/KioskOrderForm";
import KioskPaymentModal from "../components/admin-kiosk/KioskPaymentModal";

const LOCATION = "main";

export default function AdminKiosk() {
  /* ---------------- TOP: Counter QR ---------------- */
  const [meal, setMeal] = useState("lunch");
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

  /* iter-74 #1: kiosk QR provider toggle (Paytm UPI intent vs Razorpay) */
  const [qrProvider, setQrProviderState] = useState("paytm");
  const loadQrProvider = useCallback(async () => {
    try { const r = await api.get("/admin/kiosk/qr-provider"); setQrProviderState(r.data?.provider || "paytm"); }
    catch (e) { setQrProviderState("paytm"); console.warn("[AdminKiosk] qr-provider fetch failed", e); }
  }, []);
  useEffect(() => { loadQrProvider(); }, [loadQrProvider]);
  const setQrProvider = async (provider) => {
    try {
      const r = await api.put("/admin/kiosk/qr-provider", { provider });
      setQrProviderState(r.data.provider);
      toast.success(`Kiosk QR provider · ${r.data.provider === "razorpay" ? "Razorpay (auto-confirm)" : "Paytm UPI intent"}`);
    } catch { toast.error("Could not switch provider"); }
  };

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
    <div className="min-h-screen bg-[hsl(140,12%,8%)] text-[hsl(40,25%,94%)] grid grid-rows-[1fr_1fr] gap-3 p-3" data-testid="admin-kiosk-page">
      <KioskCounterPanel
        meal={meal} setMeal={setMeal} counter={counter}
        qrProvider={qrProvider} onSetQrProvider={setQrProvider}
        btCfg={btCfg} btStatus={btStatus}
        onSetBtEnabled={setBtEnabled} onPairPrinter={ensurePrinter}
      />

      <section className="rounded-3xl border border-[hsl(140,8%,22%)] bg-[hsl(140,8%,12%)] overflow-hidden flex flex-col" data-testid="kiosk-order-panel">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(140,8%,20%)]">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(26,43%,57%)] text-white">
              <ShoppingCart className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)]">Wall kiosk · self-order</p>
              <p className="font-display font-extrabold text-lg sm:text-xl">Tap. Pay. Print.</p>
            </div>
          </div>
          <div className="inline-flex bg-[hsl(140,8%,18%)] rounded-full p-1 gap-1" data-testid="kiosk-day-toggle">
            <button type="button" onClick={() => setTab("today")} className={`px-4 h-10 rounded-full text-xs font-extrabold ${tab === "today" ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)]" : "text-[hsl(40,15%,70%)]"}`} data-testid="kiosk-day-today">Today</button>
            <button type="button" onClick={() => setTab("tomorrow")} className={`px-4 h-10 rounded-full text-xs font-extrabold ${tab === "tomorrow" ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)]" : "text-[hsl(40,15%,70%)]"}`} data-testid="kiosk-day-tomorrow">Tomorrow</button>
          </div>
        </div>

        <div className="flex-1 p-4 grid sm:grid-cols-[3fr_2fr] gap-3 overflow-auto">
          <KioskMenuCard active={active} activeDate={activeDate} tab={tab} cfg={cfg} />
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
