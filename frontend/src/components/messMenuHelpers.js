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

export const SERVICE_TABS = [
  { id: "delivery", label: "Delivery", icon: Truck },
  { id: "takeaway", label: "Takeaway", icon: Package },
  { id: "dining",   label: "Dining",   icon: Utensils },
];

export const PAY_TABS = [
  { id: "online", label: "Online", icon: ScanLine },
  { id: "cash",   label: "Cash",   icon: Banknote },
  { id: "wallet", label: "Wallet", icon: Wallet },
];

export const PENDING_KEY = "efc_pending_mess_order_v1";
