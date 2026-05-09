import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ShieldCheck } from "lucide-react";

export default function Footer() {
  const [data, setData] = useState(null);
  useEffect(() => { (async () => { try { const r = await api.get("/content/footer"); setData(r.data); } catch {} })(); }, []);

  const copyright = data?.copyright || "copyright © efoodcare.in all rights reserved";
  const tagline = data?.tagline || "ghar se achha khana";

  return (
    <footer className="border-t border-border bg-muted/40 pb-16 md:pb-0" data-testid="app-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-6 flex flex-col items-center gap-3 text-sm">
        {/* FSSAI compliance — required mark for restaurant brands in India */}
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card" data-testid="fssai-mark">
          <span className="inline-flex items-center justify-center h-9 w-12 rounded-sm bg-emerald-700 text-white text-[9px] font-extrabold tracking-tight leading-tight px-1 text-center" aria-hidden>
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[9px] tracking-overline uppercase font-bold text-emerald-800 dark:text-emerald-300">FSSAI Licensed · Govt of India</span>
            <span className="text-xs font-mono font-bold tabular-nums" data-testid="fssai-license-no">Lic. No. 21521243000086</span>
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
