import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import QRTicket from "../components/QRTicket";
import { Button } from "../components/ui/button";
import { Utensils, Moon, Sun, Clock, Wallet, Pause, IndianRupee } from "lucide-react";

function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

export default function SubscriberDashboard() {
  const { user } = useAuth();
  const [sub, setSub] = useState(null);
  const [walletInfo, setWalletInfo] = useState(null);
  const [qr, setQr] = useState(null);
  const [menu, setMenu] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [s, w, q, m, h] = await Promise.all([
        api.get("/my/subscription"),
        api.get("/my/wallet"),
        api.get("/my/qr"),
        api.get("/menu/today"),
        api.get("/my/attendance"),
      ]);
      setSub(s.data.subscription);
      setWalletInfo(w.data);
      setQr(q.data);
      setMenu(m.data);
      setHistory(h.data.attendance || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todaysRecords = history.filter((r) => r.date_str === today);
  const lunchDone = todaysRecords.some((r) => r.meal_type === "lunch");
  const dinnerDone = todaysRecords.some((r) => r.meal_type === "dinner");
  const daysLeft = sub ? Math.max(0, Math.ceil((new Date(sub.end_date) - new Date()) / (1000 * 60 * 60 * 24))) : 0;
  const mealsLeft = sub ? sub.meals_total - sub.meals_used : 0;

  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading your e-Meal Pass…</div>;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-8 lg:px-12 py-10" data-testid="subscriber-dashboard">
      <div className="mb-10" data-testid="subscription-status">
        <p className="text-xs tracking-overline uppercase font-bold text-secondary">Hello, {user?.name?.split(" ")[0]}</p>
        <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight mt-2">Your e-Meal Pass</h1>
        <p className="text-muted-foreground text-sm mt-1 italic">ghar se achha khana</p>
      </div>

      <div className="grid lg:grid-cols-5 gap-8">
        <div className="lg:col-span-3">
          <QRTicket
            token={qr?.qr_token}
            userName={qr?.user_name || user?.name}
            mealsLeft={sub ? mealsLeft : 0}
            mealsTotal={sub ? sub.meals_total : 0}
            daysLeft={daysLeft}
            planName={sub ? sub.plan_name : "No active plan"}
          />

          {!sub && (
            <div className="mt-6 bg-secondary/10 border border-secondary/20 rounded-2xl p-6 text-center" data-testid="no-sub-banner">
              <p className="font-display font-bold text-lg">You don't have an active e-Meal Pass</p>
              <p className="text-sm text-muted-foreground mt-1">Grab a plan to start eating ghar-jaisa khana.</p>
              <Link to="/plans">
                <Button className="mt-4 rounded-full bg-secondary hover:bg-secondary/90" data-testid="get-plan-button">Choose a plan</Button>
              </Link>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          {/* Wallet card */}
          {sub && (
            <div className="bg-primary text-primary-foreground rounded-2xl p-6" data-testid="wallet-card">
              <div className="flex items-center justify-between">
                <Wallet className="h-5 w-5 text-primary-foreground/70" strokeWidth={1.75} />
                <span className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">Wallet</span>
              </div>
              <p className="font-display font-extrabold text-5xl mt-3 leading-none flex items-baseline" data-testid="wallet-balance">
                <IndianRupee className="h-7 w-7" strokeWidth={2} />
                <span>{Math.round(sub.wallet_balance).toLocaleString("en-IN")}</span>
              </p>
              <p className="text-xs text-primary-foreground/80 mt-3">of ₹{Math.round(sub.amount_paid).toLocaleString("en-IN")} loaded</p>
              <div className="mt-5 pt-5 border-t border-white/15 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70">Per day</p>
                  <p className="font-display font-bold text-lg mt-1">₹{Math.round(sub.per_day_amount)}</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-overline uppercase font-bold text-primary-foreground/70 flex items-center gap-1"><Pause className="h-3 w-3" /> Paused</p>
                  <p className="font-display font-bold text-lg mt-1" data-testid="paused-days">{sub.paused_days} days</p>
                </div>
              </div>
              <p className="text-xs text-primary-foreground/70 mt-4">Skip 3+ days in a row → wallet pauses & your plan auto-extends.</p>
            </div>
          )}

          {/* Today's status */}
          <div className="bg-card rounded-2xl border border-black/5 p-6" data-testid="status-card">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today</p>
            <div className="mt-4 space-y-3">
              <StatusRow icon={Sun} label="Lunch" done={lunchDone} />
              <StatusRow icon={Moon} label="Dinner" done={dinnerDone} />
            </div>
            <Link to="/self-scan">
              <Button className="mt-5 w-full rounded-full bg-primary hover:bg-primary/90" data-testid="self-scan-cta">Scan counter QR</Button>
            </Link>
          </div>

          {/* Menu */}
          <div className="bg-card rounded-2xl border border-black/5 p-6" data-testid="todays-menu">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Today's menu</p>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm font-display font-bold flex items-center gap-2"><Sun className="h-4 w-4 text-secondary" strokeWidth={1.75} /> Lunch</p>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{menu?.lunch_items?.join(" · ")}</p>
              </div>
              <div>
                <p className="text-sm font-display font-bold flex items-center gap-2"><Moon className="h-4 w-4 text-primary" strokeWidth={1.75} /> Dinner</p>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{menu?.dinner_items?.join(" · ")}</p>
              </div>
            </div>
          </div>

          {/* History */}
          <div className="bg-card rounded-2xl border border-black/5 p-6" data-testid="history-card">
            <p className="text-xs tracking-overline uppercase font-bold text-muted-foreground">Recent check-ins</p>
            <div className="mt-4 space-y-3 max-h-56 overflow-auto">
              {history.length === 0 && <p className="text-sm text-muted-foreground">No check-ins yet.</p>}
              {history.slice(0, 10).map((r) => (
                <div key={r.att_id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {r.meal_type === "lunch" ? <Sun className="h-4 w-4 text-secondary" strokeWidth={1.75} /> : <Moon className="h-4 w-4 text-primary" strokeWidth={1.75} />}
                    <span className="capitalize font-medium">{r.meal_type}</span>
                    <span className="text-muted-foreground text-xs">· {r.date_str}</span>
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{formatTime(r.checked_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ icon: Icon, label, done }) {
  return (
    <div className={`flex items-center justify-between rounded-xl px-4 py-3 border ${done ? "bg-primary/10 border-primary/20" : "bg-muted/50 border-border"}`}>
      <div className="flex items-center gap-3">
        <Icon className={`h-4 w-4 ${done ? "text-primary" : "text-muted-foreground"}`} strokeWidth={1.75} />
        <span className="font-semibold text-sm">{label}</span>
      </div>
      <span className={`text-xs font-bold tracking-overline uppercase ${done ? "text-primary" : "text-muted-foreground"}`}>{done ? "Checked in" : "Pending"}</span>
    </div>
  );
}
