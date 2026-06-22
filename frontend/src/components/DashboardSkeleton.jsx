/**
 * DashboardSkeleton — iter-118
 *
 * Pulsing-grey placeholder for SubscriberDashboard's first paint. Mirrors
 * the same outer layout (wallet card → today menu → meal status row →
 * weekly section) so the eventual content swaps in without the page
 * "jumping".
 */
import React from "react";

const bar = (w = "w-full", h = "h-3") =>
  <div className={`${w} ${h} rounded-full bg-muted animate-pulse`} />;

const Card = ({ children, className = "" }) => (
  <div className={`rounded-2xl bg-card border border-border p-6 ${className}`}>{children}</div>
);

export default function DashboardSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-6 md:px-8 lg:px-12 py-10 space-y-6" data-testid="dashboard-skeleton">
      {/* Wallet card */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          {bar("w-32", "h-3")}
          <div className="h-9 w-24 rounded-full bg-muted animate-pulse" />
        </div>
        <div className="h-10 w-40 rounded-md bg-muted animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              {bar("w-20", "h-2.5")}
              {bar("w-16", "h-5")}
            </div>
          ))}
        </div>
        {bar("w-full", "h-2")}
      </Card>

      {/* Today's menu */}
      <Card>
        {bar("w-40", "h-3")}
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl bg-muted/40 p-4 space-y-2">
              {bar("w-24", "h-2.5")}
              {bar("w-3/4", "h-3.5")}
              {bar("w-2/3", "h-3.5")}
            </div>
          ))}
        </div>
      </Card>

      {/* QR / scan-now row */}
      <Card className="flex items-center gap-4">
        <div className="h-20 w-20 rounded-xl bg-muted animate-pulse" />
        <div className="flex-1 space-y-2">
          {bar("w-40", "h-3")}
          {bar("w-56", "h-3")}
        </div>
      </Card>

      {/* Weekly history */}
      <Card>
        {bar("w-32", "h-3")}
        <div className="mt-4 grid grid-cols-7 gap-2">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="aspect-square rounded-xl bg-muted/60 animate-pulse" />
          ))}
        </div>
      </Card>
    </div>
  );
}
