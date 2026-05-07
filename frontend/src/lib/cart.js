/**
 * Restaurant cart — localStorage-backed. Stays alive across page reloads.
 * Shape: { [itemId]: { id, qty } }
 */
const KEY = "efc_restaurant_cart_v1";

export function loadCart() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
  catch { return {}; }
}

export function saveCart(cart) {
  try { localStorage.setItem(KEY, JSON.stringify(cart || {})); } catch {}
  // Cross-tab sync via storage event already handled by browser.
  try { window.dispatchEvent(new CustomEvent("efc-cart-changed")); } catch {}
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
