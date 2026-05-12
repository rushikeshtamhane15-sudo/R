/**
 * Restaurant cart — localStorage-backed, variant-aware.
 *
 * Cart shape (v2):
 *   { [key]: { id, variant, qty } }
 * where key = `${id}::${variant}` so the same dish can appear as multiple
 * lines (Regular AND Large) and each line is priced + labelled separately.
 *
 * Variants: "regular" (default), "large" (×2), "family" (×4). Keep these
 * in lockstep with backend `routes/restaurant.py#PORTION_MULTIPLIER`.
 *
 * Backwards compat: older carts used key=id with no variant. loadCart()
 * silently re-keys those lines to `${id}::regular`.
 */
const KEY = "efc_restaurant_cart_v1";
const TOKEN_KEY = "efc_guest_token";

export const PORTION_MULTIPLIER = { regular: 1, large: 2, family: 4 };
export const PORTION_LABEL = { regular: "Regular", large: "Large", family: "Family" };
export const DEFAULT_VARIANT = "regular";

export function lineKey(id, variant = DEFAULT_VARIANT) {
  return `${id}::${variant || DEFAULT_VARIANT}`;
}

function migrate(raw) {
  if (!raw || typeof raw !== "object") return {};
  const next = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v) continue;
    // Already v2 (key contains "::") OR explicit variant field present
    if (k.includes("::") || v.variant) {
      const variant = (v.variant || k.split("::")[1] || DEFAULT_VARIANT).toLowerCase();
      const id = v.id || k.split("::")[0];
      const qty = Math.max(0, Math.min(50, Number(v.qty) || 0));
      if (qty > 0 && id) next[lineKey(id, variant)] = { id, variant, qty };
      continue;
    }
    // v1 shape — coerce to regular variant
    const id = v.id || k;
    const qty = Math.max(0, Math.min(50, Number(v.qty) || 0));
    if (qty > 0 && id) next[lineKey(id, DEFAULT_VARIANT)] = { id, variant: DEFAULT_VARIANT, qty };
  }
  return next;
}

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
  try { return migrate(JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return {}; }
}

export function saveCart(cart) {
  try { localStorage.setItem(KEY, JSON.stringify(cart || {})); } catch { /* non-critical: storage/network unavailable */ }
  try { window.dispatchEvent(new CustomEvent("efc-cart-changed")); } catch { /* non-critical: storage/network unavailable */ }
  // Cross-device sync — fire-and-forget.
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
  } catch { /* non-critical: storage/network unavailable */ }
}

export async function hydrateGuestCart() {
  const token = getOrCreateGuestToken();
  const base = process.env.REACT_APP_BACKEND_URL;
  if (!token || !base) return loadCart();
  try {
    const r = await fetch(`${base}/api/guest-cart/${token}`);
    if (!r.ok) return loadCart();
    const { cart: serverCart } = await r.json();
    const local = loadCart();
    const serverMigrated = migrate(serverCart || {});
    // Merge — take max qty per (id, variant) key so cross-device adds win
    const merged = { ...local };
    for (const [k, line] of Object.entries(serverMigrated)) {
      const q = Number(line?.qty) || 0;
      if (q <= 0) continue;
      const existing = Number(merged[k]?.qty || 0);
      merged[k] = { id: line.id, variant: line.variant, qty: Math.max(existing, q) };
    }
    try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* non-critical: storage/network unavailable */ }
    try { window.dispatchEvent(new CustomEvent("efc-cart-changed")); } catch { /* non-critical: storage/network unavailable */ }
    return merged;
  } catch { return loadCart(); }
}

export function clearCart() { saveCart({}); }

export function setQty(cart, id, qty, variant = DEFAULT_VARIANT) {
  const next = { ...cart };
  const k = lineKey(id, variant);
  const n = Math.max(0, Math.min(50, Number(qty) || 0));
  if (n === 0) delete next[k];
  else next[k] = { id, variant: variant || DEFAULT_VARIANT, qty: n };
  return next;
}

export function bumpQty(cart, id, delta, variant = DEFAULT_VARIANT) {
  const cur = cart[lineKey(id, variant)]?.qty || 0;
  return setQty(cart, id, cur + delta, variant);
}

/** Move a cart line from one variant to another, merging qty if the target
 *  variant already has a line. No-op when oldVariant === newVariant. */
export function changeVariant(cart, id, oldVariant, newVariant) {
  if (!cart || !id) return cart;
  const oldV = (oldVariant || DEFAULT_VARIANT).toLowerCase();
  const newV = (newVariant || DEFAULT_VARIANT).toLowerCase();
  if (oldV === newV) return cart;
  const next = { ...cart };
  const oldKey = lineKey(id, oldV);
  const newKey = lineKey(id, newV);
  const oldQty = Number(next[oldKey]?.qty) || 0;
  if (oldQty <= 0) return cart;
  const merged = (Number(next[newKey]?.qty) || 0) + oldQty;
  delete next[oldKey];
  next[newKey] = { id, variant: newV, qty: Math.min(50, merged) };
  return next;
}

export function cartCount(cart) {
  // Counts each portion individually (Large counts as 2, Family as 4) so the
  // sticky cart-bar reflects "physical portions in the box" not "lines".
  return Object.values(cart || {}).reduce((s, l) => {
    const mult = PORTION_MULTIPLIER[l?.variant || DEFAULT_VARIANT] || 1;
    return s + (Number(l?.qty) || 0) * mult;
  }, 0);
}

/** Number of distinct cart lines — useful for "N items in cart" pluralisation. */
export function cartLineCount(cart) {
  return Object.values(cart || {}).reduce((s, l) => s + ((Number(l?.qty) || 0) > 0 ? 1 : 0), 0);
}

/** Price the cart against a menu list (frontend preview — server is the source of truth). */
export function priceCart(cart, menu) {
  const byId = {};
  for (const m of (menu || [])) byId[m.id] = m;
  const lines = [];
  let subtotal = 0;
  for (const l of Object.values(cart || {})) {
    const m = byId[l.id];
    if (!m) continue;
    const variant = (l.variant || DEFAULT_VARIANT).toLowerCase();
    const mult = PORTION_MULTIPLIER[variant] || 1;
    const baseUnit = Number(m.discounted_price ?? m.price);
    const unit = +(baseUnit * mult).toFixed(2);
    const total = +(unit * l.qty).toFixed(2);
    lines.push({
      ...m,
      qty: l.qty,
      variant,
      variant_label: PORTION_LABEL[variant] || variant,
      portion_multiplier: mult,
      unit,
      line_total: total,
    });
    subtotal += total;
  }
  subtotal = +subtotal.toFixed(2);
  return { lines, subtotal };
}
