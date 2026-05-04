import React, { useEffect, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export default function PaymentSuccess() {
  const location = useLocation();
  const [status, setStatus] = useState("polling"); // polling, paid, failed, timeout
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) { setStatus("failed"); return; }
    let active = true;
    const maxAttempts = 8;
    const poll = async (n) => {
      if (!active) return;
      setAttempts(n);
      if (n >= maxAttempts) { setStatus("timeout"); return; }
      try {
        const r = await api.get(`/checkout/status/${sessionId}`);
        if (r.data.payment_status === "paid") { setStatus("paid"); return; }
        if (r.data.status === "expired") { setStatus("failed"); return; }
      } catch {}
      setTimeout(() => poll(n + 1), 2000);
    };
    poll(0);
    return () => { active = false; };
  }, [location.search]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-10" data-testid="payment-success-page">
      <div className="w-full max-w-md text-center bg-card rounded-3xl border border-black/5 shadow-xl p-10">
        {status === "polling" && (
          <>
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto" strokeWidth={1.5} />
            <h1 className="font-display font-extrabold text-2xl mt-6">Confirming your payment…</h1>
            <p className="text-muted-foreground text-sm mt-2">Attempt {attempts + 1}</p>
          </>
        )}
        {status === "paid" && (
          <>
            <CheckCircle2 className="h-14 w-14 text-primary mx-auto" strokeWidth={1.5}/>
            <h1 className="font-display font-extrabold text-2xl mt-6">You're all set!</h1>
            <p className="text-muted-foreground mt-2">Your meal pass is active. Time to eat.</p>
            <Link to="/dashboard"><Button className="mt-8 rounded-full bg-primary hover:bg-primary/90" data-testid="go-to-dashboard-button">Go to dashboard</Button></Link>
          </>
        )}
        {(status === "failed" || status === "timeout") && (
          <>
            <XCircle className="h-14 w-14 text-destructive mx-auto" strokeWidth={1.5}/>
            <h1 className="font-display font-extrabold text-2xl mt-6">Payment not confirmed</h1>
            <p className="text-muted-foreground mt-2">{status === "timeout" ? "Taking longer than expected. Check your dashboard shortly." : "Please try again."}</p>
            <Link to="/plans"><Button className="mt-8 rounded-full" data-testid="retry-plans-button">Back to plans</Button></Link>
          </>
        )}
      </div>
    </div>
  );
}
