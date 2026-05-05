import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function Footer() {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/content/footer"); setData(r.data); } catch {}
    })();
  }, []);

  const copyright = data?.copyright || "copyright © efoodcare.in all rights reserved";
  const tagline = data?.tagline || "ghar se achha khana";

  return (
    <footer className="border-t border-border bg-muted/40" data-testid="app-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="text-sm text-muted-foreground" data-testid="footer-copyright">{copyright}</div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs tracking-overline uppercase font-bold text-muted-foreground">
          <Link to="/contact" className="hover:text-primary transition-colors" data-testid="footer-contact">Contact</Link>
          <Link to="/privacy" className="hover:text-primary transition-colors" data-testid="footer-privacy">Privacy</Link>
          <Link to="/refund" className="hover:text-primary transition-colors" data-testid="footer-refund">Refund</Link>
          <span className="text-secondary normal-case tracking-normal">{tagline}</span>
        </nav>
      </div>
    </footer>
  );
}
