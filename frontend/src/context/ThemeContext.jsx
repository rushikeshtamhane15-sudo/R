import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

const ThemeContext = createContext(null);

const TOKEN_VAR_MAP = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  card_foreground: "--card-foreground",
  popover: "--popover",
  popover_foreground: "--popover-foreground",
  primary: "--primary",
  primary_foreground: "--primary-foreground",
  secondary: "--secondary",
  secondary_foreground: "--secondary-foreground",
  muted: "--muted",
  muted_foreground: "--muted-foreground",
  accent: "--accent",
  accent_foreground: "--accent-foreground",
  destructive: "--destructive",
  destructive_foreground: "--destructive-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
  radius: "--radius",
};

export function applyTokens(tokens) {
  if (!tokens) return;
  const root = document.documentElement;
  Object.entries(tokens).forEach(([k, v]) => {
    const cssVar = TOKEN_VAR_MAP[k];
    if (cssVar && v) root.style.setProperty(cssVar, v);
  });
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/theme");
      setTheme(r.data);
      applyTokens(r.data?.tokens);
      if (r.data?.brand_name) document.title = `${r.data.brand_name} · ${r.data.brand_tagline || ""}`.trim();
    } catch (e) {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return <ThemeContext.Provider value={{ theme, setTheme, refresh, applyTokens }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext) || { theme: null };
