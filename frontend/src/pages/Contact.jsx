import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { MapPin, Phone, Mail, Clock, Building2, Navigation, ChefHat } from "lucide-react";
import SEO from "../components/SEO";
import MapBrandCaption from "../components/MapBrandCaption";

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function Contact() {
  const [data, setData] = useState(null);
  const [kitchen, setKitchen] = useState(null);
  // iter-65 #6: capture the user's coords so we can show distance + open
  // turn-by-turn directions in Google Maps with one tap.
  const [me, setMe] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    (async () => {
      try { const r = await api.get("/content/contact"); setData(r.data); } catch {}
      try { const r2 = await api.get("/kitchen-location"); setKitchen(r2.data || null); } catch {}
    })();
  }, []);

  const askDirections = () => {
    if (!kitchen?.dispatch_lat || !kitchen?.dispatch_lng) return;
    // iter-73 #4: pass the kitchen address as the destination query so Google
    // Maps shows "efoodcare · shilangan Road…" instead of the random
    // reverse-geocoded name (e.g. "Indira Digital") that surfaced before.
    const destLabel = encodeURIComponent(`efoodcare · ${data?.address || "Amravati"}`);
    const openMaps = (lat, lng) => {
      const destCoords = `${kitchen.dispatch_lat},${kitchen.dispatch_lng}`;
      const origin = lat && lng ? `${lat},${lng}` : "";
      const url = `https://www.google.com/maps/dir/?api=1&destination=${destLabel}&destination_place_id=&travelmode=driving${origin ? `&origin=${origin}` : ""}&dir_action=navigate`;
      // Drop pin alternative — if Google can't find the labelled place, fall
      // through to lat/lng coordinates so user still reaches the kitchen.
      const fallback = `https://www.google.com/maps/dir/?api=1&destination=${destCoords}${origin ? `&origin=${origin}` : ""}&travelmode=driving`;
      window.open(url || fallback, "_blank", "noopener,noreferrer");
    };
    if (!("geolocation" in navigator)) { openMaps(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        setMe({ lat, lng });
        setPermissionDenied(false);
        openMaps(lat, lng);
      },
      () => { setPermissionDenied(true); openMaps(); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  };

  if (!data) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;

  // iter-62 #6: when admin moves the kitchen pin via the Kitchen Settings
  // CMS, we build a fresh OpenStreetMap embed centered on that lat/lng so
  // the Contact map stays in sync without needing the admin to also paste a
  // new map_embed_src. Fallback to whatever was saved in /content/contact.
  const buildOsmEmbed = (lat, lng) => {
    const dLat = 0.012, dLng = 0.012;
    const bbox = `${(lng - dLng).toFixed(5)},${(lat - dLat).toFixed(5)},${(lng + dLng).toFixed(5)},${(lat + dLat).toFixed(5)}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  };
  const liveMapSrc = kitchen && kitchen.dispatch_lat && kitchen.dispatch_lng
    ? buildOsmEmbed(Number(kitchen.dispatch_lat), Number(kitchen.dispatch_lng))
    : (data.map_embed_src || "");

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-8 py-12" data-testid="contact-page">
      <SEO
        title="Contact us · franchise & support"
        path="/contact"
        description="Reach efoodcare for orders, support or franchise enquiries. Address: shilangan Road, behind bhaktidham mandir, sai nagar, Amravati 444607, Maharashtra. Phone: +91 9175560211. Mon–Sun 09:00–22:00."
      />
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">We're here for you</p>
      <h1 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight mt-3">{data.title}</h1>
      <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">{data.intro}</p>

      <div className="mt-10 grid md:grid-cols-5 gap-6">
        <div className="md:col-span-2 space-y-3">
          <ContactRow icon={Building2} label="Company" value={data.company} />
          <ContactRow icon={MapPin} label="Address" value={data.address} multiline />
          <ContactRow icon={Phone} label="Phone" value={data.phone} href={`tel:${data.phone.replace(/\s/g, "")}`} />
          <ContactRow icon={Mail} label="Email" value={data.email} href={`mailto:${data.email}`} />
          <ContactRow icon={Clock} label="Hours" value={data.hours} />
        </div>
        <div className="md:col-span-3 surface-3d rounded-2xl overflow-hidden border border-border bg-card" data-testid="contact-map">
          {liveMapSrc ? (
            // iter-64 #6: hide the OpenStreetMap "Report a problem · © OSM
            // contributors · Make a donation" attribution row and replace it
            // with our own brand caption. We make the iframe ~28px taller
            // and clip it via the relative wrapper's overflow-hidden, then
            // overlay a 1-line brand caption ribbon at the bottom.
            // iter-65 #6: tap-anywhere "Get directions" overlay → opens
            // Google Maps directions from user's GPS to the kitchen pin.
            <div className="relative h-[420px]">
              <iframe
                title="efoodcare location"
                src={liveMapSrc}
                className="absolute inset-x-0 top-0 w-full h-[448px] border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
                data-testid="contact-map-iframe"
              />
              <button
                type="button"
                onClick={askDirections}
                className="absolute inset-0 z-[300] cursor-pointer bg-transparent focus:outline-none"
                aria-label="Get directions to our kitchen"
                data-testid="get-directions-tap"
              />
              <div className="absolute top-3 left-3 right-3 z-[350] flex items-center gap-2 pointer-events-none">
                <button
                  type="button"
                  onClick={askDirections}
                  className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground pl-1.5 pr-4 py-1 shadow-lg text-xs sm:text-sm font-bold hover:shadow-xl transition-shadow"
                  data-testid="get-directions-btn"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-primary">
                    <Navigation className="h-3.5 w-3.5" />
                  </span>
                  Get directions
                </button>
                {me && kitchen?.dispatch_lat && kitchen?.dispatch_lng && (
                  <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur text-foreground text-[11px] sm:text-xs font-semibold px-2.5 py-1 shadow" data-testid="distance-pill">
                    <MapPin className="h-3 w-3 text-primary" />
                    <span className="tabular-nums">{haversineKm(me.lat, me.lng, Number(kitchen.dispatch_lat), Number(kitchen.dispatch_lng)).toFixed(1)} km away</span>
                  </span>
                )}
              </div>
              <MapBrandCaption />
              {/* iter-73 #4 + iter-74 #3: 3D restaurant emblem over the map
                  pin. Switched from a fork (Utensils) to a chef-hat (the
                  closest "restaurant building" pictograph in lucide). The
                  "3D" corner badge has been removed for a cleaner look. */}
              <div
                aria-hidden
                className="pointer-events-none absolute z-[360] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                data-testid="contact-3d-pin-emblem"
              >
                <div
                  className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-primary via-[#a02323] to-[#7a1818] flex items-center justify-center"
                  style={{
                    boxShadow: "0 18px 36px -8px rgba(160,35,35,0.55), 0 6px 12px rgba(0,0,0,0.25), inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -3px 6px rgba(0,0,0,0.25)",
                    transform: "perspective(220px) rotateX(15deg)",
                  }}
                >
                  <ChefHat className="h-7 w-7 text-white drop-shadow-md" strokeWidth={2.2} />
                </div>
                <span
                  className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/95 backdrop-blur px-2.5 py-0.5 text-[10px] font-extrabold tracking-[0.12em] uppercase text-primary shadow"
                  style={{ boxShadow: "0 6px 14px rgba(0,0,0,0.18)" }}
                >
                  efoodcare
                </span>
                {/* drop-shadow puddle */}
                <span className="absolute -bottom-2 h-1.5 w-12 rounded-full bg-black/45 blur-md" />
              </div>
              {permissionDenied && (
                <div className="absolute bottom-9 inset-x-3 z-[350] rounded-md bg-amber-50/95 border border-amber-300 text-[11px] px-3 py-1.5 text-amber-900" data-testid="directions-permission-hint">
                  Location denied — opened map without your start point.
                </div>
              )}
            </div>
          ) : (
            <div className="h-[420px] flex items-center justify-center text-muted-foreground text-sm">Map not configured</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, label, value, href, multiline }) {
  const body = href ? <a href={href} className="text-foreground hover:text-primary transition-colors">{value}</a> : <span className="text-foreground">{value}</span>;
  return (
    <div className="surface-3d tile-3d flex gap-3 items-start rounded-2xl border border-border bg-card p-4">
      <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-primary" strokeWidth={1.75} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">{label}</p>
        <p className={`text-sm font-medium mt-1 ${multiline ? "whitespace-pre-line" : ""}`}>{body}</p>
      </div>
    </div>
  );
}
