import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "../components/ui/button";
import SEO from "../components/SEO";
import { Building2, ShieldCheck, Users, Rocket, Heart, MapPin, PhoneCall, Mail, Sparkles } from "lucide-react";

export default function AboutUs() {
  return (
    <div className="bg-white" data-testid="about-page">
      <SEO title="About · efoodtech" path="/about"
        description="efoodtech is India's multi-tenant SaaS user management system for messes — QR + face check-in, wallets, per-mess Razorpay. Learn our story." />

      <section className="relative overflow-hidden bg-gradient-to-br from-primary to-red-800 text-white">
        <div className="max-w-4xl mx-auto px-6 md:px-10 pt-20 pb-16 text-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 px-3 py-1.5 mb-4">
            <Sparkles className="h-3.5 w-3.5" /> <span className="text-xs font-semibold uppercase tracking-widest">About efoodtech</span>
          </motion.div>
          <h1 className="font-display font-extrabold text-4xl sm:text-5xl leading-tight">Built by people who actually ran a mess.</h1>
          <p className="mt-5 text-white/85 text-lg max-w-2xl mx-auto">
            efoodtech started as <b>efoodcare</b> — one mess in Amravati serving 400+ subscribers with pen-and-paper. Over 2 years we built the software that made our own kitchen run smoothly. Then other mess owners asked for it. So we opened it up.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 md:px-10 py-16 space-y-10">
        <Block icon={Rocket} title="Our mission" copy="Give every mess owner in India a tech stack that used to cost lakhs to build — for the price of a monthly SaaS." />
        <Block icon={ShieldCheck} title="How we're different" copy="We are a mess. We serve real tiffins every day. Every feature you see on efoodtech was written to fix a problem we hit in our own kitchen first. Nothing is theoretical." />
        <Block icon={Users} title="Multi-tenant from day one" copy="Every mess on efoodtech is its own tenant — its own logo, tagline, plans, Razorpay account, wallet, subscribers. When your users log in, they see YOU, not us. That's the promise." />
        <Block icon={Heart} title="Our promise to mess owners" copy="Your subscriber list, your Razorpay keys, your ratings, your reviews — all belong to YOU. We charge a small per-user platform fee, that's it. No lock-in, no surprises." />
      </section>

      <section className="bg-accent/30 py-14">
        <div className="max-w-4xl mx-auto px-6 md:px-10 grid sm:grid-cols-2 gap-5">
          <Card icon={MapPin} title="Where we are" body="shilangan Road, behind bhaktidham mandir, sai nagar, Amravati 444607, Maharashtra" />
          <Card icon={PhoneCall} title="Call us" body="+91 99707 05391" href="tel:+919970705391" />
          <Card icon={Mail} title="Email" body="hello@efoodcare.in" href="mailto:hello@efoodcare.in" />
          <Card icon={Building2} title="Ready to onboard?" body="Contact us or hit the Get Started button." cta={<Link to="/login"><Button className="rounded-full bg-primary text-white h-9 px-4 text-xs font-semibold">Get started</Button></Link>} />
        </div>
      </section>
    </div>
  );
}

function Block({ icon: Icon, title, copy }) {
  return (
    <div className="flex gap-4 items-start" data-testid={`about-block-${title.toLowerCase().replace(/\s+/g,'-')}`}>
      <div className="h-11 w-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <div className="flex-1">
        <h2 className="font-display font-extrabold text-2xl text-slate-900">{title}</h2>
        <p className="text-slate-600 mt-1.5 leading-relaxed">{copy}</p>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, body, href, cta }) {
  const Inner = (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 h-full hover:shadow-md transition">
      <Icon className="h-5 w-5 text-primary mb-2" />
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <div className="text-xs text-slate-600 mt-1 leading-relaxed">{body}</div>
      {cta && <div className="mt-3">{cta}</div>}
    </div>
  );
  return href ? <a href={href}>{Inner}</a> : Inner;
}
