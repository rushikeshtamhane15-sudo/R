import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { loadCart, saveCart, setQty, bumpQty, cartCount, priceCart, hydrateGuestCart } from "../lib/cart";
import { useAuth } from "../context/AuthContext";
import { BRAND_LOGO_URL } from "../lib/brand";

// User-provided Pure Veg green-square icon. Hosted on Emergent CDN.
const PURE_VEG_ICON = "https://customer-assets.emergentagent.com/job_dining-pass-scan/artifacts/li3dreby_images.jpeg";
import {
  ShoppingBag, Plus, Minus, Search, ChefHat, ArrowRight, Tag, Truck, ChevronLeft, Star, RefreshCw, X,
  UtensilsCrossed, Soup, IceCream, Wheat, CupSoda, Cookie, Salad, Coffee, Pizza, Beef, Apple, Drumstick, Sandwich,
} from "lucide-react";

// Map a free-form menu category string → a crisp Lucide icon. Falls back to a
// generic utensil icon. Lowercased + simple contains() match keeps it forgiving
// to admin-typed category names ("Mains", "main course", "Curry & Dal", etc.).
const CATEGORY_ICON = (cat) => {
  const s = (cat || "").toLowerCase();
  if (s === "all") return UtensilsCrossed;
  if (/(rice|biryani|pulao|pulav)/.test(s)) return Wheat;
  if (/(roti|naan|bread|paratha|kulcha)/.test(s)) return Sandwich;
  if (/(dal|curry|sabzi|gravy|main)/.test(s)) return Soup;
  if (/(salad|raita|veg)/.test(s)) return Salad;
  if (/(sweet|dessert|kheer|halwa|ice)/.test(s)) return IceCream;
  if (/(drink|juice|lassi|water|beverage|soda)/.test(s)) return CupSoda;
  if (/(snack|chaat|starter|appet)/.test(s)) return Cookie;
  if (/(tea|coffee|chai)/.test(s)) return Coffee;
  if (/(thali|combo|special|meal)/.test(s)) return UtensilsCrossed;
  if (/(pizza)/.test(s)) return Pizza;
  if (/(fruit)/.test(s)) return Apple;
  return UtensilsCrossed;
};

