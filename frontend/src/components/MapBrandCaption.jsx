import React from "react";
import { MapPin } from "lucide-react";

/**
 * MapBrandCaption — iter-64 #6
 *
 * A small white ribbon pinned to the bottom of any map container that
 * replaces noisy 3rd-party attribution (OpenStreetMap "Report a problem"
 * link, Leaflet credit, etc.) with our own brand caption:
 *   "efoodcare nearby kitchen location"
 *
 * Designed to be used inside a `position: relative; overflow: hidden`
 * map wrapper. Stays out of the way of pan/zoom but covers the bottom
 * sliver where OSM/Leaflet draws their default attribution.
 */
export default function MapBrandCaption({ className = "" }) {
  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-[400] pointer-events-none select-none ${className}`}
      data-testid="map-brand-caption"
    >
      <div className="mx-auto w-full bg-white/95 backdrop-blur-sm border-t border-border px-3 py-1.5 flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-semibold text-foreground/80">
        <MapPin className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-primary" />
        <span className="truncate">efoodcare nearby kitchen location</span>
      </div>
    </div>
  );
}
