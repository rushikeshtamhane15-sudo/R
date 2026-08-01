// AdminKiosk — payment modal (Paytm UPI intent OR Razorpay Dynamic QR).
import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "../ui/button";
import { CheckCircle2, ExternalLink, Loader2, X as XIcon } from "lucide-react";

export default function KioskPaymentModal({ pendingOrder, onConfirm, onCancel }) {
  if (!pendingOrder || !pendingOrder.order || pendingOrder.order.payment_method === "cash") return null;
  const { order, provider, upiQrText, upiVpa, razorpayQrImageUrl, razorpayQrId, razorpayShortUrl } = pendingOrder;
  const isPolling = provider === "razorpay" && !!razorpayQrId && !order.online_paid;
  // iter-135 — Razorpay Dynamic QR fix.
  // Rendering the `short_url` (rzp.io/...) as a QRCodeSVG produces a QR that
  // encodes a URL, NOT a UPI intent — GPay/PhonePe/Paytm's in-app scanners
  // then fail to interpret it as a payment. The `image_url` PNG served by
  // Razorpay contains the ACTUAL UPI intent QR and works with every UPI
  // app. So we render the upstream PNG as the primary QR (sized crisp for
  // 27" kiosk), and the short_url is offered as a manual "Open pay link"
  // backup for phones that can't scan the wall from close range.
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" data-testid="kiosk-paytm-modal">
      <div className="bg-white text-[hsl(140,8%,8%)] rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(140,30%,32%)]">
              {provider === "razorpay" ? "Razorpay · auto-confirms" : "Awaiting payment"}
            </p>
            <p className="font-display font-extrabold text-xl">Scan to pay ₹{order.online_amount}</p>
            {provider !== "razorpay" && (
              <p className="text-[11px] text-muted-foreground">VPA: <span className="font-mono">{upiVpa || "efoodcare@paytm"}</span></p>
            )}
          </div>
          <button type="button" onClick={onCancel} className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-[hsl(140,8%,90%)]" data-testid="kiosk-paytm-cancel">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {provider === "razorpay" && (razorpayQrImageUrl || razorpayShortUrl) ? (
          <div className="mt-4 flex flex-col items-center">
            <div className="relative rounded-2xl bg-white p-4 border-2 border-[hsl(220,55%,55%)]" data-testid="kiosk-razorpay-qr">
              {razorpayQrImageUrl ? (
                // Razorpay-hosted PNG contains the real UPI intent QR that all
                // UPI apps (GPay/PhonePe/Paytm) recognize. crisp-edges keeps
                // it sharp on high-DPI kiosk displays.
                <img
                  src={razorpayQrImageUrl}
                  alt="Scan to pay via UPI"
                  className="w-[320px] h-[320px] object-contain block"
                  style={{ imageRendering: "pixelated" }}
                  data-testid="kiosk-razorpay-qr-img"
                />
              ) : (
                // Only used if Razorpay didn't return an image_url (rare) — the
                // short_url QR opens Razorpay's hosted payment page in a
                // browser, which is a working fallback for any camera scanner.
                <QRCodeSVG value={razorpayShortUrl} size={320} level="M" includeMargin={false} data-testid="kiosk-razorpay-qr-svg" />
              )}
              {isPolling && (
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-2 bg-white/72 backdrop-blur-[1.5px] animate-in fade-in"
                  data-testid="kiosk-razorpay-polling"
                >
                  <Loader2 className="h-10 w-10 animate-spin text-[hsl(220,55%,45%)]" strokeWidth={2.5} />
                  <p className="text-[13px] font-extrabold tracking-wide text-[hsl(220,55%,25%)]">Waiting for UPI…</p>
                  <p className="text-[10px] font-semibold text-[hsl(220,10%,40%)] tracking-[0.14em] uppercase">Auto-prints on confirmation</p>
                </div>
              )}
            </div>
            <p className="text-[11px] mt-2 text-muted-foreground text-center">Razorpay Dynamic UPI QR · auto-confirms on payment</p>
            {razorpayShortUrl && (
              <a
                href={razorpayShortUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[hsl(220,55%,45%)] hover:underline"
                data-testid="kiosk-razorpay-open-link"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Can't scan? Open pay link
              </a>
            )}
          </div>
        ) : upiQrText ? (
          <div className="mt-4 flex flex-col items-center">
            <div className="rounded-2xl bg-white p-4 border-2 border-[hsl(140,40%,40%)]">
              <QRCodeSVG value={upiQrText} size={240} level="M" />
            </div>
            <p className="text-[11px] font-mono mt-2 text-muted-foreground break-all px-2 text-center">{upiQrText}</p>
          </div>
        ) : null}

        {order.payment_method === "mixed" && (
          <div className="mt-3 rounded-xl bg-[hsl(140,40%,95%)] border border-[hsl(140,40%,80%)] p-3 text-[12px]" data-testid="kiosk-paytm-mixed-summary">
            <p className="font-extrabold">Mixed payment</p>
            <p>Cash collected at counter: <span className="font-mono">₹{order.cash_amount}</span> · UPI online: <span className="font-mono">₹{order.online_amount}</span></p>
          </div>
        )}

        <div className="mt-4 grid gap-2">
          <Button
            onClick={() => onConfirm({ online_paid: true, cash_received: order.payment_method === "mixed" })}
            className="h-11 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold"
            data-testid="kiosk-paytm-mark-paid"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {order.payment_method === "mixed" ? "Both received — print receipt" : "Mark paid & print receipt"}
          </Button>
          {order.payment_method === "mixed" && (
            <p className="text-[11px] text-center text-muted-foreground">Tap once both UPI confirmation AND cash are in hand.</p>
          )}
          <Button onClick={onCancel} variant="ghost" className="h-9 text-xs text-muted-foreground" data-testid="kiosk-paytm-cancel-2">
            Cancel order
          </Button>
        </div>
      </div>
    </div>
  );
}
