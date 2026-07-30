// Helpers extracted from TodayMessMenuFlash (iter-122 refactor pass).
import { Truck, Package, Utensils, ScanLine, Banknote, Wallet } from "lucide-react";

/**
 * splitMenuItems — convert a free-text mess menu string like
 *   "Dal bhaji + bhendi sabji + 5 roti + rice + salad"
 * into a clean array of trimmed items:
 *   ["Dal bhaji", "bhendi sabji", "5 roti", "rice", "salad"]
 * Splits on "+" or "," and drops empty fragments.
 */
export function splitMenuItems(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[+,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * loadRazorpay — lazy-load the Razorpay checkout SDK script.
 * Resolves even on failure so callers can fall back to mock flow.
 */
export function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = resolve;
    document.body.appendChild(s);
  });
}

/**
 * cleanIndianMobile — return a 10-digit Indian mobile if valid, else null.
 * Accepts "+91 98765 43210", "919876543210", "98765-43210" etc.
 */
export function cleanIndianMobile(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const stripped = digits.startsWith("91") && digits.length > 10 ? digits.slice(-10) : digits;
  if (stripped.length !== 10) return null;
  if (!/^[6-9]/.test(stripped)) return null;
  return stripped;
}

/* --------------------------------------------------------------------------
 * iter-131 additions
 * -------------------------------------------------------------------------- */

// iter-131.10: user requested Delivery + Takeaway + Dining ALL to be
// selectable again from the mess-menu order form. Restored to the original
// three-option pill row.
export const SERVICE_TABS = [
  { id: "delivery", label: "Delivery", icon: Truck },
  { id: "takeaway", label: "Takeaway", icon: Package },
  { id: "dining",   label: "Dining",   icon: Utensils },
];

// Kept for reference (also used on the physical kiosk screen).
export const KIOSK_SERVICE_TABS = SERVICE_TABS;

export const PAY_TABS = [
  { id: "online", label: "Online", icon: ScanLine },
  { id: "cash",   label: "Cash",   icon: Banknote },
  { id: "wallet", label: "Wallet", icon: Wallet },
];

export const PENDING_KEY = "efc_pending_mess_order_v1";

/**
 * Same-day meal-window rules (IST). Must stay in sync with backend
 * MEAL_WINDOWS_IST in routes/mess_menu_cal.py.
 *
 * Semantics: `lunch` orders for TODAY are accepted until lunch service ends
 * (~3 pm IST). Once 3 pm crosses, TODAY's lunch is closed; `dinner` opens.
 * After 10 pm both are closed for today — pre-orders for tomorrow are
 * always allowed regardless of window.
 *
 * iter-134.d: admin-configurable via /api/meal-slots. The App root fetches
 * the config on mount and calls `setAdminMealSlots(...)`; every consumer
 * (`isMealWindowOpen`, kiosk toggle, restaurant order form) then reads the
 * runtime value. Defaults below act as fallback for cold-start.
 */
export const MEAL_WINDOWS_IST = {
  lunch:  { start: 0,  end: 15, label: "12 – 3 pm" },
  dinner: { start: 15, end: 22, label: "7 – 10 pm" },
};

// Runtime, mutable copy — updated by setAdminMealSlots().
let _runtimeSlots = {
  lunch:  { startMin: 0,       endMin: 15 * 60 },
  dinner: { startMin: 15 * 60, endMin: 22 * 60 },
};

function _hhmmToMin(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(":").map((s) => parseInt(s, 10) || 0);
  return h * 60 + m;
}

/**
 * Called by the App root once the /api/meal-slots response lands.
 * Accepts the exact response shape:
 * `{ lunch:{start:"12:00",end:"15:00"}, dinner:{start:"19:00",end:"22:00"} }`
 * Silently no-ops on malformed payloads.
 */
export function setAdminMealSlots(slots) {
  try {
    if (!slots || typeof slots !== "object") return;
    if (slots.lunch?.start && slots.lunch?.end) {
      _runtimeSlots.lunch = {
        startMin: _hhmmToMin(slots.lunch.start),
        endMin:   _hhmmToMin(slots.lunch.end),
      };
    }
    if (slots.dinner?.start && slots.dinner?.end) {
      _runtimeSlots.dinner = {
        startMin: _hhmmToMin(slots.dinner.start),
        endMin:   _hhmmToMin(slots.dinner.end),
      };
    }
  } catch { /* ignore */ }
}

/** Current IST hour (0-23). */
export function currentISTHour() {
  const now = new Date();
  // Add IST offset (+5:30) to UTC to get IST hour, mod 24.
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 3600000).getHours();
}

/** Current IST time in minutes-since-midnight. */
function _currentISTMin() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);
  return ist.getHours() * 60 + ist.getMinutes();
}

/** True if the meal-window for `meal` is currently open in IST (admin-configurable). */
export function isMealWindowOpen(meal) {
  const w = _runtimeSlots[meal];
  if (!w) return true;
  const m = _currentISTMin();
  return m >= w.startMin && m <= w.endMin;
}

/**
 * Returns "lunch" | "dinner" | null based on the ADMIN-configured slot
 * windows in IST. Used by the restaurant order form + wall-kiosk to
 * strictly gate which meal's QR/menu is being scanned.
 */
export function activeMealForNow() {
  const m = _currentISTMin();
  if (m >= _runtimeSlots.lunch.startMin  && m <= _runtimeSlots.lunch.endMin)  return "lunch";
  if (m >= _runtimeSlots.dinner.startMin && m <= _runtimeSlots.dinner.endMin) return "dinner";
  return null;
}
