import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Footer() {
  const [data, setData] = useState(null);
  useEffect(() => { (async () => { try { const r = await api.get("/content/footer"); setData(r.data); } catch {} })(); }, []);

  const copyright = data?.copyright || "copyright © efoodcare.in all rights reserved";
  const tagline = data?.tagline || "ghar se achha khana";

  return (
    <footer className="border-t border-border bg-muted/40 pb-16 md:pb-0" data-testid="app-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-7 flex flex-col items-center md:flex-row md:items-center md:justify-between gap-2 text-sm">
        <span className="text-muted-foreground" data-testid="footer-copyright">{copyright}</span>
        <span className="text-secondary italic" data-testid="footer-tagline">{tagline}</span>
      </div>
    </footer>
  );
}
