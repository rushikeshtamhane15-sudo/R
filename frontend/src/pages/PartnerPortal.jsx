/**
 * PartnerPortal — iter-81 #1.
 * A dedicated franchise/partner entry point at /partners.
 *
 * Behaviour:
 *  • Not logged in        → shows a purple-themed marketing + login funnel
 *                            (login button pushes /login?next=/partners)
 *  • Logged in subscriber → "You're not a franchise partner yet — apply here"
 *  • franchise_owner       → auto-redirects to /admin/control-tower (their dashboard)
 *  • admin                 → can browse /partners as a preview / impersonation
 *
 * Pair this with DNS — point `partners.efoodcare.in` at the same hosting and
 * its index hits /partners automatically. No backend change required.
 */
import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import {
  Building2, BarChart3, Users, ShieldCheck, ArrowRight, ChefHat, MapPin,
  Phone, Mail, Sparkles, Receipt, Power,
} from "lucide-react";

export default function PartnerPortal() {
  const { user, logout } = useAuth();
  // iter-92 #1: PartnerPortal is now the franchise owner's HOME (mounted at "/").
  // The legacy auto-redirect to /admin/control-tower has been removed so the
  // page stays visible. CTAs in the hero handle "Open dashboard" intent.

  return (
    <div className="min-h-screen text-white" data-testid="partner-portal" style={{
      background: "linear-gradient(135deg, #2a0f3a 0%, #3d1854 38%, #6a2898 100%)",
    }}>
      {/* === Top bar — branded for partners (purple, distinct from main efoodcare red) === */}
      <header className="border-b border-white/10 backdrop-blur" data-testid="partner-header">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-500 shrink-0">
              <Building2 className="h-4 w-4 text-white" />
            </span>
            <div className="min-w-0">
              <p className="font-display font-extrabold text-base sm:text-xl leading-none truncate">efoodcare · Partners</p>
              <p className="text-[9px] sm:text-[10px] tracking-[0.18em] uppercase font-semibold opacity-80 mt-0.5 truncate">Franchise &amp; branch portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {user ? (
              <>
                <span className="hidden sm:inline text-[11px] opacity-85" data-testid="partner-current-user">{user.name || user.phone}</span>
                <button type="button" onClick={logout} data-testid="partner-logout" className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 px-3 h-9 text-xs font-extrabold">
                  <Power className="h-3.5 w-3.5" /> Log out
                </button>
              </>
            ) : (
              <Link to="/login?next=%2Fpartners" data-testid="partner-login-btn-top" className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-500 hover:bg-fuchsia-400 text-white px-4 h-9 text-xs font-extrabold">
                Partner login <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* === Hero === */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <p className="text-[10px] sm:text-xs tracking-[0.22em] uppercase font-bold text-fuchsia-300" data-testid="partner-overline">Run your own efoodcare kitchen</p>
        <h1 className="font-display font-extrabold text-3xl sm:text-5xl lg:text-6xl tracking-tight mt-2 sm:mt-3 leading-[1.05] max-w-3xl" data-testid="partner-headline">
          The franchise portal where you see <em className="not-italic italic text-fuchsia-300">only your branch.</em>
        </h1>
        <p className="mt-4 text-sm sm:text-lg max-w-2xl opacity-90 leading-relaxed" data-testid="partner-lede">
          Run your efoodcare franchise like an independent business with the support of our platform. Track subscribers, attendance, revenue and kitchen utilisation — scoped strictly to your branch. No customer data from other branches, no platform-wide settings to worry about.
        </p>

        <div className="mt-7 flex flex-wrap gap-2.5">
          {user?.role === "franchise_owner" ? (
            <>
              <Link to="/admin" data-testid="partner-go-dashboard" className="inline-flex items-center gap-2 rounded-full bg-white text-fuchsia-700 px-5 h-12 font-extrabold text-sm hover:-translate-y-0.5 transition-transform">
                Open your dashboard <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/admin/control-tower" data-testid="partner-go-control" className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur border border-white/25 text-white px-5 h-12 font-extrabold text-sm hover:bg-white/25">
                Control Tower
              </Link>
            </>
          ) : user?.role === "admin" ? (
            <Link to="/admin/messes" data-testid="partner-admin-cta" className="inline-flex items-center gap-2 rounded-full bg-white text-fuchsia-700 px-5 h-12 font-extrabold text-sm">
              Manage all branches <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link to="/login?next=%2Fpartners" data-testid="partner-login-cta" className="inline-flex items-center gap-2 rounded-full bg-white text-fuchsia-700 px-5 h-12 font-extrabold text-sm hover:-translate-y-0.5 transition-transform">
                Partner login <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="mailto:hello@efoodcare.in?subject=Franchise%20application" data-testid="partner-apply-cta" className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur border border-white/25 text-white px-5 h-12 font-extrabold text-sm hover:bg-white/25">
                Apply to franchise
              </a>
            </>
          )}
        </div>

        {user && user.role !== "franchise_owner" && user.role !== "admin" && (
          <div className="mt-6 rounded-2xl bg-white/10 backdrop-blur border border-white/15 p-4 max-w-2xl" data-testid="partner-not-yet">
            <p className="text-xs sm:text-sm">
              You&apos;re logged in as <strong>{user.name || user.phone}</strong> (role: {user.role}) — not a franchise partner yet.
              Apply via email above or ask the efoodcare admin to assign you to a branch.
            </p>
          </div>
        )}
      </section>

      {/* === Feature tiles === */}
      <section className="border-y border-white/10 bg-black/15" data-testid="partner-features">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <p className="text-[10px] tracking-[0.22em] uppercase font-bold text-fuchsia-300">What you get</p>
          <h2 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-2 leading-tight max-w-2xl">Every metric an independent restaurant owner needs.</h2>
          <div className="mt-7 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {[
              { icon: Users,       title: "Subscribers",       body: "See how many active subscribers your branch has, plus all-time signups." },
              { icon: Receipt,     title: "Revenue",           body: "Track subscription revenue + walk-in order revenue separately, with 7/30/90-day windows." },
              { icon: BarChart3,   title: "Attendance + utilisation", body: "QR check-ins per day, sparkline of activity, kitchen utilisation vs daily capacity." },
              { icon: ChefHat,     title: "Daily menu calendar",body: "Edit YOUR branch's daily lunch + dinner menu. Customers in your area see only your menu." },
              { icon: Sparkles,    title: "Walk-in wall kiosk", body: "Self-order kiosk with thermal printing + Paytm/Razorpay UPI QR — same hardware support as the main brand." },
              { icon: ShieldCheck, title: "Strict data isolation", body: "You see ONLY your branch's data. Customers and orders from other branches are invisible to you." },
            ].map((f, i) => (
              <div key={i} className="rounded-2xl bg-white/10 backdrop-blur border border-white/15 p-4 sm:p-5" data-testid={`partner-feature-${i}`}>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-500/30 mb-2.5">
                  <f.icon className="h-4 w-4" />
                </span>
                <p className="font-display font-extrabold text-base leading-tight">{f.title}</p>
                <p className="text-[12.5px] sm:text-sm mt-1.5 leading-relaxed opacity-85">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === Contact strip === */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12" data-testid="partner-contact-strip">
        <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/15 p-5 sm:p-6 grid sm:grid-cols-3 gap-3">
          <a href="tel:+919175560211" className="flex items-center gap-2.5 hover:opacity-80" data-testid="partner-call">
            <Phone className="h-4 w-4 text-fuchsia-300" /> <span className="text-sm font-bold tabular-nums">+91 91755 60211</span>
          </a>
          <a href="mailto:hello@efoodcare.in" className="flex items-center gap-2.5 hover:opacity-80" data-testid="partner-email">
            <Mail className="h-4 w-4 text-fuchsia-300" /> <span className="text-sm font-bold">hello@efoodcare.in</span>
          </a>
          <Link to="/contact" className="flex items-center gap-2.5 hover:opacity-80" data-testid="partner-hq">
            <MapPin className="h-4 w-4 text-fuchsia-300" /> <span className="text-sm font-bold">efoodcare HQ · Amravati</span>
          </Link>
        </div>
        <p className="mt-4 text-[11px] opacity-70 max-w-2xl">
          By using this portal you agree to the efoodcare partner agreement.
          Customers continue to access the main brand at efoodcare.in — this portal is operations-only.
        </p>
      </section>
    </div>
  );
}
