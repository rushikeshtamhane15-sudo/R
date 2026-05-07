import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { MapPin, Phone, Mail, Clock, Building2 } from "lucide-react";

export default function Contact() {
  const [data, setData] = useState(null);
  useEffect(() => { (async () => { try { const r = await api.get("/content/contact"); setData(r.data); } catch {} })(); }, []);
  if (!data) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-8 py-12" data-testid="contact-page">
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
        <div className="md:col-span-3 rounded-2xl overflow-hidden border border-border bg-card shadow-sm" data-testid="contact-map">
          {data.map_embed_src ? (
            <iframe
              title="efoodcare location"
              src={data.map_embed_src}
              className="w-full h-[420px] border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
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
    <div className="flex gap-3 items-start rounded-2xl border border-border bg-card p-4">
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
