import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

// User-provided composite image — green Pure Veg square + fssai logo + "Approved"
const FSSAI_IMG = "https://customer-assets.emergentagent.com/job_dining-pass-scan/artifacts/li3dreby_images.jpeg";

export default function Footer() {
  const [data, setData] = useState(null);
  useEffect(() => { (async () => { try { const r = await api.get("/content/footer"); setData(r.data); } catch {} })(); }, []);

  const copyright = data?.copyright || "copyright © efoodcare.in all rights reserved";
  const tagline = data?.tagline || "ghar se achha khana";

  return (
    <footer className="border-t border-border bg-muted/40 pb-16 md:pb-0" data-testid="app-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-6 flex flex-col items-center gap-3 text-sm">
        {/* FSSAI compliance — required mark for restaurant brands in India */}
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-card shadow-sm" data-testid="fssai-mark">
          <img
            src={FSSAI_IMG}
            alt="Pure Veg · FSSAI Approved"
            className="h-14 w-12 object-contain"
            data-testid="fssai-logo-image"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] tracking-overline uppercase font-bold text-emerald-800 dark:text-emerald-300">FSSAI Licensed · Govt of India</span>
            <span className="text-sm font-mono font-extrabold tabular-nums mt-0.5" data-testid="fssai-license-no">Lic. No. 21521243000086</span>
            <span className="text-[10px] text-muted-foreground mt-0.5">100% Pure Veg · Approved kitchen</span>
          </div>
        </div>

        <div className="w-full flex flex-col items-center md:flex-row md:justify-between gap-2">
          <span className="text-muted-foreground text-xs md:text-sm" data-testid="footer-copyright">{copyright}</span>
          <span className="text-secondary italic text-xs md:text-sm" data-testid="footer-tagline">{tagline}</span>
        </div>
      </div>
    </footer>
  );
}
