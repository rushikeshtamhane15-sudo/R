import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";

export default function AnnouncementBar() {
  const [cfg, setCfg] = useState(null);
  const location = useLocation();

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/content/announcement");
        setCfg(r.data);
      } catch {}
    })();
  }, []);

  // Iter-49: /login has its own BadStuffMarquee inside the form sheet —
  // showing this site-wide Hindi warning strip on top of it stacks two
  // marquees on the page and clutters the auth flow. Suppress here.
  if (location.pathname.startsWith("/login")) return null;
  if (!cfg || !cfg.enabled || !cfg.text) return null;

  const text = String(cfg.text).trim();
  const speed = Math.max(10, Math.min(180, Number(cfg.speed_seconds) || 45));

  return (
    <div
      className="sticky top-[var(--header-h,0px)] z-20 overflow-hidden border-b border-black/10"
      style={{ backgroundColor: cfg.bg_color || "#FACC15", color: cfg.text_color || "#1F2937" }}
      data-testid="announcement-bar"
      role="region"
      aria-label="Important announcement"
    >
      <div className="relative flex whitespace-nowrap py-2.5">
        <MarqueeTrack text={text} speed={speed} />
        <MarqueeTrack text={text} speed={speed} ariaHidden />
      </div>
      <style>{`
        @keyframes efc-marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-100%); }
        }
        [data-testid='announcement-bar'] .efc-marquee-track {
          animation: efc-marquee linear infinite;
        }
        [data-testid='announcement-bar']:hover .efc-marquee-track {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}

function MarqueeTrack({ text, speed, ariaHidden }) {
  // Build a single track by repeating the message a few times with a separator so
  // the loop is visually continuous even for short messages.
  const separator = "  •  ";
  const repeated = new Array(3).fill(text).join(separator) + separator;
  return (
    <span
      className="efc-marquee-track inline-block shrink-0 px-4 text-sm md:text-[15px] font-semibold tracking-wide"
      style={{ animationDuration: `${speed}s` }}
      aria-hidden={ariaHidden ? "true" : undefined}
    >
      {repeated}
    </span>
  );
}
