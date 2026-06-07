import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { BRAND_LOGO_URL } from "../lib/brand";

// User-provided composite image — green Pure Veg square + fssai logo + "Approved"
const FSSAI_IMG = "https://customer-assets.emergentagent.com/job_dining-pass-scan/artifacts/li3dreby_images.jpeg";

// iter-65 #4: corporate identity block above the bottom copyright bar.
// Same numbers and addresses used everywhere — CMS-overridable via
// /api/content/footer (corporate_address / support_phone / website / email).
const DEFAULT_CORPORATE = {
  brand_name: "efoodcare",
  tagline: "ghar se achha khana",
  promise: "India's first zero meal adulteration app — proudly made by the genius team of efoodcare.",
  corporate_address: "shilangan Road, behind bhaktidham mandir, sai nagar, Amravati 444607, Maharashtra",
  support_phone: "+91 91755 60211",
  website: "https://efoodcare.in",
  email: "hello@efoodcare.in",
};

export default function Footer() {
  const [data, setData] = useState(null);
  useEffect(() => { (async () => { try { const r = await api.get("/content/footer"); setData(r.data); } catch {} })(); }, []);

  const copyright = data?.copyright || "copyright © efoodcare.in all rights reserved";
  const tagline = data?.tagline || DEFAULT_CORPORATE.tagline;
  const brandName = data?.brand_name || DEFAULT_CORPORATE.brand_name;
  const promise = data?.promise || DEFAULT_CORPORATE.promise;
  const address = data?.corporate_address || DEFAULT_CORPORATE.corporate_address;
  const phone = data?.support_phone || DEFAULT_CORPORATE.support_phone;
  const website = data?.website || DEFAULT_CORPORATE.website;
  const email = data?.email || DEFAULT_CORPORATE.email;

  return (
    <footer className="border-t border-border bg-muted/40 pb-16 md:pb-0" data-testid="app-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-8">
        {/* iter-65 #4 + iter-72 #4: brand identity block — logo CENTERED above
            brand name (was inline). Brand name in white per request, with
            primary background underlay so it stays readable on light bg too. */}
        <div className="flex flex-col items-center text-center gap-2 mb-6" data-testid="footer-brand-block">
          <span className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary overflow-hidden shadow-md">
            <img src={BRAND_LOGO_URL} alt={brandName} className="h-[88%] w-[88%] object-contain" />
          </span>
          <span
            className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight text-white"
            data-testid="footer-brand-name"
            style={{
              // iter-75 #6: subtle drop-shadow on the brand name so it
              // lifts off the red footer instead of sitting flat. Stays
              // strictly white (per iter-74 #5) but gains depth.
              textShadow: "0 2px 4px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.20)",
            }}
          >{brandName}</span>
          <span className="text-[11px] sm:text-xs tracking-[0.2em] uppercase font-semibold text-secondary" data-testid="footer-brand-tagline">{tagline}</span>
          <p className="text-sm sm:text-base max-w-2xl text-muted-foreground leading-relaxed mt-1" data-testid="footer-brand-promise">
            {promise}
          </p>

          <div className="mt-3 w-full max-w-3xl grid sm:grid-cols-2 gap-2.5 text-left" data-testid="footer-corporate-card">
            <div className="rounded-xl border border-border bg-card p-3.5">
              <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Corporate office</p>
              <p className="text-[13px] mt-1 leading-snug" data-testid="footer-corporate-address">{address}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5 space-y-1.5">
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Phone</p>
                <a href={`tel:${phone.replace(/\s/g, "")}`} className="text-[13px] mt-0.5 font-semibold tabular-nums text-foreground hover:text-primary" data-testid="footer-phone">{phone}</a>
              </div>
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Email</p>
                <a href={`mailto:${email}`} className="text-[13px] mt-0.5 font-semibold text-foreground hover:text-primary" data-testid="footer-email">{email}</a>
              </div>
              <div>
                <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Website</p>
                <a href={website} target="_blank" rel="noreferrer noopener" className="text-[13px] mt-0.5 font-semibold text-foreground hover:text-primary" data-testid="footer-website">{website.replace(/^https?:\/\//, "")}</a>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 text-sm border-t border-border pt-5">
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
              <span className="text-[10px] text-muted-foreground mt-0.5">101% Pure Veg · Approved kitchen</span>
            </div>
          </div>

          <div className="w-full flex flex-col items-center md:flex-row md:justify-between gap-2">
            <span className="text-muted-foreground text-xs md:text-sm" data-testid="footer-copyright">{copyright}</span>
            <span className="text-secondary italic text-xs md:text-sm" data-testid="footer-tagline">{tagline}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
