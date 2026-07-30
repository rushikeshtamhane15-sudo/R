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
  isFullscreen = false,
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
        <div className={`inline-flex bg-white rounded-full p-1 gap-1 shadow-md ring-1 ring-primary/25 ${isFullscreen ? "" : ""}`} data-testid="kiosk-meal-toggle">
          <button
            type="button"
            onClick={() => canLunch && setMeal("lunch")}
            disabled={!canLunch}
            data-testid="kiosk-meal-lunch"
            className={`rounded-full font-extrabold inline-flex items-center transition-all ${isFullscreen ? "h-12 px-6 text-base gap-2" : "h-11 px-5 text-sm gap-1.5"} ${meal === "lunch" && canLunch
              ? "bg-white text-primary ring-2 ring-emerald-500 shadow"
              : canLunch
                ? "bg-white text-primary/80 hover:text-primary hover:ring-1 hover:ring-emerald-300"
                : "bg-white text-primary/40 opacity-70 cursor-not-allowed"}`}
          >
            <Sun className={isFullscreen ? "h-5 w-5" : "h-4 w-4"} /> Lunch
          </button>
          <button
            type="button"
            onClick={() => canDinner && setMeal("dinner")}
            disabled={!canDinner}
            data-testid="kiosk-meal-dinner"
            className={`rounded-full font-extrabold inline-flex items-center transition-all ${isFullscreen ? "h-12 px-6 text-base gap-2" : "h-11 px-5 text-sm gap-1.5"} ${meal === "dinner" && canDinner
              ? "bg-white text-primary ring-2 ring-emerald-500 shadow"
              : canDinner
                ? "bg-white text-primary/80 hover:text-primary hover:ring-1 hover:ring-emerald-300"
                : "bg-white text-primary/40 opacity-70 cursor-not-allowed"}`}
          >
            <Moon className={isFullscreen ? "h-5 w-5" : "h-4 w-4"} /> Dinner
          </button>
        </div>
      </div>

      <div className="flex-1 grid sm:grid-cols-[1.4fr_1fr] gap-4 p-5 min-h-0">
        <div className="rounded-2xl bg-white p-5 flex flex-col items-center justify-center h-full" data-testid="kiosk-counter-qr">
          {/* iter-131.32: efoodcare brand block above the QR — centered logo +
              white text + tagline. Admin can (in a later iter) upload a custom
              icon; we fall back to the built-in favicon path. */}
          <div className={`w-full rounded-2xl bg-primary flex flex-col items-center gap-1 shadow-md ${isFullscreen ? "max-w-[440px] py-4 mb-5" : "max-w-[360px] py-3 mb-4"}`} data-testid="kiosk-brand-block">
            <img
              src={kioskLogoUrl || "/favicon-96.png"}
              alt="efoodcare"
              onError={(e) => { e.currentTarget.src = "/favicon-96.png"; }}
              className={`object-contain rounded-md bg-white/10 ring-1 ring-white/20 ${isFullscreen ? "h-16 w-16" : "h-12 w-12"}`}
              data-testid="kiosk-brand-logo"
            />
            <p className={`font-display font-extrabold leading-none text-white tracking-tight ${isFullscreen ? "text-3xl" : "text-2xl"}`} data-testid="kiosk-brand-name">efoodcare</p>
            <p className={`tracking-[0.24em] uppercase font-bold text-white/85 ${isFullscreen ? "text-xs" : "text-[10px]"}`} data-testid="kiosk-brand-tagline">ghar se achha khana</p>
          </div>
          {counter ? (
            <>
              <QRCodeSVG value={counter.counter_code} size={isFullscreen ? 500 : 360} level="M" fgColor="hsl(142 45% 28%)" />
              <p className={`font-mono text-muted-foreground mt-3 break-all max-w-md text-center ${isFullscreen ? "text-xs" : "text-[10px]"}`}>{counter.counter_code}</p>
              <p className={`font-semibold text-foreground mt-1 ${isFullscreen ? "text-base" : "text-xs"}`}>{meal.toUpperCase()} · {LOCATION}</p>
            </>
          ) : (
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          )}
        </div>

        <div className="flex flex-col gap-3 h-full min-h-0">
          <div className={`rounded-2xl bg-white border border-black/8 shadow-sm flex-1 min-h-0 ${isFullscreen ? "p-6" : "p-5"}`} data-testid="kiosk-how-it-works">
            <p className={`tracking-[0.18em] uppercase font-bold text-primary ${isFullscreen ? "text-sm" : "text-[11px]"}`}>How it works</p>
            <ol className={`mt-2 space-y-2 text-foreground list-decimal list-inside font-medium ${isFullscreen ? "text-xl leading-relaxed" : "text-base"}`}>
              <li>Open your phone camera.</li>
              <li>Point it at the QR on the left.</li>
              <li>Tap the notification to check in for {meal}.</li>
              <li>Walk-in? Scan the QR on your printed receipt instead.</li>
            </ol>
          </div>

          <div className={`rounded-2xl bg-white border border-black/8 shadow-sm ${isFullscreen ? "p-5" : "p-4"}`} data-testid="kiosk-qr-provider-card">
            <p className={`tracking-[0.18em] uppercase font-bold text-primary mb-2 ${isFullscreen ? "text-sm" : "text-[11px]"}`}>Online payment QR</p>
            <div className={`inline-flex bg-[hsl(220,55%,55%)] rounded-full items-center w-full justify-center ${isFullscreen ? "h-12 px-5" : "h-9 px-4"}`} data-testid="kiosk-qr-provider-razorpay">
              <span className={`font-extrabold text-white ${isFullscreen ? "text-base" : "text-[12px]"}`}>Razorpay Dynamic UPI QR</span>
            </div>
            <p className={`text-muted-foreground mt-2 leading-relaxed ${isFullscreen ? "text-sm" : "text-[11px]"}`}>
              Razorpay Dynamic QR — auto-confirms payment in ~4s. Paytm has been retired.
            </p>
          </div>

          <div className={`rounded-2xl bg-white border border-black/8 shadow-sm ${isFullscreen ? "p-5" : "p-4"}`} data-testid="kiosk-bt-card">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-foreground">
                {btCfg?.enabled
                  ? (btStatus === "connected" ? <BluetoothConnected className={`${isFullscreen ? "h-5 w-5" : "h-4 w-4"} text-blue-600`} /> : <Bluetooth className={`${isFullscreen ? "h-5 w-5" : "h-4 w-4"} text-blue-600`} />)
                  : <BluetoothOff className={`${isFullscreen ? "h-5 w-5" : "h-4 w-4"} text-muted-foreground`} />}
                <p className={`font-extrabold ${isFullscreen ? "text-base" : "text-sm"}`}>Bluetooth printer</p>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!btCfg?.enabled}
                  onChange={(e) => onSetBtEnabled(e.target.checked)}
                  className="sr-only peer"
                  data-testid="kiosk-bt-toggle"
                />
                <span className={`bg-gray-300 peer-checked:bg-blue-600 rounded-full relative transition-colors ${isFullscreen ? "w-12 h-7" : "w-10 h-6"}`}>
                  <span className={`absolute top-0.5 left-0.5 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow-md ${isFullscreen ? "h-6 w-6" : "h-5 w-5"}`} />
                </span>
              </label>
            </div>
            {btCfg?.enabled && (
              <>
                <p className={`text-muted-foreground mt-1.5 ${isFullscreen ? "text-sm" : "text-[12px]"}`}>
                  {btStatus === "connected" ? "Paired — auto-print on every order." : "Pair once per kiosk session — receipts auto-print after."}
                </p>
                {btStatus !== "connected" && (
                  <Button onClick={onPairPrinter} disabled={btStatus === "connecting"}
                    className={`mt-2 rounded-full bg-blue-600 hover:bg-blue-700 w-full text-white ${isFullscreen ? "h-11 text-sm" : "h-9 text-xs"}`} data-testid="kiosk-bt-pair">
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
