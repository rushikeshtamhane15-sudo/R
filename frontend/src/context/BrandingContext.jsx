import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";

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
const DEFAULT_SPLASH_URL = "/brand-logo.jpg";
const DEFAULT_KIOSK_URL = "/brand-logo.jpg";

const BrandingContext = createContext({
  brandLogoUrl: DEFAULT_BRAND_URL,
  headerLogoUrl: DEFAULT_HEADER_URL,
  splashLogoUrl: DEFAULT_SPLASH_URL,
  kioskLogoUrl: DEFAULT_KIOSK_URL,
  isCustom: false,
  isHeaderCustom: false,
  isSplashCustom: false,
  isKioskCustom: false,
  updatedAt: null,
  brandUpdatedAt: null,
  headerUpdatedAt: null,
  splashUpdatedAt: null,
  kioskUpdatedAt: null,
  refresh: async () => {},
});

export function BrandingProvider({ children }) {
  // iter-165 · multi-tenant SaaS — logged-in subscribers see their mess's
  // custom brand/header/splash/kiosk logo. Anonymous traffic and the Super
  // Admin frontend always fall through to the platform (Super Admin) defaults.
  const { user } = useAuth();
  const messId = user?.mess_id || null;

  const [state, setState] = useState({
    brandLogoUrl: DEFAULT_BRAND_URL,
    headerLogoUrl: DEFAULT_HEADER_URL,
    splashLogoUrl: DEFAULT_SPLASH_URL,
    kioskLogoUrl: DEFAULT_KIOSK_URL,
    isCustom: false,
    isHeaderCustom: false,
    isSplashCustom: false,
    isKioskCustom: false,
    updatedAt: null,
    brandUpdatedAt: null,
    headerUpdatedAt: null,
    splashUpdatedAt: null,
    kioskUpdatedAt: null,
  });

  const refresh = useCallback(async () => {
    try {
      // iter-170 · strict isolation. Super-admin (role=admin) sees the
      // global brand doc even if the /users record has a legacy `mess_id`
      // field — passing mess_id would return a scoped view which would
      // hide their global upload behind a per-mess override.
      const scopeMess = (user?.role === "subscriber" || user?.role === "mess_owner") ? messId : null;
      const params = scopeMess ? { mess_id: scopeMess } : undefined;
      const { data } = await api.get("/branding", params ? { params } : undefined);
      if (!data) return;
      setState({
        brandLogoUrl:  data.brand_logo_url  || DEFAULT_BRAND_URL,
        headerLogoUrl: data.header_logo_url || DEFAULT_HEADER_URL,
        splashLogoUrl: data.splash_logo_url || DEFAULT_SPLASH_URL,
        kioskLogoUrl:  data.kiosk_logo_url  || DEFAULT_KIOSK_URL,
        isCustom:       Boolean(data.is_custom),
        isHeaderCustom: Boolean(data.is_header_custom),
        isSplashCustom: Boolean(data.is_splash_custom),
        isKioskCustom:  Boolean(data.is_kiosk_custom),
        updatedAt:       data.updated_at        || null,
        brandUpdatedAt:  data.brand_updated_at  || null,
        headerUpdatedAt: data.header_updated_at || null,
        splashUpdatedAt: data.splash_updated_at || null,
        kioskUpdatedAt:  data.kiosk_updated_at  || null,
      });
    } catch {
      // fall through — keep defaults
    }
  }, [messId, user?.role]);

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
