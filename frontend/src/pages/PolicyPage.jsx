import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

function PolicyPage({ contentKey, testId }) {
  const [data, setData] = useState(null);
  useEffect(() => { (async () => { try { const r = await api.get(`/content/${contentKey}`); setData(r.data); } catch {} })(); }, [contentKey]);

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-8 py-12" data-testid={testId}>
      <p className="text-xs tracking-overline uppercase font-bold text-secondary">Information</p>
      <h1 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight mt-3">{data?.title || "—"}</h1>
      {data?.last_updated && <p className="text-xs text-muted-foreground mt-2">Last updated: {data.last_updated}</p>}
      <div className="mt-8 prose-content text-foreground/80 whitespace-pre-wrap">{data?.body || ""}</div>
    </div>
  );
}

export function Privacy() { return <PolicyPage contentKey="privacy" testId="privacy-page" />; }
export function Refund() { return <PolicyPage contentKey="refund" testId="refund-page" />; }
export default PolicyPage;
