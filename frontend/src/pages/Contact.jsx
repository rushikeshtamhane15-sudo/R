import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { MapPin, Phone, Mail, Clock, Building2 } from "lucide-react";
import SEO from "../components/SEO";
import MapBrandCaption from "../components/MapBrandCaption";

export default function Contact() {
  const [data, setData] = useState(null);
  const [kitchen, setKitchen] = useState(null);
  useEffect(() => {
    (async () => {
      try { const r = await api.get("/content/contact"); setData(r.data); } catch {}
      try { const r2 = await api.get("/kitchen-location"); setKitchen(r2.data || null); } catch {}
    })();
  }, []);
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
              <MapBrandCaption />
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
