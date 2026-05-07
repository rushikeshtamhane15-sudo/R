import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import {
  loadCart, saveCart, setQty, bumpQty, clearCart, priceCart,
} from "../lib/cart";
import {
  ChevronLeft, Plus, Minus, ShoppingBag, MapPin, Phone, User as UserIcon,
  Loader2, ShieldCheck, CheckCircle2, Trash2, Truck,
} from "lucide-react";

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
  const { user } = useAuth();
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
  const [meta, setMeta] = useState({ delivery_fee_flat: 30, delivery_free_over: 400 });
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [address, setAddress] = useState(user?.address || "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!user) { navigate("/login?next=/restaurant/checkout"); return; }
    api.get("/restaurant/menu")
      .then((r) => { setMenu(r.data.items || []); setMeta({ delivery_fee_flat: r.data.delivery_fee_flat, delivery_free_over: r.data.delivery_free_over }); })
      .catch(() => toast.error("Could not load menu"));
  }, [user, navigate]);

  // Persist cart edits — but ONLY when this is the persistent cart, not buy-now.
  useEffect(() => { if (!isBuyNow) saveCart(cart); else { try { sessionStorage.setItem(BUYNOW_KEY, JSON.stringify(cart)); } catch {} } }, [cart, isBuyNow]);

  const priced = useMemo(() => priceCart(cart, menu || []), [cart, menu]);
  const subtotal = priced.subtotal;
  const deliveryFee = subtotal === 0 ? 0 : (subtotal >= meta.delivery_free_over ? 0 : meta.delivery_fee_flat);
  const total = +(subtotal + deliveryFee).toFixed(2);

  const onAdd = (id) => setCart((c) => bumpQty(c, id, 1));
  const onSub = (id) => setCart((c) => bumpQty(c, id, -1));
  const onChangeQty = (id, val) => setCart((c) => setQty(c, id, val));
  const onRemove = (id) => setCart((c) => setQty(c, id, 0));

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
        items: priced.lines.map((l) => ({ id: l.id, qty: l.qty })),
        name, phone, address, notes,
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
    if (isBuyNow) { try { sessionStorage.removeItem(BUYNOW_KEY); } catch {} }
    else clearCart();
    setSubmitting(false);
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
    <div className="min-h-screen bg-background pb-32" data-testid="restaurant-checkout">
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
            <div className="p-8 text-center text-muted-foreground text-sm">
              Cart is empty. <Link to="/" className="text-primary font-semibold underline-offset-2 hover:underline">Browse the menu</Link>.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {priced.lines.map((l) => (
                <li key={l.id} className="p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:items-center" data-testid={`checkout-line-${l.id}`}>
                  <div className="flex gap-3 items-center flex-1 min-w-0">
                    <img src={l.image_url} alt={l.name} className="h-14 w-14 rounded-xl object-cover flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold leading-tight truncate text-sm">{l.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">₹{l.unit} × {l.qty} = <span className="font-bold tabular-nums text-foreground">₹{l.line_total.toFixed(0)}</span></p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:gap-3 sm:justify-end flex-shrink-0">
                    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background overflow-hidden">
                      <button type="button" className="h-8 w-8 flex items-center justify-center hover:bg-muted" onClick={() => onSub(l.id)} aria-label="Decrease" data-testid={`co-dec-${l.id}`}>
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        value={l.qty}
                        onChange={(e) => onChangeQty(l.id, e.target.value)}
                        className="w-9 h-8 text-center bg-transparent text-xs font-bold focus:outline-none tabular-nums"
                        data-testid={`co-qty-${l.id}`}
                        min={0}
                        max={50}
                      />
                      <button type="button" className="h-8 w-8 flex items-center justify-center hover:bg-muted" onClick={() => onAdd(l.id)} aria-label="Increase" data-testid={`co-inc-${l.id}`}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button type="button" onClick={() => onRemove(l.id)} className="text-muted-foreground hover:text-destructive p-1.5" aria-label="Remove" data-testid={`co-remove-${l.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
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
            <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Special instructions (optional)</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Less spicy, no onion, etc." className="mt-1.5" data-testid="co-notes" />
          </div>
        </section>

        {/* Bill summary */}
        <section className="rounded-2xl border border-border bg-card p-5" data-testid="checkout-summary">
          <p className="font-display font-extrabold mb-3">Bill summary</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums" data-testid="sum-subtotal">₹{subtotal.toFixed(0)}</dd></div>
            <div className="flex justify-between text-muted-foreground">
              <dt className="flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" /> Delivery fee</dt>
              <dd className="tabular-nums" data-testid="sum-delivery">{deliveryFee === 0 ? "FREE" : `₹${deliveryFee.toFixed(0)}`}</dd>
            </div>
            {deliveryFee > 0 && (
              <p className="text-[11px] text-muted-foreground italic">
                Add ₹{(meta.delivery_free_over - subtotal).toFixed(0)} more for free delivery
              </p>
            )}
            <div className="border-t border-border pt-2 mt-2 flex justify-between font-display font-extrabold text-lg">
              <dt>Total</dt><dd className="tabular-nums text-primary" data-testid="sum-total">₹{total.toFixed(0)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {/* Sticky pay button */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-background border-t border-border px-5 py-3.5 md:bottom-0 md:py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="text-sm">
            <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Total</p>
            <p className="font-display font-extrabold text-xl tabular-nums">₹{total.toFixed(0)}</p>
          </div>
          <Button
            size="lg"
            onClick={placeOrder}
            disabled={submitting || priced.lines.length === 0}
            className="rounded-full bg-primary hover:bg-primary/90 px-7"
            data-testid="checkout-pay-btn"
          >
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            Pay ₹{total.toFixed(0)}
          </Button>
        </div>
      </div>
    </div>
  );
}
