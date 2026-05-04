import React, { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = location.hash || window.location.hash;
    const match = hash.match(/session_id=([^&]+)/);
    if (!match) {
      navigate("/login", { replace: true });
      return;
    }
    const sessionId = decodeURIComponent(match[1]);

    (async () => {
      try {
        const res = await api.post("/auth/session", { session_id: sessionId });
        setUser(res.data.user);
        navigate("/dashboard", { replace: true, state: { user: res.data.user } });
      } catch (e) {
        navigate("/login", { replace: true });
      }
    })();
  }, [location.hash, navigate, setUser]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center" data-testid="auth-callback">
      <div className="text-center">
        <div className="inline-block h-10 w-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
        <p className="mt-4 text-muted-foreground">Signing you in…</p>
      </div>
    </div>
  );
}
