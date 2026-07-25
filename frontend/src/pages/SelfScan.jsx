/* SelfScan — Scan & eat landing (iter-131.25 redesign).
 * Matches the user-provided screenshot: trust-badge card, big scan card
 * ("Ready to dine?" + Open scanner + View my e-meal pass QR link), and a
 * green Hindi tagline banner. The actual html5-qrcode scanner remains
 * unchanged and only shows once the user taps Open scanner.
 */
import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useNavigate } from "react-router-dom";
import confetti from "canvas-confetti";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { ScanLine, X, CheckCircle2, Sun, Moon, ShieldCheck, QrCode, CreditCard, Heart } from "lucide-react";
import { playCheckinSuccess, unlockAudio } from "../lib/notify";

export default function SelfScan() {
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [success, setSuccess] = useState(null);
  const instanceRef = useRef(null);

  const stopScanner = async () => {
    if (instanceRef.current) {
      try { await instanceRef.current.stop(); await instanceRef.current.clear(); } catch { /* non-critical */ }
      instanceRef.current = null;
    }
    setScanning(false);
  };

  const fireConfetti = () => {
    const end = Date.now() + 1500;
    const colors = ["#dc2626", "#f97316", "#e9d8a6"];
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  };

  const handleDecoded = async (text) => {
    await stopScanner();
    let code = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.code) code = parsed.code;
    } catch { /* non-critical */ }
    try {
      const res = await api.post("/attendance/self-scan", { counter_code: code, meal_type: "lunch" });
      playCheckinSuccess();
      toast.success(`Checked in for ${res.data.meal_type} ✓`);
      setSuccess(res.data);
      fireConfetti();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to check in");
    }
  };

  const startScanner = async () => {
    unlockAudio();
    setScanning(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      const html5 = new Html5Qrcode("self-qr-region");
      instanceRef.current = html5;
      await html5.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => handleDecoded(decoded),
        () => {}
      );
    } catch {
      toast.error("Could not start camera.");
      setScanning(false);
    }
  };

  useEffect(() => () => { stopScanner(); }, []);

  if (success) {
    const isLunch = success.meal_type === "lunch";
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center" data-testid="self-scan-success">
        <div className="bg-card rounded-3xl border border-black/5 shadow-xl p-10">
          <div className="h-20 w-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="h-12 w-12 text-primary" strokeWidth={1.5} />
          </div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary mt-6">Checked in</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl mt-3 leading-tight flex items-center justify-center gap-2">
            {isLunch ? <Sun className="h-7 w-7 text-secondary" /> : <Moon className="h-7 w-7 text-primary" />}
            <span className="capitalize">{success.meal_type}</span> · Enjoy!
          </h1>
          <div className="mt-8 grid grid-cols-2 divide-x divide-black/5 border border-black/5 rounded-2xl overflow-hidden">
            <div className="p-5">
              <p className="font-display font-extrabold text-3xl text-primary leading-none">{success.meals_left}</p>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground mt-1.5">Meals left</p>
            </div>
            <div className="p-5">
              <p className="font-display font-extrabold text-3xl text-foreground leading-none">{success.meals_total}</p>
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground mt-1.5">Total</p>
            </div>
          </div>
          <div className="mt-8 flex gap-2">
            <Button onClick={() => setSuccess(null)} variant="outline" className="rounded-full flex-1" data-testid="scan-again-button">
              Scan again
            </Button>
            <Button onClick={() => navigate("/dashboard")} className="rounded-full flex-1 bg-primary hover:bg-primary/90" data-testid="success-go-dashboard">
              Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Live scanner view (fullscreen-ish) — replaces the landing until user stops.
  if (scanning) {
    return (
      <div className="max-w-md mx-auto px-4 py-6" data-testid="self-scan-live">
        <p className="text-xs tracking-widest uppercase font-bold text-primary text-center">Point at the counter QR</p>
        <h2 className="font-display font-extrabold text-2xl text-center mt-1">Scanning…</h2>
        <div className="mt-4 rounded-3xl overflow-hidden border border-black/5 bg-card shadow-lg">
          <div id="self-qr-region" className="aspect-square" />
        </div>
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={stopScanner} className="rounded-full" data-testid="self-stop-scanner">
            <X className="h-4 w-4 mr-2" /> Stop
          </Button>
        </div>
      </div>
    );
  }

  // Landing view — matches the user-provided screenshot exactly.
  return (
    <div className="max-w-md mx-auto px-4 pt-4 pb-32" data-testid="self-scan-page">
      {/* Trust badge card */}
      <div
        className="rounded-2xl bg-primary/6 border border-primary/15 px-4 py-3 flex items-center gap-3"
        data-testid="scan-trust-badge"
      >
        <span className="inline-flex h-10 w-10 rounded-xl bg-primary/12 text-primary items-center justify-center shrink-0">
          <ShieldCheck className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <p className="font-display font-extrabold text-sm text-foreground">
            efoodcare · <span className="text-primary">ghar se achha khana</span>
          </p>
          <p className="text-[10.5px] tracking-[0.08em] uppercase font-extrabold text-emerald-700 leading-snug mt-0.5">
            101% pure veg · zero adulteration · fssai certified
          </p>
        </div>
      </div>

      {/* Heading */}
      <h1 className="font-display font-extrabold text-4xl text-center mt-8" data-testid="scan-heading">Scan &amp; eat</h1>
      <p className="text-muted-foreground text-center text-sm mt-2">
        Scan the counter QR to redeem your meal
      </p>

      {/* Big scan card */}
      <div
        className="mt-6 rounded-3xl bg-white ring-1 ring-black/5 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.15)] p-6"
        data-testid="scan-cta-card"
      >
        {/* Big QR illustration — matches the flat red QR in the screenshot */}
        <div className="mx-auto h-32 w-32 rounded-3xl bg-primary/6 flex items-center justify-center" aria-hidden>
          <QrCode className="h-24 w-24 text-primary" strokeWidth={2.5} />
        </div>

        <h2 className="font-display font-extrabold text-2xl text-center mt-5">Ready to dine?</h2>
        <p className="text-muted-foreground text-center text-sm mt-2 leading-relaxed">
          Show the kitchen counter the camera so it can read the QR sticker.
        </p>

        <Button
          onClick={startScanner}
          className="mt-5 w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-display font-extrabold text-base shadow-[0_6px_16px_-6px_rgba(220,38,38,0.5)]"
          data-testid="self-start-scanner"
        >
          <ScanLine className="h-5 w-5 mr-2" strokeWidth={2.25} /> Open scanner
        </Button>

        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="mt-3 w-full h-11 rounded-2xl text-primary hover:bg-primary/5 font-display font-extrabold text-sm inline-flex items-center justify-center gap-2 transition-colors"
          data-testid="view-emeal-pass-link"
        >
          <CreditCard className="h-4 w-4" strokeWidth={2.25} /> View my e-meal pass QR
        </button>
      </div>

      {/* Hindi tagline banner */}
      <div
        className="mt-4 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start gap-2"
        data-testid="scan-hindi-tagline"
      >
        <Heart className="h-4 w-4 text-primary fill-current shrink-0 mt-0.5" />
        <p className="text-[13px] leading-snug text-emerald-900 italic">
          हमारा खाना आपको पसंद आये ना आये आपके स्वास्थ्य (Health) को जरूर पसंद आयेगा
        </p>
      </div>
    </div>
  );
}
