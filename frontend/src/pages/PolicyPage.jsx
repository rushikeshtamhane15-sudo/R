import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import SEO from "../components/SEO";

/**
 * PolicyPage — iter-75 #7 rebuilt to render the structured Privacy +
 * Refund content (sections[], effective_date, intro, contact_block) the
 * backend now ships in DEFAULT_CONTENT. Legacy flat `body` payloads
 * still work for back-compat.
 */
function PolicyPage({ contentKey, testId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const r = await api.get(`/content/${contentKey}`); if (alive) setData(r.data); }
      catch { if (alive) setData({}); }
    })();
    return () => { alive = false; };
  }, [contentKey]);

  if (!data) return <div className="min-h-screen" data-testid={`${testId}-loading`} />;

  const sections = Array.isArray(data.sections) ? data.sections : null;
  const isStructured = !!sections && sections.length > 0;

  return (
    <div className="bg-background min-h-screen" data-testid={testId}>
      <SEO title={`${data.title || ""} · efoodcare`} path={`/${contentKey}`} description={data.intro?.slice(0, 160) || data.title || ""} />
      <header className="bg-gradient-to-br from-primary via-primary/95 to-[#7a1818] text-primary-foreground">
        <div className="max-w-3xl mx-auto px-6 md:px-8 py-10 sm:py-14">
          <p className="text-[10px] sm:text-xs tracking-[0.22em] uppercase font-bold text-secondary" data-testid={`${testId}-overline`}>Information · efoodcare</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl tracking-tight mt-2 leading-[1.05]" data-testid={`${testId}-title`}>
            {data.title || "—"}
          </h1>
          {(data.effective_date || data.last_updated) && (
            <p className="text-[11px] sm:text-xs mt-3 opacity-85" data-testid={`${testId}-effective`}>
              Effective: {data.effective_date || data.last_updated}
            </p>
          )}
          {data.intro && (
            <p className="mt-4 text-[13.5px] sm:text-base leading-relaxed opacity-95 max-w-2xl" data-testid={`${testId}-intro`}>{data.intro}</p>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 md:px-8 py-10 sm:py-14">
        {isStructured ? (
          <div className="space-y-7" data-testid={`${testId}-sections`}>
            {sections.map((s, i) => (
              <section key={i} className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid={`${testId}-section-${i}`}>
                <h2 className="font-display font-extrabold text-lg sm:text-xl text-primary leading-tight">
                  {s.heading}
                </h2>
                <p className="mt-2 text-[13.5px] sm:text-[15px] leading-relaxed text-foreground/85 whitespace-pre-wrap">{s.body}</p>
              </section>
            ))}
            {data.contact_block && (
              <div className="rounded-2xl bg-secondary/10 border border-secondary/30 p-5 sm:p-6" data-testid={`${testId}-contact`}>
                <p className="text-[11px] tracking-[0.22em] uppercase font-bold text-secondary">Contact</p>
                <p className="mt-2 text-[13.5px] sm:text-[15px] leading-relaxed text-foreground/85 whitespace-pre-wrap">{data.contact_block}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="prose-content text-foreground/80 whitespace-pre-wrap text-[14px] leading-relaxed">{data.body || ""}</div>
        )}
      </div>
    </div>
  );
}

export function Privacy() { return <PolicyPage contentKey="privacy" testId="privacy-page" />; }
export function Refund()  { return <PolicyPage contentKey="refund"  testId="refund-page"  />; }
export default PolicyPage;
