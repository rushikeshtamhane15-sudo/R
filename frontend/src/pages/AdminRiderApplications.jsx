import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Bike, Check, X, Clock, IdCard, Building, Phone } from "lucide-react";

const STATUS = ["pending", "approved", "rejected", "all"];

export default function AdminRiderApplications() {
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    try {
      const r = await api.get(`/admin/rider-applications?status=${filter}`);
      setRows(r.data?.applications || []);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not load applications"); }
  };
  useEffect(() => { load(); }, [filter]);

  const decide = async (app, decision) => {
    if (decision === "reject" && !window.confirm(`Reject ${app.full_name}'s rider application?`)) return;
    setBusy(app.application_id);
    try {
      await api.post(`/admin/rider-applications/${app.application_id}/decide`, { decision });
      toast.success(`Application ${decision === "approve" ? "approved · user is now a rider" : "rejected"}`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5" data-testid="admin-rider-applications">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-2xl tracking-tight flex items-center gap-2">
            <Bike className="h-6 w-6 text-primary" /> Rider applications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Review self-service rider sign-ups. Approving promotes the user instantly.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS.map((s) => (
            <Button
              key={s}
              variant={filter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(s)}
              className="rounded-full capitalize text-xs"
              data-testid={`filter-${s}`}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No applications in <b>{filter}</b>.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.application_id} className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid={`app-row-${a.application_id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display font-extrabold text-lg">{a.full_name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" /> {a.phone} · <Building className="h-3 w-3" /> {a.city}</p>
                  <p className="font-mono text-[11px] text-muted-foreground mt-1">{a.application_id}</p>
                </div>
                <span className={`text-[10px] uppercase tracking-overline font-bold px-2 py-1 rounded-full ${
                  a.status === "approved" ? "bg-emerald-100 text-emerald-800" :
                  a.status === "rejected" ? "bg-rose-100 text-rose-800" :
                  "bg-amber-100 text-amber-800"
                }`}>{a.status}</span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 text-sm">
                <div>
                  <dt className="text-[10px] uppercase tracking-overline font-bold text-muted-foreground flex items-center gap-1"><IdCard className="h-3 w-3" /> Licence</dt>
                  <dd className="font-mono text-xs mt-0.5">{a.licence_no}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-overline font-bold text-muted-foreground">Bike #</dt>
                  <dd className="font-mono text-xs mt-0.5">{a.bike_number}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-overline font-bold text-muted-foreground">Bank a/c last 4</dt>
                  <dd className="font-mono text-xs mt-0.5">**** {a.bank_acc_last4}</dd>
                </div>
              </dl>

              <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1"><Clock className="h-3 w-3" /> Submitted {new Date(a.created_at).toLocaleString("en-IN")}</p>

              {a.status === "pending" && (
                <div className="flex gap-2 mt-4">
                  <Button
                    onClick={() => decide(a, "approve")}
                    disabled={busy === a.application_id}
                    size="sm"
                    className="rounded-full bg-emerald-600 hover:bg-emerald-700"
                    data-testid={`approve-${a.application_id}`}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                  <Button
                    onClick={() => decide(a, "reject")}
                    disabled={busy === a.application_id}
                    variant="outline"
                    size="sm"
                    className="rounded-full text-rose-700 border-rose-300 hover:bg-rose-50"
                    data-testid={`reject-${a.application_id}`}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
