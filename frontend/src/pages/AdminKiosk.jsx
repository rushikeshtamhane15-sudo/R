/**
 * Admin Wall Kiosk — iter-72 redesign.
 *
 * Top half: stationary COUNTER QR (rotating HMAC code). Customers scan it
 * with their phone — no camera needed on the kiosk. Replaces the iter-69
 * camera scanner per user direction.
 *
 * Bottom half: walk-in self-order with editable qty + service + (compulsory)
 * phone for delivery. Optionally auto-prints to the paired Bluetooth thermal
 * printer when admin has switched on the Bluetooth toggle. Single-use kiosk
 * QR is included on the printed receipt for fraud-free counter check-in.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Sun, Moon, Truck, Utensils, Package, ShoppingCart, Loader2, Minus, Plus, RotateCcw, Bluetooth, BluetoothConnected, BluetoothOff, Banknote, ScanLine,
} from "lucide-react";
import KioskReceiptModal from "../components/KioskReceiptModal";
import { connectBluetoothPrinter, isBluetoothSupported } from "../lib/bluetoothPrinter";

const SERVICE_TABS = [
  { id: "delivery", label: "Delivery", icon: Truck },
  { id: "takeaway", label: "Takeaway", icon: Package },
  { id: "dining", label: "Dining", icon: Utensils },
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
  const [service, setService] = useState("delivery");
  const [qty, setQty] = useState(1);
  const [phone, setPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash"); // cash | upi
  const [placing, setPlacing] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);
  const [receipt, setReceipt] = useState(null);

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
  const total = useMemo(() => priceFor(service) * qty, [service, qty, cfg]); // eslint-disable-line

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

  // Auto-pair printer once when BT is ON and no connection yet.
  // Web Bluetooth requires a user gesture, so we trigger pairing on the
  // "Pair printer now" button OR on Place Order if auto-print is on.
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

  const resetOrderForm = () => { setQty(1); setService("delivery"); setPhone(""); setPaymentMethod("cash"); };

  const placeOrder = async () => {
    if (!active || (!active.lunch && !active.dinner)) { toast.error("No menu for selected day"); return; }
    // iter-72 #5: phone compulsory for DELIVERY ONLY
    const phoneClean = phone.replace(/\D/g, "");
    if (service === "delivery" && phoneClean.length < 10) {
      toast.error("Customer phone required for delivery");
      return;
    }
    setPlacing(true);
    try {
      const r = await api.post("/admin/kiosk/order", {
        service, qty, date: activeDate, meal_type: orderMeal,
        phone: phoneClean || null,
        payment_method: paymentMethod,
      });
      const order = r.data?.order;
      toast.success(`Order placed · ₹${order?.total || total} · ${paymentMethod.toUpperCase()}`);
      setLastOrder(order);
      const rcpt = {
        order,
        qrDataUrl: r.data?.qr_data_url || "",
        qrText: r.data?.qr_text || "",
      };
      setReceipt(rcpt);

      // Auto-print via Bluetooth if admin has enabled it
      if (btCfg?.enabled) {
        const printer = await ensurePrinter();
        if (printer) {
          try {
            await printer.printReceipt(rcpt.order, rcpt.qrText);
            toast.success("Receipt printed");
          } catch (e) {
            toast.error("Auto-print failed — use the modal Print button");
          }
        }
      }
      resetOrderForm();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not place order");
    } finally { setPlacing(false); }
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
            {/* Bluetooth toggle */}
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

      {/* ---------------- BOTTOM — Walk-in order ---------------- */}
      <section className="rounded-3xl border border-[hsl(140,8%,22%)] bg-[hsl(140,8%,12%)] overflow-hidden flex flex-col" data-testid="kiosk-order-panel">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(140,8%,20%)]">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(26,43%,57%)] text-white">
              <ShoppingCart className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)]">Walk-in self-order</p>
              <p className="font-display font-extrabold text-lg sm:text-xl">Order today's mess menu</p>
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
            <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-4 flex flex-col gap-3" data-testid="kiosk-order-form">
              {active.lunch && active.dinner ? (
                <div className="inline-flex rounded-full bg-[hsl(140,8%,12%)] p-1 gap-1 self-start">
                  <button type="button" onClick={() => setOrderMeal("lunch")} data-testid="kiosk-order-meal-lunch" className={`px-4 h-9 rounded-full text-xs font-extrabold ${orderMeal === "lunch" ? "bg-[hsl(26,43%,57%)] text-white" : "text-[hsl(40,15%,70%)]"}`}>Lunch</button>
                  <button type="button" onClick={() => setOrderMeal("dinner")} data-testid="kiosk-order-meal-dinner" className={`px-4 h-9 rounded-full text-xs font-extrabold ${orderMeal === "dinner" ? "bg-[hsl(220,55%,55%)] text-white" : "text-[hsl(40,15%,70%)]"}`}>Dinner</button>
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-2">
                {SERVICE_TABS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setService(s.id)}
                    data-testid={`kiosk-svc-${s.id}`}
                    className={`rounded-xl px-2 py-2 inline-flex flex-col items-center gap-0.5 text-[10px] font-extrabold tracking-wide border ${service === s.id ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)] border-transparent" : "bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,15%,80%)]"}`}
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
                  <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-10 w-10 inline-flex items-center justify-center" data-testid="kiosk-qty-dec"><Minus className="h-4 w-4" /></button>
                  <span className="px-4 text-lg font-extrabold tabular-nums" data-testid="kiosk-qty">{qty}</span>
                  <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} className="h-10 w-10 inline-flex items-center justify-center" data-testid="kiosk-qty-inc"><Plus className="h-4 w-4" /></button>
                </div>
              </div>

              {/* Payment method — iter-72 #2 partial: cash + UPI (Razorpay wired later) */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "cash", label: "Cash", icon: Banknote },
                  { id: "upi", label: "UPI (counter)", icon: ScanLine },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPaymentMethod(p.id)}
                    data-testid={`kiosk-pay-${p.id}`}
                    className={`rounded-xl px-2 py-2 inline-flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide border ${paymentMethod === p.id ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)] border-transparent" : "bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,15%,80%)]"}`}
                  >
                    <p.icon className="h-3.5 w-3.5" /> {p.label}
                  </button>
                ))}
              </div>

              {service === "delivery" && (
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Customer phone (required for delivery)"
                  inputMode="tel"
                  className="h-10 bg-[hsl(140,8%,12%)] border-[hsl(140,8%,22%)] text-[hsl(40,25%,94%)] placeholder:text-[hsl(40,15%,60%)]"
                  data-testid="kiosk-phone"
                />
              )}

              <div className="flex items-center justify-between gap-2 mt-1">
                <span className="text-[11px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)]">Total</span>
                <span className="font-display font-extrabold text-2xl tabular-nums" data-testid="kiosk-total">₹{total}</span>
              </div>
              <Button
                onClick={placeOrder}
                disabled={placing}
                className="h-12 rounded-full bg-[hsl(26,43%,57%)] hover:bg-[hsl(26,43%,62%)] text-white font-extrabold text-base"
                data-testid="kiosk-place-order"
              >
                {placing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShoppingCart className="h-4 w-4 mr-2" />}
                Place order
              </Button>
              <Button onClick={resetOrderForm} variant="ghost" className="text-[hsl(40,15%,70%)] hover:text-white text-xs h-9" data-testid="kiosk-order-reset">
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
              </Button>

              {lastOrder && (
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
