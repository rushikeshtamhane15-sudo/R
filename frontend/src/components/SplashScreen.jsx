import React, { useEffect, useState } from "react";

/**
 * Brand splash screen — shows on first paint of the SPA.
 *
 *   ┌────────────────────────┐   red background
 *   │                        │
 *   │       [ logo ]         │   slightly smaller logo (96 px)
 *   │      eFoodCare         │   wordmark (white)
 *   │                        │
 *   │  ghar se accha khana   │   tagline (white, italic)
 *   │                        │
 *   └────────────────────────┘
 *
 * Auto-fades out after `holdMs` and unmounts after `unmountMs`. Honors a
 * sessionStorage flag so it never re-flashes during the same tab session.
 */
const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_dining-pass-scan/artifacts/uzs344m6_9a705f5a-b3a0-4286-b51d-b9bd6f55b7bb_20260504_011957_0000.png";

const HOLD_MS = 1100;
const FADE_MS = 350;

export default function SplashScreen() {
  const [show, setShow] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem("efc_splash_shown") !== "1";
    } catch {
      return true;
    }
  });
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem("efc_splash_shown", "1"); } catch {}
    const t1 = setTimeout(() => setFading(true), HOLD_MS);
    const t2 = setTimeout(() => setShow(false), HOLD_MS + FADE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [show]);

  if (!show) return null;

  return (
    <div
      data-testid="splash-screen"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#a02323", // brand red
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <img
        src={LOGO_URL}
        alt="eFoodCare"
        width={96}
        height={96}
        style={{
          width: 96,
          height: 96,
          objectFit: "contain",
          borderRadius: 18,
          background: "rgba(255,255,255,0.04)",
          padding: 6,
          animation: "efc-pop 600ms cubic-bezier(.2,.9,.3,1.2) both",
        }}
      />

      <h1
        style={{
          color: "#ffffff",
          fontFamily: '"Cabinet Grotesk", "Manrope", system-ui, sans-serif',
          fontWeight: 800,
          fontSize: "clamp(2rem, 7vw, 3rem)",
          letterSpacing: "-0.02em",
          margin: "20px 0 0",
          lineHeight: 1.05,
          animation: "efc-rise 700ms ease-out 100ms both",
        }}
      >
        eFoodCare
      </h1>

      <p
        style={{
          color: "#ffffff",
          opacity: 0.9,
          fontFamily: '"Manrope", system-ui, sans-serif',
          fontStyle: "italic",
          fontSize: "clamp(1rem, 3.4vw, 1.25rem)",
          letterSpacing: "0.01em",
          margin: "44px 0 0",
          animation: "efc-rise 700ms ease-out 220ms both",
        }}
      >
        ghar se accha khana
      </p>

      <style>{`
        @keyframes efc-pop {
          0%   { transform: scale(0.78); opacity: 0; }
          70%  { transform: scale(1.04); opacity: 1; }
          100% { transform: scale(1);    opacity: 1; }
        }
        @keyframes efc-rise {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}
