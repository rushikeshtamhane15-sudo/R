import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

const AuthContext = createContext(null);

// iter-95: HQ-admin "view-as-branch" — persisted across reloads so the
// switcher stays sticky. Lives in localStorage and is appended as
// `?as_mess_id=` to every /admin/* + /franchise/* call by the axios layer.
const AS_MESS_KEY = "efc_as_mess_id";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [asMessId, setAsMessIdState] = useState(() => {
    try { return localStorage.getItem(AS_MESS_KEY) || null; } catch { return null; }
  });

  const setAsMessId = useCallback((id) => {
    try {
      if (id) localStorage.setItem(AS_MESS_KEY, id);
      else localStorage.removeItem(AS_MESS_KEY);
    } catch { /* ignore */ }
    // Hand the value to the axios layer so requests pick it up immediately.
    if (typeof api.__setAsMessId === "function") api.__setAsMessId(id);
    setAsMessIdState(id);
  }, []);

  // Wire the axios interceptor with the initial value on mount.
  useEffect(() => {
    if (typeof api.__setAsMessId === "function") api.__setAsMessId(asMessId);
  }, [asMessId]);

  const checkAuth = useCallback(async () => {
    try {
      const res = await api.get("/auth/me");
      setUser(res.data);
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (e) {}
    // iter-95: clear the view-as override so the next admin doesn't inherit it.
    setAsMessId(null);
    setUser(null);
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, checkAuth, logout, asMessId, setAsMessId }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
