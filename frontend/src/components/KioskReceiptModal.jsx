import React, { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Printer, X, Bluetooth, BluetoothConnected, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { connectBluetoothPrinter, isBluetoothSupported, getLastPrinterName } from "../lib/bluetoothPrinter";

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
  // iter-71: Bluetooth printer state. We persist the printer object on the
  // window so subsequent receipts within the same session reuse the GATT
  // connection (Web Bluetooth re-pairing is otherwise a per-print prompt).
  const [btStatus, setBtStatus] = useState(() => (
    typeof window !== "undefined" && window.__efcBtPrinter ? "connected" : "idle"
  ));
  const [btPrinting, setBtPrinting] = useState(false);
  const btSupported = isBluetoothSupported();
  const lastBtName = getLastPrinterName();

  const connectBt = async () => {
    try {
      setBtStatus("connecting");
      const printer = await connectBluetoothPrinter();
      // eslint-disable-next-line no-undef
      window.__efcBtPrinter = printer;
      printer.device.addEventListener("gattserverdisconnected", () => {
        // eslint-disable-next-line no-undef
        if (window.__efcBtPrinter === printer) window.__efcBtPrinter = null;
        setBtStatus("idle");
      });
      setBtStatus("connected");
      toast.success(`Paired with ${printer.name}`);
    } catch (e) {
      setBtStatus("idle");
      toast.error(e?.message || "Could not pair printer");
    }
  };

  const printViaBluetooth = async () => {
    // eslint-disable-next-line no-undef
    let printer = window.__efcBtPrinter;
    if (!printer) { await connectBt(); /* eslint-disable-next-line no-undef */ printer = window.__efcBtPrinter; }
    if (!printer) return;
    setBtPrinting(true);
    try {
      await printer.printReceipt(order, qrText);
      toast.success("Receipt sent to printer");
    } catch (e) {
      toast.error(e?.message || "Print failed — reconnect printer");
      // Drop the reference so the next print re-pairs cleanly
      // eslint-disable-next-line no-undef
      window.__efcBtPrinter = null;
      setBtStatus("idle");
    } finally { setBtPrinting(false); }
  };

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

        <div className="px-5 py-3 border-t border-border flex flex-col gap-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="rounded-full flex-1" data-testid="kiosk-receipt-cancel">Close</Button>
            <Button onClick={printReceipt} className="rounded-full flex-1 bg-primary text-primary-foreground" data-testid="kiosk-receipt-print">
              <Printer className="h-4 w-4 mr-1.5" /> Browser print
            </Button>
          </div>
          {/* iter-71: Bluetooth printer row */}
          <div className="flex items-center gap-2">
            {btSupported ? (
              <>
                <Button
                  onClick={printViaBluetooth}
                  disabled={btPrinting || btStatus === "connecting"}
                  className="rounded-full flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  data-testid="kiosk-receipt-bluetooth"
                >
                  {btPrinting || btStatus === "connecting" ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : btStatus === "connected" ? (
                    <BluetoothConnected className="h-4 w-4 mr-1.5" />
                  ) : (
                    <Bluetooth className="h-4 w-4 mr-1.5" />
                  )}
                  {btStatus === "connected"
                    ? "Print via Bluetooth"
                    : btStatus === "connecting"
                      ? "Pairing…"
                      : "Pair & print via Bluetooth"}
                </Button>
                {btStatus === "connected" && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      // eslint-disable-next-line no-undef
                      try { window.__efcBtPrinter?.disconnect(); } catch { /* ignore */ }
                      // eslint-disable-next-line no-undef
                      window.__efcBtPrinter = null;
                      setBtStatus("idle");
                    }}
                    className="rounded-full text-xs"
                    data-testid="kiosk-bt-disconnect"
                  >Unpair</Button>
                )}
              </>
            ) : (
              <div className="flex-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900" data-testid="kiosk-bt-unsupported">
                Bluetooth printing not supported here. Use Chrome on Android/desktop, or install <a className="underline" href="https://apps.apple.com/in/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noreferrer noopener">Bluefy</a> on iOS.
              </div>
            )}
          </div>
        </div>
        <p className="px-5 pb-3 text-[10px] text-muted-foreground text-center">
          QR is single-use. Counter must scan it before serving the thali.{lastBtName && btStatus !== "connected" ? ` · Last used: ${lastBtName}` : ""}
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
