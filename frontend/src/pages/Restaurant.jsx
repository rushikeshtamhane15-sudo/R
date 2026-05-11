import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { loadCart, saveCart, setQty, bumpQty, cartCount, priceCart, hydrateGuestCart } from "../lib/cart";
import { useAuth } from "../context/AuthContext";
import {
  ShoppingBag, Search, ArrowRight, Truck, RefreshCw, X,
} from "lucide-react";
import HeroPanel from "../components/restaurant/HeroPanel";
import CategoryStrip from "../components/restaurant/CategoryStrip";
import DishCard from "../components/restaurant/DishCard";

// 8 trust chips — what we promise (and don't) about the food. Brand-defining
// commitment, intentionally kept in code (not CMS-editable).
const TRUST_CHIPS = [
  "0% Ajinomoto",
  "0% Maida",
  "No Artificial Flavours",
  "No Artificial Colour",
  "No Refined & Palm Oil",
  "0% Polished Grains",
  "100% Fresh Vegetables",
  "No Pre Made Gravy",
];

/**
 * Restaurant browse — Zomato-style:
 *   • HeroPanel (3D + parallax tilt) on top
 *   • CategoryStrip (floating Lucide icons + label) below search
 *   • DishCard grid with 3D depth + glassmorphism category badges
 *   • Sticky cart pill at the bottom
 */
