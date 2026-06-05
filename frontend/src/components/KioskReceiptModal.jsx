import React, { useEffect, useRef } from "react";
import { Button } from "./ui/button";
import { Printer, X } from "lucide-react";

/**
 * KioskReceiptModal — iter-70
 *
 * Shows the freshly-printed receipt preview (80mm thermal width) with the
 * one-time check-in QR. Big "Print receipt" button uses window.print() on
 * a hidden iframe so the user's default thermal printer (USB ESC/POS
 * driver) gets a clean print job without any OS dialog noise.
 *
 * The QR encodes `kio:<token>`. The counter scanner recognizes the prefix
 * and consumes the token atomically → marks the walk-in as "served". A
 * second scan of the same QR fails with 400 "Already redeemed", killing
 * the staff-side "no-checkin, free thali" fraud.
 */
export default function KioskReceiptModal({ order, qrDataUrl, qrText, onClose }) {
  const iframeRef = useRef(null);

  const printReceipt = () => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      // Fallback: open the receipt in a new tab
      const win = window.open("", "efc_receipt_fallback", "width=400,height=600");
      if (win) {
        win.document.write(buildReceiptHtml({ order, qrDataUrl, qrText }));
        win.document.close();
        setTimeout(() => { try { win.print(); } catch { /* no-op */ } }, 200);
      }
    }
  };

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(buildReceiptHtml({ order, qrDataUrl, qrText }));
    doc.close();
  }, [order, qrDataUrl, qrText]);

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4 py-6" data-testid="kiosk-receipt-modal">
      <div className="bg-card rounded-3xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-secondary">Receipt ready</p>
            <p className="font-display font-extrabold text-lg">Print &amp; hand to customer</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-muted/40 rounded-full" data-testid="kiosk-receipt-close" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Preview (rendered exactly like the print output) */}
        <iframe
          ref={iframeRef}
          title="receipt-preview"
          className="w-full h-[440px] bg-white"
          data-testid="kiosk-receipt-iframe"
        />

        <div className="px-5 py-3 border-t border-border flex gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-full flex-1" data-testid="kiosk-receipt-cancel">Close</Button>
          <Button onClick={printReceipt} className="rounded-full flex-1 bg-primary text-primary-foreground" data-testid="kiosk-receipt-print">
            <Printer className="h-4 w-4 mr-1.5" /> Print receipt
          </Button>
        </div>
        <p className="px-5 pb-3 text-[10px] text-muted-foreground text-center">
          QR is single-use. Counter must scan it before serving the thali.
        </p>
      </div>
    </div>
  );
}

function buildReceiptHtml({ order, qrDataUrl, qrText }) {
  // 80mm thermal printers render at ~576px width @ 203dpi. We design at
  // 280px logical so the HTML preview looks tight and the print scales OK.
  const safe = (s) => String(s ?? "").replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
  const o = order || {};
  return `<!doctype html><html><head><meta charset="utf-8"><title>efoodcare receipt</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: 'Courier New', Courier, monospace; }
  .r { width: 280px; padding: 10px 12px 16px; margin: 0 auto; }
  .center { text-align: center; }
  .brand { font-weight: 800; font-size: 16px; letter-spacing: 2px; }
  .tagline { font-size: 9px; letter-spacing: 2px; margin-top: 2px; }
  .sep { border-top: 1px dashed #000; margin: 8px 0; }
  .line { display: flex; justify-content: space-between; font-size: 11px; line-height: 1.5; }
  .line b { font-weight: 800; }
  .total { font-size: 14px; font-weight: 800; margin-top: 4px; }
  .qr { display:flex; flex-direction:column; align-items:center; margin: 10px 0 4px; }
  .qr img { width: 180px; height: 180px; }
  .qr-label { font-size: 9px; text-align:center; margin-top: 4px; letter-spacing: 1px; }
  .token { font-size: 9px; font-family: 'Courier New', Courier, monospace; word-break: break-all; text-align:center; margin-top: 2px; }
  .footer { text-align:center; font-size: 10px; margin-top: 8px; }
  .single { background:#000; color:#fff; padding: 3px 6px; display:inline-block; font-weight:800; font-size:10px; letter-spacing:1px; }
  @media print {
    body { width: 80mm; }
    .r { width: auto; padding: 4mm 4mm 6mm; }
    .no-print { display: none; }
  }
</style>
</head><body><div class="r">
  <div class="center">
    <div class="brand">efoodcare</div>
    <div class="tagline">GHAR SE ACHHA KHANA</div>
  </div>
  <div class="sep"></div>
  <div class="line"><span>Order</span><b>${safe(o.order_id)}</b></div>
  <div class="line"><span>Date</span><span>${safe(o.date)}</span></div>
  <div class="line"><span>Meal</span><b>${safe((o.meal_type || "").toUpperCase())}</b></div>
  <div class="line"><span>Service</span><b>${safe((o.service || "").toUpperCase())}</b></div>
  ${o.phone ? `<div class="line"><span>Phone</span><span>${safe(o.phone)}</span></div>` : ""}
  <div class="sep"></div>
  <div class="line"><span>${safe(o.qty)} × ${safe((o.menu_text || "").slice(0, 60))}</span><b>₹${safe(o.total)}</b></div>
  <div class="line"><span>Unit</span><span>₹${safe(o.unit_price)}</span></div>
  <div class="line total"><span>TOTAL</span><span>₹${safe(o.total)}</span></div>
  <div class="line"><span>Status</span><span>${safe(o.status)}</span></div>
  <div class="sep"></div>
  <div class="qr">
    ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR"/>` : `<div style="font-size:10px">[QR unavailable — token: ${safe(qrText)}]</div>`}
    <div class="qr-label">SCAN AT COUNTER</div>
    <div class="single">SINGLE-USE</div>
    <div class="token">${safe(qrText)}</div>
  </div>
  <div class="footer">
    Show this QR at counter before collecting your thali.<br/>
    Thank you for choosing efoodcare!
  </div>
</div></body></html>`;
}
