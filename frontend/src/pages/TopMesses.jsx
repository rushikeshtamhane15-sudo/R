/**
 * TopMesses — iter-146.
 * Top 5 messes near me (2 km radius) with photos, address, mobile, rating.
 * Subscribers can post a 5-star review. Featured messes pin to slot 1.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Star, MapPin, Phone, Navigation, Building2, Sparkles, Loader2, Send, X, Locate } from "lucide-react";

function StarRow({ value = 0, onChange, size = 4 }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value);
        const cls = `h-${size} w-${size} ${filled ? "text-amber-500 fill-amber-500" : "text-slate-300"}`;
        return onChange ? (
          <button key={n} type="button" onClick={() => onChange(n)} data-testid={`star-${n}`} aria-label={`${n} star`}>
            <Star className={cls} strokeWidth={1.5} />
          </button>
        ) : (
          <Star key={n} className={cls} strokeWidth={1.5} />
        );
      })}
    </div>
  );
}

export default function TopMesses() {
  const { user } = useAuth();
  const [pincode, setPincode] = useState("");
  const [coords, setCoords] = useState(null);
  const [radiusKm, setRadiusKm] = useState(2);
  const [messes, setMesses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reviewFor, setReviewFor] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchMode, setSearchMode] = useState("top-rated");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { radius_km: radiusKm };
      if (coords) { params.lat = coords.lat; params.lng = coords.lng; }
      else if (pincode.trim()) params.pincode = pincode.trim();
      const r = await api.get("/nearby/messes/top5", { params });
      setMesses(r.data?.messes || []);
      setSearchMode(r.data?.search_mode || "top-rated");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to load"); }
    finally { setLoading(false); }
  }, [coords, pincode, radiusKm]);

  useEffect(() => { load(); }, [load]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error("Geolocation unavailable"); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setPincode(""); toast.success("Location captured"); },
      (e) => { toast.error(e.message || "Denied"); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const submitReview = async () => {
    if (!user) { toast.error("Please log in to review"); return; }
    if (!reviewFor) return;
    setSubmitting(true);
    try {
      await api.post(`/messes/${encodeURIComponent(reviewFor.mess_id)}/reviews`, { rating: reviewRating, review: reviewText.trim() });
      toast.success("Review posted");
      setReviewFor(null); setReviewText(""); setReviewRating(5);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Post failed"); }
    finally { setSubmitting(false); }
  };

  const modeLabel = useMemo(() => searchMode === "geo" ? "within 2 km" : searchMode === "pincode" ? `pincode ${pincode}` : "top rated", [searchMode, pincode]);

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5 pb-24" data-testid="top-messes-page">
      <div className="rounded-2xl bg-primary text-white p-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center"><Sparkles className="h-5 w-5" /></div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">Discover</div>
            <div className="text-xl font-extrabold">Top 5 messes near you</div>
            <div className="text-xs text-white/70 mt-0.5">2 km radius · photos, address, rating, contact</div>
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="flex gap-2">
          <Input value={pincode} onChange={(e) => { setPincode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6)); setCoords(null); }}
            placeholder="Enter 6-digit pincode" className="rounded-xl" data-testid="pincode-input" inputMode="numeric" />
          <Button onClick={useMyLocation} variant="outline" className="rounded-xl shrink-0" data-testid="use-location-btn">
            <Locate className="h-4 w-4 mr-1.5" /> My location
          </Button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span data-testid="search-mode-label">Showing {modeLabel}</span>
          {coords && <button onClick={() => setCoords(null)} className="text-primary hover:underline">Clear location</button>}
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="p-10 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div>
      ) : messes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm" data-testid="no-messes">
          <Building2 className="h-9 w-9 mx-auto mb-2 opacity-40" />
          No messes found in this area yet. Try a different pincode or widen radius.
        </div>
      ) : (
        <div className="space-y-3">
          {messes.map((m, idx) => (
            <div key={m.mess_id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden hover:shadow-md transition"
              data-testid={`mess-card-${m.mess_id}`}>
              <div className="flex gap-4 p-4">
                <div className="relative shrink-0">
                  {m.logo_url ? (
                    <img src={m.logo_url} alt="" className="h-20 w-20 rounded-xl object-cover border border-slate-200" />
                  ) : (
                    <div className="h-20 w-20 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Building2 className="h-8 w-8" /></div>
                  )}
                  <div className="absolute -top-1 -left-1 h-6 w-6 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center border-2 border-white">
                    {idx + 1}
                  </div>
                  {m.is_featured && (
                    <div className="absolute -bottom-1 -right-1 rounded-full bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 border-2 border-white uppercase tracking-wider">Featured</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900 truncate">{m.name}</h3>
                    <span className="font-mono text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">{m.mess_id}</span>
                  </div>
                  {m.tagline && <p className="text-xs text-slate-500 truncate mt-0.5">{m.tagline}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <StarRow value={m.avg_rating} />
                    <span className="text-xs text-slate-500">{(m.avg_rating || 0).toFixed(1)} · {m.review_count || 0} review{m.review_count === 1 ? "" : "s"}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{m.city}</span>
                    {m.distance_km !== null && m.distance_km !== undefined && (
                      <span className="inline-flex items-center gap-1 text-primary font-semibold"><Navigation className="h-3 w-3" />{m.distance_km.toFixed(2)} km</span>
                    )}
                    {m.manager_phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{m.manager_phone}</span>}
                  </div>
                  {m.address && <p className="text-[11px] text-slate-500 mt-1.5 line-clamp-2">{m.address}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.manager_phone && (
                      <a href={`tel:${m.manager_phone.replace(/\s+/g, "")}`}
                        className="inline-flex items-center gap-1 rounded-full bg-primary text-white text-xs font-semibold px-3 py-1.5"
                        data-testid={`call-${m.mess_id}`}>
                        <Phone className="h-3 w-3" /> Call
                      </a>
                    )}
                    {m.lat && m.lng && (
                      <a href={`https://maps.google.com/?q=${m.lat},${m.lng}`} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5"
                        data-testid={`map-${m.mess_id}`}>
                        <MapPin className="h-3 w-3" /> Directions
                      </a>
                    )}
                    <Link to="/login" onClick={() => { try { localStorage.setItem("efoodtech.mess.picked", JSON.stringify(m)); } catch {} }}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/30 text-primary text-xs font-semibold px-3 py-1.5"
                      data-testid={`join-${m.mess_id}`}>
                      Join this mess
                    </Link>
                    {user && user.role === "subscriber" && (
                      <button onClick={() => { setReviewFor(m); setReviewRating(5); setReviewText(""); }}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-300 text-amber-700 text-xs font-semibold px-3 py-1.5"
                        data-testid={`review-${m.mess_id}`}>
                        <Star className="h-3 w-3" /> Rate & review
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900" data-testid="promote-card">
        <div className="font-bold flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> Mess owner? Get featured in slot 1.</div>
        <p className="mt-1">Featured messes appear pinned at the top for every user in their area — a proven way to attract new subscribers.</p>
        {user?.role === "franchise_owner" ? (
          <Link to="/mess-owner/settings" className="inline-block mt-2 rounded-full bg-amber-600 text-white text-xs font-semibold px-3 py-1.5">Open owner settings</Link>
        ) : (
          <p className="mt-1 italic text-amber-800">Log in as mess owner to request featuring.</p>
        )}
      </div>

      {/* Review sheet */}
      {reviewFor && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={() => setReviewFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3" data-testid="review-sheet">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">Rate {reviewFor.name}</h3>
              <button onClick={() => setReviewFor(null)}><X className="h-5 w-5 text-slate-500" /></button>
            </div>
            <div className="flex justify-center py-2"><StarRow value={reviewRating} onChange={setReviewRating} size={8} /></div>
            <Textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)}
              placeholder="Tell others about your experience…" rows={4} data-testid="review-text-input" />
            <Button onClick={submitReview} disabled={submitting}
              className="w-full rounded-xl bg-primary hover:bg-primary/90 text-white h-11" data-testid="submit-review-btn">
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Post review
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
