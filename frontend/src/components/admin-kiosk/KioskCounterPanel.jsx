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
  faceScanNode = null,
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
      {/* Header — vertically compact (iter-134.k). Brand block absolutely
          centered; logo LEFT, pure-veg mark RIGHT — both symmetrically sized. */}
      <div className={`relative border-b border-white/12 ${isFullscreen ? "px-6 py-3" : "px-5 py-3"}`}>
        {/* Brand centered over the whole header */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center leading-tight" data-testid="kiosk-header-brand">
          <p className={`font-display font-extrabold text-white tracking-tight ${isFullscreen ? "text-5xl" : "text-2xl"}`} data-testid="kiosk-header-brand-name">efoodcare</p>
          <p className={`uppercase font-bold text-white/85 tracking-[0.32em] ${isFullscreen ? "text-sm mt-1" : "text-[10px]"}`} data-testid="kiosk-header-brand-tagline">ghar se accha khana</p>
        </div>

        {/* Foreground row: logo LEFT, pure-veg mark RIGHT */}
        <div className="relative flex items-center justify-between gap-4">
          {/* LEFT — brand logo icon corner */}
          <div className="flex items-center" data-testid="kiosk-header-brand-logo">
            <img
              src={kioskLogoUrl || "/favicon-96.png"}
              alt="efoodcare"
              onError={(e) => { e.currentTarget.src = "/favicon-96.png"; }}
              className={`object-contain rounded-2xl bg-white/15 ring-1 ring-white/20 ${isFullscreen ? "h-20 w-20 p-1.5" : "h-10 w-10 p-0.5"}`}
            />
          </div>

          {/* RIGHT — pure-veg certification mark. Same footprint as logo. */}
          <div className="flex items-center" data-testid="kiosk-header-pureveg" title="100% Pure Veg · FSSAI">
            <div className={`bg-white rounded-lg flex items-center justify-center shadow ring-1 ring-white/20 ${isFullscreen ? "h-20 w-20 p-2" : "h-10 w-10 p-1"}`}>
              <div className={`border-emerald-600 rounded-md flex items-center justify-center ${isFullscreen ? "border-[3px] h-full w-full" : "border-2 h-full w-full"}`}>
                <div className={`bg-emerald-600 rounded-full ${isFullscreen ? "h-6 w-6" : "h-3 w-3"}`} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`flex-1 grid sm:grid-cols-[1.4fr_1fr] gap-4 min-h-0 ${isFullscreen ? "p-6" : "p-5"}`}>
        <div className={`rounded-2xl bg-white flex flex-col items-center h-full ${isFullscreen ? "px-6 py-6 gap-3 justify-center" : "p-5 gap-2 justify-center"}`} data-testid="kiosk-counter-qr">
          {/* iter-138.p — user asked for MORE breathing space between the
              toggle → QR → info pills (previous `gap-1` was still too tight).
              Bumped fullscreen gap to `gap-3` (12px ≈ 9pt) — a comfortable
              breathing room between each item. Also shrank the Lunch/Dinner
              toggle from h-14 text-xl → h-12 text-lg per user request. */}
          <div className={`inline-flex bg-primary/5 rounded-full p-1.5 gap-1 shadow-sm ring-2 ring-primary/20`} data-testid="kiosk-meal-toggle">
            <button
              type="button"
              onClick={() => canLunch && setMeal("lunch")}
              disabled={!canLunch}
              data-testid="kiosk-meal-lunch"
              className={`rounded-full font-extrabold inline-flex items-center transition-all ${isFullscreen ? "h-12 px-6 text-lg gap-2" : "h-11 px-5 text-sm gap-1.5"} ${meal === "lunch" && canLunch
                ? "bg-white text-primary ring-[3px] ring-emerald-500 shadow"
                : meal === "lunch"
                  ? "bg-white text-primary ring-2 ring-emerald-300 shadow-sm"
                  : canLunch
                    ? "bg-transparent text-primary/70 hover:text-primary"
                    : "bg-transparent text-primary/40 opacity-70 cursor-not-allowed"}`}
            >
              <Sun className={isFullscreen ? "h-5 w-5" : "h-4 w-4"} /> Lunch
            </button>
            <button
              type="button"
              onClick={() => canDinner && setMeal("dinner")}
              disabled={!canDinner}
              data-testid="kiosk-meal-dinner"
              className={`rounded-full font-extrabold inline-flex items-center transition-all ${isFullscreen ? "h-12 px-6 text-lg gap-2" : "h-11 px-5 text-sm gap-1.5"} ${meal === "dinner" && canDinner
                ? "bg-white text-primary ring-[3px] ring-emerald-500 shadow"
                : meal === "dinner"
                  ? "bg-white text-primary ring-2 ring-emerald-300 shadow-sm"
                  : canDinner
                    ? "bg-transparent text-primary/70 hover:text-primary"
                    : "bg-transparent text-primary/40 opacity-70 cursor-not-allowed"}`}
            >
              <Moon className={isFullscreen ? "h-5 w-5" : "h-4 w-4"} /> Dinner
            </button>
          </div>

          {counter ? (
            <>
              <QRCodeSVG
                value={counter.counter_code}
                size={720}
                level="M"
                fgColor="hsl(142 45% 28%)"
                style={{ width: "100%", height: "auto", maxWidth: isFullscreen ? "480px" : "360px" }}
              />
              <div className={`flex flex-col items-center w-full ${isFullscreen ? "gap-3" : "gap-2"}`}>
                <div
                  className={`inline-flex items-center gap-2 rounded-full bg-primary text-white shadow ring-1 ring-primary/20 ${isFullscreen ? "px-7 h-14 text-xl" : "px-4 h-9 text-xs"} font-extrabold tracking-tight`}
                  data-testid="kiosk-scan-info-tag"
                >
                  <ScanLine className={isFullscreen ? "h-6 w-6" : "h-3.5 w-3.5"} />
                  Scan Me And Get Ghar Se Accha Khana
                </div>
                {slotCountdownLabel && (
                  <div
                    className={`inline-flex items-center gap-2 rounded-full bg-white text-primary shadow-sm ring-2 ring-emerald-500 ${isFullscreen ? "px-5 h-12 text-base" : "px-3 h-8 text-xs"} font-extrabold uppercase tracking-[0.14em]`}
                    data-testid="kiosk-slot-countdown"
                    title={`${activeSlot === "lunch" ? "Lunch" : activeSlot === "dinner" ? "Dinner" : "Next meal"} timing (IST)`}
                  >
                    <Clock className={isFullscreen ? "h-5 w-5" : "h-3.5 w-3.5"} />
                    {slotCountdownLabel}
                  </div>
                )}
                {qrRotateSeconds > 0 && (
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300 ${isFullscreen ? "px-4 h-10 text-sm" : "px-2.5 h-7 text-[10px]"} font-extrabold uppercase tracking-[0.16em]`}
                    data-testid="kiosk-qr-rotate-countdown"
                    title="This QR rotates every 5 minutes for security"
                  >
                    <RefreshCw className={`${isFullscreen ? "h-4 w-4" : "h-3 w-3"} ${qrRotateSeconds <= 10 ? "animate-spin" : ""}`} />
                    Refreshes in {qrRotateSeconds >= 60 ? `${Math.floor(qrRotateSeconds / 60)}m ${String(qrRotateSeconds % 60).padStart(2, "0")}s` : `${qrRotateSeconds}s`}
                  </div>
                )}
              </div>
            </>
          ) : (
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          )}
        </div>

        <div className="flex flex-col gap-3 h-full min-h-0">
          {/* iter-138.o — face-check-in tile now fills the full column
              height (flex-1) so it aligns visually with the QR container
              on the left instead of sitting as a small aspect-fixed box
              with whitespace above/below. Bluetooth-printer card sits
              at natural height beneath it. */}
          <div className={`rounded-2xl bg-white border border-black/8 shadow-sm overflow-hidden flex-1 min-h-0 ${isFullscreen ? "p-3" : "p-2.5"}`} data-testid="kiosk-face-scan-tile">
            <p className={`tracking-[0.18em] uppercase font-bold text-primary mb-2 ${isFullscreen ? "text-sm" : "text-[11px]"}`}>Face check-in</p>
            {faceScanNode ? (
              faceScanNode
            ) : (
              <div className="h-[calc(100%-1.5rem)] rounded-xl bg-slate-50 border border-dashed border-slate-300 flex items-center justify-center text-center px-3">
                <p className={`text-muted-foreground font-bold ${isFullscreen ? "text-sm" : "text-xs"}`}>
                  Enable the <b>Voice</b> button in the header to activate the wall camera and auto-check-in subscribers.
                </p>
              </div>
            )}
          </div>

          {/* iter-138.f — Online payment QR card hidden per user request; the
              scannable QR still lives inside the payment modal that opens on
              order. Face check-in tile now stretches to take the reclaimed
              vertical space (flex-1 above). */}

          <div className={`rounded-2xl bg-white border border-black/8 shadow-sm ${isFullscreen ? "p-5" : "p-4"}`} data-testid="kiosk-bt-card">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-foreground">
                {btCfg?.enabled
                  ? (btStatus === "connected" ? <BluetoothConnected className={`${isFullscreen ? "h-5 w-5" : "h-4 w-4"} text-blue-600`} /> : <Bluetooth className={`${isFullscreen ? "h-5 w-5" : "h-4 w-4"} text-blue-600`} />)
                  : <BluetoothOff className={`${isFullscreen ? "h-5 w-5" : "h-4 w-4"} text-muted-foreground`} />}
                <p className={`font-extrabold ${isFullscreen ? "text-base" : "text-sm"}`}>Bluetooth printer</p>
                <span
                  className={`inline-flex items-center gap-1 rounded-full uppercase font-extrabold ring-1 ${isFullscreen ? "text-[10px] px-2 h-6 tracking-[0.14em]" : "text-[9px] px-1.5 h-5 tracking-[0.14em]"} ${btPill.tone}`}
                  data-testid="kiosk-printer-status-pill"
                  title={btPill.label}
                >
                  {btPill.label}
                </span>
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
