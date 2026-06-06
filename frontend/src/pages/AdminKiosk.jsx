/**
 * Admin Wall Kiosk — iter-72 redesign + iter-73 #14 self-order rebuild.
 *
 * Top half: stationary COUNTER QR (rotating HMAC code). Customers scan it
 * with their phone — no camera needed on the kiosk.
 *
 * Bottom half (iter-73 #14): SELF-ORDER wall kiosk with TAKEAWAY (₹120) and
 * DINING (₹100) only — no delivery. Three payment modes:
 *   • cash — staff collects at counter, tap "Cash received" to settle
 *   • online — flash a Paytm Dynamic UPI QR with the merchant VPA; customer
 *     scans + pays; staff taps "Mark paid" to settle
 *   • mixed — split cash + online amounts (both must equal total)
 * Once settled, the receipt auto-prints to the paired Bluetooth thermal
 * printer (admin must toggle Bluetooth ON + pair once per session).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Sun, Moon, Utensils, Package, ShoppingCart, Loader2, Minus, Plus, RotateCcw,
  Bluetooth, BluetoothConnected, BluetoothOff, Banknote, ScanLine,
  Wallet as WalletIcon, CheckCircle2, X as XIcon,
} from "lucide-react";
import KioskReceiptModal from "../components/KioskReceiptModal";
import { connectBluetoothPrinter, isBluetoothSupported } from "../lib/bluetoothPrinter";

// iter-73 #14: drop delivery → takeaway/dining only for the wall kiosk
const SERVICE_TABS = [
  { id: "takeaway", label: "Takeaway", icon: Package },
  { id: "dining",   label: "Dining",   icon: Utensils },
];
const PAY_TABS = [
  { id: "cash",   label: "Cash",        icon: Banknote },
  { id: "online", label: "Paytm QR",    icon: ScanLine },
  { id: "mixed",  label: "Cash + UPI",  icon: WalletIcon },
];
const LOCATION = "main";

export default function AdminKiosk() {
  /* ---------------- TOP: Counter QR ---------------- */
  const [meal, setMeal] = useState("lunch");
  const [counter, setCounter] = useState(null);
  const loadCounter = useCallback(async () => {
    try {
      const r = await api.get(`/counter/qr?meal=${meal}&location=${LOCATION}`);
      setCounter(r.data);
    } catch { /* silent */ }
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
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadMenu(); const id = setInterval(loadMenu, 60_000); return () => clearInterval(id); }, [loadMenu]);

  const active = tab === "today" ? data?.current : data?.next;
  const activeDate = tab === "today" ? data?.today : data?.tomorrow;
  const priceFor = (svc) => Number(cfg?.[`price_${svc}`] || 0);
  const total = useMemo(() => priceFor(service) * qty, [service, qty, cfg]);

  // Auto-balance helpers — invoked from event handlers (not useEffect) to
  // keep the `react-hooks/set-state-in-effect` rule happy.
  const setPaymentMethod = (next) => {
    setPaymentMethodRaw(next);
    if (next === "cash") { setCashAmount(total); setOnlineAmount(0); }
    else if (next === "online") { setCashAmount(0); setOnlineAmount(total); }
    else {
      const half = Math.floor(total / 2);
      setCashAmount(half);
      setOnlineAmount(total - half);
    }
  };
  const setCash = (n) => {
    const cash = Math.max(0, Math.min(total, Number(n) || 0));
    setCashAmount(cash);
    setOnlineAmount(Math.max(0, total - cash));
  };
  // When qty/service changes, re-pin amounts to the new total so the form
  // stays consistent without a setState-in-effect.
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
    catch { setBtCfg({ enabled: false }); }
  }, []);
  useEffect(() => { loadBtCfg(); }, [loadBtCfg]);

  /* iter-74 #1: kiosk QR provider toggle (Paytm UPI intent vs Razorpay) */
  const [qrProvider, setQrProviderState] = useState("paytm");
  const loadQrProvider = useCallback(async () => {
    try { const r = await api.get("/admin/kiosk/qr-provider"); setQrProviderState(r.data?.provider || "paytm"); }
    catch { setQrProviderState("paytm"); }
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
        try { window.__efcBtPrinter?.disconnect(); } catch { /* ignore */ }
        window.__efcBtPrinter = null;
        setBtStatus("idle");
      }
      toast.success(enabled ? "Bluetooth printing ON" : "Bluetooth printing OFF");
    } catch { toast.error("Could not save"); }
  };

  const ensurePrinter = useCallback(async () => {
    if (typeof window === "undefined") return null;
    if (window.__efcBtPrinter) return window.__efcBtPrinter;
    if (!isBluetoothSupported()) {
      toast.error("Bluetooth not supported in this browser");
      return null;
    }
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

  /* iter-74 #1: poll Razorpay QR every 4s while modal is open. Once
     payments_amount_received covers online_amount, backend auto-marks
     online_paid=true and we settle without staff tapping "Mark paid". */
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
                catch { /* user can re-print from modal */ }
              }
            }
            setPendingOrder(null);
            setQty(1); setService("takeaway"); setPaymentMethodRaw("cash"); setCashAmount(0); setOnlineAmount(0);
            toast.success("Payment received · receipt printed");
          }
        }
      } catch { /* keep polling */ }
    };
    const id = setInterval(tick, 4000);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [pendingOrder?.razorpayQrId, pendingOrder?.order?.order_id, btCfg?.enabled, ensurePrinter, pendingOrder?.order?.payment_method, pendingOrder?.qrDataUrl, pendingOrder?.qrText]);

  const resetOrderForm = () => {
    setQty(1); setService("takeaway"); setPaymentMethod("cash");
    setCashAmount(0); setOnlineAmount(0); setPendingOrder(null);
  };

  const placeOrder = async () => {
    if (!active || (!active.lunch && !active.dinner)) { toast.error("No menu for selected day"); return; }
    if (paymentMethod === "mixed" && (cashAmount + onlineAmount) !== total) {
      toast.error(`Cash + Online must equal ₹${total}`);
      return;
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
      // Cache the QR payload + texts for both the printed receipt and the payment modal.
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
        // straight to confirm + print
        await confirmPayment({ order, qrText: r.data?.qr_text, qrDataUrl: r.data?.qr_data_url, upiQrText: "", upiVpa: "" }, { cash_received: true });
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not place order");
    } finally { setPlacing(false); }
  };

  const confirmPayment = async (target, flags) => {
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
        const rcpt = {
          order: r.data.order,
          qrDataUrl: obj.qrDataUrl,
          qrText: obj.qrText,
        };
        setReceipt(rcpt);
        // Auto-print exactly once per order_id
        const orderId = rcpt.order.order_id;
        if (btCfg?.enabled && !printedFor.current.has(orderId)) {
          const printer = await ensurePrinter();
          if (printer) {
            try {
              await printer.printReceipt(rcpt.order, rcpt.qrText);
              printedFor.current.add(orderId);
              toast.success("Receipt printed");
            } catch {
              toast.error("Auto-print failed — use the modal Print button");
            }
          }
        }
        setPendingOrder(null);
        resetOrderForm();
      } else {
        // partial settlement (mixed — one half pending)
        setPendingOrder((prev) => prev ? { ...prev, order: r.data.order } : prev);
        toast.message("Awaiting remaining payment");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Confirm failed");
    }
  };

  const cancelPending = () => {
    setPendingOrder(null);
    toast.message("Cancelled — start a new order");
  };

  return (
    <div
      className="min-h-screen bg-[hsl(140,12%,8%)] text-[hsl(40,25%,94%)] grid grid-rows-[1fr_1fr] gap-3 p-3"
      data-testid="admin-kiosk-page"
    >
      {/* ---------------- TOP — Counter QR ---------------- */}
      <section className="rounded-3xl border border-[hsl(140,8%,22%)] bg-[hsl(140,8%,12%)] overflow-hidden flex flex-col" data-testid="kiosk-counter-panel">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(140,8%,20%)]">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(135,25%,55%)] text-[hsl(140,8%,8%)]">
              <ScanLine className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(135,25%,72%)]">Counter QR</p>
              <p className="font-display font-extrabold text-lg sm:text-xl">Scan with your phone to check in</p>
            </div>
          </div>
          <div className="flex gap-2" data-testid="kiosk-meal-toggle">
            <Button onClick={() => setMeal("lunch")} data-testid="kiosk-meal-lunch"
              className={`rounded-full h-11 px-5 text-sm font-extrabold ${meal === "lunch" ? "bg-[hsl(26,43%,57%)] text-white" : "bg-[hsl(140,8%,18%)] text-[hsl(40,25%,92%)]"}`}>
              <Sun className="h-4 w-4 mr-1.5" /> Lunch
            </Button>
            <Button onClick={() => setMeal("dinner")} data-testid="kiosk-meal-dinner"
              className={`rounded-full h-11 px-5 text-sm font-extrabold ${meal === "dinner" ? "bg-[hsl(220,55%,55%)] text-white" : "bg-[hsl(140,8%,18%)] text-[hsl(40,25%,92%)]"}`}>
              <Moon className="h-4 w-4 mr-1.5" /> Dinner
            </Button>
          </div>
        </div>

        <div className="flex-1 grid sm:grid-cols-[1.4fr_1fr] gap-4 p-5">
          <div className="rounded-2xl bg-white p-5 flex flex-col items-center justify-center" data-testid="kiosk-counter-qr">
            {counter ? (
              <>
                <QRCodeSVG value={counter.counter_code} size={Math.min(360, 360)} level="M" fgColor="hsl(142 45% 28%)" />
                <p className="font-mono text-[10px] text-muted-foreground mt-3 break-all max-w-md text-center">{counter.counter_code}</p>
                <p className="text-xs font-semibold text-foreground mt-1">{meal.toUpperCase()} · {LOCATION}</p>
              </>
            ) : (
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-5">
              <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(135,25%,72%)]">How it works</p>
              <ol className="mt-2 space-y-2 text-sm text-[hsl(40,15%,82%)] list-decimal list-inside">
                <li>Open your phone camera.</li>
                <li>Point it at the QR on the left.</li>
                <li>Tap the notification to check in for {meal}.</li>
                <li>Walk-in? Scan the QR on your printed receipt instead.</li>
              </ol>
            </div>
            <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-4" data-testid="kiosk-qr-provider-card">
              <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)] mb-2">Online payment QR</p>
              <div className="inline-flex bg-[hsl(140,8%,12%)] rounded-full p-1 gap-1 w-full">
                <button
                  type="button"
                  onClick={() => setQrProvider("paytm")}
                  data-testid="kiosk-qr-provider-paytm"
                  className={`flex-1 px-3 h-9 rounded-full text-[11px] font-extrabold ${qrProvider === "paytm" ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)]" : "text-[hsl(40,15%,70%)]"}`}
                >Paytm UPI</button>
                <button
                  type="button"
                  onClick={() => setQrProvider("razorpay")}
                  data-testid="kiosk-qr-provider-razorpay"
                  className={`flex-1 px-3 h-9 rounded-full text-[11px] font-extrabold ${qrProvider === "razorpay" ? "bg-[hsl(220,55%,55%)] text-white" : "text-[hsl(40,15%,70%)]"}`}
                >Razorpay</button>
              </div>
              <p className="text-[10px] text-[hsl(40,15%,65%)] mt-2 leading-relaxed">
                {qrProvider === "razorpay"
                  ? "Razorpay Dynamic QR — auto-confirms payment in ~4s. Uses live Razorpay creds."
                  : "Paytm UPI intent QR — works with any UPI app. Staff taps Mark paid after scan."}
              </p>
            </div>
            <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-4" data-testid="kiosk-bt-card">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {btCfg?.enabled
                    ? (btStatus === "connected" ? <BluetoothConnected className="h-4 w-4 text-blue-400" /> : <Bluetooth className="h-4 w-4 text-blue-400" />)
                    : <BluetoothOff className="h-4 w-4 text-[hsl(40,15%,60%)]" />}
                  <p className="text-sm font-extrabold">Bluetooth printer</p>
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!btCfg?.enabled}
                    onChange={(e) => setBtEnabled(e.target.checked)}
                    className="sr-only peer"
                    data-testid="kiosk-bt-toggle"
                  />
                  <span className="w-10 h-6 bg-[hsl(140,8%,22%)] peer-checked:bg-blue-600 rounded-full relative transition-colors">
                    <span className="absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-md" />
                  </span>
                </label>
              </div>
              {btCfg?.enabled && (
                <>
                  <p className="text-[11px] text-[hsl(40,15%,70%)] mt-1.5">
                    {btStatus === "connected" ? "Paired — auto-print on every order." : "Pair once per kiosk session — receipts auto-print after."}
                  </p>
                  {btStatus !== "connected" && (
                    <Button
                      onClick={ensurePrinter}
                      className="mt-2 rounded-full h-9 text-xs bg-blue-600 hover:bg-blue-700 w-full"
                      disabled={btStatus === "connecting"}
                      data-testid="kiosk-bt-pair"
                    >
                      {btStatus === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Bluetooth className="h-3.5 w-3.5 mr-1.5" />}
                      {btStatus === "connecting" ? "Pairing…" : "Pair printer now"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- BOTTOM — Walk-in self-order ---------------- */}
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
          <div
            className="rounded-2xl p-4 sm:p-5 relative overflow-hidden"
            style={cfg ? {
              background: `linear-gradient(145deg, ${cfg.bg_gradient_from} 0%, ${cfg.bg_gradient_mid} 45%, ${cfg.bg_gradient_to} 100%)`,
              color: cfg.text_color,
            } : { background: "#0c1a14" }}
            data-testid="kiosk-menu-card"
          >
            {active ? (
              <>
                <p className="text-[10px] tracking-[0.2em] uppercase font-extrabold opacity-85">
                  {tab === "today" ? "Today's mess menu" : "Tomorrow's preview"} · {new Date(activeDate).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
                </p>
                <div className="mt-3 grid sm:grid-cols-2 gap-3">
                  {active.lunch && (
                    <div className="rounded-xl bg-white/10 px-3 py-2.5">
                      <p className="text-[10px] tracking-[0.18em] uppercase font-bold opacity-80 flex items-center gap-1"><Sun className="h-3 w-3" /> Lunch</p>
                      <p className="text-[14px] sm:text-base font-bold leading-snug mt-0.5">{active.lunch}</p>
                    </div>
                  )}
                  {active.dinner && (
                    <div className="rounded-xl bg-white/10 px-3 py-2.5">
                      <p className="text-[10px] tracking-[0.18em] uppercase font-bold opacity-80 flex items-center gap-1"><Moon className="h-3 w-3" /> Dinner</p>
                      <p className="text-[14px] sm:text-base font-bold leading-snug mt-0.5">{active.dinner}</p>
                    </div>
                  )}
                </div>
                {active.note && <p className="mt-3 text-[11px] italic opacity-85">★ {active.note}</p>}
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-center px-4">
                <p className="text-sm opacity-80">No {tab === "today" ? "menu" : "preview"} published — try the other tab.</p>
              </div>
            )}
          </div>

          {active ? (
            <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-4 flex flex-col gap-2.5" data-testid="kiosk-order-form">
              {active.lunch && active.dinner ? (
                <div className="inline-flex rounded-full bg-[hsl(140,8%,12%)] p-1 gap-1 self-start">
                  <button type="button" onClick={() => setOrderMeal("lunch")} data-testid="kiosk-order-meal-lunch" className={`px-4 h-9 rounded-full text-xs font-extrabold ${orderMeal === "lunch" ? "bg-[hsl(26,43%,57%)] text-white" : "text-[hsl(40,15%,70%)]"}`}>Lunch</button>
                  <button type="button" onClick={() => setOrderMeal("dinner")} data-testid="kiosk-order-meal-dinner" className={`px-4 h-9 rounded-full text-xs font-extrabold ${orderMeal === "dinner" ? "bg-[hsl(220,55%,55%)] text-white" : "text-[hsl(40,15%,70%)]"}`}>Dinner</button>
                </div>
              ) : null}

              {/* iter-73 #14: takeaway + dining ONLY (delivery removed). */}
              <div className="grid grid-cols-2 gap-2">
                {SERVICE_TABS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setServiceSafe(s.id)}
                    data-testid={`kiosk-svc-${s.id}`}
                    className={`rounded-xl px-2 py-2 inline-flex flex-col items-center gap-0.5 text-[11px] font-extrabold tracking-wide border ${service === s.id ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)] border-transparent" : "bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,15%,80%)]"}`}
                  >
                    <s.icon className="h-4 w-4" />
                    {s.label}
                    <span className="tabular-nums text-[10px] opacity-80">₹{priceFor(s.id)}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl bg-[hsl(140,8%,12%)] px-2 py-1.5">
                <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)] pl-2">Quantity</span>
                <div className="inline-flex items-center rounded-full bg-[hsl(140,8%,8%)]">
                  <button type="button" onClick={() => setQtySafe((q) => Math.max(1, q - 1))} className="h-10 w-10 inline-flex items-center justify-center" data-testid="kiosk-qty-dec"><Minus className="h-4 w-4" /></button>
                  <span className="px-4 text-lg font-extrabold tabular-nums" data-testid="kiosk-qty">{qty}</span>
                  <button type="button" onClick={() => setQtySafe((q) => Math.min(20, q + 1))} className="h-10 w-10 inline-flex items-center justify-center" data-testid="kiosk-qty-inc"><Plus className="h-4 w-4" /></button>
                </div>
              </div>

              {/* iter-73 #14: payment mode — cash / online (Paytm QR) / mixed */}
              <div className="grid grid-cols-3 gap-2">
                {PAY_TABS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPaymentMethod(p.id)}
                    data-testid={`kiosk-pay-${p.id}`}
                    className={`rounded-xl px-2 py-2 inline-flex flex-col items-center justify-center gap-0.5 text-[10px] font-extrabold tracking-wide border ${paymentMethod === p.id ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)] border-transparent" : "bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,15%,80%)]"}`}
                  >
                    <p.icon className="h-3.5 w-3.5" /> {p.label}
                  </button>
                ))}
              </div>

              {paymentMethod === "mixed" && (
                <div className="grid grid-cols-2 gap-2" data-testid="kiosk-mixed-amounts">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)]">Cash ₹</span>
                    <Input
                      type="number"
                      min={0}
                      max={total}
                      value={cashAmount}
                      onChange={(e) => setCash(e.target.value)}
                      data-testid="kiosk-mixed-cash"
                      className="h-9 bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,25%,94%)]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)]">Online ₹</span>
                    <Input
                      type="number"
                      readOnly
                      value={onlineAmount}
                      data-testid="kiosk-mixed-online"
                      className="h-9 bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,25%,94%)]"
                    />
                  </label>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 mt-1">
                <span className="text-[11px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)]">Total</span>
                <span className="font-display font-extrabold text-2xl tabular-nums" data-testid="kiosk-total">₹{total}</span>
              </div>
              <Button
                onClick={placeOrder}
                disabled={placing || !!pendingOrder}
                className="h-11 rounded-full bg-[hsl(26,43%,57%)] hover:bg-[hsl(26,43%,62%)] text-white font-extrabold text-base"
                data-testid="kiosk-place-order"
              >
                {placing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShoppingCart className="h-4 w-4 mr-2" />}
                Place order
              </Button>
              <Button onClick={resetOrderForm} variant="ghost" className="text-[hsl(40,15%,70%)] hover:text-white text-xs h-8" data-testid="kiosk-order-reset">
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
              </Button>

              {lastOrder && !pendingOrder && (
                <div className="rounded-xl border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-emerald-100" data-testid="kiosk-last-order">
                  <p className="text-[10px] tracking-[0.18em] uppercase font-bold opacity-85">Last order</p>
                  <p className="text-xs mt-0.5 font-mono break-all">{lastOrder.order_id}</p>
                  <p className="text-xs">{lastOrder.qty} × {lastOrder.menu_text?.slice(0, 60)}{lastOrder.menu_text?.length > 60 ? "…" : ""} · ₹{lastOrder.total}</p>
                  {receipt && (
                    <button type="button" onClick={() => setReceipt({ ...receipt })} className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white px-3 h-7 text-[11px] font-extrabold hover:bg-emerald-500" data-testid="kiosk-reprint">Re-open receipt</button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-6 text-sm text-[hsl(40,15%,70%)] text-center">
              Menu not published yet — switch days or check back shortly.
            </div>
          )}
        </div>
      </section>

      {/* === Paytm Dynamic QR / payment confirm modal ====================== */}
      {pendingOrder && pendingOrder.order && pendingOrder.order.payment_method !== "cash" && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" data-testid="kiosk-paytm-modal">
          <div className="bg-white text-[hsl(140,8%,8%)] rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(140,30%,32%)]">
                  {pendingOrder.provider === "razorpay" ? "Razorpay · auto-confirms" : "Awaiting payment"}
                </p>
                <p className="font-display font-extrabold text-xl">Scan to pay ₹{pendingOrder.order.online_amount}</p>
                {pendingOrder.provider !== "razorpay" && (
                  <p className="text-[11px] text-muted-foreground">VPA: <span className="font-mono">{pendingOrder.upiVpa || "efoodcare@paytm"}</span></p>
                )}
              </div>
              <button type="button" onClick={cancelPending} className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-[hsl(140,8%,90%)]" data-testid="kiosk-paytm-cancel">
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {pendingOrder.provider === "razorpay" && pendingOrder.razorpayQrImageUrl ? (
              <div className="mt-4 flex flex-col items-center">
                <div className="rounded-2xl bg-white p-4 border-2 border-[hsl(220,55%,55%)]" data-testid="kiosk-razorpay-qr">
                  <img
                    src={pendingOrder.razorpayQrImageUrl}
                    alt="Scan to pay via Razorpay UPI"
                    className="w-[240px] h-[240px] object-contain"
                  />
                </div>
                <p className="text-[11px] mt-2 text-muted-foreground text-center">Razorpay Dynamic QR · auto-confirms on payment</p>
              </div>
            ) : pendingOrder.upiQrText ? (
              <div className="mt-4 flex flex-col items-center">
                <div className="rounded-2xl bg-white p-4 border-2 border-[hsl(140,40%,40%)]">
                  <QRCodeSVG value={pendingOrder.upiQrText} size={240} level="M" />
                </div>
                <p className="text-[11px] font-mono mt-2 text-muted-foreground break-all px-2 text-center">{pendingOrder.upiQrText}</p>
              </div>
            ) : null}

            {pendingOrder.order.payment_method === "mixed" && (
              <div className="mt-3 rounded-xl bg-[hsl(140,40%,95%)] border border-[hsl(140,40%,80%)] p-3 text-[12px]" data-testid="kiosk-paytm-mixed-summary">
                <p className="font-extrabold">Mixed payment</p>
                <p>Cash collected at counter: <span className="font-mono">₹{pendingOrder.order.cash_amount}</span> · UPI online: <span className="font-mono">₹{pendingOrder.order.online_amount}</span></p>
              </div>
            )}

            <div className="mt-4 grid gap-2">
              <Button
                onClick={() => confirmPayment(null, { online_paid: true, cash_received: pendingOrder.order.payment_method === "mixed" })}
                className="h-11 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold"
                data-testid="kiosk-paytm-mark-paid"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {pendingOrder.order.payment_method === "mixed" ? "Both received — print receipt" : "Mark paid & print receipt"}
              </Button>
              {pendingOrder.order.payment_method === "mixed" && (
                <p className="text-[11px] text-center text-muted-foreground">Tap once both UPI confirmation AND cash are in hand.</p>
              )}
              <Button
                onClick={cancelPending}
                variant="ghost"
                className="h-9 text-xs text-muted-foreground"
                data-testid="kiosk-paytm-cancel-2"
              >
                Cancel order
              </Button>
            </div>
          </div>
        </div>
      )}

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
