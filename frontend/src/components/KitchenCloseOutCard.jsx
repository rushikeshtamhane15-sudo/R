import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ChefHat, CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * KitchenCloseOutCard — iter-59 #9
 *
 * Lets the kitchen lead (or admin) close out the day by entering tiffins
 * dispatched and plates served. Backend reconciles vs QR scans + cash + online
 * and raises a fraud_alert admin notification if the gap exceeds threshold.
 */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function KitchenCloseOutCard({ onSubmitted }) {
  const [date, setDate] = useState(todayISO());
  const [tiffins, setTiffins] = useState("");
  const [plates, setPlates] = useState("");
  const [notes, setNotes] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async (d) => {
    try {
      const r = await api.get(`/kitchen/close-out?date=${d}`);
      setSnapshot(r.data || null);
      if (r.data?.submitted) {
        setTiffins(String(r.data.tiffins_dispatched || ""));
        setPlates(String(r.data.plates_served || ""));
        setNotes(r.data.notes || "");
      } else {
        setTiffins(""); setPlates(""); setNotes("");
      }
    } catch (e) { console.warn("[close-out] load failed", e); }
  };
  useEffect(() => { load(date); }, [date]);

  const submit = async () => {
    const t = parseInt(tiffins, 10);
    if (Number.isNaN(t) || t < 0) { toast.error("Tiffins dispatched must be 0 or more"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/kitchen/close-out", {
        date,
        tiffins_dispatched: t,
        plates_served: parseInt(plates || "0", 10),
        notes: notes.trim(),
      });
      setSnapshot(r.data);
      if (r.data.alert_raised) {
        toast.warning(`Fraud alert raised — gap of ${r.data.delta} units (${r.data.delta_pct}%) between dispatched and scanned`);
      } else {
        toast.success("Close-out saved · reconciliation clean");
      }
      onSubmitted?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSubmitting(false); }
  };

  const suspicious = snapshot?.suspicious || snapshot?.alert_raised;

  return (
    <div className="card-3d p-4 sm:p-5" data-testid="kitchen-closeout-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs tracking-overline uppercase font-bold text-secondary flex items-center gap-1.5">
            <ChefHat className="h-3.5 w-3.5" /> Kitchen daily close-out · #9 anti-fraud
          </p>
          <h2 className="font-display font-extrabold text-lg sm:text-xl mt-1 leading-tight">Reconcile what was dispatched vs what got scanned</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Submit dispatched + served counts. We compare against QR scans + cash collected. If the gap exceeds 3 units or 3% the owner gets a fraud alert.
          </p>
        </div>
      </div>

      <div className="mt-4 grid md:grid-cols-4 gap-3">
        <div>
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Date</label>
          <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="mt-1.5 rounded-xl" data-testid="closeout-date" />
        </div>
        <div>
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Tiffins dispatched</label>
          <Input type="number" min="0" value={tiffins} onChange={(e) => setTiffins(e.target.value)} placeholder="0" className="mt-1.5 rounded-xl tabular-nums" data-testid="closeout-tiffins" />
        </div>
        <div>
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Plates served</label>
          <Input type="number" min="0" value={plates} onChange={(e) => setPlates(e.target.value)} placeholder="0" className="mt-1.5 rounded-xl tabular-nums" data-testid="closeout-plates" />
        </div>
        <div>
          <label className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Notes</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" className="mt-1.5 rounded-xl" data-testid="closeout-notes" />
        </div>
      </div>

      {/* Reconciliation strip */}
      {snapshot && (
        <div className={`mt-4 p-3 sm:p-4 rounded-xl border ${suspicious ? "border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50" : "border-emerald-200 bg-emerald-50/60"}`} data-testid="closeout-recon">
          <div className="flex items-center gap-2.5">
            {suspicious ? (
              <AlertTriangle className="h-4 w-4 text-amber-700" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
            )}
            <p className={`text-xs font-bold ${suspicious ? "text-amber-900" : "text-emerald-900"}`}>
              {suspicious
                ? `Gap of ${snapshot.delta} units (${snapshot.delta_pct}%) — owner has been notified`
                : "Reconciliation clean — dispatched ≈ scanned"}
            </p>
          </div>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <ReconStat label="Dispatched" value={snapshot.tiffins_dispatched ?? "—"} />
            <ReconStat label="Scanned" value={snapshot.scans ?? 0} />
            <ReconStat label="Delta" value={snapshot.delta ?? 0} highlight={suspicious} />
            <ReconStat label="Cash ₹" value={Math.round(snapshot.cash_collected || 0).toLocaleString("en-IN")} />
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button onClick={submit} disabled={submitting} className="rounded-full" data-testid="closeout-submit">
          {submitting ? "Saving…" : (snapshot?.submitted ? "Update close-out" : "Save close-out")}
        </Button>
      </div>
    </div>
  );
}

function ReconStat({ label, value, highlight }) {
  return (
    <div className={`px-2 py-1.5 rounded-lg ${highlight ? "bg-amber-100 text-amber-900" : "bg-white/60 text-foreground"}`}>
      <p className="text-[9px] tracking-overline uppercase font-bold opacity-70">{label}</p>
      <p className="font-display font-extrabold text-sm tabular-nums leading-tight">{value}</p>
    </div>
  );
}
