// AdminKiosk — payment modal (Paytm UPI intent OR Razorpay Dynamic QR).
import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "../ui/button";
import { CheckCircle2, X as XIcon } from "lucide-react";

export default function KioskPaymentModal({ pendingOrder, onConfirm, onCancel }) {
  if (!pendingOrder || !pendingOrder.order || pendingOrder.order.payment_method === "cash") return null;
  const { order, provider, upiQrText, upiVpa, razorpayQrImageUrl } = pendingOrder;
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

        {provider === "razorpay" && razorpayQrImageUrl ? (
          <div className="mt-4 flex flex-col items-center">
            <div className="rounded-2xl bg-white p-4 border-2 border-[hsl(220,55%,55%)]" data-testid="kiosk-razorpay-qr">
              <img src={razorpayQrImageUrl} alt="Scan to pay via Razorpay UPI" className="w-[240px] h-[240px] object-contain" />
            </div>
            <p className="text-[11px] mt-2 text-muted-foreground text-center">Razorpay Dynamic QR · auto-confirms on payment</p>
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
