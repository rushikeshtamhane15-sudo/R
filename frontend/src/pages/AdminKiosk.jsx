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
import { ShoppingCart, Maximize2, Minimize2, Receipt, FileText, Volume2, VolumeX, X } from "lucide-react";
import KioskReceiptModal from "../components/KioskReceiptModal";
import { connectBluetoothPrinter, isBluetoothSupported } from "../lib/bluetoothPrinter";
import { unlockAudio, announceCheckinSuccess } from "../lib/notify";

import KioskCounterPanel from "../components/admin-kiosk/KioskCounterPanel";
import KioskFaceScan from "../components/admin-kiosk/KioskFaceScan";
import KioskMenuCard from "../components/admin-kiosk/KioskMenuCard";
import KioskOrderForm from "../components/admin-kiosk/KioskOrderForm";
import KioskPaymentModal from "../components/admin-kiosk/KioskPaymentModal";
import KioskReprintDialog from "../components/admin-kiosk/KioskReprintDialog";
import KioskDailyReportDialog from "../components/admin-kiosk/KioskDailyReportDialog";

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

  // iter-134.b: fetch admin-configured meal-slot windows from the public
  // /api/meal-slots endpoint. Falls back to sensible defaults (12–15, 19–22)
  // until the response lands. Kept in state so both activeSlot + counter QR
  // stay in sync with the admin's configuration and re-poll every 5 min.
  const [mealSlots, setMealSlots] = useState({
    lunch:  { start: "12:00", end: "15:00" },
    dinner: { start: "19:00", end: "22:00" },
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.get("/meal-slots");
        if (!cancelled && r.data) setMealSlots(r.data);
      } catch (e) { console.warn("[AdminKiosk] /meal-slots fetch failed", e); }
    };
    load();
    // iter-134.i — poll every 60 s (was 5 min) so admin changes appear
    // quickly even without a manual reload.
    const id = setInterval(load, 60_000);
    // Cross-tab / same-tab instant refresh: listen for the "efc:meal-slots-updated"
    // custom event dispatched by AdminMealSlots.save(), plus the localStorage
    // `storage` event so a save on ANY tab hot-refreshes ALL open kiosks.
    const onLocal = () => load();
    const onStorage = (e) => { if (e.key === "efc_meal_slots_updated_at") load(); };
    window.addEventListener("efc:meal-slots-updated", onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("efc:meal-slots-updated", onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Convert `now` → minutes-since-midnight in IST, safe on any device timezone.
  // Uses UTC ms + explicit +5:30 shift, then reads UTC hours/minutes to avoid
  // double-shifting when the device is already in IST (iter-134.j fix).
  const istNowMin = () => {
    const nowMs = Date.now();
    const ist = new Date(nowMs + 330 * 60_000);
    return ist.getUTCHours() * 60 + ist.getUTCMinutes();
  };
  // Convert "HH:MM" → minutes-since-midnight (used to gate the kiosk slot).
  const parseMin = (t) => {
    if (!t) return 0;
    const [h, m] = String(t).split(":").map((s) => parseInt(s, 10) || 0);
    return h * 60 + m;
  };
  const slotWin = React.useMemo(() => ({
    lunch:  { s: parseMin(mealSlots.lunch?.start),  e: parseMin(mealSlots.lunch?.end)  },
    dinner: { s: parseMin(mealSlots.dinner?.start), e: parseMin(mealSlots.dinner?.end) },
  }), [mealSlots]);

  // iter-131.30: activeSlot is stricter than activeMealNow — "off" means
  // we're outside BOTH windows (early-morning/afternoon/late-night) and both
  // Lunch/Dinner tabs should render disabled.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setNowTick((t) => t + 1), 30_000); return () => clearInterval(id); }, []);
  const activeSlot = React.useMemo(() => {
    const m = istNowMin();
    if (m >= slotWin.lunch.s  && m <= slotWin.lunch.e)  return "lunch";
    if (m >= slotWin.dinner.s && m <= slotWin.dinner.e) return "dinner";
    return "off";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotWin, nowTick]);

  // iter-134.e/g: slot-close countdown text for the active tab pill + slot-flip
  // toast for the kiosk when the window changes over. During "off" windows we
  // instead surface "Next: <meal> opens in Xh Ym" so operators always see WHY
  // both tabs are faded and roughly when service resumes.
  const slotCountdownLabel = React.useMemo(() => {
    const m = istNowMin();
    const fmt = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);
    if (activeSlot !== "off") {
      const endMin = activeSlot === "lunch" ? slotWin.lunch.e : slotWin.dinner.e;
      const left = endMin - m;
      if (left <= 0) return "";
      return `${activeSlot === "lunch" ? "Lunch" : "Dinner"} closes in ${fmt(left)}`;
    }
    // "off" — figure out which meal opens next (today or tomorrow-lunch).
    const nextCandidates = [
      { meal: "lunch",  startMin: slotWin.lunch.s },
      { meal: "dinner", startMin: slotWin.dinner.s },
    ].filter((c) => c.startMin > m).sort((a, b) => a.startMin - b.startMin);
    if (nextCandidates.length === 0) {
      // Both slots have already passed for today — next is tomorrow's lunch.
      const wait = (24 * 60 - m) + slotWin.lunch.s;
      return `Lunch opens in ${fmt(wait)}`;
    }
    const nxt = nextCandidates[0];
    const wait = nxt.startMin - m;
    return `${nxt.meal === "lunch" ? "Lunch" : "Dinner"} opens in ${fmt(wait)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlot, slotWin, nowTick]);
  const slotCountdownEndsAt = React.useMemo(() => {
    if (activeSlot === "off") return "";
    const endMin = activeSlot === "lunch" ? slotWin.lunch.e : slotWin.dinner.e;
    const h = Math.floor(endMin / 60), mm = endMin % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")} IST`;
  }, [activeSlot, slotWin]);

  // Toast when the slot flips over (lunch → off → dinner, or vice versa).
  const prevSlotRef = React.useRef(activeSlot);
  useEffect(() => {
    if (prevSlotRef.current === activeSlot) return;
    const prev = prevSlotRef.current;
    const next = activeSlot;
    prevSlotRef.current = next;
    if (prev === "off" && next !== "off") {
      toast.message(`${next === "lunch" ? "🌞 Lunch" : "🌙 Dinner"} slot is now active`, { duration: 6000 });
    } else if (prev !== "off" && next === "off") {
      toast.message(`${prev === "lunch" ? "Lunch" : "Dinner"} slot ended · counter is between meals`, { duration: 6000 });
    } else if (prev !== next) {
      toast.message(`${prev === "lunch" ? "Lunch" : "Dinner"} slot ended · ${next === "lunch" ? "Lunch" : "Dinner"} active`, { duration: 6000 });
    }
  }, [activeSlot]);

  /* ---------------- TOP: Counter QR ---------------- */
  // iter-131.29: auto-select meal by IST clock via admin-configured windows.
  // When outside a slot, we still pick the next upcoming slot so the QR shows
  // something sensible — but activeSlot="off" gates actual scan acceptance.
  const activeMealNow = React.useMemo(() => {
    const m = istNowMin();
    if (m >= slotWin.lunch.s  && m <= slotWin.lunch.e)  return "lunch";
    if (m >= slotWin.dinner.s && m <= slotWin.dinner.e) return "dinner";
    if (m < slotWin.lunch.s)  return "lunch";
    if (m < slotWin.dinner.s) return "dinner";
    return "lunch"; // late night → tomorrow's lunch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotWin, nowTick]);
  const [meal, setMeal] = useState("lunch");
  // Auto-sync meal to whatever slot is currently active (or upcoming) — the
  // user cannot scan the wrong QR during the opposite slot. If the admin
  // changes the windows, this re-runs and updates the QR splash.
  useEffect(() => {
    setMeal((prev) => prev === activeMealNow ? prev : activeMealNow);
  }, [activeMealNow]);
  const [counter, setCounter] = useState(null);
  const loadCounter = useCallback(async () => {
    try {
      const r = await api.get(`/counter/qr?meal=${meal}&location=${LOCATION}`);
      setCounter(r.data);
    } catch (e) { console.warn("[AdminKiosk] /counter/qr fetch failed", e); }
  }, [meal]);
  useEffect(() => { loadCounter(); const id = setInterval(loadCounter, 25_000); return () => clearInterval(id); }, [loadCounter]);
  // iter-137.h — voice-alert toggle (state hoisted above the polling effect
  // so JS TDZ doesn't fire when the effect factory reads `voiceOn`).
  const [voiceOn, setVoiceOn] = useState(() => {
    try { return localStorage.getItem("efc.kiosk.voice") === "1"; } catch { return false; }
  });
  const seenAttIdsRef = useRef(new Set());
  const attInitRef = useRef(false);
  // iter-137.h — poll today's attendance every 6s; when a new att_id appears
  // AND the voice toggle is on, play the bilingual "meal check-in successful"
  // announcement. First tick just seeds the seen-set so we don't blast the
  // whole day of history on page load.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await api.get("/admin/attendance/today");
        const recs = (r.data && r.data.attendance) || [];
        if (cancelled) return;
        if (!attInitRef.current) {
          for (const rec of recs) { if (rec.att_id) seenAttIdsRef.current.add(rec.att_id); }
          attInitRef.current = true;
          return;
        }
        // Newly appended records — announce (most recent first, but only 1
        // per tick to avoid a queue of TTS if 3 people scan in the same window).
        const fresh = recs.filter((rec) => rec.att_id && !seenAttIdsRef.current.has(rec.att_id));
        for (const rec of fresh) seenAttIdsRef.current.add(rec.att_id);
        if (fresh.length && voiceOn) {
          const latest = fresh[0]; // sorted checked_at desc by server
          try { announceCheckinSuccess(latest.meal_type || "lunch", latest.subscriber_name || ""); } catch { /* noop */ }
        }
      } catch { /* noop */ }
    };
    tick();
    const id = setInterval(tick, 6_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [voiceOn]);
  // iter-134.e: 1-Hz local tick to power the "Refreshes in Ns" QR countdown pill.
  const [qrTick, setQrTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setQrTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  const qrRotateSeconds = React.useMemo(() => {
    if (!counter?.rotates_at) return 0;
    const nowSec = Math.floor(Date.now() / 1000);
    return Math.max(0, Number(counter.rotates_at) - nowSec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counter, qrTick]);

  /* ---------------- Mess-menu order state ---------------- */
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState("today");
  const [orderMeal, setOrderMeal] = useState("lunch");
  // iter-134.m — orderMeal auto-syncs with the currently-active meal window
  // so staff can't accidentally book a lunch order during dinner slot. The
  // header/QR toggle already syncs; this brings the self-order toggle in
  // lock-step too.
  useEffect(() => {
    setOrderMeal((prev) => prev === activeMealNow ? prev : activeMealNow);
  }, [activeMealNow]);
  const [service, setService] = useState("takeaway");
  const [qty, setQty] = useState(1);
  const [paymentMethod, setPaymentMethodRaw] = useState("cash");
  const [cashAmount, setCashAmount] = useState(0);
  const [onlineAmount, setOnlineAmount] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [pendingOrder, setPendingOrder] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [dailyReportOpen, setDailyReportOpen] = useState(false);
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
    setCustomerName("");
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
        customer_name: (customerName || "").trim() || undefined,
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
        razorpayShortUrl: r.data?.razorpay_qr_short_url || "",
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
      className={`min-h-screen text-white grid gap-3 p-4 kiosk-lights-shell ${isFullscreenRoute ? "grid-rows-[5fr_5fr_auto]" : "grid-rows-[5fr_3fr_auto]"}`}
      style={{ background: "hsl(0, 76%, 45%)" }}
      data-testid="admin-kiosk-page"
      data-kiosk-fs={isFullscreenRoute ? "1" : "0"}
    >
      <KioskCounterPanel
        meal={meal} setMeal={setMeal} counter={counter} activeSlot={activeSlot} kioskLogoUrl={kioskLogoUrl}
        qrProvider={qrProvider} onSetQrProvider={setQrProvider}
        btCfg={btCfg} btStatus={btStatus}
        onSetBtEnabled={setBtEnabled} onPairPrinter={ensurePrinter}
        isFullscreen={isFullscreenRoute}
        slotCountdownLabel={slotCountdownLabel}
        slotCountdownEndsAt={slotCountdownEndsAt}
        qrRotateSeconds={qrRotateSeconds}
      />

      {/* iter-138 — Face check-in preview strip. Only mounts when the admin
          enables Voice (which is also the audio-unlock gesture required for
          the bilingual announcer). Small overlay in a corner so it doesn't
          steal focus from the counter QR. */}
      {voiceOn && (
        <div className={`pointer-events-none fixed z-40 ${isFullscreenRoute ? "bottom-4 right-4 w-64" : "bottom-3 right-3 w-56"}`}>
          <div className="pointer-events-auto">
            <KioskFaceScan
              isFullscreen={isFullscreenRoute}
              active={voiceOn}
              onCheckin={(data) => {
                try {
                  announceCheckinSuccess(data.meal_type || meal || "lunch", data.subscriber_name || "");
                } catch { /* noop */ }
                // Seed the poller so it doesn't double-announce this scan.
                if (data?.record?.att_id) {
                  try { seenAttIdsRef.current.add(data.record.att_id); } catch { /* noop */ }
                }
              }}
            />
          </div>
        </div>
      )}

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
          <button
            type="button"
            onClick={() => {
              const next = !voiceOn;
              setVoiceOn(next);
              try { localStorage.setItem("efc.kiosk.voice", next ? "1" : "0"); } catch { /* noop */ }
              if (next) {
                // The click IS the required user gesture — unlock the audio
                // engine right now so the very first check-in speaks.
                unlockAudio();
                try { announceCheckinSuccess("lunch"); } catch { /* noop */ }
                toast.success("Voice alerts enabled · Hindi + English");
              } else {
                toast.message("Voice alerts muted");
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-full font-extrabold ${voiceOn ? "bg-emerald-500 text-white" : "bg-white/15 text-white hover:bg-white/25"} ${isFullscreenRoute ? "h-12 px-5 text-sm" : "h-9 px-3 text-xs"}`}
            data-testid="kiosk-voice-toggle"
            aria-pressed={voiceOn}
            title={voiceOn ? "Voice alerts on · tap to mute" : "Tap to enable Hindi + English voice alerts"}
          >
            {voiceOn
              ? <Volume2 className={isFullscreenRoute ? "h-4 w-4" : "h-3.5 w-3.5"} />
              : <VolumeX className={isFullscreenRoute ? "h-4 w-4" : "h-3.5 w-3.5"} />}
            {voiceOn ? "Voice ON" : "Voice"}
          </button>
          <button
            type="button"
            onClick={() => setReprintOpen(true)}
            className={`inline-flex items-center gap-1.5 rounded-full font-extrabold bg-white/15 hover:bg-white/25 text-white ${isFullscreenRoute ? "h-12 px-5 text-sm" : "h-9 px-3 text-xs"}`}
            data-testid="kiosk-reprint-open"
          >
            <Receipt className={isFullscreenRoute ? "h-4 w-4" : "h-3.5 w-3.5"} /> Reprint
          </button>
          <button
            type="button"
            onClick={() => setDailyReportOpen(true)}
            className={`inline-flex items-center gap-1.5 rounded-full font-extrabold bg-white/15 hover:bg-white/25 text-white ${isFullscreenRoute ? "h-12 px-5 text-sm" : "h-9 px-3 text-xs"}`}
            data-testid="kiosk-daily-report-open"
          >
            <FileText className={isFullscreenRoute ? "h-4 w-4" : "h-3.5 w-3.5"} /> Day report
          </button>
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

        <div className={`flex-1 p-4 grid gap-3 overflow-auto min-h-0 ${isFullscreenRoute ? "grid-cols-1 grid-rows-[auto_1fr]" : "sm:grid-cols-[3fr_2fr] items-start"}`}>
          {/* iter-137.d/f — day toggle removed per user's request. `tab` state
              is retained (defaults to "today") so KioskMenuCard/OrderForm
              keep their existing prop shape without a broader refactor. */}
          <KioskMenuCard active={active} activeDate={activeDate} tab={tab} cfg={cfg} isFullscreen={isFullscreenRoute} mealSlots={mealSlots} />
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
            customerName={customerName} setCustomerName={setCustomerName}
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

      <KioskReprintDialog
        open={reprintOpen}
        onClose={() => setReprintOpen(false)}
        onReprint={(rcpt) => setReceipt(rcpt)}
      />

      <KioskDailyReportDialog
        open={dailyReportOpen}
        onClose={() => setDailyReportOpen(false)}
      />

      {/* iter-137.a — permanent bottom tag: efoodcare's zero-adulteration promise.
          Sits below the two grid rows on both admin and fullscreen kiosk views. */}
      <div
        className={`flex items-center justify-center gap-2 flex-wrap ${isFullscreenRoute ? "py-2" : "py-1"}`}
        data-testid="kiosk-purity-strip"
      >
        {[
          "0% Ajinomoto",
          "0% Maida",
          "0% Palm or Refined Oil Meal",
          "100% Pure Veg Meal",
        ].map((t) => (
          <span
            key={t}
            className={`inline-flex items-center gap-1 rounded-full bg-white text-primary font-extrabold uppercase tracking-[0.14em] shadow-sm ring-1 ring-white/60 ${isFullscreenRoute ? "text-sm px-4 h-9" : "text-[10px] px-2.5 h-7"}`}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
