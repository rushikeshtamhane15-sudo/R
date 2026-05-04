import React from "react";
import { Button } from "../components/ui/button";
import { UtensilsCrossed } from "lucide-react";

export default function Login() {
  const handleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-6 py-16" data-testid="login-page">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-3xl border border-black/5 shadow-xl p-10">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center mb-8">
            <UtensilsCrossed className="h-7 w-7 text-primary-foreground" strokeWidth={1.75} />
          </div>
          <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3">Welcome</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl tracking-tight leading-tight">
            Sign in to your<br />meal pass.
          </h1>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Quick login with your Google account. We'll set up your pass automatically.
          </p>

          <Button
            onClick={handleLogin}
            data-testid="google-login-button"
            className="mt-10 w-full h-12 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base"
          >
            Continue with Google
          </Button>

          <p className="text-xs text-muted-foreground text-center mt-6">
            By continuing you agree to our terms and privacy policy.
          </p>
        </div>
      </div>
    </div>
  );
}
