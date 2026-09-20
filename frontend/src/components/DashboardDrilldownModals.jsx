/* DashboardDrilldownModals — iter-172
 *
 * Two accessible popups triggered by clicking:
 *   • Total Users tile → <TotalUsersModal>
 *   • Active Tiffin tile → <ActiveTiffinModal>
 *
 * Both are scoped server-side (mess-owner sees their branch, super-admin
 * sees platform-wide unless impersonating).
 */
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { X, Loader2, Phone, MapPin, User as UserIcon, Truck, Check } from "lucide-react";
import { Button } from "./ui/button";

function ModalShell({ open, onClose, title, subtitle, children, testid }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3"
      onClick={onClose}
      data-testid={testid}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-border">
          <div>
            <p className="text-[10px] tracking-widest uppercase font-bold text-secondary">{subtitle}</p>
            <h2 className="font-display font-extrabold text-2xl mt-0.5">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-muted/60 text-muted-foreground"
            data-testid="modal-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// -------------------------------------------------- Total users popup
export function TotalUsersModal({ open, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const r = await api.get("/admin/users");
        setRows(r.data?.users || []);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not load users");
      } finally { setLoading(false); }
    })();
  }, [open]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      subtitle="Directory"
      title={`Total users (${rows.length})`}
      testid="modal-total-users"
    >
      {loading && (
        <div className="text-center py-12 text-muted-foreground" data-testid="modal-users-loading">
          <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" /> Loading users…
        </div>
      )}
      {!loading && rows.length === 0 && (
        <p className="text-center py-8 text-muted-foreground text-sm">No users yet.</p>
      )}
      {!loading && rows.length > 0 && (
        <div className="divide-y divide-border" data-testid="modal-users-list">
          {rows.map((u) => (
            <div key={u.user_id} className="py-3 flex items-start gap-3" data-testid={`modal-users-row-${u.user_id}`}>
              <span className="h-10 w-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-extrabold text-sm flex-shrink-0">
                {(u.name || u.phone || "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{u.name || "—"}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  {u.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{u.phone}</span>}
                  {u.email && <span className="truncate">{u.email}</span>}
                  {u.role && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted text-[10px] uppercase font-bold tracking-widest">{u.role}</span>}
                </div>
                {u.address && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1">
                    <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" /><span className="truncate">{u.address}</span>
                  </p>
                )}
              </div>
              <p className="text-[11px] tabular-nums text-muted-foreground shrink-0">₹{Math.round(u.wallet_balance || 0)}</p>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

// -------------------------------------------------- Active tiffin popup
export function ActiveTiffinModal({ open, onClose }) {
  const [state, setState] = useState({ rows: [], count: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const r = await api.get("/admin/active-tiffin-details");
        setState({ rows: r.data?.rows || [], count: r.data?.count || 0 });
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not load tiffin subscribers");
      } finally { setLoading(false); }
    })();
  }, [open]);

  const statusPill = (delivered) => (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${
        delivered
          ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-amber-100 text-amber-700 ring-1 ring-amber-200"
      }`}
    >
      {delivered ? <Check className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
      {delivered ? "Delivered" : "Pending"}
    </span>
  );

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      subtitle="Today's tiffin runs"
      title={`Active tiffin subscribers (${state.count})`}
      testid="modal-active-tiffin"
    >
      {loading && (
        <div className="text-center py-12 text-muted-foreground" data-testid="modal-tiffin-loading">
          <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" /> Loading tiffin runs…
        </div>
      )}
      {!loading && state.rows.length === 0 && (
        <p className="text-center py-8 text-muted-foreground text-sm">No active tiffin subscribers yet.</p>
      )}
      {!loading && state.rows.length > 0 && (
        <div className="divide-y divide-border" data-testid="modal-tiffin-list">
          {state.rows.map((r) => (
            <div key={r.sub_id} className="py-3" data-testid={`modal-tiffin-row-${r.sub_id}`}>
              <div className="flex items-start gap-3">
                <span className="h-10 w-10 rounded-full bg-orange-500/15 text-orange-700 flex items-center justify-center font-extrabold text-sm flex-shrink-0">
                  <UserIcon className="h-5 w-5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{r.plan_name}</p>
                  {r.phone && (
                    <a href={`tel:+91${r.phone}`} className="text-[11px] text-primary inline-flex items-center gap-1 mt-0.5">
                      <Phone className="h-3 w-3" />{r.phone}
                    </a>
                  )}
                  {r.address && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1">
                      <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" /><span>{r.address}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 pl-13">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Lunch:</span>
                {statusPill(r.lunch_delivered)}
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold ml-2">Dinner:</span>
                {statusPill(r.dinner_delivered)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button variant="outline" onClick={onClose} className="rounded-full text-xs">Close</Button>
      </div>
    </ModalShell>
  );
}
