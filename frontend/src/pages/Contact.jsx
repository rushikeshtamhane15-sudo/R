import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { MapPin, Phone, Mail, Clock, Building2, Navigation, ChefHat, MessageCircle } from "lucide-react";
import SEO from "../components/SEO";
import MapBrandCaption from "../components/MapBrandCaption";
import ContactMap from "../components/ContactMap";

/**
 * Contact — iter-79 Batch B #5.
 *
 * Location-aware branch directory.
 *   1. Asks for user GPS on mount.
 *   2. Calls /api/messes/nearby?lat&lng → returns active branches sorted by
 *      distance with a `closest_mess_id`.
 *   3. Renders the closest branch's address / phone / WhatsApp / email /
 *      manager / FSSAI / map. Falls back to the CMS /content/contact doc
 *      if location is denied OR no branches are available.
 *
 * If the customer lives in (say) Nagpur and we have a Nagpur branch, they
 * see Nagpur contact details — not Amravati HQ. This is the whole point of
 * the multi-mess architecture.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function digitsOnly(p) { return String(p || "").replace(/\D/g, ""); }

export default function Contact() {
  const [cms, setCms] = useState(null);
  const [branch, setBranch] = useState(null);  // nearest branch (mess doc)
  const [allBranches, setAllBranches] = useState([]);
  const [me, setMe] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load CMS fallback in parallel with location resolve
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await api.get("/content/contact");
        if (!cancel) setCms(r.data);
      } catch { /* ignore */ }
    })();
    return () => { cancel = true; };
  }, []);

  // Resolve nearest branch — iter-97 #4: SPEED.
  // Step 1: use cached lat/lng (localStorage) to resolve INSTANTLY.
  // Step 2: kick off a fresh low-accuracy fix in parallel; if it returns a
  //         different branch, swap silently.
  // Step 3: only fall back to default branch if both fail.
  useEffect(() => {
    let cancel = false;
    const LOC_KEY = "efc_user_geo_v1";

    const resolveNearby = async (lat, lng) => {
      try {
        const r = await api.get(`/messes/nearby?lat=${lat}&lng=${lng}`);
        if (cancel) return false;
        const items = r.data?.messes || [];
        if (items.length) {
          setMe({ lat, lng });
          setAllBranches(items);
          setBranch(items[0]);
          try { localStorage.setItem(LOC_KEY, JSON.stringify({ lat, lng, ts: Date.now() })); } catch { /* no-op */ }
          setLoading(false);
          return true;
        }
      } catch { /* fallthrough */ }
      return false;
    };

    const fallbackToFirst = async () => {
      try {
        const r = await api.get("/messes");
        if (cancel) return;
        const all = r.data?.messes || [];
        setAllBranches(all);
        const def = all.find((m) => m.mess_id === r.data.default_mess_id) || all[0] || null;
        setBranch(def);
      } finally { if (!cancel) setLoading(false); }
    };

    // Step 1 — instant cached resolve
    try {
      const cached = JSON.parse(localStorage.getItem(LOC_KEY) || "null");
      if (cached?.lat != null && cached?.lng != null && (Date.now() - (cached.ts || 0) < 24 * 60 * 60 * 1000)) {
        resolveNearby(cached.lat, cached.lng);
      }
    } catch { /* ignore */ }

    // Step 2 — fresh GPS in background (low accuracy = sub-second response)
    if (!("geolocation" in navigator)) { fallbackToFirst(); return () => { cancel = true; }; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { resolveNearby(pos.coords.latitude, pos.coords.longitude); },
      () => {
        setPermissionDenied(true);
        // Only show fallback if step 1 didn't already populate.
        if (!branch) fallbackToFirst();
        if (!cancel) setLoading(false);
      },
      { enableHighAccuracy: false, timeout: 1500, maximumAge: 10 * 60 * 1000 },
    );
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askDirections = () => {
    if (!branch?.lat || !branch?.lng) return;
    const destLabel = encodeURIComponent(`${branch.name} · ${branch.address}`);
    const openMaps = () => {
      const destCoords = `${branch.lat},${branch.lng}`;
      const origin = me ? `${me.lat},${me.lng}` : "";
      const url = `https://www.google.com/maps/dir/?api=1&destination=${destLabel}&destination_place_id=&travelmode=driving${origin ? `&origin=${origin}` : ""}&dir_action=navigate`;
      const fallback = `https://www.google.com/maps/dir/?api=1&destination=${destCoords}${origin ? `&origin=${origin}` : ""}&travelmode=driving`;
      window.open(url || fallback, "_blank", "noopener,noreferrer");
    };
    openMaps();
  };

  // iter-114: real road distance via OSRM (public, no key needed). The
  // haversine value is the immediate fallback so the pill still renders
  // while OSRM is in-flight (or if it 5xxs). Cached per (branch+rounded
  // user lat/lng) for 5 min so revisits don't re-hit the API.
  // iter-115: we also pull back the route geometry (overview=full + GeoJSON)
  // and render it as a dotted blue polyline on the new Leaflet map.
  // NB: hooks must run on every render — declared BEFORE the early-return
  // below to satisfy React's Rules of Hooks.
  const [roadKm, setRoadKm] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null);
  useEffect(() => {
    if (!me || !branch?.lat || !branch?.lng) { setRoadKm(null); setRouteCoords(null); return; }
    const k = `road:${branch.mess_id || `${branch.lat},${branch.lng}`}:${me.lat.toFixed(3)},${me.lng.toFixed(3)}`;
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const v = JSON.parse(raw);
        if (v?.ts && Date.now() - v.ts < 5 * 60 * 1000 && typeof v.km === "number") {
          setRoadKm(v.km);
          if (Array.isArray(v.route)) setRouteCoords(v.route);
          return;
        }
      }
    } catch { /* ignore */ }
    let cancelled = false;
    const url = `https://router.project-osrm.org/route/v1/driving/${me.lng},${me.lat};${branch.lng},${branch.lat}?overview=full&geometries=geojson`;
    fetch(url, { mode: "cors" })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (cancelled || !j?.routes?.[0]?.distance) return;
        const km = j.routes[0].distance / 1000;
        // GeoJSON coords come back as [lng, lat] — swap for Leaflet's [lat, lng]
        const geom = j.routes[0]?.geometry?.coordinates || [];
        const route = geom.map(([lng, lat]) => [lat, lng]);
        setRoadKm(km);
        setRouteCoords(route);
        try { localStorage.setItem(k, JSON.stringify({ km, route, ts: Date.now() })); } catch { /* quota */ }
      })
      .catch(() => { /* OSRM offline → keep haversine fallback */ });
    return () => { cancelled = true; };
  }, [me, branch?.lat, branch?.lng, branch?.mess_id]);

  if (loading || !branch) return <div className="p-12 text-center text-muted-foreground" data-testid="contact-loading">Loading…</div>;

  const title = cms?.title || "We're a phone call away";
  const overline = cms?.overline || "We're here for you";
  const intro = cms?.intro || "Reach out for orders, support or franchise enquiries — we usually reply within an hour.";
  const hours = cms?.hours || "Mon–Sun · 09:00–22:00 IST";
  const nearestLabel = cms?.nearest_label || "Your nearest branch:";
  const defaultLabel = cms?.default_label || "Showing default branch:";
  const permHint = cms?.perm_hint || "Enable location to auto-pick your nearest branch.";
  const ctaDirections = cms?.cta_directions || "Get directions";
  const labelBranch = cms?.label_branch || "Branch";
  const labelAddress = cms?.label_address || "Address";
  const labelPhone = cms?.label_phone || "Phone";
  const labelWhatsapp = cms?.label_whatsapp || "WhatsApp";
  const whatsappValue = cms?.whatsapp_value || "Chat with us on WhatsApp";
  const labelEmail = cms?.label_email || "Email";
  const labelManager = cms?.label_manager || "Branch manager";
  const labelFssai = cms?.label_fssai || "FSSAI";
  const labelHours = cms?.label_hours || "Hours";
  const distanceKm = (me && branch.lat && branch.lng) ? haversineKm(me.lat, me.lng, branch.lat, branch.lng) : null;
  const effectiveKm = roadKm != null ? roadKm : distanceKm;
  const distanceKmStr = effectiveKm != null ? effectiveKm.toFixed(1) : null;
  // Bike ETA assumes 25 km/h average for Indian city traffic.
  const bikeEtaMin = effectiveKm != null ? Math.max(1, Math.round((effectiveKm / 25) * 60)) : null;
  // Drop the leading "~" once we have a real-road value; keep it for haversine.
  const distancePrefix = roadKm != null ? "" : "~";
  // Map renders inline below via <ContactMap />.

  const phoneDigits = digitsOnly(branch.manager_phone);
  const waLink = phoneDigits ? `https://wa.me/${phoneDigits.startsWith("91") ? phoneDigits : "91" + phoneDigits}` : null;

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-8 py-12" data-testid="contact-page">
      <SEO title="Contact us · branch directory" path="/contact" description={`Reach efoodcare ${branch.city || "support"}. ${branch.address}. Phone: ${branch.manager_phone}.`} />
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">{overline}</p>
      <h1 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight mt-3">{title}</h1>
      <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">{intro}</p>

      {/* Location-aware branch pill */}
      <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/30 px-3 py-1.5" data-testid="contact-branch-pill">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-extrabold text-primary tracking-wide">
          {me ? nearestLabel : defaultLabel} <span className="text-foreground">{branch.name}</span>
          {distanceKmStr && (
            <span className="text-muted-foreground font-semibold ml-2">
              · {distancePrefix}{distanceKmStr} km · ~{bikeEtaMin} min by bike
            </span>
          )}
        </span>
      </div>

      {permissionDenied && (
        <p className="mt-2 text-[11px] text-muted-foreground" data-testid="contact-perm-hint">
          {permHint}
        </p>
      )}

      {/* iter-97 #4: branch picker chips removed — we always show the
          auto-detected nearest branch. No manual override on the consumer side. */}

      <div className="mt-10 grid md:grid-cols-5 gap-6">
        <div className="md:col-span-2 space-y-3">
          <ContactRow icon={Building2} label={labelBranch} value={branch.name} />
          <ContactRow icon={MapPin} label={labelAddress} value={branch.address} multiline />
          <ContactRow icon={Phone} label={labelPhone} value={branch.manager_phone || (cms?.phone)} href={branch.manager_phone ? `tel:${digitsOnly(branch.manager_phone)}` : null} />
          {waLink && (
            <ContactRow icon={MessageCircle} label={labelWhatsapp} value={whatsappValue} href={waLink} />
          )}
          <ContactRow icon={Mail} label={labelEmail} value={branch.manager_email || cms?.email} href={`mailto:${branch.manager_email || cms?.email}`} />
          {branch.manager_name && (
            <ContactRow icon={ChefHat} label={labelManager} value={branch.manager_name} />
          )}
          {branch.fssai_number && (
            <ContactRow icon={Building2} label={labelFssai} value={branch.fssai_number} />
          )}
          <ContactRow icon={Clock} label={labelHours} value={hours} />
        </div>
        <div className="md:col-span-3 surface-3d rounded-2xl overflow-hidden border border-border bg-card" data-testid="contact-map">
          {(branch.lat && branch.lng) ? (
            <div className="relative h-[420px]">
              <ContactMap
                branchLat={branch.lat}
                branchLng={branch.lng}
                meLat={me?.lat}
                meLng={me?.lng}
                routeCoords={routeCoords}
              />
              <button
                type="button"
                onClick={askDirections}
                className="absolute inset-0 z-[300] cursor-pointer bg-transparent focus:outline-none"
                  aria-label={`${ctaDirections} to ${branch.name}`}
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
                    {ctaDirections}
                  </button>
                  {distanceKmStr && (
                    <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur text-foreground text-[11px] sm:text-xs font-semibold px-2.5 py-1 shadow" data-testid="distance-pill">
                      <MapPin className="h-3 w-3 text-primary" />
                      <span className="tabular-nums">{distancePrefix}{distanceKmStr} km · ~{bikeEtaMin} min by bike</span>
                    </span>
                  )}
                </div>
              <MapBrandCaption />
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
                  {branch.city || "efoodcare"}
                </span>
                <span className="absolute -bottom-2 h-1.5 w-12 rounded-full bg-black/45 blur-md" />
              </div>
            </div>
          ) : (
            <div className="h-[420px] flex items-center justify-center text-muted-foreground text-sm">Map not configured for this branch</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, label, value, href, multiline }) {
  if (!value) return null;
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
