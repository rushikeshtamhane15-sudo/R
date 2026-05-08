import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Bike, Wallet, IndianRupee, ListChecks, Bell, Volume2, VolumeX, Phone, Navigation,
  CheckCircle2, MapPin, Loader2, BadgeCheck, RefreshCw, BanknoteIcon, ShieldCheck,
  PackageCheck, Hourglass, ArrowRight, Banknote,
} from "lucide-react";

/**
 * Rider dashboard — single-screen ops centre for restaurant deliveries.
 *  • Active orders pane (ready_for_pickup or assigned & out-for-delivery)
 *  • Live earnings + cash-pending + wallet
 *  • Withdraw flow (stub RazorpayX)
 *  • Daily-cash reconciliation OTP entry
 *  • Sound notification for new ready_for_pickup orders
 */

const POLL_INTERVAL_MS = 8_000;
const PING_INTERVAL_MS = 30_000;

// Embedded "ding" tone (short oscillator-generated beep, kept in JS so we ship without an audio asset).
function playDing() {
  try {
    // eslint-disable-next-line no-undef
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.65);
  } catch {}
}

export default function RiderDashboard() {
  const { user, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [orders, setOrders] = useState([]);
  const [earnings, setEarnings] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("efc_rider_sound") !== "off");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [bank4, setBank4] = useState("");
  const [showCashOtp, setShowCashOtp] = useState(false);
  const [cashOtp, setCashOtp] = useState("");
  const lastReadyIds = useRef(new Set());

  useEffect(() => { if (user && user.role !== "rider") navigate("/"); }, [user, navigate]);

  const load = async () => {
    try {
      const [m, o, e] = await Promise.all([
        api.get("/rider/me"),
        api.get("/rider/orders/active"),
        api.get("/rider/earnings"),
      ]);
      setMe(m.data); setEarnings(e.data); setLoadErr("");
      const next = o.data?.orders || [];
      // Sound notification for NEW ready_for_pickup orders
      const newReady = next.filter((x) => x.status === "ready_for_pickup" && !lastReadyIds.current.has(x.order_id));
      if (newReady.length > 0 && soundOn && lastReadyIds.current.size > 0) {
        playDing();
        toast.message(`🔔 ${newReady.length} new order ready for pickup`);
      }
      lastReadyIds.current = new Set(next.filter((x) => x.status === "ready_for_pickup").map((x) => x.order_id));
      setOrders(next);
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Could not load rider dashboard";
      setLoadErr(msg);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setInterval(load, POLL_INTERVAL_MS); return () => clearInterval(t); }, [soundOn]);

  // Geolocation pings while there's an active out_for_delivery order
  useEffect(() => {
    const hasActive = orders.some((o) => o.status === "out_for_delivery");
    if (!hasActive || !navigator.geolocation) return;
    const tick = () => navigator.geolocation.getCurrentPosition(
      (pos) => { api.post("/rider/location", { lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {}); },
      () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 },
    );
    tick();
    const t = setInterval(tick, PING_INTERVAL_MS);
    return () => clearInterval(t);
  }, [orders]);

  const toggleSound = () => {
    const next = !soundOn; setSoundOn(next);
    localStorage.setItem("efc_rider_sound", next ? "on" : "off");
    if (next) playDing();
  };

  const pickUp = async (id) => {
    try { await api.post(`/rider/orders/${id}/pickup`); toast.success("Picked up · drive safe!"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Pickup failed"); }
  };
  const arrived = async (id) => {
    try {
      const r = await api.post(`/rider/orders/${id}/arrived`);
      const dev = r.data?.dev_otp ? ` (dev OTP: ${r.data.dev_otp})` : "";
      toast.message(`OTP sent to customer${dev}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to send OTP"); }
  };
  const deliver = async (id, mode) => {
    const otp = window.prompt(`Enter 4-digit delivery OTP from customer (${mode}):`);
    if (!otp) return;
    try {
      const r = await api.post(`/rider/orders/${id}/deliver`, { otp: otp.trim(), payment_mode: mode });
      toast.success(`Delivered! +₹${r.data.rider_payout_inr} added to wallet`);
      load(); checkAuth?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delivery failed"); }
  };
  const submitWithdraw = async () => {
    const amt = Number(withdrawAmt);
    if (!amt || amt < 1) return toast.error("Enter a valid amount");
    setWithdrawing(true);
    try {
      const r = await api.post("/rider/withdraw", { amount: amt, bank_account_last4: bank4 || null });
      toast.success(`Payout ${r.data.payout_id} queued`);
      setWithdrawAmt(""); setBank4(""); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Withdraw failed"); }
    finally { setWithdrawing(false); }
  };
  const submitCashOtp = async () => {
    if (!cashOtp.trim()) return;
    try {
      const r = await api.post("/rider/cash-reconcile/confirm-otp", { otp: cashOtp.trim() });
      toast.success(`Cleared ${r.data.orders_cleared} cash order(s)`);
      setShowCashOtp(false); setCashOtp(""); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "OTP confirm failed"); }
  };

  if (loadErr) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" data-testid="rider-error">
        <div className="max-w-sm text-center">
          <Bike className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="font-display font-extrabold text-lg">Couldn't load rider dashboard</p>
          <p className="text-sm text-muted-foreground mt-2">{loadErr}</p>
          <Button onClick={load} className="rounded-full mt-5"><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry</Button>
        </div>
      </div>
    );
  }
  if (!me || !earnings) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>;
  }

  const ready = orders.filter((o) => o.status === "ready_for_pickup");
  const onTheWay = orders.filter((o) => o.status === "out_for_delivery");

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-28" data-testid="rider-dashboard">
      <header className="bg-foreground text-background">
        <div className="max-w-4xl mx-auto px-5 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Bike className="h-6 w-6" />
            <div>
              <p className="text-xs tracking-overline uppercase font-bold opacity-75">efoodcare Rider</p>
              <h1 className="font-display font-extrabold text-lg leading-tight">{me.name || "Rider"}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleSound} className="text-background hover:bg-white/10" title={soundOn ? "Mute" : "Unmute"} data-testid="rider-sound-toggle">
              {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5 opacity-60" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={load} className="text-background hover:bg-white/10" title="Refresh" data-testid="rider-refresh-btn">
              <RefreshCw className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-5 py-6 space-y-6">
        {/* Stat cards */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="rider-stats">
          <StatCard icon={PackageCheck} label="Today" value={`${earnings.today_deliveries} · ₹${earnings.today_earnings}`} tone="ok" />
          <StatCard icon={ListChecks} label="This month" value={`${earnings.month_deliveries} · ₹${earnings.month_earnings}`} />
          <StatCard icon={Wallet} label="Wallet" value={`₹${me.wallet_balance.toFixed(0)}`} tone="brand" testId="rider-wallet" />
          <StatCard icon={Banknote} label="Cash pending" value={`₹${me.cash_pending.toFixed(0)}`} tone={me.cash_pending > 0 ? "warn" : "ok"} testId="rider-cash-pending" />
        </section>

        {/* Cash-pending CTA */}
        {me.cash_pending > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/40 p-4 flex flex-wrap items-center justify-between gap-3" data-testid="rider-cash-banner">
            <div className="flex items-start gap-3 min-w-0">
              <Banknote className="h-5 w-5 mt-0.5 text-amber-700 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-amber-900 dark:text-amber-100">₹{me.cash_pending.toFixed(0)} cash to deposit</p>
                <p className="text-xs text-amber-800/80 dark:text-amber-200/80">Hand cash to admin/staff and enter the OTP they share to clear pendency.</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowCashOtp((s) => !s)} className="rounded-full border-amber-300" data-testid="rider-cash-otp-toggle">
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> {showCashOtp ? "Cancel" : "Enter OTP"}
            </Button>
          </div>
        )}
        {showCashOtp && (
          <div className="rounded-2xl border border-border bg-card p-4 flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">6-digit OTP from admin</label>
              <Input value={cashOtp} onChange={(e) => setCashOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} placeholder="••••••" inputMode="numeric" className="mt-1.5" data-testid="rider-cash-otp-input" />
            </div>
            <Button onClick={submitCashOtp} data-testid="rider-cash-otp-submit"><CheckCircle2 className="h-4 w-4 mr-1.5" /> Confirm</Button>
          </div>
        )}

        {/* Ready for pickup */}
        <section data-testid="rider-ready-section">
          <h2 className="text-xs tracking-overline uppercase font-bold text-secondary mb-3 flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" /> Ready for pickup ({ready.length})</h2>
          {ready.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-2xl border border-dashed border-border p-6 text-center">
              <Hourglass className="h-5 w-5 inline mr-1.5 opacity-60" /> No pickups right now — sound alert will fire when one's ready.
            </p>
          ) : (
            <ul className="space-y-3">
              {ready.map((o) => <OrderCard key={o.order_id} o={o} onAction={() => pickUp(o.order_id)} actionLabel="Pick up" actionIcon={ArrowRight} testIdPrefix="ready" />)}
            </ul>
          )}
        </section>

        {/* Out for delivery */}
        <section data-testid="rider-active-section">
          <h2 className="text-xs tracking-overline uppercase font-bold text-secondary mb-3 flex items-center gap-1.5"><Navigation className="h-3.5 w-3.5" /> On the way ({onTheWay.length})</h2>
          {onTheWay.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-2xl border border-dashed border-border p-6 text-center">No active deliveries.</p>
          ) : (
            <ul className="space-y-3">
              {onTheWay.map((o) => <ActiveDeliveryCard key={o.order_id} o={o} onArrived={() => arrived(o.order_id)} onDeliver={(mode) => deliver(o.order_id, mode)} />)}
            </ul>
          )}
        </section>

        {/* Withdraw */}
        <section className="rounded-2xl border border-border bg-card p-5" data-testid="rider-withdraw-section">
          <p className="text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5"><BanknoteIcon className="h-3.5 w-3.5" /> Withdraw to bank</p>
          <p className="font-display font-extrabold text-xl mt-1">₹{me.wallet_balance.toFixed(0)} available</p>
          <p className="text-xs text-muted-foreground mt-1">Instant payout via RazorpayX (currently STUBBED — appears in payouts queue).</p>
          <div className="mt-3 grid sm:grid-cols-3 gap-2">
            <Input type="number" placeholder="Amount ₹" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} data-testid="withdraw-amount" />
            <Input placeholder="Bank a/c last 4" value={bank4} onChange={(e) => setBank4(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} data-testid="withdraw-bank4" />
            <Button onClick={submitWithdraw} disabled={withdrawing || !withdrawAmt || me.wallet_balance < Number(withdrawAmt)} data-testid="withdraw-submit">
              {withdrawing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <BadgeCheck className="h-4 w-4 mr-1.5" />}
              Withdraw
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone = "neutral", testId }) {
  const cls = tone === "ok" ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900/30"
    : tone === "warn" ? "border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/30"
      : tone === "brand" ? "border-primary/20 bg-primary/5"
        : "border-border bg-card";
  return (
    <div className={`rounded-2xl border ${cls} p-4`} data-testid={testId}>
      <div className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 text-muted-foreground" /><p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p></div>
      <p className="font-display font-extrabold text-lg mt-1.5 leading-tight">{value}</p>
    </div>
  );
}

function OrderCard({ o, onAction, actionLabel, actionIcon: ActionIcon, testIdPrefix }) {
  return (
    <li className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-center gap-3 justify-between" data-testid={`${testIdPrefix}-${o.order_id}`}>
      <div className="min-w-0">
        <p className="font-mono text-[11px] text-muted-foreground">{o.order_id}</p>
        <p className="font-bold leading-tight">₹{o.total} · {o.items?.length} item{o.items?.length !== 1 ? "s" : ""}</p>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin className="h-3 w-3" /> {o.address?.slice(0, 80) || "—"}</p>
      </div>
      <Button onClick={onAction} className="rounded-full" data-testid={`${testIdPrefix}-action-${o.order_id}`}>
        <ActionIcon className="h-4 w-4 mr-1.5" /> {actionLabel}
      </Button>
    </li>
  );
}

function ActiveDeliveryCard({ o, onArrived, onDeliver }) {
  const otpSent = !!o.arrived_at;
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-3" data-testid={`active-${o.order_id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-mono text-[11px] text-muted-foreground">{o.order_id}</p>
          <p className="font-bold">₹{o.total} · {o.items?.length} item{o.items?.length !== 1 ? "s" : ""}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{o.name} · <a className="underline" href={`tel:${o.phone}`}><Phone className="h-3 w-3 inline" /> {o.phone}</a></p>
          <p className="text-xs text-muted-foreground mt-1.5"><MapPin className="h-3 w-3 inline mr-0.5" /> {o.address?.slice(0, 110)}</p>
        </div>
        {o.address && (
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" className="rounded-full" data-testid={`map-${o.order_id}`}><Navigation className="h-3.5 w-3.5 mr-1.5" /> Map</Button>
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant={otpSent ? "outline" : "default"} onClick={onArrived} data-testid={`arrived-${o.order_id}`}>
          <Bell className="h-4 w-4 mr-1.5" /> {otpSent ? "Resend OTP" : "I've arrived · Send OTP"}
        </Button>
        <Button onClick={() => onDeliver("online")} disabled={!otpSent} data-testid={`deliver-online-${o.order_id}`}>
          <CheckCircle2 className="h-4 w-4 mr-1.5" /> Confirm online
        </Button>
        <Button onClick={() => onDeliver("cash")} disabled={!otpSent} variant="outline" data-testid={`deliver-cash-${o.order_id}`}>
          <Banknote className="h-4 w-4 mr-1.5" /> Confirm cash
        </Button>
      </div>
    </li>
  );
}
