// AdminKiosk — TOP panel: counter QR + meal toggle + QR provider + Bluetooth printer card.
import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "../ui/button";
import {
  Sun, Moon, ScanLine, Loader2, Clock, RefreshCw,
  Bluetooth, BluetoothConnected, BluetoothOff,
} from "lucide-react";

const LOCATION = "main";

export default function KioskCounterPanel({
  meal, setMeal, counter, activeSlot, kioskLogoUrl,
  qrProvider, onSetQrProvider,
  btCfg, btStatus, onSetBtEnabled, onPairPrinter,
  isFullscreen = false,
  slotCountdownLabel = "", slotCountdownEndsAt = "",
  qrRotateSeconds = 0,
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
      // OFF: red border to catch attention
      return { label: "Printer off", tone: "bg-white text-blue-700 ring-red-500", Icon: BluetoothOff };
    }
    if (btStatus === "connected") {
      // PAIRED: green border
      return { label: "Printer paired", tone: "bg-white text-blue-700 ring-emerald-500", Icon: BluetoothConnected };
    }
    if (btStatus === "connecting") {
      // Pairing in flight: keep red until success
      return { label: "Pairing…", tone: "bg-white text-blue-700 ring-red-500", Icon: Loader2 };
    }
    // UNPAIRED but enabled: red border
    return { label: "Printer waiting", tone: "bg-white text-blue-700 ring-red-500", Icon: Bluetooth };
  })();
  return (
    <section className="rounded-3xl border border-white/25 bg-black/45 backdrop-blur-sm overflow-hidden flex flex-col" data-testid="kiosk-counter-panel">
      {/* Header — logo LEFT, brand ABSOLUTELY-centered, toggle RIGHT, so the
          brand block sits at the exact optical centre regardless of the
          left/right widths (iter-134.e). */}
      <div className="relative border-b border-white/12 px-5 py-4">
        {/* Brand centered over the whole header */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center leading-tight" data-testid="kiosk-header-brand">
          <p className={`font-display font-extrabold text-white tracking-tight ${isFullscreen ? "text-5xl" : "text-2xl"}`} data-testid="kiosk-header-brand-name">efoodcare</p>
          <p className={`uppercase font-bold text-white/85 tracking-[0.32em] ${isFullscreen ? "text-base mt-1.5" : "text-[10px]"}`} data-testid="kiosk-header-brand-tagline">ghar se accha khana</p>
        </div>

        {/* Foreground row: logo + toggle sit above the absolutely-centered brand */}
        <div className="relative flex items-center justify-between gap-4">
          {/* LEFT — brand logo icon corner */}
          <div className="flex items-center" data-testid="kiosk-header-brand-logo">
            <img
              src={kioskLogoUrl || "/favicon-96.png"}
              alt="efoodcare"
              onError={(e) => { e.currentTarget.src = "/favicon-96.png"; }}
              className={`object-contain rounded-2xl bg-white/15 ring-1 ring-white/20 ${isFullscreen ? "h-24 w-24 p-1.5" : "h-10 w-10 p-0.5"}`}
            />
          </div>

          {/* RIGHT — Lunch / Dinner toggle + slot-close countdown pill */}
          <div className="flex items-center gap-2">
            {slotCountdownLabel && (
              <span
                className={`inline-flex items-center gap-1 rounded-full bg-white/90 text-primary font-extrabold shadow-sm ring-2 ring-emerald-500 ${isFullscreen ? "h-10 px-3 text-sm" : "h-8 px-2.5 text-[11px]"}`}
                data-testid="kiosk-slot-countdown"
                title={`${activeSlot === "lunch" ? "Lunch" : "Dinner"} window closes at ${slotCountdownEndsAt}`}
              >
                <Clock className={isFullscreen ? "h-4 w-4" : "h-3.5 w-3.5"} />
                {slotCountdownLabel}
              </span>
            )}
            <div className="inline-flex bg-white rounded-full p-1 gap-1 shadow-md ring-1 ring-primary/25" data-testid="kiosk-meal-toggle">
          <button
            type="button"
            onClick={() => canLunch && setMeal("lunch")}
            disabled={!canLunch}
            data-testid="kiosk-meal-lunch"
            className={`rounded-full font-extrabold inline-flex items-center transition-all ${isFullscreen ? "h-10 px-4 text-sm gap-1.5" : "h-11 px-5 text-sm gap-1.5"} ${meal === "lunch" && canLunch
              ? "bg-white text-primary ring-[3px] ring-emerald-500 shadow"
              : canLunch
                ? "bg-white text-primary/80 hover:text-primary hover:ring-1 hover:ring-emerald-300"
                : "bg-white text-primary/40 opacity-70 cursor-not-allowed"}`}
          >
            <Sun className={isFullscreen ? "h-4 w-4" : "h-4 w-4"} /> Lunch
          </button>
          <button
            type="button"
            onClick={() => canDinner && setMeal("dinner")}
            disabled={!canDinner}
            data-testid="kiosk-meal-dinner"
            className={`rounded-full font-extrabold inline-flex items-center transition-all ${isFullscreen ? "h-10 px-4 text-sm gap-1.5" : "h-11 px-5 text-sm gap-1.5"} ${meal === "dinner" && canDinner
              ? "bg-white text-primary ring-[3px] ring-emerald-500 shadow"
              : canDinner
                ? "bg-white text-primary/80 hover:text-primary hover:ring-1 hover:ring-emerald-300"
                : "bg-white text-primary/40 opacity-70 cursor-not-allowed"}`}
          >
            <Moon className={isFullscreen ? "h-4 w-4" : "h-4 w-4"} /> Dinner
          </button>
        </div>
          </div>
        </div>
      </div>

      <div className="flex-1 grid sm:grid-cols-[1.4fr_1fr] gap-4 p-5 min-h-0">
        <div className="rounded-2xl bg-white p-5 flex flex-col items-center justify-center h-full" data-testid="kiosk-counter-qr">
          {counter ? (
            <>
              <QRCodeSVG value={counter.counter_code} size={isFullscreen ? 500 : 360} level="M" fgColor="hsl(142 45% 28%)" />
              {/* iter-134.c: compact "scan me" info tag replaces the earlier
                  brand/tagline block — cleaner + on-brand for the QR square. */}
              <div
                className={`inline-flex items-center gap-2 rounded-full bg-primary text-white shadow ring-1 ring-primary/20 ${isFullscreen ? "mt-4 px-5 h-11 text-base" : "mt-3 px-4 h-9 text-xs"} font-extrabold tracking-tight`}
                data-testid="kiosk-scan-info-tag"
              >
                <ScanLine className={isFullscreen ? "h-5 w-5" : "h-3.5 w-3.5"} />
                Scan Me And Get Ghar Se Accha Khana
              </div>
              {/* iter-134.e: live QR-rotation countdown so staff/customers know
                  the QR auto-refreshes and roughly when. */}
              {qrRotateSeconds > 0 && (
                <div
                  className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300 ${isFullscreen ? "mt-2 px-3 h-8 text-xs" : "mt-2 px-2.5 h-7 text-[10px]"} font-extrabold uppercase tracking-[0.16em]`}
                  data-testid="kiosk-qr-rotate-countdown"
                  title="This QR rotates every 5 minutes for security"
                >
                  <RefreshCw className={`${isFullscreen ? "h-3.5 w-3.5" : "h-3 w-3"} ${qrRotateSeconds <= 10 ? "animate-spin" : ""}`} />
                  Refreshes in {qrRotateSeconds >= 60 ? `${Math.floor(qrRotateSeconds / 60)}m ${String(qrRotateSeconds % 60).padStart(2, "0")}s` : `${qrRotateSeconds}s`}
                </div>
              )}
              <p className={`font-mono text-muted-foreground mt-2 break-all max-w-md text-center ${isFullscreen ? "text-xs" : "text-[10px]"}`}>{counter.counter_code}</p>
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
            {/* iter-134.c: printer status pill relocated below the how-it-works
                copy so staff/customers see the health line without cluttering
                the top header (which now only carries the brand + meal toggle). */}
            <div className="mt-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full uppercase font-extrabold ring-2 ${isFullscreen ? "text-xs px-3 h-9 tracking-[0.16em]" : "text-[10px] px-2.5 h-7 tracking-[0.16em]"} ${btPill.tone} shadow-sm`}
                data-testid="kiosk-printer-status-pill"
                title={btPill.label}
              >
                <btPill.Icon className={`${isFullscreen ? "h-3.5 w-3.5" : "h-3 w-3"} ${btStatus === "connecting" ? "animate-spin" : ""}`} />
                <span>{btPill.label}</span>
              </span>
            </div>
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
