import React, { useEffect, useState } from "react";

/**
 * Brand splash screen — full-bleed red overlay, 3D digital logo treatment,
 * holds for 2 s on every cold load (no sessionStorage skip — user wants the
 * splash to be the FIRST thing every launch).
 *
 *   ┌────────────────────────┐   #a02323 background
 *   │   [3D logo · 96 px]    │
 *   │                        │
 *   │      eFoodCare         │   wordmark (white)
 *   │  ghar se accha khana   │   tagline (white, italic)
 *   └────────────────────────┘
 */
const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_dining-pass-scan/artifacts/uzs344m6_9a705f5a-b3a0-4286-b51d-b9bd6f55b7bb_20260504_011957_0000.png";

const HOLD_MS = 5000;
const FADE_MS = 380;

export default function SplashScreen() {
  const [show, setShow] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), HOLD_MS);
    const t2 = setTimeout(() => setShow(false), HOLD_MS + FADE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (!show) return null;

  return (
    <div
      data-testid="splash-screen"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        // Subtle radial gradient ON TOP of brand red — gives the splash a
        // bit of depth without losing the solid-red brand cue.
        background: "radial-gradient(circle at 50% 38%, #c33030 0%, #a02323 55%, #761616 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      {/* 3D logo container — multi-layer shadow + ring + highlight gradient */}
      <div
        className="efc-logo-3d"
        style={{
          position: "relative",
          width: 112,
          height: 112,
          borderRadius: 26,
          background:
            "linear-gradient(145deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 45%, rgba(0,0,0,0.18) 100%)",
          padding: 8,
          // Stack of shadows: outer glow + lift shadow + inner highlight + inner darker line
          boxShadow:
            "0 18px 36px rgba(0,0,0,0.45)," +
            " 0 6px 14px rgba(0,0,0,0.3)," +
            " inset 0 1px 0 rgba(255,255,255,0.35)," +
            " inset 0 -2px 4px rgba(0,0,0,0.25)",
          animation: "efc-pop 700ms cubic-bezier(.2,.9,.3,1.2) both",
        }}
      >
        {/* faint orbit ring */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: 32,
            border: "1.5px solid rgba(255,255,255,0.22)",
            opacity: 0.55,
            pointerEvents: "none",
            animation: "efc-orbit 4s linear infinite",
          }}
        />
        <img
          src={LOGO_URL}
          alt="eFoodCare"
          width={96}
          height={96}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            borderRadius: 18,
            background: "rgba(255,255,255,0.06)",
            // Crisp digital edge — 1px highlight + drop shadow
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))",
          }}
        />
      </div>

      <h1
        style={{
          color: "#ffffff",
          fontFamily: '"Cabinet Grotesk", "Manrope", system-ui, sans-serif',
          fontWeight: 800,
          fontSize: "clamp(2rem, 7vw, 3rem)",
          letterSpacing: "-0.02em",
          margin: "26px 0 0",
          lineHeight: 1.05,
          textTransform: "lowercase",
          textShadow: "0 2px 12px rgba(0,0,0,0.35)",
          animation: "efc-rise 700ms ease-out 120ms both",
        }}
      >
        efoodcare
      </h1>

      <p
        style={{
          color: "#ffffff",
          opacity: 0.95,
          fontFamily: '"Manrope", system-ui, sans-serif',
          fontStyle: "italic",
          fontSize: "clamp(1.5rem, 5vw, 2rem)",
          fontWeight: 600,
          letterSpacing: "0.005em",
          margin: "32px 0 0",
          textShadow: "0 1px 8px rgba(0,0,0,0.3)",
          animation: "efc-rise 700ms ease-out 240ms both",
        }}
      >
        ghar se accha khana
      </p>

      <style>{`
        @keyframes efc-pop {
          0%   { transform: scale(0.7) rotate(-2deg); opacity: 0; }
          70%  { transform: scale(1.05) rotate(0deg); opacity: 1; }
          100% { transform: scale(1)    rotate(0deg); opacity: 1; }
        }
        @keyframes efc-rise {
          from { transform: translateY(10px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes efc-orbit {
          from { transform: rotate(0deg)   scale(1); }
          50%  { transform: rotate(180deg) scale(1.04); }
          to   { transform: rotate(360deg) scale(1); }
        }
      `}</style>
    </div>
  );
}
