// iter-135 · Kiosk reprint dialog.
// Looks up a settled walk-in kiosk order by (date, bill_no) and passes the
// order + regenerated single-use kiosk-token QR to the existing
// KioskReceiptModal via the parent's `onReprint(receipt)` handler. Also
// lists today's kiosk bills so staff can one-tap reprint from history.
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { Loader2, Printer, Receipt, RotateCcw, Search, X as XIcon } from "lucide-react";
import { toast } from "sonner";

function todayIST() {
  const ist = new Date(Date.now() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
}

export default function KioskReprintDialog({ open, onClose, onReprint }) {
  const [date, setDate] = useState(todayIST());
  const [billNo, setBillNo] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const loadOrders = useCallback(async (d) => {
    setLoading(true);
    try {
      const r = await api.get(`/admin/kiosk/orders/today?date=${d}`);
      setOrders(r.data?.orders || []);
    } catch (e) {
      console.warn("[Reprint] orders/today failed", e);
      setOrders([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) loadOrders(date); }, [open, date, loadOrders]);

  const reprint = async (bn) => {
    const n = Number(bn);
    if (!Number.isFinite(n) || n <= 0) { toast.error("Enter a valid bill number"); return; }
    setFetching(true);
    try {
      const r = await api.get(`/admin/kiosk/reprint/${n}?date=${date}`);
      if (r.data?.order) {
        onReprint({ order: r.data.order, qrDataUrl: r.data.qr_data_url, qrText: r.data.qr_text });
        onClose();
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bill not found");
    } finally { setFetching(false); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[900] bg-black/80 flex items-center justify-center p-4" data-testid="kiosk-reprint-dialog">
      <div className="bg-white text-[hsl(140,8%,8%)] rounded-3xl max-w-lg w-full max-h-[86vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(140,8%,88%)]">
          <div>
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(140,30%,32%)]">Reprint receipt</p>
            <p className="font-display font-extrabold text-lg flex items-center gap-1.5">
              <Receipt className="h-5 w-5" /> Look up by bill no
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center rounded-full bg-[hsl(140,8%,92%)] hover:bg-[hsl(140,8%,84%)]" data-testid="kiosk-reprint-close" aria-label="Close">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-3 grid gap-2 border-b border-[hsl(140,8%,90%)]">
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="flex-1 h-11 rounded-full border border-[hsl(140,8%,80%)] px-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(140,40%,45%)]"
              data-testid="kiosk-reprint-date"
            />
            <Button
              variant="outline"
              onClick={() => loadOrders(date)}
              className="rounded-full h-11 px-3"
              data-testid="kiosk-reprint-refresh"
              aria-label="Refresh"
            >
              <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              placeholder="Bill no (e.g. 7)"
              value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") reprint(billNo); }}
              className="flex-1 h-11 rounded-full border border-[hsl(140,8%,80%)] px-4 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[hsl(140,40%,45%)]"
              data-testid="kiosk-reprint-billno"
            />
            <Button
              onClick={() => reprint(billNo)}
              disabled={fetching || !billNo}
              className="rounded-full h-11 px-4 bg-[hsl(140,40%,40%)] hover:bg-[hsl(140,40%,32%)] text-white font-extrabold"
              data-testid="kiosk-reprint-lookup"
            >
              {fetching ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Search className="h-4 w-4 mr-1.5" />}
              Reprint
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[hsl(140,30%,32%)] mb-2">
            {orders.length} bill{orders.length === 1 ? "" : "s"} on {date}
          </p>
          {loading && orders.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : orders.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center p-6">No kiosk orders on this date yet.</div>
          ) : (
            <ul className="grid gap-1.5" data-testid="kiosk-reprint-list">
              {orders.map((o) => (
                <li
                  key={o.order_id}
                  className="flex items-center gap-2 rounded-xl border border-[hsl(140,8%,90%)] px-3 py-2 hover:bg-[hsl(140,20%,96%)]"
                  data-testid={`kiosk-reprint-row-${o.bill_no}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-extrabold text-base">#{o.bill_no || "—"}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                        {(o.meal_type || "").toUpperCase()} · {(o.service || "").toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {o.qty}× · ₹{o.total} · {o.payment_method?.toUpperCase()} · {o.status}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => reprint(o.bill_no)}
                    disabled={!o.bill_no || fetching}
                    className="rounded-full bg-[hsl(140,40%,40%)] hover:bg-[hsl(140,40%,32%)] text-white text-xs font-extrabold"
                    data-testid={`kiosk-reprint-btn-${o.bill_no}`}
                  >
                    <Printer className="h-3.5 w-3.5 mr-1" /> Reprint
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
