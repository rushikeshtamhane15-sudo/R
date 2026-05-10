/**
 * Restaurant cart — localStorage-backed. Stays alive across page reloads.
 * Shape: { [itemId]: { id, qty } }
 *
 * Cross-device sync: every saveCart() also fire-and-forgets a PUT /guest-cart
 * keyed by a UUID stored in localStorage.efc_guest_token. On app boot, /restaurant
 * page calls hydrateGuestCart() to merge any server-side cart into the local one
 * (taking max qty per item). This way mobile-built carts appear on desktop.
 */
const KEY = "efc_restaurant_cart_v1";
const TOKEN_KEY = "efc_guest_token";

function getOrCreateGuestToken() {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t || t.length < 8) {
      t = (crypto?.randomUUID ? crypto.randomUUID() : `gc_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/-/g, "").slice(0, 32);
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch { return null; }
}

export function loadCart() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
  catch { return {}; }
}

export function saveCart(cart) {
  try { localStorage.setItem(KEY, JSON.stringify(cart || {})); } catch {}
  // Cross-tab sync via storage event already handled by browser.
  try { window.dispatchEvent(new CustomEvent("efc-cart-changed")); } catch {}
  // Cross-device sync — fire-and-forget. Uses fetch (axios isn't imported here).
  try {
    const token = getOrCreateGuestToken();
    const base = process.env.REACT_APP_BACKEND_URL;
    if (token && base) {
      fetch(`${base}/api/guest-cart`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, cart: cart || {} }),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {}
}

/** Hydrate localStorage cart from server-side guest cart (cross-device). */
export async function hydrateGuestCart() {
  const token = getOrCreateGuestToken();
  const base = process.env.REACT_APP_BACKEND_URL;
  if (!token || !base) return loadCart();
  try {
    const r = await fetch(`${base}/api/guest-cart/${token}`);
    if (!r.ok) return loadCart();
    const { cart: serverCart } = await r.json();
    const local = loadCart();
    // Merge: take max qty per item so a cart built on another device adds in
    const merged = { ...local };
    for (const [id, line] of Object.entries(serverCart || {})) {
      const q = Number(line?.qty) || 0;
      if (q <= 0) continue;
      const existing = Number(merged[id]?.qty || 0);
      merged[id] = { id, qty: Math.max(existing, q) };
    }
    // Persist merged locally (without re-PUT — would loop)
    try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch {}
    try { window.dispatchEvent(new CustomEvent("efc-cart-changed")); } catch {}
    return merged;
  } catch { return loadCart(); }
}

export function clearCart() { saveCart({}); }

export function setQty(cart, id, qty) {
  const next = { ...cart };
  const n = Math.max(0, Math.min(50, Number(qty) || 0));
  if (n === 0) delete next[id];
  else next[id] = { id, qty: n };
  return next;
}

export function bumpQty(cart, id, delta) {
  const cur = cart[id]?.qty || 0;
  return setQty(cart, id, cur + delta);
}

export function cartCount(cart) {
  return Object.values(cart || {}).reduce((s, l) => s + (l?.qty || 0), 0);
}

/** Price the cart against a menu list (frontend preview only — server is the source of truth). */
export function priceCart(cart, menu) {
  const byId = {};
  for (const m of (menu || [])) byId[m.id] = m;
  const lines = [];
  let subtotal = 0;
  for (const l of Object.values(cart || {})) {
    const m = byId[l.id];
    if (!m) continue;
    const unit = Number(m.discounted_price ?? m.price);
    const total = +(unit * l.qty).toFixed(2);
    lines.push({ ...m, qty: l.qty, unit, line_total: total });
    subtotal += total;
  }
  subtotal = +subtotal.toFixed(2);
  return { lines, subtotal };
}
