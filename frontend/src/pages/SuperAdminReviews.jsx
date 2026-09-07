/**
 * SuperAdminReviews — iter-147 · review moderation inbox.
 * Super-admin can hide / unhide any review. Hidden reviews drop out of
 * public listings AND the mess's rolling avg gets recomputed.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Star, Shield, MessageSquare } from "lucide-react";

export default function SuperAdminReviews() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("visible"); // visible | hidden | all
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter === "visible") params.hidden = false;
      if (filter === "hidden") params.hidden = true;
      const r = await api.get("/admin/reviews", { params });
      setRows(r.data?.reviews || []);
    } catch (e) { toast.error(e?.response?.data?.detail || "Load failed"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;

  const toggleHidden = async (row) => {
    setBusy(row.review_id);
    try {
      const r = await api.post(`/admin/reviews/${row.review_id}/toggle-hidden`);
      toast.success(r.data?.hidden ? "Hidden" : "Restored");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(null); }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5" data-testid="super-admin-reviews">
      <div className="rounded-2xl bg-primary text-white p-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center"><Shield className="h-5 w-5" /></div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">Super Admin</div>
            <div className="text-xl font-extrabold">Review moderation</div>
            <div className="text-xs text-white/70 mt-0.5">Hide abusive or fake reviews. Aggregate ratings recompute automatically.</div>
          </div>
        </div>
      </div>

      <div className="flex gap-2" data-testid="filter-tabs">
        {[
          { id: "visible", label: "Visible" },
          { id: "hidden", label: "Hidden" },
          { id: "all", label: "All" },
        ].map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${filter === f.id ? "bg-primary text-white" : "bg-slate-100 text-slate-700"}`}
            data-testid={`filter-${f.id}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-10 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-slate-500 text-sm" data-testid="no-reviews">
          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" /> No reviews here.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.review_id} className={`rounded-2xl border p-4 ${r.hidden ? "bg-slate-50 border-slate-200 opacity-70" : "bg-white border-slate-200"}`}
              data-testid={`review-row-${r.review_id}`}>
              <div className="flex items-start gap-3">
                {r.user_picture ? (
                  <img src={r.user_picture} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                    {(r.user_name || "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">{r.user_name || "Anonymous"}</span>
                    <div className="flex items-center gap-0.5">
                      {[1,2,3,4,5].map((n) => (
                        <Star key={n} className={`h-3.5 w-3.5 ${n <= r.rating ? "text-amber-500 fill-amber-500" : "text-slate-300"}`} strokeWidth={1.5} />
                      ))}
                    </div>
                    <span className="text-[10px] text-slate-500">→ {r.mess_name} <span className="font-mono">({r.mess_id})</span></span>
                  </div>
                  {r.review && <p className="text-sm text-slate-700 mt-1.5">{r.review}</p>}
                  <div className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-2">
                    <span>{r.created_at?.slice(0, 16).replace("T", " ")}</span>
                    {r.hidden && <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 font-semibold uppercase tracking-widest text-[9px]">Hidden</span>}
                  </div>
                </div>
                <Button size="sm" variant="outline"
                  onClick={() => toggleHidden(r)} disabled={busy === r.review_id}
                  className="rounded-xl shrink-0"
                  data-testid={`toggle-${r.review_id}`}>
                  {busy === r.review_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (r.hidden ? (<><Eye className="h-3.5 w-3.5 mr-1" /> Restore</>) : (<><EyeOff className="h-3.5 w-3.5 mr-1" /> Hide</>))}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
