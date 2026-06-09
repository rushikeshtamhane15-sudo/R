/**
 * BranchContact — iter-78 #3.
 * Public per-mess contact page. Reads /api/messes/:slug and shows the
 * branch name, address, phone, email + an embedded Google Maps view.
 *
 * URL: /branch/efoodcare-amravati  (or any active mess slug)
 */
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import SEO from "../components/SEO";
import { MapPin, Phone, Mail, ChefHat, ArrowRight, Navigation } from "lucide-react";

export default function BranchContact() {
  const { slug } = useParams();
  const [m, setM] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/messes/${slug}`)
      .then((r) => { if (alive) setM(r.data || {}); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [slug]);

  if (err) return (
    <div className="min-h-[60vh] flex items-center justify-center bg-background" data-testid="branch-not-found">
      <div className="text-center">
        <p className="font-display font-extrabold text-2xl">Branch not found</p>
        <Link to="/contact" className="inline-flex items-center gap-1.5 mt-3 text-primary font-bold text-sm" data-testid="branch-not-found-back">
          <ArrowRight className="h-4 w-4 rotate-180" /> All branches
        </Link>
      </div>
    </div>
  );
  if (!m) return <div className="min-h-[60vh]" data-testid="branch-loading" />;

  const hasGeo = m.lat && m.lng;
  const mapsEmbed = hasGeo
    ? `https://www.google.com/maps?q=${m.lat},${m.lng}&z=16&output=embed`
    : `https://www.google.com/maps?q=${encodeURIComponent((m.address || "") + " " + (m.city || ""))}&output=embed`;
  const askDirections = () => {
    if (hasGeo) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${m.name} · ${m.address}`)}&destination_place_id=&travelmode=driving&dir_action=navigate`, "_blank", "noopener,noreferrer");
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${m.name} ${m.address} ${m.city}`)}`, "_blank", "noopener,noreferrer");
    }
  };
  const callPhone = (m.manager_phone || "").replace(/\s/g, "");
  const isFranchise = !!m.is_franchise;

  return (
    <div className="bg-background min-h-screen" data-testid="branch-contact-page">
      <SEO title={`${m.name} · contact & directions`} path={`/branch/${slug}`} description={`Visit ${m.name} at ${m.address}. Call ${m.manager_phone}.`} />

      {/* === Hero === */}
      <header className={`text-white ${isFranchise ? "bg-gradient-to-br from-fuchsia-700 via-fuchsia-800 to-fuchsia-900" : "bg-gradient-to-br from-primary via-primary/95 to-[#7a1818]"}`}>
        <div className="max-w-3xl mx-auto px-5 py-8 sm:py-12">
          <p className="text-[10px] tracking-[0.22em] uppercase font-bold opacity-85" data-testid="branch-overline">
            {isFranchise ? "Franchise partner branch" : "efoodcare branch"} · {m.city}
          </p>
          <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-2 leading-tight" data-testid="branch-name">{m.name}</h1>
          {m.tagline && <p className="mt-3 text-base sm:text-lg opacity-90" data-testid="branch-tagline">{m.tagline}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            {callPhone && (
              <a href={`tel:${callPhone}`} data-testid="branch-call-btn" className="inline-flex items-center gap-2 rounded-full bg-white text-foreground px-4 h-11 font-extrabold text-sm hover:-translate-y-0.5 transition-transform">
                <Phone className="h-4 w-4" /> Call {m.manager_phone}
              </a>
            )}
            <button type="button" onClick={askDirections} data-testid="branch-directions-btn" className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur text-white border border-white/30 px-4 h-11 font-extrabold text-sm hover:bg-white/25">
              <Navigation className="h-4 w-4" /> Get directions
            </button>
          </div>
        </div>
      </header>

      {/* === Map === */}
      <section className="max-w-3xl mx-auto px-5 mt-6">
        <div className="rounded-2xl overflow-hidden border border-border bg-card aspect-[16/12] sm:aspect-[16/9]" data-testid="branch-map">
          <iframe
            title={`${m.name} map`}
            src={mapsEmbed}
            className="w-full h-full"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>
      </section>

      {/* === Details === */}
      <section className="max-w-3xl mx-auto px-5 py-8 grid sm:grid-cols-2 gap-3" data-testid="branch-details">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-primary font-extrabold mb-2">
            <MapPin className="h-4 w-4" /> Address
          </div>
          <p className="text-sm leading-relaxed text-foreground/85">{m.address}, {m.city} {m.state} {m.pincode}</p>
        </div>
        {m.manager_phone && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-primary font-extrabold mb-2">
              <Phone className="h-4 w-4" /> Phone
            </div>
            <a href={`tel:${callPhone}`} className="text-sm font-bold tabular-nums hover:text-primary" data-testid="branch-detail-phone">{m.manager_phone}</a>
          </div>
        )}
        {m.manager_email && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-primary font-extrabold mb-2">
              <Mail className="h-4 w-4" /> Email
            </div>
            <a href={`mailto:${m.manager_email}`} className="text-sm font-bold hover:text-primary" data-testid="branch-detail-email">{m.manager_email}</a>
          </div>
        )}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-primary font-extrabold mb-2">
            <ChefHat className="h-4 w-4" /> Manager
          </div>
          <p className="text-sm font-bold">{m.manager_name || "—"}</p>
          {m.fssai_number && <p className="text-[11px] text-muted-foreground mt-0.5">FSSAI {m.fssai_number}</p>}
        </div>
      </section>
    </div>
  );
}
