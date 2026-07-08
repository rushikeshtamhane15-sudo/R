import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * BrandingContext — single source of truth for the app-wide brand logo.
 *
 * The admin can upload a new logo via /admin/branding; that URL flows into
 * every component (Header uses HEADER_LOGO_URL independently, so it is NOT
 * affected — per product decision). All other places (footer, hero, kiosk,
 * live-map marker, 3D track map, mess-menu card) subscribe to this context
 * so the change is reflected instantly the moment the admin saves.
 */
const DEFAULT_URL = "/brand-logo.jpg";

const BrandingContext = createContext({
  brandLogoUrl: DEFAULT_URL,
  isCustom: false,
  updatedAt: null,
  refresh: async () => {},
});

export function BrandingProvider({ children }) {
  const [state, setState] = useState({
    brandLogoUrl: DEFAULT_URL,
    isCustom: false,
    updatedAt: null,
  });

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/branding");
      if (data && data.brand_logo_url) {
        setState({
          brandLogoUrl: data.brand_logo_url,
          isCustom: Boolean(data.is_custom),
          updatedAt: data.updated_at || null,
        });
      }
    } catch {
      // fall through — keep DEFAULT_URL
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
