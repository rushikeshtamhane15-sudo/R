import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Quote, Star } from "lucide-react";

export default function TestimonialsSection() {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get("/testimonials")
      .then((r) => setItems(r.data?.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  if (items.length === 0) return null;

  return (
    <section className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16 md:py-20" data-testid="testimonials-section">
      <div className="max-w-2xl">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Loved by 1000+ subscribers</p>
        <h2 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl tracking-tight mt-2 leading-[1.05]">
          What our subscribers say
        </h2>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          Hear from the families and professionals who eat <i>ghar se achha khana</i> with us every day.
        </p>
      </div>

      <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((t) => (
          <article
            key={t.id}
            className="rounded-3xl border border-border bg-card p-6 flex flex-col gap-4 hover:shadow-lg transition-shadow"
            data-testid={`testimonial-${t.id}`}
          >
            <Quote className="h-7 w-7 text-primary opacity-30" strokeWidth={1.5} />
            <p className="font-display text-lg leading-snug flex-1 text-foreground">
              "{t.quote}"
            </p>
            <div className="flex items-center gap-3 pt-3 border-t border-border">
              {t.image_url ? (
                <img
                  src={t.image_url}
                  alt={t.name}
                  className="h-11 w-11 rounded-full object-cover bg-muted"
                  loading="lazy"
                />
              ) : (
                <span className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-display font-extrabold text-lg">
                  {(t.name || "?").trim().charAt(0).toUpperCase()}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{t.name}</p>
                {t.role && <p className="text-xs text-muted-foreground truncate">{t.role}</p>}
              </div>
              {t.rating && (
                <div className="flex gap-0.5" aria-label={`${t.rating} stars`}>
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" strokeWidth={0} />
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
