// iter-137 · Kiosk end-of-day cash + UPI report modal.
// Tallies bills, cash, UPI, per-staff breakdown for the given IST date and
// renders a print-friendly 80mm thermal receipt-style summary. Admins can
// print via window.print() or share via WhatsApp Cloud API (future).
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { Loader2, Printer, RefreshCw, Receipt, X as XIcon } from "lucide-react";

function todayIST() {
  const ist = new Date(Date.now() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
}

export default function KioskDailyReportDialog({ open, onClose }) {
  const [date, setDate] = useState(todayIST());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const r = await api.get(`/admin/kiosk/daily-report?date=${d}`);
      setReport(r.data);
    } catch (e) {
      console.warn("[DailyReport] load failed", e);
      setReport(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) load(date); }, [open, date, load]);

  const printReport = () => {
    if (!report) return;
    const win = window.open("", "efc_daily_report", "width=420,height=680");
    if (!win) return;
    win.document.write(buildReportHtml(report));
    win.document.close();
    setTimeout(() => { try { win.print(); } catch { /* noop */ } }, 220);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[900] bg-black/80 flex items-center justify-center p-4" data-testid="kiosk-daily-report-dialog">
      <div className="bg-white text-[hsl(140,8%,8%)] rounded-3xl max-w-lg w-full max-h-[88vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(140,8%,88%)]">
          <div>
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(140,30%,32%)]">End-of-day close-out</p>
            <p className="font-display font-extrabold text-lg flex items-center gap-1.5">
              <Receipt className="h-5 w-5" /> Daily kiosk report
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center rounded-full bg-[hsl(140,8%,92%)] hover:bg-[hsl(140,8%,84%)]" data-testid="kiosk-daily-report-close" aria-label="Close">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[hsl(140,8%,90%)] flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 h-11 rounded-full border border-[hsl(140,8%,80%)] px-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(140,40%,45%)]"
            data-testid="kiosk-daily-report-date"
          />
          <Button variant="outline" onClick={() => load(date)} className="rounded-full h-11 px-3" data-testid="kiosk-daily-report-refresh" aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            onClick={printReport}
            disabled={!report || loading}
            className="rounded-full h-11 px-4 bg-[hsl(140,40%,40%)] hover:bg-[hsl(140,40%,32%)] text-white font-extrabold"
            data-testid="kiosk-daily-report-print"
          >
            <Printer className="h-4 w-4 mr-1.5" /> Print
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4" data-testid="kiosk-daily-report-body">
          {loading && !report ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !report ? (
            <div className="text-sm text-muted-foreground text-center p-6">Failed to load report.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Bills placed" value={report.bill_count} testid="dr-bill-count" />
                <Metric label="Settled" value={`${report.settled_count} / ${report.bill_count}`} testid="dr-settled" />
                <Metric label="Cash collected" value={`₹${report.cash_total}`} tone="ok" testid="dr-cash-total" />
                <Metric label="UPI collected" value={`₹${report.upi_total}`} tone="ok" testid="dr-upi-total" />
                <Metric label="Cash pending" value={`₹${report.cash_pending}`} tone={report.cash_pending > 0 ? "warn" : "ok"} testid="dr-cash-pending" />
                <Metric label="UPI pending" value={`₹${report.upi_pending}`} tone={report.upi_pending > 0 ? "warn" : "ok"} testid="dr-upi-pending" />
                <div className="col-span-2 rounded-2xl bg-[hsl(140,40%,45%)] text-white p-3 flex items-center justify-between" data-testid="dr-grand-total">
                  <span className="text-[11px] tracking-[0.18em] uppercase font-bold opacity-80">Grand total collected</span>
                  <span className="font-display font-extrabold text-2xl">₹{report.grand_total}</span>
                </div>
              </div>

              <div>
                <p className="text-[11px] tracking-[0.18em] uppercase font-bold text-muted-foreground mb-1.5">Meal · service split</p>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <Chip label="Lunch" value={report.lunch_count} />
                  <Chip label="Dinner" value={report.dinner_count} />
                  <Chip label="Takeaway" value={report.takeaway_count} />
                  <Chip label="Dining" value={report.dining_count} />
                </div>
              </div>

              <div>
                <p className="text-[11px] tracking-[0.18em] uppercase font-bold text-muted-foreground mb-1.5">Staff cash-in-hand</p>
                {report.staff_breakdown?.length ? (
                  <ul className="divide-y divide-[hsl(140,8%,92%)] rounded-xl border border-[hsl(140,8%,90%)]">
                    {report.staff_breakdown.map((s) => (
                      <li key={s.staff_id} className="flex items-center justify-between px-3 py-2 text-sm" data-testid={`dr-staff-${s.staff_id}`}>
                        <div className="min-w-0">
                          <p className="font-extrabold truncate">{s.name || s.staff_id}</p>
                          <p className="text-[11px] text-muted-foreground">{s.bill_count} bill{s.bill_count === 1 ? "" : "s"}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-extrabold tabular-nums">₹{s.cash_collected} <span className="opacity-60 text-xs font-normal">cash</span></p>
                          <p className="text-xs text-muted-foreground">₹{s.upi_collected} UPI{s.cash_pending > 0 ? ` · ₹${s.cash_pending} pending` : ""}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No kiosk activity on this date.</p>
                )}
              </div>

              {report.top_bills?.length > 0 && (
                <div>
                  <p className="text-[11px] tracking-[0.18em] uppercase font-bold text-muted-foreground mb-1.5">Top 5 bills</p>
                  <ul className="text-sm space-y-0.5">
                    {report.top_bills.map((b) => (
                      <li key={b.bill_no} className="flex items-center justify-between rounded px-2 py-1 hover:bg-[hsl(140,20%,96%)]">
                        <span>#{b.bill_no} · {b.meal_type} · {b.service}</span>
                        <span className="font-extrabold tabular-nums">₹{b.total}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone, testid }) {
  const border = tone === "warn" ? "border-amber-300 bg-amber-50" : tone === "ok" ? "border-emerald-200 bg-emerald-50" : "border-[hsl(140,8%,90%)] bg-white";
  return (
    <div className={`rounded-xl border ${border} p-3`} data-testid={testid}>
      <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">{label}</p>
      <p className="font-display font-extrabold text-xl tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function Chip({ label, value }) {
  return (
    <div className="rounded-lg border border-[hsl(140,8%,90%)] px-2 py-1 text-center">
      <p className="text-[10px] tracking-[0.14em] uppercase font-bold text-muted-foreground">{label}</p>
      <p className="text-base font-extrabold">{value}</p>
    </div>
  );
}

function buildReportHtml(report) {
  const esc = (s) => String(s ?? "").replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
  const staff = (report.staff_breakdown || []).map((s) =>
    `<div class="line"><span>${esc(s.name || s.staff_id)}</span><b>₹${esc(s.cash_collected)} + ₹${esc(s.upi_collected)}</b></div>`
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>efoodcare · daily report ${esc(report.date)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: 'Courier New', Courier, monospace; }
  .r { width: 288px; padding: 10px 12px 16px; margin: 0 auto; }
  .center { text-align: center; }
  .brand { font-weight: 800; font-size: 16px; letter-spacing: 2px; }
  .tagline { font-size: 9px; letter-spacing: 2px; margin-top: 2px; }
  .head { font-weight: 800; font-size: 13px; margin-top: 6px; }
  .sub { font-size: 10px; margin-bottom: 4px; }
  .sep { border-top: 1px dashed #000; margin: 8px 0; }
  .line { display: flex; justify-content: space-between; font-size: 11px; line-height: 1.5; }
  .grand { font-size: 15px; font-weight: 800; margin-top: 4px; padding: 4px 6px; background: #000; color: #fff; display:flex; justify-content: space-between; }
  .footer { text-align:center; font-size: 10px; margin-top: 10px; }
  @media print { body { width: 80mm; } .r { width: auto; padding: 4mm 4mm 6mm; } }
</style>
</head><body><div class="r">
  <div class="center">
    <div class="brand">efoodcare</div>
    <div class="tagline">GHAR SE ACHHA KHANA</div>
    <div class="head">DAILY KIOSK REPORT</div>
    <div class="sub">${esc(report.date)}</div>
  </div>
  <div class="sep"></div>
  <div class="line"><span>Bills placed</span><b>${esc(report.bill_count)}</b></div>
  <div class="line"><span>Settled</span><b>${esc(report.settled_count)} / ${esc(report.bill_count)}</b></div>
  <div class="line"><span>Cash collected</span><b>₹${esc(report.cash_total)}</b></div>
  <div class="line"><span>UPI collected</span><b>₹${esc(report.upi_total)}</b></div>
  <div class="line"><span>Cash pending</span><b>₹${esc(report.cash_pending)}</b></div>
  <div class="line"><span>UPI pending</span><b>₹${esc(report.upi_pending)}</b></div>
  <div class="sep"></div>
  <div class="line"><span>Lunch bills</span><span>${esc(report.lunch_count)}</span></div>
  <div class="line"><span>Dinner bills</span><span>${esc(report.dinner_count)}</span></div>
  <div class="line"><span>Takeaway</span><span>${esc(report.takeaway_count)}</span></div>
  <div class="line"><span>Dining</span><span>${esc(report.dining_count)}</span></div>
  ${staff ? `<div class="sep"></div><div class="sub" style="font-weight:800">STAFF CASH-IN-HAND (cash + UPI)</div>${staff}` : ""}
  <div class="grand"><span>GRAND TOTAL</span><span>₹${esc(report.grand_total)}</span></div>
  <div class="footer">
    Generated at ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}<br/>
    efoodcare · ghar se achha khana
  </div>
</div></body></html>`;
}
