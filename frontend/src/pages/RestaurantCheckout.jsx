import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import {
  loadCart, saveCart, setQty, bumpQty, clearCart, priceCart, changeVariant,
  PORTION_LABEL,
} from "../lib/cart";
import {
  ShoppingBag, MapPin, Phone, User as UserIcon,
  Loader2, ShieldCheck, Truck, Wallet,
  ChevronLeft, CheckCircle2,
} from "lucide-react";
import LocationPicker from "../components/LocationPicker";
import CheckoutCartLine, { CheckoutEmptyCart } from "../components/checkout/CheckoutCartLine";
import BillSummary from "../components/checkout/BillSummary";
import { haversineKm, etaMinutes } from "../lib/geo";

const BUYNOW_KEY = "efc_buynow_v1";

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

export default function RestaurantCheckout() {
  const navigate = useNavigate();
  const { user, checkAuth } = useAuth();
  const [params] = useSearchParams();
  const isBuyNow = params.get("buynow") === "1";

  const [menu, setMenu] = useState(null);
  const [cart, setCart] = useState(() => {
    if (isBuyNow) {
      try { return JSON.parse(sessionStorage.getItem(BUYNOW_KEY) || "{}") || {}; }
      catch { return {}; }
    }
    return loadCart();
  });
  const [meta, setMeta] = useState({ delivery_fee_flat: 30, delivery_free_over: 400, kitchen_lat: null, kitchen_lng: null });
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [address, setAddress] = useState(user?.address || "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [applyWallet, setApplyWallet] = useState(false);
  const [pinLoc, setPinLoc] = useState(
    user?.lat && user?.lng ? { lat: user.lat, lng: user.lng } : null
  );

  useEffect(() => {
    if (!user) { navigate("/login?next=/restaurant/checkout"); return; }
    setWalletBalance(Number(user.wallet_balance || 0));
    api.get("/restaurant/menu")
      .then((r) => {
        setMenu(r.data.items || []);
        setMeta({
          delivery_fee_flat: r.data.delivery_fee_flat,
          delivery_free_over: r.data.delivery_free_over,
          kitchen_lat: r.data.kitchen_lat ?? null,
          kitchen_lng: r.data.kitchen_lng ?? null,
        });
      })
      .catch(() => toast.error("Could not load menu"));
  }, [user, navigate]);

  // Persist cart edits — but ONLY when this is the persistent cart, not buy-now.
  useEffect(() => { if (!isBuyNow) saveCart(cart); else { try { sessionStorage.setItem(BUYNOW_KEY, JSON.stringify(cart)); } catch { /* non-critical: storage/network unavailable */ } } }, [cart, isBuyNow]);

  const priced = useMemo(() => priceCart(cart, menu || []), [cart, menu]);
  const subtotal = priced.subtotal;
  const deliveryFee = subtotal === 0 ? 0 : (subtotal >= meta.delivery_free_over ? 0 : meta.delivery_fee_flat);
  const total = +(subtotal + deliveryFee).toFixed(2);
  const walletApplied = applyWallet ? Math.min(walletBalance, total) : 0;
  const payable = +(total - walletApplied).toFixed(2);

  // ETA — kitchen → customer pin. Falls back to "Pin location" hint if no pin yet.
  const etaInfo = useMemo(() => {
    if (!meta.kitchen_lat || !meta.kitchen_lng || !pinLoc?.lat || !pinLoc?.lng) return null;
    const km = haversineKm({ lat: meta.kitchen_lat, lng: meta.kitchen_lng }, pinLoc);
    if (km == null) return null;
    const min = etaMinutes(km);
    // Add a 15-min kitchen prep buffer for total customer-facing ETA.
    const total = (min || 0) + 15;
    return { km, min, total };
  }, [meta.kitchen_lat, meta.kitchen_lng, pinLoc]);

  // Variant-aware cart mutators — checkout's qty controls operate on a
  // specific (id, variant) line, so we accept the full priced-line object
  // and pass its variant through to bumpQty/setQty.
  const onAdd = (line) => setCart((c) => bumpQty(c, line.id, 1, line.variant));
  const onSub = (line) => setCart((c) => bumpQty(c, line.id, -1, line.variant));
  const onChangeQty = (line, val) => setCart((c) => setQty(c, line.id, val, line.variant));
  const onRemove = (line) => setCart((c) => setQty(c, line.id, 0, line.variant));
  const onChangeVariant = (line, nextVariant) => {
    if (nextVariant === line.variant) return;
    setCart((c) => changeVariant(c, line.id, line.variant, nextVariant));
    toast.success(`Switched to ${PORTION_LABEL[nextVariant] || nextVariant}`);
  };

  // Track which line has the variant popover open (composite-key string).
  const [variantEditOpen, setVariantEditOpen] = useState(null);

  const placeOrder = async () => {
    if (!name.trim() || !phone.trim() || !address.trim()) {
      toast.error("Please fill name, phone and delivery address");
      return;
    }
    if (priced.lines.length === 0) {
      toast.error("Your cart is empty");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post("/restaurant/order", {
        items: priced.lines.map((l) => ({ id: l.id, qty: l.qty, variant: l.variant || "regular" })),
        name, phone, address, notes,
        apply_wallet: applyWallet && walletBalance > 0,
        customer_lat: pinLoc?.lat,
        customer_lng: pinLoc?.lng,
      });
      const { order_id, razorpay, mock } = r.data;

      if (mock || !razorpay) {
        // Mock auto-verify
        const v = await api.post("/restaurant/verify", { order_id });
        finalize(v.data.order);
        return;
      }

      await loadRazorpayScript();
      const opt = {
        ...razorpay,
        theme: { color: "#a02323" },
        handler: async (resp) => {
          try {
            const v = await api.post("/restaurant/verify", {
              order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            finalize(v.data.order);
          } catch (e) {
            toast.error(e?.response?.data?.detail || "Payment verification failed");
            setSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => { setSubmitting(false); toast.message("Payment cancelled"); },
        },
      };
      const rzp = new window.Razorpay(opt);
      rzp.open();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not place order");
      setSubmitting(false);
    }
  };

  const finalize = (order) => {
    setSuccess(order);
    if (isBuyNow) { try { sessionStorage.removeItem(BUYNOW_KEY); } catch { /* non-critical: storage/network unavailable */ } }
    else clearCart();
    setSubmitting(false);
    try { checkAuth?.(); } catch { /* non-critical: storage/network unavailable */ }
    toast.success("Order placed · enjoy your meal!");
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10" data-testid="restaurant-success">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center mb-5">
            <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-300" />
          </div>
          <h1 className="font-display font-extrabold text-2xl">Order placed</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Order <span className="font-mono">{success.order_id}</span> · ₹{success.total.toLocaleString("en-IN")}
          </p>
          <p className="text-sm mt-1.5 text-muted-foreground">
            ETA: {success.eta_at ? new Date(success.eta_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "~40 min"}
          </p>
          <div className="mt-7 flex flex-col gap-3">
            <Button asChild size="lg" className="rounded-full bg-primary hover:bg-primary/90">
              <Link to={`/restaurant/track/${success.order_id}`} data-testid="success-track">Track your order</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/restaurant/orders" data-testid="success-history">My orders</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/restaurant" data-testid="success-keep-browsing">Continue browsing</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-44 md:pb-32" data-testid="restaurant-checkout">
      <header className="bg-primary text-primary-foreground">
        <div className="max-w-3xl mx-auto px-5 py-6">
          <Link to="/restaurant" className="inline-flex items-center text-primary-foreground/85 hover:text-primary-foreground text-xs font-bold uppercase tracking-overline" data-testid="back-restaurant">
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back to menu
          </Link>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-2">Checkout</h1>
          <p className="text-sm opacity-90 mt-1">Edit quantities below · pay securely with Razorpay</p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
        {/* Cart lines */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden" data-testid="checkout-items">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-primary" />
            <p className="font-display font-extrabold">Your order</p>
          </div>
          {priced.lines.length === 0 ? (
            <CheckoutEmptyCart />
          ) : (
            <ul className="divide-y divide-border">
              {priced.lines.map((l) => {
                // Use composite (id, variant) for the React key + testids so a
                // user can hold both Regular and Large of the same dish.
                const lk = `${l.id}::${l.variant || "regular"}`;
                return (
                  <CheckoutCartLine
                    key={lk}
                    line={l}
                    lk={lk}
                    variantEditOpen={variantEditOpen}
                    setVariantEditOpen={setVariantEditOpen}
                    onAdd={onAdd}
                    onSub={onSub}
                    onChangeQty={onChangeQty}
                    onRemove={onRemove}
                    onChangeVariant={onChangeVariant}
                  />
                );
              })}
            </ul>
          )}
        </section>

        {/* Delivery details */}
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3" data-testid="checkout-delivery">
          <p className="font-display font-extrabold">Delivery details</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><UserIcon className="h-3 w-3" /> Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1.5" data-testid="co-name" />
            </div>
            <div>
              <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" /> Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} placeholder="10-digit mobile" inputMode="numeric" className="mt-1.5" data-testid="co-phone" />
            </div>
          </div>
          <div>
            <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Address</label>
            <Textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Building, street, area, pincode" rows={2} className="mt-1.5" data-testid="co-address" />
          </div>
          <div>
            <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Pin delivery location</label>
            <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">Drop a pin so your rider can find you instantly. Drag to adjust.</p>
            <LocationPicker value={pinLoc} onChange={setPinLoc} />
          </div>
          <div>
            <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Special instructions (optional)</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Less spicy, no onion, etc." className="mt-1.5" data-testid="co-notes" />
          </div>
        </section>

        {/* Wallet credit toggle */}
        {walletBalance > 0 && (
          <section className="rounded-2xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900/40 p-4 sm:p-5" data-testid="checkout-wallet">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={applyWallet}
                onChange={(e) => setApplyWallet(e.target.checked)}
                className="mt-1 h-4 w-4 rounded text-primary focus:ring-primary border-emerald-400"
                data-testid="apply-wallet-toggle"
              />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 font-display font-extrabold text-base">
                  <Wallet className="h-4 w-4 text-emerald-700" />
                  You have ₹{walletBalance.toFixed(0)} in wallet
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Apply at checkout — pay only ₹{Math.max(0, total - Math.min(walletBalance, total)).toFixed(0)} via Razorpay
                </span>
              </span>
            </label>
          </section>
        )}

        {/* Bill summary */}
        <BillSummary
          subtotal={subtotal}
          deliveryFee={deliveryFee}
          walletApplied={walletApplied}
          payable={payable}
          freeOver={meta.delivery_free_over}
        />
      </div>

      {/* Sticky pay button — sits above BottomNav on mobile (bottom-16) */}
      <div className="fixed bottom-16 md:bottom-0 inset-x-0 z-40 bg-background border-t border-border px-5 py-3.5 md:py-4">
        <div className="max-w-3xl mx-auto">
          {/* ETA chip — kitchen → customer pin */}
          <div className="mb-2 flex items-center justify-between gap-2">
            {etaInfo ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 px-2.5 py-1 text-[11px] font-bold border border-emerald-300 dark:border-emerald-900/50" data-testid="checkout-eta">
                <Truck className="h-3 w-3" />
                <span className="tabular-nums">{etaInfo.km.toFixed(1)} km</span>
                <span className="opacity-50">·</span>
                <span className="tabular-nums">~{etaInfo.total} min to your door</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 px-2.5 py-1 text-[11px] font-bold border border-amber-300 dark:border-amber-900/50" data-testid="checkout-eta-prompt">
                <MapPin className="h-3 w-3" /> Drop a pin above to see live ETA
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{walletApplied > 0 ? "Payable" : "Total"}</p>
              <p className="font-display font-extrabold text-xl tabular-nums">₹{payable.toFixed(0)}</p>
              {walletApplied > 0 && (
                <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold mt-0.5">
                  ₹{walletApplied.toFixed(0)} from wallet
                </p>
              )}
            </div>
            <Button
              size="lg"
              onClick={placeOrder}
              disabled={submitting || priced.lines.length === 0}
              className="rounded-full bg-primary hover:bg-primary/90 px-7"
              data-testid="checkout-pay-btn"
            >
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              {payable <= 0 ? `Place order` : `Pay ₹${payable.toFixed(0)}`}
              {etaInfo && (
                <span className="ml-2 hidden sm:inline-flex items-center text-[10px] font-bold opacity-90 bg-white/15 rounded-full px-1.5 py-0.5 tabular-nums" data-testid="pay-btn-eta">
                  ~{etaInfo.total}m
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
