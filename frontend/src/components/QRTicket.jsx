import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { motion } from "framer-motion";

export default function QRTicket({ token, userName, mealsLeft, mealsTotal, daysLeft, planName }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full max-w-[280px] mx-auto"
      data-testid="qr-ticket"
    >
      <div className="bg-white rounded-2xl shadow-md border border-black/5 overflow-hidden">
        {/* Top: QR section */}
        <div className="p-3.5 pb-2.5 bg-gradient-to-b from-[hsl(40,25%,96%)] to-white">
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <p className="text-[8px] tracking-overline uppercase font-bold text-muted-foreground">Meal Pass</p>
              <p className="font-display font-extrabold text-sm leading-none mt-0.5" data-testid="qr-user-name">{userName}</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] tracking-overline uppercase font-bold text-muted-foreground">Plan</p>
              <p className="font-semibold text-[11px] mt-0.5">{planName || "No Plan"}</p>
            </div>
          </div>

          <div className="flex justify-center py-1">
            <div className="bg-white p-1.5 rounded-lg border border-primary/10" data-testid="subscriber-qr">
              <QRCodeSVG
                value={token || "no-token"}
                size={108}
                level="M"
                bgColor="#ffffff"
                fgColor="#2e7d4f"
              />
            </div>
          </div>

          <p className="text-center text-[9px] text-muted-foreground mt-1.5">
            Show this at the counter to mark attendance
          </p>
        </div>

        {/* Tear divider */}
        <div className="relative h-4 flex items-center">
          <div className="absolute left-0 -translate-x-1/2 w-4 h-4 rounded-full bg-[hsl(40,25%,96%)]"></div>
          <div className="flex-1 border-t border-dashed border-black/20 mx-3"></div>
          <div className="absolute right-0 translate-x-1/2 w-4 h-4 rounded-full bg-[hsl(40,25%,96%)]"></div>
        </div>

        {/* Bottom: stats */}
        <div className="grid grid-cols-3 divide-x divide-black/5">
          <div className="p-2 text-center" data-testid="meals-remaining">
            <p className="font-display font-extrabold text-lg text-primary leading-none">{mealsLeft ?? "—"}</p>
            <p className="text-[8px] tracking-overline uppercase font-bold text-muted-foreground mt-0.5">Meals Left</p>
          </div>
          <div className="p-2 text-center" data-testid="stat-meals-total">
            <p className="font-display font-extrabold text-lg text-secondary leading-none">{mealsTotal ?? "—"}</p>
            <p className="text-[8px] tracking-overline uppercase font-bold text-muted-foreground mt-0.5">Total</p>
          </div>
          <div className="p-2 text-center" data-testid="stat-days-left">
            <p className="font-display font-extrabold text-lg text-foreground leading-none">{daysLeft ?? "—"}</p>
            <p className="text-[8px] tracking-overline uppercase font-bold text-muted-foreground mt-0.5">Days Left</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
