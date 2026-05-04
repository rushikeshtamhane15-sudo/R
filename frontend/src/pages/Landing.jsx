import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "../components/ui/button";
import { QrCode, Calendar, ShieldCheck, Utensils, TrendingUp, Smartphone } from "lucide-react";

const HERO_IMG = "https://images.unsplash.com/photo-1600488999806-8efb986d87b1?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwxfHx3YXJtJTIwbW9kZXJuJTIwZGluaW5nJTIwaGFsbHxlbnwwfHx8fDE3Nzc5MjYyMzJ8MA&ixlib=rb-4.1.0&q=85";
const FOOD_IMG = "https://images.unsplash.com/photo-1676300186673-615bcc8d5d68?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTN8MHwxfHNlYXJjaHwyfHxoZWFsdGh5JTIwZ291cm1ldCUyMGx1bmNoJTIwYm93bHxlbnwwfHx8fDE3Nzc5MjYyMjh8MA&ixlib=rb-4.1.0&q=85";
const QR_IMG = "https://images.unsplash.com/photo-1595079836278-25b7ad6d5ddb?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2OTV8MHwxfHNlYXJjaHwxfHxxciUyMGNvZGUlMjBvbiUyMHBob25lJTIwc2NyZWVufGVufDB8fHx8MTc3NzkyNjIzM3ww&ixlib=rb-4.1.0&q=85";

export default function Landing() {
  return (
    <div data-testid="landing-page">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <img src={HERO_IMG} alt="dining hall" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-[hsl(40,25%,96%)]/85"></div>
        </div>
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-28 lg:py-36">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs tracking-overline uppercase font-bold text-secondary mb-6"
          >
            QR • ATTENDANCE • SUBSCRIPTIONS
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="font-display font-extrabold text-4xl sm:text-5xl lg:text-7xl tracking-tight leading-[0.95] max-w-4xl"
          >
            A meal pass that tracks <span className="text-primary">every plate,</span> not just every user.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-8 text-lg max-w-xl text-muted-foreground leading-relaxed"
          >
            30-day passes. 60 meals. One QR. MessPass turns your dining hall into a secure, auditable, subscription-first operation — so the right person gets the right meal, every time.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-10 flex flex-wrap gap-4"
          >
            <Link to="/login" data-testid="hero-cta-start">
              <Button size="lg" className="rounded-full bg-primary hover:bg-primary/90 px-8 h-12 text-base">
                Get your meal pass
              </Button>
            </Link>
            <Link to="/plans" data-testid="hero-cta-plans">
              <Button size="lg" variant="outline" className="rounded-full px-8 h-12 text-base border-black/20">
                View plans
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-28">
        <div className="grid md:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="md:col-span-6">
            <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-4">How it works</p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.05]">
              Two meals a day. One tap at the counter.
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed max-w-lg">
              Subscribe once, get a lifetime-of-pass QR. Staff scans it or you scan the counter — either way, your meal is logged and your balance ticks down.
            </p>
            <div className="mt-10 space-y-6">
              {[
                { icon: Smartphone, t: "Subscribe in seconds", d: "Pay once for 30 days · 60 meals with Stripe." },
                { icon: QrCode, t: "Scan to check in", d: "Show your QR — or scan the counter's. Both work." },
                { icon: ShieldCheck, t: "No duplicates", d: "One meal per slot, per day. Auditable and tamper-proof." },
              ].map((f, i) => (
                <div key={i} className="flex gap-5 items-start">
                  <div className="h-12 w-12 rounded-xl bg-accent flex items-center justify-center shrink-0">
                    <f.icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="font-display font-bold text-lg leading-tight">{f.t}</p>
                    <p className="text-muted-foreground text-sm mt-1">{f.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="md:col-span-6 grid grid-cols-2 gap-4">
            <img src={FOOD_IMG} alt="meal" className="rounded-2xl aspect-[4/5] object-cover w-full border border-black/5" />
            <img src={QR_IMG} alt="qr scan" className="rounded-2xl aspect-[4/5] object-cover w-full border border-black/5 mt-10" />
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="bg-accent/50 border-y border-black/5">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-24">
          <div className="flex flex-wrap justify-between items-end gap-6 mb-12">
            <div>
              <p className="text-xs tracking-overline uppercase font-bold text-secondary mb-3">Built for busy canteens</p>
              <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-5xl tracking-tight max-w-xl leading-[1.05]">
                Everything you need. Nothing you don't.
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Utensils, t: "Daily menu display", d: "Show today's lunch and dinner items — update them once, shown to everyone." },
              { icon: Calendar, t: "30-day subscription", d: "60 meals, 2 per day. Fair. Simple. Transparent." },
              { icon: TrendingUp, t: "Admin analytics", d: "Live attendance trends, revenue, active subscribers — at a glance." },
            ].map((f, i) => (
              <div
                key={i}
                className="bg-card rounded-2xl border border-black/5 p-8 transition-all hover:-translate-y-1 hover:shadow-lg"
                data-testid={`feature-card-${i}`}
              >
                <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <f.icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                </div>
                <p className="font-display font-bold text-xl">{f.t}</p>
                <p className="text-muted-foreground text-sm mt-2 leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20 md:py-24">
        <div className="bg-primary rounded-3xl p-10 md:p-16 flex flex-col md:flex-row items-start md:items-center justify-between gap-8 text-primary-foreground">
          <div>
            <h3 className="font-display font-extrabold text-3xl md:text-4xl lg:text-5xl tracking-tight leading-[1.05]">
              Turn your mess into a membership.
            </h3>
            <p className="mt-4 text-primary-foreground/80 max-w-lg">
              Stop chasing coupons. Start scanning QRs.
            </p>
          </div>
          <Link to="/login" data-testid="cta-footer">
            <Button size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 px-8 h-12 text-base font-bold">
              Start now
            </Button>
          </Link>
        </div>
        <p className="text-center text-muted-foreground text-sm mt-16">© MessPass · Built with care.</p>
      </section>
    </div>
  );
}
