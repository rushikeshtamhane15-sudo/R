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
  meal, setMeal, counter, activeSlot, kioskLogoUrl,
  qrProvider, onSetQrProvider,
  btCfg, btStatus, onSetBtEnabled, onPairPrinter,
}) {
  // iter-131.30: hard-lock the meal toggle to the currently-active slot. Off-slot
  // buttons render disabled + faded so staff can never mint the wrong QR.
  const canLunch = activeSlot === "lunch";
  const canDinner = activeSlot === "dinner";
  // iter-132.b: compact live Bluetooth-printer status pill for the kiosk header.
  // Three visible states: off (BT disabled), waiting (enabled but not paired),
  // pairing (in-flight), and paired (green). Rendered next to the header title
  // so staff spot a disconnect BEFORE the next print job.
  const btPill = (() => {
    if (!btCfg?.enabled) {
      return { label: "Printer off", tone: "bg-white/12 text-white/80 ring-white/20", Icon: BluetoothOff };
    }
    if (btStatus === "connected") {
      return { label: "Printer paired", tone: "bg-emerald-400/25 text-emerald-100 ring-emerald-300/40", Icon: BluetoothConnected };
    }
    if (btStatus === "connecting") {
      return { label: "Pairing…", tone: "bg-blue-400/25 text-blue-100 ring-blue-300/40", Icon: Loader2 };
    }
    return { label: "Printer waiting", tone: "bg-amber-400/25 text-amber-100 ring-amber-300/40", Icon: Bluetooth };
  })();
  return (
    <section className="rounded-3xl border border-white/25 bg-black/45 backdrop-blur-sm overflow-hidden flex flex-col" data-testid="kiosk-counter-panel">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/12">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white">
            <ScanLine className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-white/80">Counter QR</p>
            <p className="font-display font-extrabold text-lg sm:text-xl">Scan with your phone to check in</p>
          </div>
          <span
            className={`ml-3 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[10px] tracking-[0.16em] uppercase font-extrabold ring-1 ${btPill.tone}`}
            data-testid="kiosk-printer-status-pill"
            title={btPill.label}
          >
            <btPill.Icon className={`h-3.5 w-3.5 ${btStatus === "connecting" ? "animate-spin" : ""}`} />
            <span>{btPill.label}</span>
          </span>
        </div>
        <div className="flex gap-2" data-testid="kiosk-meal-toggle">
          <Button
            onClick={() => canLunch && setMeal("lunch")}
            disabled={!canLunch}
            data-testid="kiosk-meal-lunch"
            className={`rounded-full h-11 px-5 text-sm font-extrabold transition-opacity ${meal === "lunch" && canLunch ? "bg-white text-emerald-700 ring-2 ring-emerald-500 shadow-lg" : canLunch ? "bg-white text-emerald-700 ring-1 ring-emerald-300 hover:ring-emerald-500" : "bg-white text-red-600 ring-1 ring-red-400 opacity-70 cursor-not-allowed"}`}>
            <Sun className="h-4 w-4 mr-1.5" /> Lunch
          </Button>
          <Button
            onClick={() => canDinner && setMeal("dinner")}
            disabled={!canDinner}
            data-testid="kiosk-meal-dinner"
            className={`rounded-full h-11 px-5 text-sm font-extrabold transition-opacity ${meal === "dinner" && canDinner ? "bg-white text-emerald-700 ring-2 ring-emerald-500 shadow-lg" : canDinner ? "bg-white text-emerald-700 ring-1 ring-emerald-300 hover:ring-emerald-500" : "bg-white text-red-600 ring-1 ring-red-400 opacity-70 cursor-not-allowed"}`}>
            <Moon className="h-4 w-4 mr-1.5" /> Dinner
          </Button>
        </div>
      </div>

      <div className="flex-1 grid sm:grid-cols-[1.4fr_1fr] gap-4 p-5">
        <div className="rounded-2xl bg-white p-5 flex flex-col items-center justify-center" data-testid="kiosk-counter-qr">
          {/* iter-131.32: efoodcare brand block above the QR — centered logo +
              white text + tagline. Admin can (in a later iter) upload a custom
              icon; we fall back to the built-in favicon path. */}
          <div className="w-full max-w-[360px] rounded-2xl bg-primary flex flex-col items-center gap-1 py-3 mb-4 shadow-md" data-testid="kiosk-brand-block">
            <img
              src={kioskLogoUrl || "/favicon-96.png"}
              alt="efoodcare"
              onError={(e) => { e.currentTarget.src = "/favicon-96.png"; }}
              className="h-12 w-12 object-contain rounded-md bg-white/10 ring-1 ring-white/20"
              data-testid="kiosk-brand-logo"
            />
            <p className="font-display font-extrabold text-2xl leading-none text-white tracking-tight" data-testid="kiosk-brand-name">efoodcare</p>
            <p className="text-[10px] tracking-[0.24em] uppercase font-bold text-white/85" data-testid="kiosk-brand-tagline">ghar se achha khana</p>
          </div>
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
          <div className="rounded-2xl bg-white border border-black/8 p-5 shadow-sm" data-testid="kiosk-how-it-works">
            <p className="text-[11px] tracking-[0.18em] uppercase font-bold text-primary">How it works</p>
            <ol className="mt-2 space-y-2 text-base text-foreground list-decimal list-inside font-medium">
              <li>Open your phone camera.</li>
              <li>Point it at the QR on the left.</li>
              <li>Tap the notification to check in for {meal}.</li>
              <li>Walk-in? Scan the QR on your printed receipt instead.</li>
            </ol>
          </div>

          <div className="rounded-2xl bg-white border border-black/8 p-4 shadow-sm" data-testid="kiosk-qr-provider-card">
            <p className="text-[11px] tracking-[0.18em] uppercase font-bold text-primary mb-2">Online payment QR</p>
            <div className="inline-flex bg-[hsl(220,55%,55%)] rounded-full h-9 px-4 items-center w-full justify-center" data-testid="kiosk-qr-provider-razorpay">
              <span className="text-[12px] font-extrabold text-white">Razorpay Dynamic UPI QR</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
              Razorpay Dynamic QR — auto-confirms payment in ~4s. Paytm has been retired.
            </p>
          </div>

          <div className="rounded-2xl bg-white border border-black/8 p-4 shadow-sm" data-testid="kiosk-bt-card">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-foreground">
                {btCfg?.enabled
                  ? (btStatus === "connected" ? <BluetoothConnected className="h-4 w-4 text-blue-600" /> : <Bluetooth className="h-4 w-4 text-blue-600" />)
                  : <BluetoothOff className="h-4 w-4 text-muted-foreground" />}
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
                <span className="w-10 h-6 bg-gray-300 peer-checked:bg-blue-600 rounded-full relative transition-colors">
                  <span className="absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-md" />
                </span>
              </label>
            </div>
            {btCfg?.enabled && (
              <>
                <p className="text-[12px] text-muted-foreground mt-1.5">
                  {btStatus === "connected" ? "Paired — auto-print on every order." : "Pair once per kiosk session — receipts auto-print after."}
                </p>
                {btStatus !== "connected" && (
                  <Button onClick={onPairPrinter} disabled={btStatus === "connecting"}
                    className="mt-2 rounded-full h-9 text-xs bg-blue-600 hover:bg-blue-700 w-full text-white" data-testid="kiosk-bt-pair">
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
