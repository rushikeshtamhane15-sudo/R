import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * BrandingContext — single source of truth for admin-managed logos.
 *
 * Two independent slots:
 *   · `brandLogoUrl`  — app-wide "app icon". Used by Footer, HeroPanel,
 *                       Kiosk, admin surfaces, etc.
 *   · `headerLogoUrl` — top-nav Header icon. Kept as its own slot so
 *                       marketing can experiment with different marks
 *                       between the navigation and the app icon.
 *
 * Both fall back to the bundled `/brand-logo.jpg` if no custom upload
 * exists, so the UI never flashes a broken image.
 */
const DEFAULT_BRAND_URL = "/brand-logo.jpg";
const DEFAULT_HEADER_URL = "/brand-logo.jpg";

const BrandingContext = createContext({
  brandLogoUrl: DEFAULT_BRAND_URL,
  headerLogoUrl: DEFAULT_HEADER_URL,
  isCustom: false,
  isHeaderCustom: false,
  updatedAt: null,
  brandUpdatedAt: null,
  headerUpdatedAt: null,
  refresh: async () => {},
});

export function BrandingProvider({ children }) {
  const [state, setState] = useState({
    brandLogoUrl: DEFAULT_BRAND_URL,
    headerLogoUrl: DEFAULT_HEADER_URL,
    isCustom: false,
    isHeaderCustom: false,
    updatedAt: null,
    brandUpdatedAt: null,
    headerUpdatedAt: null,
  });

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/branding");
      if (!data) return;
      setState({
        brandLogoUrl:  data.brand_logo_url  || DEFAULT_BRAND_URL,
        headerLogoUrl: data.header_logo_url || DEFAULT_HEADER_URL,
        isCustom:       Boolean(data.is_custom),
        isHeaderCustom: Boolean(data.is_header_custom),
        updatedAt:       data.updated_at        || null,
        brandUpdatedAt:  data.brand_updated_at  || null,
        headerUpdatedAt: data.header_updated_at || null,
      });
    } catch {
      // fall through — keep defaults
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BrandingContext.Provider value={{ ...state, refresh }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
