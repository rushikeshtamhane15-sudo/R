/**
 * Admin Kiosk — iter-69.
 *
 * A wall-mounted, touchscreen-friendly page that combines:
 *   • TOP HALF — always-on camera QR scanner for subscriber check-ins.
 *     The scanner re-arms automatically after every scan so the kiosk is
 *     never "frozen" on a previous customer. The QR region stays in the
 *     same DOM position throughout, satisfying the "scan qr must stay
 *     stationary" requirement.
 *   • BOTTOM HALF — walk-in self-order container backed by the existing
 *     mess-menu order endpoints. Updating the order panel never touches
 *     the scanner above it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  ScanLine, UserCheck, Sun, Moon, Truck, Utensils, Package, ShoppingCart, Loader2, Minus, Plus, RotateCcw, Camera, AlertCircle,
} from "lucide-react";
import { playCheckinSuccess, unlockAudio } from "../lib/notify";

const SERVICE_TABS = [
  { id: "delivery", label: "Delivery", icon: Truck },
  { id: "takeaway", label: "Takeaway", icon: Package },
  { id: "dining", label: "Dining", icon: Utensils },
];

const RESCAN_COOLDOWN_MS = 2500; // de-dupe rapid double-scans of the same QR

export default function AdminKiosk() {
  /* ------------------------- TOP: Scanner state ------------------------- */
  const [meal, setMeal] = useState("lunch");
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [scannerError, setScannerError] = useState("");
  const instanceRef = useRef(null);
  const lastTokenRef = useRef({ token: "", at: 0 });

  const stopScanner = useCallback(async () => {
    if (instanceRef.current) {
      try { await instanceRef.current.stop(); await instanceRef.current.clear(); } catch { /* no-op */ }
      instanceRef.current = null;
    }
    setScanning(false);
  }, []);

  const handleToken = useCallback(async (qrToken) => {
    // De-dupe: same QR within cooldown window → ignore (camera fires repeatedly)
    const now = Date.now();
    if (qrToken === lastTokenRef.current.token && now - lastTokenRef.current.at < RESCAN_COOLDOWN_MS) return;
    lastTokenRef.current = { token: qrToken, at: now };
    try {
      const res = await api.post("/attendance/scan", { qr_token: qrToken, meal_type: meal });
      const d = res.data || {};
      playCheckinSuccess();
      setLastScan({
        name: d.subscriber_name,
        phone: d.subscriber_phone,
        photo: d.profile_photo_url,
        plan: d.plan_name,
        meals_left: d.meals_left,
        meals_total: d.meals_total,
        meal_type: meal,
        at: new Date().toLocaleTimeString(),
      });
      toast.success(`${d.subscriber_name} checked in for ${meal}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Scan failed");
    }
  }, [meal]);

  const startScanner = useCallback(async () => {
    unlockAudio();
    setScannerError("");
    setScanning(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      const html5 = new Html5Qrcode("kiosk-scanner-region");
      instanceRef.current = html5;
      await html5.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        (decoded) => handleToken(decoded),
        () => {},
      );
    } catch (e) {
      setScannerError("Camera not available — check permissions or use a different device.");
      setScanning(false);
    }
  }, [handleToken]);

  useEffect(() => { startScanner(); /* eslint-disable-next-line */ }, []);
  // When meal changes, restart so new callbacks pick up the right value
  useEffect(() => {
    if (scanning) {
      (async () => { await stopScanner(); await startScanner(); })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal]);
  useEffect(() => () => { stopScanner(); }, [stopScanner]);

  /* ------------------------- BOTTOM: Mess-menu order ------------------------- */
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState("today"); // today | tomorrow
  const [orderMeal, setOrderMeal] = useState("lunch");
  const [service, setService] = useState("delivery");
  const [qty, setQty] = useState(1);
  const [phone, setPhone] = useState(""); // walk-in customer phone (optional, for delivery)
  const [placing, setPlacing] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

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

  const resetOrderForm = () => { setQty(1); setService("delivery"); setPhone(""); };

  const placeOrder = async () => {
    if (!active || (!active.lunch && !active.dinner)) { toast.error("No menu for selected day"); return; }
    setPlacing(true);
    try {
      const r = await api.post("/admin/kiosk/order", {
        service, qty, date: activeDate, meal_type: orderMeal,
        phone: phone.trim() || null,
      });
      const order = r.data?.order;
      toast.success(`Walk-in order placed · ₹${order?.total || total}`);
      setLastOrder(order);
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
      {/* ---------------------------------------------- TOP — Scanner ---------------------------------------------- */}
      <section className="rounded-3xl border border-[hsl(140,8%,22%)] bg-[hsl(140,8%,12%)] overflow-hidden flex flex-col" data-testid="kiosk-scanner-panel">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(140,8%,20%)]">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(135,25%,55%)] text-[hsl(140,8%,8%)]">
              <ScanLine className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(135,25%,72%)]">Subscriber check-in</p>
              <p className="font-display font-extrabold text-lg sm:text-xl">Scan your QR here</p>
            </div>
          </div>
          <div className="flex gap-2" data-testid="kiosk-meal-toggle">
            <Button
              onClick={() => setMeal("lunch")}
              data-testid="kiosk-meal-lunch"
              className={`rounded-full h-11 px-5 text-sm font-extrabold ${meal === "lunch" ? "bg-[hsl(26,43%,57%)] text-white" : "bg-[hsl(140,8%,18%)] text-[hsl(40,25%,92%)]"}`}
            >
              <Sun className="h-4 w-4 mr-1.5" /> Lunch
            </Button>
            <Button
              onClick={() => setMeal("dinner")}
              data-testid="kiosk-meal-dinner"
              className={`rounded-full h-11 px-5 text-sm font-extrabold ${meal === "dinner" ? "bg-[hsl(220,55%,55%)] text-white" : "bg-[hsl(140,8%,18%)] text-[hsl(40,25%,92%)]"}`}
            >
              <Moon className="h-4 w-4 mr-1.5" /> Dinner
            </Button>
          </div>
        </div>

        {/* Scanner region — STAYS MOUNTED so QR doesn't disappear on bottom-half re-render */}
        <div className="flex-1 grid sm:grid-cols-[2fr_1fr] gap-3 p-4">
          <div className="relative rounded-2xl overflow-hidden bg-[hsl(140,8%,6%)]">
            <div id="kiosk-scanner-region" className={scanning ? "w-full h-full" : "hidden"} />
            {!scanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                {scannerError ? (
                  <>
                    <AlertCircle className="h-10 w-10 text-amber-400" />
                    <p className="text-sm font-semibold text-amber-200">{scannerError}</p>
                  </>
                ) : (
                  <>
                    <Camera className="h-10 w-10 text-[hsl(135,25%,55%)]" />
                    <p className="text-sm text-[hsl(40,15%,70%)]">Starting camera…</p>
                  </>
                )}
                <Button onClick={startScanner} className="rounded-full bg-[hsl(135,25%,55%)] text-[hsl(140,8%,10%)] hover:bg-[hsl(135,25%,65%)] mt-2" data-testid="kiosk-scanner-start">
                  <ScanLine className="h-4 w-4 mr-1.5" /> Start scanner
                </Button>
              </div>
            )}
            {scanning && (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-emerald-500 text-white text-[10px] font-extrabold tracking-overline uppercase px-2.5 py-1 pointer-events-none" data-testid="kiosk-scanner-live">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Live
              </span>
            )}
          </div>

          {/* Last scan card */}
          <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-4 flex flex-col" data-testid="kiosk-last-scan">
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)] flex items-center gap-1.5"><UserCheck className="h-3.5 w-3.5" /> Last check-in</p>
            {lastScan ? (
              <div className="mt-3 flex items-start gap-3">
                {lastScan.photo ? (
                  <img src={lastScan.photo} alt="" className="h-14 w-14 rounded-2xl object-cover shrink-0" />
                ) : (
                  <span className="h-14 w-14 rounded-2xl bg-[hsl(135,25%,55%)] text-[hsl(140,8%,8%)] inline-flex items-center justify-center font-display font-extrabold text-2xl shrink-0">
                    {(lastScan.name || "?").slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="font-display font-extrabold text-base leading-tight truncate" data-testid="kiosk-last-scan-name">{lastScan.name}</p>
                  <p className="text-[11px] text-[hsl(40,15%,70%)] tabular-nums">{lastScan.phone}</p>
                  <p className="text-[10px] mt-1 text-[hsl(135,25%,72%)]">{lastScan.plan}</p>
                  <p className="text-[10px] tabular-nums text-[hsl(40,15%,70%)]">{lastScan.meals_left}/{lastScan.meals_total} meals left</p>
                  <p className="text-[10px] tabular-nums text-[hsl(40,15%,55%)] mt-1">{lastScan.meal_type} · {lastScan.at}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[hsl(40,15%,60%)] mt-4">No scan yet — show your phone QR to the camera.</p>
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------- BOTTOM — Walk-in order ---------------------------------------------- */}
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
          {/* Menu card */}
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

          {/* Order form */}
          {active ? (
            <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-4 flex flex-col gap-3" data-testid="kiosk-order-form">
              {/* meal */}
              {active.lunch && active.dinner ? (
                <div className="inline-flex rounded-full bg-[hsl(140,8%,12%)] p-1 gap-1 self-start">
                  <button type="button" onClick={() => setOrderMeal("lunch")} data-testid="kiosk-order-meal-lunch" className={`px-4 h-9 rounded-full text-xs font-extrabold ${orderMeal === "lunch" ? "bg-[hsl(26,43%,57%)] text-white" : "text-[hsl(40,15%,70%)]"}`}>Lunch</button>
                  <button type="button" onClick={() => setOrderMeal("dinner")} data-testid="kiosk-order-meal-dinner" className={`px-4 h-9 rounded-full text-xs font-extrabold ${orderMeal === "dinner" ? "bg-[hsl(220,55%,55%)] text-white" : "text-[hsl(40,15%,70%)]"}`}>Dinner</button>
                </div>
              ) : null}

              {/* service tabs */}
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

              {/* qty stepper */}
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[hsl(140,8%,12%)] px-2 py-1.5">
                <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)] pl-2">Quantity</span>
                <div className="inline-flex items-center rounded-full bg-[hsl(140,8%,8%)]">
                  <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-10 w-10 inline-flex items-center justify-center" data-testid="kiosk-qty-dec"><Minus className="h-4 w-4" /></button>
                  <span className="px-4 text-lg font-extrabold tabular-nums" data-testid="kiosk-qty">{qty}</span>
                  <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} className="h-10 w-10 inline-flex items-center justify-center" data-testid="kiosk-qty-inc"><Plus className="h-4 w-4" /></button>
                </div>
              </div>

              {service === "delivery" && (
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Customer phone (for delivery)"
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
              <Button
                onClick={resetOrderForm}
                variant="ghost"
                className="text-[hsl(40,15%,70%)] hover:text-white text-xs h-9"
                data-testid="kiosk-order-reset"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
              </Button>

              {lastOrder && (
                <div className="rounded-xl border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-emerald-100" data-testid="kiosk-last-order">
                  <p className="text-[10px] tracking-[0.18em] uppercase font-bold opacity-85">Last order</p>
                  <p className="text-xs mt-0.5 font-mono break-all">{lastOrder.order_id}</p>
                  <p className="text-xs">{lastOrder.qty} × {lastOrder.menu_text?.slice(0, 60)}{lastOrder.menu_text?.length > 60 ? "…" : ""} · ₹{lastOrder.total}</p>
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
    </div>
  );
}
