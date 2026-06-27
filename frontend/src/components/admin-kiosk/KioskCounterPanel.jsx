// AdminKiosk — TOP panel: counter QR + meal toggle + QR provider + Bluetooth printer card.
import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "../ui/button";
import {
  Sun, Moon, ScanLine, Loader2,
  Bluetooth, BluetoothConnected, BluetoothOff,
} from "lucide-react";

const LOCATION = "main";

export default function KioskCounterPanel({
  meal, setMeal, counter,
  qrProvider, onSetQrProvider,
  btCfg, btStatus, onSetBtEnabled, onPairPrinter,
}) {
  return (
    <section className="rounded-3xl border border-[hsl(140,8%,22%)] bg-[hsl(140,8%,12%)] overflow-hidden flex flex-col" data-testid="kiosk-counter-panel">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(140,8%,20%)]">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(135,25%,55%)] text-[hsl(140,8%,8%)]">
            <ScanLine className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(135,25%,72%)]">Counter QR</p>
            <p className="font-display font-extrabold text-lg sm:text-xl">Scan with your phone to check in</p>
          </div>
        </div>
        <div className="flex gap-2" data-testid="kiosk-meal-toggle">
          <Button onClick={() => setMeal("lunch")} data-testid="kiosk-meal-lunch"
            className={`rounded-full h-11 px-5 text-sm font-extrabold ${meal === "lunch" ? "bg-[hsl(26,43%,57%)] text-white" : "bg-[hsl(140,8%,18%)] text-[hsl(40,25%,92%)]"}`}>
            <Sun className="h-4 w-4 mr-1.5" /> Lunch
          </Button>
          <Button onClick={() => setMeal("dinner")} data-testid="kiosk-meal-dinner"
            className={`rounded-full h-11 px-5 text-sm font-extrabold ${meal === "dinner" ? "bg-[hsl(220,55%,55%)] text-white" : "bg-[hsl(140,8%,18%)] text-[hsl(40,25%,92%)]"}`}>
            <Moon className="h-4 w-4 mr-1.5" /> Dinner
          </Button>
        </div>
      </div>

      <div className="flex-1 grid sm:grid-cols-[1.4fr_1fr] gap-4 p-5">
        <div className="rounded-2xl bg-white p-5 flex flex-col items-center justify-center" data-testid="kiosk-counter-qr">
          {counter ? (
            <>
              <QRCodeSVG value={counter.counter_code} size={360} level="M" fgColor="hsl(142 45% 28%)" />
              <p className="font-mono text-[10px] text-muted-foreground mt-3 break-all max-w-md text-center">{counter.counter_code}</p>
              <p className="text-xs font-semibold text-foreground mt-1">{meal.toUpperCase()} · {LOCATION}</p>
            </>
          ) : (
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-5">
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(135,25%,72%)]">How it works</p>
            <ol className="mt-2 space-y-2 text-sm text-[hsl(40,15%,82%)] list-decimal list-inside">
              <li>Open your phone camera.</li>
              <li>Point it at the QR on the left.</li>
              <li>Tap the notification to check in for {meal}.</li>
              <li>Walk-in? Scan the QR on your printed receipt instead.</li>
            </ol>
          </div>

          <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-4" data-testid="kiosk-qr-provider-card">
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(40,15%,70%)] mb-2">Online payment QR</p>
            <div className="inline-flex bg-[hsl(140,8%,12%)] rounded-full p-1 gap-1 w-full">
              <button type="button" onClick={() => onSetQrProvider("paytm")} data-testid="kiosk-qr-provider-paytm"
                className={`flex-1 px-3 h-9 rounded-full text-[11px] font-extrabold ${qrProvider === "paytm" ? "bg-[hsl(40,25%,94%)] text-[hsl(140,8%,8%)]" : "text-[hsl(40,15%,70%)]"}`}>
                Paytm UPI
              </button>
              <button type="button" onClick={() => onSetQrProvider("razorpay")} data-testid="kiosk-qr-provider-razorpay"
                className={`flex-1 px-3 h-9 rounded-full text-[11px] font-extrabold ${qrProvider === "razorpay" ? "bg-[hsl(220,55%,55%)] text-white" : "text-[hsl(40,15%,70%)]"}`}>
                Razorpay
              </button>
            </div>
            <p className="text-[10px] text-[hsl(40,15%,65%)] mt-2 leading-relaxed">
              {qrProvider === "razorpay"
                ? "Razorpay Dynamic QR — auto-confirms payment in ~4s. Uses live Razorpay creds."
                : "Paytm UPI intent QR — works with any UPI app. Staff taps Mark paid after scan."}
            </p>
          </div>

          <div className="rounded-2xl bg-[hsl(140,8%,16%)] border border-[hsl(140,8%,22%)] p-4" data-testid="kiosk-bt-card">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {btCfg?.enabled
                  ? (btStatus === "connected" ? <BluetoothConnected className="h-4 w-4 text-blue-400" /> : <Bluetooth className="h-4 w-4 text-blue-400" />)
                  : <BluetoothOff className="h-4 w-4 text-[hsl(40,15%,60%)]" />}
                <p className="text-sm font-extrabold">Bluetooth printer</p>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!btCfg?.enabled}
                  onChange={(e) => onSetBtEnabled(e.target.checked)}
                  className="sr-only peer"
                  data-testid="kiosk-bt-toggle"
                />
                <span className="w-10 h-6 bg-[hsl(140,8%,22%)] peer-checked:bg-blue-600 rounded-full relative transition-colors">
                  <span className="absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-md" />
                </span>
              </label>
            </div>
            {btCfg?.enabled && (
              <>
                <p className="text-[11px] text-[hsl(40,15%,70%)] mt-1.5">
                  {btStatus === "connected" ? "Paired — auto-print on every order." : "Pair once per kiosk session — receipts auto-print after."}
                </p>
                {btStatus !== "connected" && (
                  <Button onClick={onPairPrinter} disabled={btStatus === "connecting"}
                    className="mt-2 rounded-full h-9 text-xs bg-blue-600 hover:bg-blue-700 w-full" data-testid="kiosk-bt-pair">
                    {btStatus === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Bluetooth className="h-3.5 w-3.5 mr-1.5" />}
                    {btStatus === "connecting" ? "Pairing…" : "Pair printer now"}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
