import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useNavigate } from "react-router-dom";
import confetti from "canvas-confetti";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { ScanLine, X, CheckCircle2, Sun, Moon } from "lucide-react";

export default function SelfScan() {
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [success, setSuccess] = useState(null);
  const instanceRef = useRef(null);

  const stopScanner = async () => {
    if (instanceRef.current) {
      try { await instanceRef.current.stop(); await instanceRef.current.clear(); } catch {}
      instanceRef.current = null;
    }
    setScanning(false);
  };

  const fireConfetti = () => {
    const end = Date.now() + 1500;
    const colors = ["#4b5c4a", "#c08a5b", "#e9d8a6"];
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
    } catch {}
    try {
      const res = await api.post("/attendance/self-scan", { counter_code: code, meal_type: "lunch" });
      toast.success(`Checked in for ${res.data.meal_type} ✓`);
      setSuccess(res.data);
      fireConfetti();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to check in");
    }
  };

  const startScanner = async () => {
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

  return (
    <div className="max-w-2xl mx-auto px-6 py-10" data-testid="self-scan-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Self check-in</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl mt-2">Scan the counter QR</h1>
      <p className="text-muted-foreground mt-2 text-sm">The slot (lunch/dinner) is detected automatically from the counter code.</p>

      <div className="mt-6 rounded-3xl overflow-hidden border border-black/5 bg-card">
        {!scanning && (
          <div className="aspect-video flex flex-col items-center justify-center gap-4 p-8">
            <ScanLine className="h-12 w-12 text-primary" strokeWidth={1.5}/>
            <p className="text-muted-foreground">Point your camera at the counter QR</p>
            <Button onClick={startScanner} className="rounded-full bg-primary hover:bg-primary/90" data-testid="self-start-scanner">
              Start camera
            </Button>
          </div>
        )}
        <div id="self-qr-region" className={scanning ? "aspect-video" : "hidden"}></div>
        {scanning && (
          <div className="p-4 flex justify-center">
            <Button variant="outline" onClick={stopScanner} className="rounded-full" data-testid="self-stop-scanner">
              <X className="h-4 w-4 mr-2"/> Stop
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
