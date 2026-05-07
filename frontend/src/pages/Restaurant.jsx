import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { loadCart, saveCart, setQty, bumpQty, cartCount, priceCart } from "../lib/cart";
import { useAuth } from "../context/AuthContext";
import {
  ShoppingBag, Plus, Minus, Search, UtensilsCrossed, ArrowRight, Tag, Truck, ChevronLeft,
} from "lucide-react";

export default function Restaurant() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [menu, setMenu] = useState(null);
  const [meta, setMeta] = useState({ delivery_fee_flat: 30, delivery_free_over: 400 });
  const [cart, setCart] = useState(loadCart());
  const [q, setQ] = useState("");
  const [activeCat, setActiveCat] = useState("All");

  useEffect(() => {
    api.get("/restaurant/menu")
      .then((r) => { setMenu(r.data.items || []); setMeta({ delivery_fee_flat: r.data.delivery_fee_flat, delivery_free_over: r.data.delivery_free_over }); })
      .catch(() => toast.error("Could not load menu"));
  }, []);

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

  // Buy now → redirect to checkout with ONLY this item, leaving the user's
  // existing cart intact. We use a separate sessionStorage key for the
  // "instant order" so it can't accidentally pollute the persistent cart.
  const buyNow = (it) => {
    if (!user) { toast.message("Please log in to order"); navigate(`/login?next=/restaurant`); return; }
    try {
      sessionStorage.setItem("efc_buynow_v1", JSON.stringify({ [it.id]: { id: it.id, qty: 1 } }));
    } catch {}
    navigate("/restaurant/checkout?buynow=1");
  };

  const goCheckout = () => {
    if (!user) { toast.message("Please log in to order"); navigate(`/login?next=/restaurant/checkout`); return; }
    if (totalCount === 0) { toast.error("Your cart is empty"); return; }
    navigate("/restaurant/checkout");
  };

  return (
    <div className="min-h-screen bg-background pb-32" data-testid="restaurant-page">
      {/* Hero */}
      <header className="bg-primary text-primary-foreground">
        <div className="max-w-6xl mx-auto px-5 py-7">
          <Link to="/" className="inline-flex items-center text-primary-foreground/80 hover:text-primary-foreground text-xs font-bold uppercase tracking-overline" data-testid="back-home">
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Home
          </Link>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs tracking-overline uppercase font-bold opacity-80 flex items-center gap-1.5"><UtensilsCrossed className="h-3.5 w-3.5" /> eFoodCare Restaurant</p>
              <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-1.5">Order online · ghar se accha khana</h1>
              <p className="opacity-90 text-sm mt-1.5 flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Free delivery on orders over ₹{meta.delivery_free_over} · ₹{meta.delivery_fee_flat} otherwise
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-5">
        {/* Search + categories */}
        <div className="sticky top-0 z-20 -mx-4 sm:-mx-5 px-4 sm:px-5 pt-4 pb-3 bg-background/95 backdrop-blur border-b border-border">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search dishes, descriptions…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-10 rounded-full"
              data-testid="restaurant-search"
            />
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" data-testid="restaurant-categories">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCat(c)}
                className={`whitespace-nowrap text-xs uppercase font-bold tracking-overline px-4 py-1.5 rounded-full border transition-colors ${activeCat === c ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:border-primary/40"}`}
                data-testid={`cat-${c.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Items grid */}
        {!menu ? (
          <p className="text-center text-muted-foreground py-12">Loading menu…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-muted-foreground py-12" data-testid="restaurant-no-items">
            No items match your search.
          </p>
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 py-5" data-testid="restaurant-items">
            {filtered.map((it) => {
              const qty = cart[it.id]?.qty || 0;
              const hasDiscount = it.discounted_price != null && it.discounted_price < it.price;
              return (
                <li key={it.id} className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col" data-testid={`item-${it.id}`}>
                  <div className="relative aspect-[3/2] bg-muted">
                    <img src={it.image_url} alt={it.name} className="w-full h-full object-cover" loading="lazy" />
                    {hasDiscount && (
                      <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold tracking-overline uppercase">
                        <Tag className="h-3 w-3" /> {Math.round(((it.price - it.discounted_price) / it.price) * 100)}% off
                      </span>
                    )}
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <p className="text-[10px] tracking-overline uppercase font-bold text-secondary">{it.category}</p>
                    <h3 className="font-display font-extrabold mt-1.5 leading-tight" data-testid={`item-name-${it.id}`}>{it.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 flex-1">{it.description}</p>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        {hasDiscount && <span className="text-xs line-through text-muted-foreground mr-1.5">₹{it.price}</span>}
                        <span className="font-display font-extrabold text-lg" data-testid={`item-price-${it.id}`}>
                          ₹{it.discounted_price ?? it.price}
                        </span>
                      </div>
                      {qty === 0 ? (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => onAdd(it)} data-testid={`add-${it.id}`} className="rounded-full">
                            <Plus className="h-3.5 w-3.5 mr-1" /> Add
                          </Button>
                          <Button size="sm" onClick={() => buyNow(it)} data-testid={`buy-now-${it.id}`} className="rounded-full bg-primary hover:bg-primary/90">
                            Buy now <ArrowRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background overflow-hidden">
                          <button type="button" className="h-9 w-9 flex items-center justify-center hover:bg-muted" onClick={() => onSub(it)} aria-label="Decrease" data-testid={`dec-${it.id}`}>
                            <Minus className="h-4 w-4" />
                          </button>
                          <input
                            type="number"
                            value={qty}
                            onChange={(e) => onChangeQty(it, e.target.value)}
                            className="w-10 h-9 text-center bg-transparent text-sm font-bold focus:outline-none"
                            data-testid={`qty-${it.id}`}
                            min={0}
                            max={50}
                          />
                          <button type="button" className="h-9 w-9 flex items-center justify-center hover:bg-muted" onClick={() => onAdd(it)} aria-label="Increase" data-testid={`inc-${it.id}`}>
                            <Plus className="h-4 w-4" />
                          </button>
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

      {/* Sticky cart bar */}
      {totalCount > 0 && (
        <div className="fixed bottom-16 md:bottom-4 inset-x-0 z-30 px-4" data-testid="cart-bar">
          <div className="max-w-2xl mx-auto rounded-full bg-foreground text-background shadow-2xl flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex items-center gap-3">
              <ShoppingBag className="h-5 w-5" />
              <div className="text-sm">
                <p className="font-bold leading-tight" data-testid="cart-count">
                  {totalCount} item{totalCount > 1 ? "s" : ""} · ₹{cartLines.subtotal.toLocaleString("en-IN")}
                </p>
                <p className="text-xs opacity-80 leading-tight">
                  {!user
                    ? "Login required to checkout"
                    : (cartLines.subtotal >= meta.delivery_free_over ? "Free delivery" : `+ ₹${meta.delivery_fee_flat} delivery`)}
                </p>
              </div>
            </div>
            <Button onClick={goCheckout} className="rounded-full bg-primary hover:bg-primary/90" data-testid="go-checkout">
              {!user ? "Login & checkout" : "Checkout"} <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
