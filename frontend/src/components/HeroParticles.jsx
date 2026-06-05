import React from "react";

/**
 * HeroParticles — iter-65 #1
 *
 * Pure-CSS parallax / ambient layer behind the landing hero:
 *   • Soft "steam" plumes rising from the bottom (3 layered blurred blobs).
 *   • Floating "PURE VEG" chips drifting upward (5 chips, staggered).
 *   • Slow mouse-driven parallax shift via CSS variables set on
 *     parent in Landing.jsx (--px, --py from 0..1).
 *
 * No JS animation. Honors prefers-reduced-motion via CSS.
 */
export default function HeroParticles() {
  return (
    <div className="efc-hero-particles absolute inset-0 -z-[1] overflow-hidden pointer-events-none" data-testid="hero-particles" aria-hidden="true">
      {/* Steam plumes — emerald-tinted soft blobs rising */}
      <span className="efc-steam efc-steam--a" />
      <span className="efc-steam efc-steam--b" />
      <span className="efc-steam efc-steam--c" />

      {/* Floating pure-veg chips */}
      <span className="efc-chip efc-chip--1">PURE VEG</span>
      <span className="efc-chip efc-chip--2">0% MAIDA</span>
      <span className="efc-chip efc-chip--3">NO AJINOMOTO</span>
      <span className="efc-chip efc-chip--4">PURE VEG</span>
      <span className="efc-chip efc-chip--5">NO REFINED OIL</span>

      <style>{`
        .efc-hero-particles { mask-image: linear-gradient(to bottom, rgba(0,0,0,0.92), rgba(0,0,0,0.96) 70%, rgba(0,0,0,0.4) 100%); }

        .efc-steam {
          position: absolute;
          bottom: -20%;
          width: 42vmin;
          height: 42vmin;
          border-radius: 50%;
          filter: blur(46px);
          opacity: 0.0;
          animation: efc-steam-rise 14s ease-in-out infinite;
          background: radial-gradient(closest-side, rgba(16,185,129,0.35), rgba(16,185,129,0));
          transform: translate3d(calc(var(--px,0)*8px), 0, 0);
        }
        .efc-steam--a { left: 8%;  animation-delay: 0s;   }
        .efc-steam--b { left: 42%; animation-delay: 4.5s; background: radial-gradient(closest-side, rgba(217,119,6,0.30), rgba(217,119,6,0)); }
        .efc-steam--c { left: 72%; animation-delay: 8.5s; background: radial-gradient(closest-side, rgba(160,35,35,0.28), rgba(160,35,35,0)); }

        @keyframes efc-steam-rise {
          0%   { transform: translate3d(calc(var(--px,0)*8px), 10vh, 0) scale(0.7); opacity: 0; }
          25%  { opacity: 0.7; }
          70%  { opacity: 0.55; }
          100% { transform: translate3d(calc(var(--px,0)*8px), -65vh, 0) scale(1.15); opacity: 0; }
        }

        .efc-chip {
          position: absolute;
          bottom: -8%;
          left: 50%;
          padding: 4px 10px;
          font-size: 9px;
          letter-spacing: 0.18em;
          font-weight: 800;
          color: #065f46;
          background: rgba(236, 253, 245, 0.85);
          border: 1px solid rgba(16, 185, 129, 0.45);
          border-radius: 999px;
          box-shadow: 0 4px 12px -4px rgba(16,185,129,0.35), inset 0 1px 0 rgba(255,255,255,0.5);
          backdrop-filter: blur(4px);
          white-space: nowrap;
          animation: efc-chip-float 22s linear infinite;
          opacity: 0;
          transform: translate3d(calc(var(--px,0)*-12px), 0, 0) rotate(-2deg);
          will-change: transform, opacity;
        }
        .efc-chip--1 { left: 12%; animation-delay: 0s;    color: #065f46; }
        .efc-chip--2 { left: 32%; animation-delay: 4s;    color: #a02323; background: rgba(254, 242, 242, 0.85); border-color: rgba(160,35,35,0.4); }
        .efc-chip--3 { left: 52%; animation-delay: 8s;    color: #92400e; background: rgba(254, 252, 232, 0.9);  border-color: rgba(217,119,6,0.4); }
        .efc-chip--4 { left: 72%; animation-delay: 12s;   color: #065f46; }
        .efc-chip--5 { left: 88%; animation-delay: 16.5s; color: #065f46; }

        @keyframes efc-chip-float {
          0%   { transform: translate3d(calc(var(--px,0)*-12px), 0,      0) rotate(-2deg); opacity: 0; }
          10%  { opacity: 0.85; }
          85%  { opacity: 0.55; }
          100% { transform: translate3d(calc(var(--px,0)*-12px), -110vh, 0) rotate(8deg); opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .efc-steam, .efc-chip { animation: none; opacity: 0.18; }
        }
      `}</style>
    </div>
  );
}
