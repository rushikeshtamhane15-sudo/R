import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { ScanLine, UserCheck, Sun, Moon, X } from "lucide-react";

export default function AdminScanner() {
  const [meal, setMeal] = useState(new Date().getHours() < 16 ? "lunch" : "dinner");
  const [scanning, setScanning] = useState(false);
  const [lastScans, setLastScans] = useState([]);
  const [manualToken, setManualToken] = useState("");
  const instanceRef = useRef(null);

  const stopScanner = async () => {
    if (instanceRef.current) {
      try { await instanceRef.current.stop(); await instanceRef.current.clear(); } catch {}
      instanceRef.current = null;
    }
    setScanning(false);
  };

  const handleToken = async (qrToken) => {
    await stopScanner();
    try {
      const res = await api.post("/attendance/scan", { qr_token: qrToken, meal_type: meal });
      toast.success(`${res.data.subscriber_name} checked in for ${meal}`);
      setLastScans((p) => [{ id: res.data.record.att_id, name: res.data.subscriber_name, meal, at: new Date().toLocaleTimeString() }, ...p].slice(0, 10));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Scan failed");
    }
  };

  const startScanner = async () => {
    setScanning(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      const html5 = new Html5Qrcode("admin-qr-region");
      instanceRef.current = html5;
      await html5.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => handleToken(decoded),
        () => {}
      );
    } catch {
      toast.error("Could not start camera. Use manual entry.");
      setScanning(false);
    }
  };

  useEffect(() => () => { stopScanner(); }, []);

  return (
    <div data-testid="admin-scanner-page">
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Admin · QR Scanner</p>
      <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Scan subscriber QR</h1>
      <p className="text-muted-foreground mt-2 text-sm">Use the camera to mark attendance, or paste a QR token manually.</p>

      <div className="mt-6 flex gap-2" data-testid="meal-toggle">
        <Button onClick={() => setMeal("lunch")} data-testid="meal-lunch"
          className={`rounded-full ${meal === "lunch" ? "bg-secondary hover:bg-secondary/90" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
          <Sun className="h-4 w-4 mr-2" /> Lunch
        </Button>
        <Button onClick={() => setMeal("dinner")} data-testid="meal-dinner"
          className={`rounded-full ${meal === "dinner" ? "bg-primary hover:bg-primary/90" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
          <Moon className="h-4 w-4 mr-2" /> Dinner
        </Button>
      </div>

      <div className="mt-6 rounded-3xl overflow-hidden border border-border bg-card">
        {!scanning && (
          <div className="aspect-video flex flex-col items-center justify-center gap-4 p-10">
            <ScanLine className="h-12 w-12 text-primary" strokeWidth={1.5} />
            <p className="text-muted-foreground">Tap to open the camera and scan a subscriber QR</p>
            <Button onClick={startScanner} className="rounded-full bg-primary hover:bg-primary/90" data-testid="start-scanner-button">
              Start scanner
            </Button>
          </div>
        )}
        <div id="admin-qr-region" className={scanning ? "aspect-video" : "hidden"}></div>
        {scanning && (
          <div className="p-4 flex justify-center">
            <Button variant="outline" onClick={stopScanner} className="rounded-full" data-testid="stop-scanner-button">
              <X className="h-4 w-4 mr-2" /> Stop
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6 bg-card border border-border rounded-2xl p-6">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Manual entry</p>
        <div className="mt-3 flex gap-2">
          <input data-testid="manual-token-input" value={manualToken} onChange={(e) => setManualToken(e.target.value)}
            placeholder="Paste subscriber QR token"
            className="flex-1 bg-background border border-input rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary" />
          <Button onClick={() => { if (manualToken) { handleToken(manualToken); setManualToken(""); } }}
            data-testid="manual-submit-button" className="rounded-xl bg-primary hover:bg-primary/90">
            Check in
          </Button>
        </div>
      </div>

      <div className="mt-6" data-testid="recent-scans">
        <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground mb-3">Recent scans</p>
        {lastScans.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        {lastScans.map((s) => (
          <div key={s.id} className="flex items-center justify-between py-3 border-b border-border">
            <div className="flex items-center gap-3"><UserCheck className="h-4 w-4 text-primary" /><span className="font-semibold">{s.name}</span><span className="text-xs text-muted-foreground capitalize">· {s.meal}</span></div>
            <span className="text-xs text-muted-foreground">{s.at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