// 8 trust chips — what we promise (and don't) about the food. Editable via PRD;
// kept here in code (not in CMS) since they're a brand-defining commitment.
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
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    api.get("/restaurant/menu")
      .then((r) => { setMenu(r.data.items || []); setMeta({ delivery_fee_flat: r.data.delivery_fee_flat, delivery_free_over: r.data.delivery_free_over }); })
      .catch(() => toast.error("Could not load menu"));
    // CMS-managed restaurant page theme (admin can edit hero copy/colors)
    api.get("/restaurant/theme")
      .then((r) => setTheme(r.data || null))
      .catch(() => {});
    // Cross-device guest cart hydration — merges server-side cart with local
    hydrateGuestCart().then((merged) => setCart(merged)).catch(() => {});
  }, []);

  // Pull most recent delivered order for the "reorder in 1 tap" banner
  // AND any in-flight (out_for_delivery / preparing / etc) for the live tracking pill.
  const [activeOrder, setActiveOrder] = useState(null);
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

  // Buy now: stash one-item cart in sessionStorage and jump to checkout (login wall handles redirect)
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
    <div className="min-h-screen bg-background pb-40 md:pb-32" data-testid="restaurant-page">
      {/* Hero — compact mobile-first layout. Top row: Pure Veg icon (left) + 100% Pure Veg (right).
          Title row: brand line + dish title. Bottom strip: 90-min delivery banner. */}
      <header
        className="hero-3d bg-primary text-primary-foreground relative"
        style={(theme?.hero_bg_color || theme?.hero_text_color) ? { backgroundColor: theme?.hero_bg_color || undefined, color: theme?.hero_text_color || undefined } : undefined}
        data-testid="restaurant-hero"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-5 py-4 sm:py-5 relative z-[1]">
          {/* Row 1 — efoodcare restaurant overline (LEFT) ↔ tiny 100% Pure Veg badge (RIGHT) */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-3d-overline text-[12px] sm:text-base tracking-wider uppercase font-extrabold flex items-center gap-1.5 min-w-0 truncate">
              <ChefHat className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 drop-shadow" /> {theme?.hero_overline || "efoodcare restaurant"}
            </p>
            <span className="badge-3d badge-3d-bob inline-flex items-center gap-1 rounded bg-white/95 text-green-700 pl-1.5 pr-1.5 py-0.5 text-[9px] sm:text-[10px] font-extrabold tracking-wide uppercase flex-shrink-0" data-testid="pure-veg-badge">
              {theme?.pure_veg_label || "100% Pure Veg"}
              <img src={BRAND_LOGO_URL} alt="eFoodCare" className="h-3.5 w-3.5 rounded-sm" />
            </span>
            <span className="sr-only" data-testid="zero-bad-stuff">100% Pure Veg</span>
          </div>

          {/* Row 2 — Title + tagline (overline pulled up to row 1) */}
          <div className="mt-1.5">
            <h1 className="text-3d-title font-display font-extrabold text-2xl sm:text-3xl tracking-tight lowercase leading-tight">
              {theme?.hero_title || "order online · ghar se accha khana"}
            </h1>
            {/* Hindi quote — placed between the two headings so it visually
                anchors the brand promise. Slight negative spacing pulls it up
                to feel centered between title and tagline. */}
            <p
              className="text-3d-quote -mt-0.5 text-[16px] sm:text-xl italic font-bold leading-snug"
              data-testid="hero-hindi-quote"
              lang="hi"
            >
              <span aria-hidden className="mr-1 text-yellow-200">“</span>
              {theme?.hero_promise_line1 || "हम टाइम लेते हैं पर फ्रेश लातें हैं"}
              <span aria-hidden className="ml-1 text-yellow-200">”</span>
            </p>
            <p className="text-3d-soft opacity-95 text-[13px] sm:text-base mt-2 flex items-center gap-1.5 leading-snug">
              <Truck className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 drop-shadow" />
              <span className="truncate">{theme?.hero_tagline || `Free delivery on orders over ₹${meta.delivery_free_over} · ₹${meta.delivery_fee_flat} otherwise`}</span>
            </p>
          </div>

          {/* Row 3 — 90-min banner */}
          <div
            className="badge-3d mt-2.5 inline-flex items-center gap-2 rounded-full px-3 py-1"
            style={{
              backgroundColor: theme?.ninety_min_bg_color || "#059669",
              color: theme?.ninety_min_text_color || "#ffffff",
            }}
            data-testid="ninety-min-banner"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/95 text-emerald-700 text-[11px] font-extrabold">⏱</span>
            <span className="text-[12px] sm:text-sm font-extrabold tracking-tight">{theme?.hero_delivery_badge || "90 minutes Fresh Meal Delivery"}</span>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-3 sm:px-5">
        {/* Trust chips — auto-scrolling horizontal marquee. 8 micro-blocks. */}
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

        {/* Horizontal category chips — each chip has a floating circular icon
            symbol ABOVE the label, giving the strip a 3D "ledge" feel.
            The icon sits on cat-icon-3d (gradient + heavy shadow + reflection). */}
        <div
          className="sticky top-[58px] z-10 -mx-3 sm:-mx-5 px-3 sm:px-5 pt-3 pb-3 bg-background/95 backdrop-blur border-b border-border overflow-x-auto no-scrollbar"
          data-testid="restaurant-categories"
        >
          <ul className="flex items-end gap-3 min-w-max">
            {categories.map((c) => {
              const Icon = CATEGORY_ICON(c);
              const isActive = activeCat === c;
              return (
                <li key={c} className="flex-shrink-0">
                  <button
                    onClick={() => setActiveCat(c)}
                    className="cat-chip-3d group flex flex-col items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-2xl px-1.5 pt-1 pb-1"
                    data-active={isActive}
                    data-testid={`cat-${c.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <span className="cat-icon-3d" aria-hidden>
                      <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
                    </span>
                    <span
                      className={`text-[10px] sm:text-[11px] font-bold tracking-overline uppercase whitespace-nowrap leading-none ${isActive ? "text-primary" : "text-foreground/80 group-hover:text-foreground"}`}
                    >
                      {c}
                    </span>
                  </button>
                </li>
              );
            })}
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
              className="grid grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5 pt-2 pb-4"
              data-testid="restaurant-items"
              style={{ perspective: "1200px" }}
            >
              {filtered.map((it, idx) => {
                const qty = cart[it.id]?.qty || 0;
                const hasDiscount = it.discounted_price != null && it.discounted_price < it.price;
                const CatIcon = CATEGORY_ICON(it.category);
                return (
                  <li
                    key={it.id}
                    className="dish-card-3d dish-rise rounded-2xl border border-border bg-card overflow-hidden flex flex-col"
                    style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                    data-testid={`item-${it.id}`}
                  >
                    {/* Image on top — square aspect, full width, with gloss sweep */}
                    <div className="dish-image-3d relative aspect-square w-full bg-muted">
                      <img src={it.image_url} alt={it.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                      {/* Floating category symbol — top-right, glassmorphism */}
                      <span
                        className="absolute top-1.5 right-1.5 z-[3] inline-flex h-7 w-7 items-center justify-center rounded-full backdrop-blur bg-white/55 border border-white/60 text-emerald-700 shadow-md dark:bg-black/35 dark:text-emerald-200 dark:border-white/15"
                        aria-hidden
                        data-testid={`item-cat-icon-${it.id}`}
                      >
                        <CatIcon className="h-3.5 w-3.5" strokeWidth={2.4} />
                      </span>
                      {hasDiscount && (
                        <span className="absolute top-1.5 left-1.5 z-[3] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold tracking-overline uppercase shadow">
                          <Tag className="h-2.5 w-2.5" /> {Math.round(((it.price - it.discounted_price) / it.price) * 100)}%
                        </span>
                      )}
                    </div>
                    {/* Details + price BELOW image */}
                    <div className="p-2.5 sm:p-3 flex flex-col gap-1.5">
                      <p className="text-[9px] tracking-overline uppercase font-bold text-secondary leading-none">{it.category}</p>
                      <h3 className="font-display font-extrabold text-sm sm:text-base leading-tight line-clamp-1" data-testid={`item-name-${it.id}`}>{it.name}</h3>
                      <span
                        className="inline-flex items-center gap-0.5 text-[8px] sm:text-[9px] font-extrabold tracking-wide uppercase rounded px-1.5 py-0.5"
                        style={{
                          color: theme?.item_promise_text_color || "#065f46",
                          backgroundColor: theme?.item_promise_bg_color || "#d1fae5",
                        }}
                        data-testid={`item-90min-${it.id}`}
                      >
                        ⏱ {theme?.item_promise_label || "90-min fresh"}
                      </span>
                      <p className="text-[12px] sm:text-[13px] text-muted-foreground line-clamp-3 min-h-[3lh] leading-snug">
                        {it.description || `Freshly prepared ${(it.name || "").toLowerCase()} · made daily in our kitchen.`}
                      </p>

                      <div className="flex items-end justify-between gap-2 mt-1">
                        {hasDiscount && <p className="text-[10px] line-through text-muted-foreground tabular-nums">₹{it.price}</p>}
                        <p className="font-display font-extrabold text-base text-primary tabular-nums ml-auto" data-testid={`item-price-${it.id}`}>
                          ₹{it.discounted_price ?? it.price}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        {qty === 0 ? (
                          <>
                            <Button variant="outline" size="sm" onClick={() => onAdd(it)} data-testid={`add-${it.id}`} className="rounded-full h-7 text-[11px] sm:text-xs flex-1 px-2">
                              <Plus className="h-3 w-3 mr-0.5" /> Add
                            </Button>
                            <Button size="sm" onClick={() => buyNow(it)} data-testid={`buy-now-${it.id}`} className="rounded-full h-7 text-[11px] sm:text-xs flex-1 px-2 bg-primary hover:bg-primary/90">
                              Buy <ArrowRight className="h-3 w-3 ml-0.5" />
                            </Button>
                          </>
                        ) : (
                          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background overflow-hidden mx-auto" data-testid={`qty-controls-${it.id}`}>
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

      {/* Sticky cart bar — sits ABOVE BottomNav (bottom-20 = 80px = above the 64px nav + 16px breathing room) */}
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
                  {!user ? (theme?.cart_login_hint || "Login required to checkout") : (cartLines.subtotal >= meta.delivery_free_over ? (theme?.cart_free_delivery_label || "Free delivery") : (theme?.cart_delivery_fee_template?.replace("{fee}", String(meta.delivery_fee_flat)) || `+ ₹${meta.delivery_fee_flat} delivery`))}
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
