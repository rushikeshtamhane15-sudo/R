import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { ScanLine, UserCheck, Sun, Moon, X } from "lucide-react";

export default function StaffScanner() {
  const [meal, setMeal] = useState("lunch");
  const [scanning, setScanning] = useState(false);
  const [lastScans, setLastScans] = useState([]);
  const [manualToken, setManualToken] = useState("");
  const scannerRef = useRef(null);
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
      const html5 = new Html5Qrcode("qr-scanner-region");
      instanceRef.current = html5;
      await html5.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => handleToken(decoded),
        () => {}
      );
    } catch (e) {
      toast.error("Could not start camera. Use manual entry.");
      setScanning(false);
    }
  };

  useEffect(() => () => { stopScanner(); }, []);

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[hsl(140,8%,10%)] text-[hsl(40,25%,92%)]" data-testid="staff-scanner">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <p className="text-xs tracking-overline uppercase font-bold text-[hsl(135,25%,65%)]">Counter · Staff</p>
        <h1 className="font-display font-extrabold text-3xl md:text-4xl mt-2">Scan subscriber QR</h1>

        <div className="mt-8 flex gap-2" data-testid="meal-toggle">
          <Button
            onClick={() => setMeal("lunch")}
            data-testid="meal-lunch"
            className={`rounded-full ${meal === "lunch" ? "bg-[hsl(26,43%,57%)] text-white" : "bg-[hsl(140,8%,18%)] text-[hsl(40,25%,92%)] hover:bg-[hsl(140,8%,22%)]"}`}
          >
            <Sun className="h-4 w-4 mr-2" strokeWidth={1.75}/> Lunch
          </Button>
          <Button
            onClick={() => setMeal("dinner")}
            data-testid="meal-dinner"
            className={`rounded-full ${meal === "dinner" ? "bg-[hsl(135,25%,55%)] text-[hsl(140,8%,10%)]" : "bg-[hsl(140,8%,18%)] text-[hsl(40,25%,92%)] hover:bg-[hsl(140,8%,22%)]"}`}
          >
            <Moon className="h-4 w-4 mr-2" strokeWidth={1.75}/> Dinner
          </Button>
        </div>

        <div className="mt-8 rounded-3xl overflow-hidden border border-[hsl(140,8%,22%)] bg-[hsl(140,8%,13%)]">
          {!scanning && (
            <div className="aspect-video flex flex-col items-center justify-center gap-4 p-10">
              <ScanLine className="h-12 w-12 text-[hsl(135,25%,55%)]" strokeWidth={1.5}/>
              <p className="text-[hsl(40,15%,70%)]">Tap to open the camera and scan a subscriber QR</p>
              <Button onClick={startScanner} className="rounded-full bg-[hsl(135,25%,55%)] text-[hsl(140,8%,10%)] hover:bg-[hsl(135,25%,65%)]" data-testid="start-scanner-button">
                Start scanner
              </Button>
            </div>
          )}
          <div id="qr-scanner-region" ref={scannerRef} className={scanning ? "aspect-video" : "hidden"}></div>
          {scanning && (
            <div className="p-4 flex justify-center">
              <Button variant="outline" onClick={stopScanner} className="rounded-full border-[hsl(140,8%,22%)] bg-transparent text-[hsl(40,25%,92%)]" data-testid="stop-scanner-button">
                <X className="h-4 w-4 mr-2"/> Stop
              </Button>
            </div>
          )}
        </div>

        <div className="mt-8 bg-[hsl(140,8%,13%)] border border-[hsl(140,8%,22%)] rounded-2xl p-6">
          <p className="text-xs tracking-overline uppercase font-bold text-[hsl(40,15%,70%)]">Manual entry</p>
          <div className="mt-3 flex gap-2">
            <input
              data-testid="manual-token-input"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Paste subscriber QR token"
              className="flex-1 bg-[hsl(140,8%,18%)] border border-[hsl(140,8%,22%)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[hsl(135,25%,55%)]"
            />
            <Button
              onClick={() => { if (manualToken) { handleToken(manualToken); setManualToken(""); } }}
              data-testid="manual-submit-button"
              className="rounded-xl bg-[hsl(135,25%,55%)] text-[hsl(140,8%,10%)] hover:bg-[hsl(135,25%,65%)]"
            >
              Check in
            </Button>
          </div>
        </div>

        <div className="mt-8" data-testid="recent-scans">
          <p className="text-xs tracking-overline uppercase font-bold text-[hsl(40,15%,70%)] mb-3">Recent scans</p>
          {lastScans.length === 0 && <p className="text-sm text-[hsl(40,15%,70%)]">None yet.</p>}
          {lastScans.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-3 border-b border-[hsl(140,8%,22%)]">
              <div className="flex items-center gap-3"><UserCheck className="h-4 w-4 text-[hsl(135,25%,55%)]"/><span className="font-semibold">{s.name}</span><span className="text-xs text-[hsl(40,15%,70%)] capitalize">· {s.meal}</span></div>
              <span className="text-xs text-[hsl(40,15%,70%)]">{s.at}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