export default function Restaurant() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [menu, setMenu] = useState(null);
  const [meta, setMeta] = useState({ delivery_fee_flat: 50, delivery_free_over: 500 });
  const [cart, setCart] = useState(loadCart());
  const [q, setQ] = useState("");
  const [activeCat, setActiveCat] = useState("All");
  const [lastOrder, setLastOrder] = useState(null);
  const [reorderDismissed, setReorderDismissed] = useState(false);
  const [theme, setTheme] = useState(null);
  const [activeOrder, setActiveOrder] = useState(null);

  useEffect(() => {
    api.get("/restaurant/menu")
      .then((r) => { setMenu(r.data.items || []); setMeta({ delivery_fee_flat: r.data.delivery_fee_flat, delivery_free_over: r.data.delivery_free_over }); })
      .catch(() => toast.error("Could not load menu"));
    api.get("/restaurant/theme").then((r) => setTheme(r.data || null)).catch(() => {});
    hydrateGuestCart().then((merged) => setCart(merged)).catch(() => {});
  }, []);

  // Pull most recent delivered order for the "reorder in 1 tap" banner
  // AND any in-flight (out_for_delivery / preparing / etc) for the live tracking pill.
  useEffect(() => {
    if (!user) { setLastOrder(null); setActiveOrder(null); return; }
    try {
      if (sessionStorage.getItem("efc_reorder_dismissed_v1") === "1") setReorderDismissed(true);
    } catch {}
    api.get("/restaurant/orders?limit=10")
      .then((r) => {
        const rows = r.data?.orders || [];
        const delivered = rows.find((o) => o.status === "delivered");
        if (delivered) setLastOrder(delivered);
        const live = rows.find((o) => ["paid", "preparing", "ready_for_pickup", "out_for_delivery"].includes(o.status));
        if (live) setActiveOrder(live);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => { saveCart(cart); }, [cart]);

  const categories = useMemo(() => {
    const set = new Set((menu || []).map((m) => m.category || "Mains"));
    return ["All", ...Array.from(set)];
  }, [menu]);

  const filtered = useMemo(() => {
    if (!menu) return [];
    const ql = q.trim().toLowerCase();
    return menu.filter((m) => {
      if (activeCat !== "All" && m.category !== activeCat) return false;
      if (!ql) return true;
      return (m.name || "").toLowerCase().includes(ql) || (m.description || "").toLowerCase().includes(ql);
    });
  }, [menu, q, activeCat]);

  const cartLines = priceCart(cart, menu || []);
  const totalCount = cartCount(cart);

  const onAdd = (it) => setCart((c) => bumpQty(c, it.id, 1));
  const onSub = (it) => setCart((c) => bumpQty(c, it.id, -1));
  const onChangeQty = (it, val) => setCart((c) => setQty(c, it.id, val));

  const buyNow = (it) => {
    try { sessionStorage.setItem("efc_buynow_v1", JSON.stringify({ [it.id]: { id: it.id, qty: 1 } })); } catch {}
    if (!user) {
      try { sessionStorage.setItem("efc_pending_action_v1", "/restaurant/checkout?buynow=1"); } catch {}
      navigate(`/login?next=${encodeURIComponent("/restaurant/checkout?buynow=1")}`);
      return;
    }
    navigate("/restaurant/checkout?buynow=1");
  };

  const goCheckout = () => {
    if (totalCount === 0) { toast.error("Your cart is empty"); return; }
    if (!user) {
      try { sessionStorage.setItem("efc_pending_action_v1", "/restaurant/checkout"); } catch {}
      navigate(`/login?next=${encodeURIComponent("/restaurant/checkout")}`);
      return;
    }
    navigate("/restaurant/checkout");
  };

  const reorderNow = () => {
    if (!lastOrder || !menu) return;
    const liveIds = new Set(menu.map((m) => m.id));
    let next = { ...cart };
    let added = 0;
    let skipped = 0;
    for (const line of lastOrder.items || []) {
      if (!liveIds.has(line.id)) { skipped += 1; continue; }
      const cur = next[line.id]?.qty || 0;
      next = setQty(next, line.id, cur + (line.qty || 1));
      added += 1;
    }
    setCart(next);
    if (added === 0) { toast.error("None of those items are available right now"); return; }
    if (skipped > 0) toast.warning(`${skipped} item(s) no longer available — skipped`);
    toast.success(`Reordered ${added} item${added > 1 ? "s" : ""}`);
    navigate("/restaurant/checkout");
  };

  const dismissReorder = () => {
    setReorderDismissed(true);
    try { sessionStorage.setItem("efc_reorder_dismissed_v1", "1"); } catch {}
  };

  return (
    <div className="min-h-screen bg-background pb-40 md:pb-32" data-testid="restaurant-page">
      <HeroPanel theme={theme} meta={meta} />

      <div className="max-w-6xl mx-auto px-3 sm:px-5">
        {/* Trust chips — auto-scrolling horizontal marquee. */}
        <section className="mt-3 -mb-1 overflow-hidden" data-testid="trust-chips">
          <div className="flex items-center gap-2 animate-trust-marquee py-1" style={{ width: "max-content" }}>
            {[...TRUST_CHIPS, ...TRUST_CHIPS].map((label, i) => (
              <span
                key={`${label}-${i}`}
                className="flex-shrink-0 text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wide rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/40"
                data-testid={i < TRUST_CHIPS.length ? `trust-chip-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : undefined}
              >
                {label}
              </span>
            ))}
          </div>
        </section>

        {/* Live tracking pill — when a restaurant order is in-flight */}
        {user && activeOrder && (
          <Link
            to={`/restaurant/track/${activeOrder.order_id}`}
            className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900/40 p-3.5 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40 transition-colors group"
            data-testid="active-track-pill"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="relative h-10 w-10 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60"></span>
                <Truck className="h-5 w-5 relative z-10" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] tracking-overline uppercase font-bold text-emerald-700 dark:text-emerald-300">Order in progress</p>
                <p className="font-display font-extrabold text-sm leading-tight mt-0.5 truncate">
                  {activeOrder.status === "out_for_delivery" ? "Rider on the way · Track live" : "Tap to track your order"}
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-emerald-700 dark:text-emerald-300 group-hover:translate-x-1 transition-transform flex-shrink-0" />
          </Link>
        )}

        {/* Reorder banner — most recent delivered order, 1-tap CTA */}
        {user && lastOrder && !reorderDismissed && (
          <div
            className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5 flex items-center gap-3 sm:gap-4"
            data-testid="reorder-banner"
          >
            <div className="hidden sm:flex h-12 w-12 rounded-full bg-primary/15 items-center justify-center flex-shrink-0">
              <RefreshCw className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] tracking-overline uppercase font-bold text-primary">Welcome back</p>
              <p className="font-display font-extrabold text-base sm:text-lg leading-tight mt-0.5 truncate">
                Reorder your last meal · ₹{Number(lastOrder.total).toFixed(0)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {(lastOrder.items || []).map((i) => `${i.name} × ${i.qty}`).join(" · ")}
              </p>
            </div>
            <Button
              onClick={reorderNow}
              size="sm"
              className="rounded-full bg-primary hover:bg-primary/90 flex-shrink-0 h-9 px-4 text-xs sm:text-sm"
              data-testid="reorder-banner-cta"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Reorder
            </Button>
            <button
              type="button"
              onClick={dismissReorder}
              className="text-muted-foreground hover:text-foreground flex-shrink-0"
              aria-label="Dismiss"
              data-testid="reorder-banner-dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Search */}
        <div className="sticky top-0 z-20 -mx-3 sm:-mx-5 px-3 sm:px-5 pt-3.5 pb-2.5 bg-background/95 backdrop-blur border-b border-border">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={theme?.search_placeholder || "Search dishes…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-9 rounded-full text-sm"
              data-testid="restaurant-search"
            />
          </div>
        </div>

        <CategoryStrip categories={categories} activeCat={activeCat} onChange={setActiveCat} />

        {/* Items grid */}
        <div className="mt-3">
          {!menu ? (
            <p className="text-center text-muted-foreground py-12">Loading menu…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-12" data-testid="restaurant-no-items">No items match your search.</p>
          ) : (
            <ul
              className="grid grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5 pt-2 pb-4"
              data-testid="restaurant-items"
              style={{ perspective: "1200px" }}
            >
              {filtered.map((it, idx) => (
                <DishCard
                  key={it.id}
                  it={it}
                  qty={cart[it.id]?.qty || 0}
                  theme={theme}
                  idx={idx}
                  onAdd={onAdd}
                  onSub={onSub}
                  onChangeQty={onChangeQty}
                  onBuy={buyNow}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Sticky cart bar — sits ABOVE BottomNav */}
      {totalCount > 0 && (
        <div className="fixed bottom-20 md:bottom-6 inset-x-0 z-40 px-4" data-testid="cart-bar">
          <div className="max-w-2xl mx-auto rounded-full bg-foreground text-background shadow-2xl flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <ShoppingBag className="h-5 w-5 flex-shrink-0" />
              <div className="text-sm min-w-0">
                <p className="font-bold leading-tight truncate" data-testid="cart-count">
                  {totalCount} item{totalCount > 1 ? "s" : ""} · ₹{cartLines.subtotal.toLocaleString("en-IN")}
                </p>
                <p className="text-xs opacity-80 leading-tight truncate">
                  {!user
                    ? (theme?.cart_login_hint || "Login required to checkout")
                    : (cartLines.subtotal >= meta.delivery_free_over
                        ? (theme?.cart_free_delivery_label || "Free delivery")
                        : (theme?.cart_delivery_fee_template?.replace("{fee}", String(meta.delivery_fee_flat)) || `+ ₹${meta.delivery_fee_flat} delivery`))}
                </p>
              </div>
            </div>
            <Button onClick={goCheckout} className="rounded-full bg-primary hover:bg-primary/90 flex-shrink-0" data-testid="go-checkout">
              {!user ? (theme?.checkout_login_btn_label || "Login & checkout") : (theme?.checkout_btn_label || "Checkout")} <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
