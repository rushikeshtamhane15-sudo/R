import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { loadCart, saveCart, setQty, bumpQty, cartCount, priceCart } from "../lib/cart";
import { useAuth } from "../context/AuthContext";
import {
  ShoppingBag, Plus, Minus, Search, ChefHat, ArrowRight, Tag, Truck, ChevronLeft, Star, RefreshCw, X,
} from "lucide-react";

/**
 * Restaurant browse — Zomato-style:
 *   • Horizontal category chips (sticky)
 *   • Compact horizontal item cards
 *   • "Reorder in 1 tap" banner for returning customers
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
  const [lastOrder, setLastOrder] = useState(null); // most recent delivered order for reorder banner
  const [reorderDismissed, setReorderDismissed] = useState(false);

  useEffect(() => {
    api.get("/restaurant/menu")
      .then((r) => { setMenu(r.data.items || []); setMeta({ delivery_fee_flat: r.data.delivery_fee_flat, delivery_free_over: r.data.delivery_free_over }); })
      .catch(() => toast.error("Could not load menu"));
  }, []);

  // Pull most recent delivered order for the "reorder in 1 tap" banner
  useEffect(() => {
    if (!user) { setLastOrder(null); return; }
    try {
      if (sessionStorage.getItem("efc_reorder_dismissed_v1") === "1") setReorderDismissed(true);
    } catch {}
    api.get("/restaurant/orders?limit=10")
      .then((r) => {
        const delivered = (r.data?.orders || []).find((o) => o.status === "delivered");
        if (delivered) setLastOrder(delivered);
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

  // Buy now: stash one-item cart in sessionStorage and jump to checkout (login wall handles redirect)
  const buyNow = (it) => {
    try { sessionStorage.setItem("efc_buynow_v1", JSON.stringify({ [it.id]: { id: it.id, qty: 1 } })); } catch {}
    if (!user) { navigate(`/login?next=/restaurant/checkout?buynow=1`); return; }
    navigate("/restaurant/checkout?buynow=1");
  };

  const goCheckout = () => {
    if (totalCount === 0) { toast.error("Your cart is empty"); return; }
    if (!user) { navigate(`/login?next=/restaurant/checkout`); return; }
    navigate("/restaurant/checkout");
  };

  // 1-tap reorder: restock cart against current menu, jump to checkout
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
    <div className="min-h-screen bg-background pb-32" data-testid="restaurant-page">
      {/* Hero */}
      <header className="bg-primary text-primary-foreground">
        <div className="max-w-6xl mx-auto px-5 py-5">
          <Link to="/home" className="inline-flex items-center text-primary-foreground/85 hover:text-primary-foreground text-xs font-bold uppercase tracking-overline" data-testid="back-home">
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Tiffin
          </Link>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs tracking-overline uppercase font-bold opacity-80 flex items-center gap-1.5"><ChefHat className="h-3.5 w-3.5" /> efoodcare restaurant</p>
              <h1 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-1.5 lowercase">order online · ghar se accha khana</h1>
              <p className="opacity-90 text-sm mt-1.5 flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Free delivery on orders over ₹{meta.delivery_free_over} · ₹{meta.delivery_fee_flat} otherwise
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-3 sm:px-5">
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
              placeholder="Search dishes…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-9 rounded-full text-sm"
              data-testid="restaurant-search"
            />
          </div>
        </div>

        {/* Horizontal category chips */}
        <div
          className="sticky top-[58px] z-10 -mx-3 sm:-mx-5 px-3 sm:px-5 py-2.5 bg-background/95 backdrop-blur border-b border-border overflow-x-auto no-scrollbar"
          data-testid="restaurant-categories"
        >
          <ul className="flex items-center gap-2 min-w-max">
            {categories.map((c) => (
              <li key={c} className="flex-shrink-0">
                <button
                  onClick={() => setActiveCat(c)}
                  className={`text-xs font-bold tracking-overline uppercase px-3.5 py-1.5 rounded-full border transition-all whitespace-nowrap ${activeCat === c ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card text-foreground border-border hover:border-primary/40"}`}
                  data-testid={`cat-${c.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Items list — responsive grid: 1 col on mobile, 2 cols ≥sm, 3 cols ≥lg */}
        <div className="mt-3">
          {!menu ? (
            <p className="text-center text-muted-foreground py-12">Loading menu…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-12" data-testid="restaurant-no-items">No items match your search.</p>
          ) : (
            <ul
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3"
              data-testid="restaurant-items"
            >
              {filtered.map((it) => {
                const qty = cart[it.id]?.qty || 0;
                const hasDiscount = it.discounted_price != null && it.discounted_price < it.price;
                return (
                  <li key={it.id} className="rounded-xl border border-border bg-card overflow-hidden flex items-stretch" data-testid={`item-${it.id}`}>
                    <div className="relative w-24 sm:w-28 flex-shrink-0 bg-muted">
                      <img src={it.image_url} alt={it.name} className="w-full h-full object-cover" loading="lazy" />
                      {hasDiscount && (
                        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold tracking-overline uppercase">
                          <Tag className="h-2.5 w-2.5" /> {Math.round(((it.price - it.discounted_price) / it.price) * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="p-2.5 sm:p-3 flex-1 min-w-0 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[9px] tracking-overline uppercase font-bold text-secondary leading-none">{it.category}</p>
                          <h3 className="font-display font-extrabold text-sm sm:text-base mt-1 leading-tight truncate" data-testid={`item-name-${it.id}`}>{it.name}</h3>
                          <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 line-clamp-2">{it.description}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {hasDiscount && <p className="text-[10px] line-through text-muted-foreground">₹{it.price}</p>}
                          <p className="font-display font-extrabold text-sm sm:text-base text-primary tabular-nums" data-testid={`item-price-${it.id}`}>
                            ₹{it.discounted_price ?? it.price}
                          </p>
                        </div>
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        {qty === 0 ? (
                          <>
                            <Button variant="outline" size="sm" onClick={() => onAdd(it)} data-testid={`add-${it.id}`} className="rounded-full h-7 text-xs flex-1">
                              <Plus className="h-3 w-3 mr-1" /> Add
                            </Button>
                            <Button size="sm" onClick={() => buyNow(it)} data-testid={`buy-now-${it.id}`} className="rounded-full h-7 text-xs flex-1 bg-primary hover:bg-primary/90">
                              Buy <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                          </>
                        ) : (
                          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background overflow-hidden ml-auto" data-testid={`qty-controls-${it.id}`}>
                            <button type="button" className="h-7 w-7 flex items-center justify-center hover:bg-muted" onClick={() => onSub(it)} aria-label="Decrease" data-testid={`dec-${it.id}`}><Minus className="h-3.5 w-3.5" /></button>
                            <input
                              type="number"
                              value={qty}
                              onChange={(e) => onChangeQty(it, e.target.value)}
                              className="w-8 h-7 text-center bg-transparent text-xs font-bold focus:outline-none tabular-nums"
                              data-testid={`qty-${it.id}`}
                              min={0}
                              max={50}
                            />
                            <button type="button" className="h-7 w-7 flex items-center justify-center hover:bg-muted" onClick={() => onAdd(it)} aria-label="Increase" data-testid={`inc-${it.id}`}><Plus className="h-3.5 w-3.5" /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Sticky cart bar */}
      {totalCount > 0 && (
        <div className="fixed bottom-16 md:bottom-4 inset-x-0 z-30 px-4" data-testid="cart-bar">
          <div className="max-w-2xl mx-auto rounded-full bg-foreground text-background shadow-2xl flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <ShoppingBag className="h-5 w-5 flex-shrink-0" />
              <div className="text-sm min-w-0">
                <p className="font-bold leading-tight truncate" data-testid="cart-count">
                  {totalCount} item{totalCount > 1 ? "s" : ""} · ₹{cartLines.subtotal.toLocaleString("en-IN")}
                </p>
                <p className="text-xs opacity-80 leading-tight truncate">
                  {!user ? "Login required to checkout" : (cartLines.subtotal >= meta.delivery_free_over ? "Free delivery" : `+ ₹${meta.delivery_fee_flat} delivery`)}
                </p>
              </div>
            </div>
            <Button onClick={goCheckout} className="rounded-full bg-primary hover:bg-primary/90 flex-shrink-0" data-testid="go-checkout">
              {!user ? "Login & checkout" : "Checkout"} <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
