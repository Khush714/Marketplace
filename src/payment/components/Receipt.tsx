import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Check, Download, X } from "lucide-react";
import {
  ACCENTS,
  type Accent,
  type Channel,
  formatINR,
  ORDER,
  useCountUp,
} from "../lib/checkout";

const ease = [0.22, 1, 0.36, 1] as const;

function stampDate() {
  return new Date().toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const BARCODE =
  "repeating-linear-gradient(90deg, #0a0a0a 0 1px, transparent 1px 2px, #0a0a0a 2px 3px, transparent 3px 5px, #0a0a0a 5px 6px, transparent 6px 9px, #0a0a0a 9px 10px, transparent 10px 12px)";

export default function Receipt({
  channel,
  accent,
  reference,
  method,
  settledReceived = 0,
  settledChange = 0,
  onClose,
}: {
  channel: Channel;
  accent: Accent;
  reference: string;
  method: string;
  settledReceived?: number;
  settledChange?: number;
  onClose: () => void;
}) {
  const rgb = ACCENTS[accent].rgb;
  const amount = useCountUp(ORDER.amount, true, 800);

  // Print isolation: hide everything in the document except the receipt when printing.
  useEffect(() => {
    const el = document.createElement("style");
    el.id = "codexr-print-rules";
    el.textContent = `@media print {
      body > *:not(#codexr-receipt-root) { display: none !important; }
      #codexr-receipt-root {
        position: static !important; inset: auto !important; display: block !important;
        background: #ffffff !important; padding: 0 !important; overflow: visible !important;
      }
      #codexr-receipt {
        max-width: 100% !important; border-radius: 0 !important; box-shadow: none !important; margin: 0 !important;
      }
      @page { margin: 12mm; }
    }`;
    document.head.appendChild(el);
    return () => document.getElementById("codexr-print-rules")?.remove();
  }, []);

  if (typeof document === "undefined") return null;

  const rows: Array<[string, string]> = [];
  rows.push([channel === "upi" ? "UTR reference" : "Receipt no.", reference]);
  rows.push(["Paid to", ORDER.payee]);
  if (channel === "upi") rows.push(["UPI ID", ORDER.payeeVpa]);
  if (channel === "card") rows.push(["Card", method]);
  if (channel === "cash") rows.push(["Order", `#${ORDER.orderNo} · Table ${ORDER.table}`]);
  rows.push(["Date & time", stampDate()]);
  rows.push(["Method", method]);
  rows.push([
    "Status",
    channel === "cash"
      ? settledChange > 0
        ? "Recorded · drawer open"
        : "Recorded · exact cash"
      : "Credited to merchant",
  ]);

  return createPortal(
    <motion.div
      id="codexr-receipt-root"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[96] overflow-y-auto bg-void sm:flex sm:items-center sm:justify-center"
    >
      <motion.div
        id="codexr-receipt"
        initial={{ y: 36, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 24, scale: 0.98, opacity: 0 }}
        transition={{ duration: 0.55, ease }}
        className="relative mx-auto my-6 w-full max-w-[26rem] overflow-hidden rounded-[30px] bg-[#fbfaf7] text-ink-900 sm:my-0"
        style={{ boxShadow: `0 40px 120px -30px rgba(${rgb},0.32), 0 30px 70px -30px rgba(0,0,0,0.85)` }}
      >
        {/* watermark */}
        <span className="pointer-events-none absolute right-6 top-20 select-none font-bold leading-none tracking-tighter text-ink-900/[0.045] text-[9rem]">
          C
        </span>

        {/* masthead */}
        <div className="relative flex items-center justify-between border-b border-black/[0.07] px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-ink-900 text-[15px] font-semibold tracking-tight text-white">
              C
            </span>
            <div>
              <p className="text-[13px] font-medium tracking-[0.4em] text-ink-900">CODEXR</p>
              <p className="mt-0.5 text-[9px] tracking-[0.24em] text-ink-900/45">PREMIUM PAYMENT RECEIPT</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-deep/30 bg-emerald-glow/10 px-2.5 py-1 text-[9px] font-semibold tracking-[0.22em] text-emerald-deep">
            <span className="size-1.5 rounded-full bg-emerald-deep" /> PAID
          </span>
        </div>

        {/* amount */}
        <div className="relative px-6 pb-6 pt-7 text-center">
          <p className="text-[9px] tracking-[0.3em] text-ink-900/40">AMOUNT PAID</p>
          <p className="mt-2 flex items-baseline justify-center gap-1 font-light tracking-tight text-ink-900">
            <span className="text-xl text-ink-900/50">₹</span>
            <span className="text-[2.7rem] leading-none tabular-nums">{formatINR(amount)}</span>
          </p>
          <p className="mt-2 font-mono text-[10px] tracking-[0.16em] text-ink-900/50">{method}</p>
        </div>

        {/* items */}
        <div className="relative border-y border-black/[0.07] px-6 py-5">
          {ORDER.items.map((item) => (
            <div key={item.label} className="flex items-baseline justify-between py-1.5 text-[12px]">
              <span className="text-ink-800/70">{item.label}</span>
              <span className="font-mono text-ink-800">₹{formatINR(item.value)}</span>
            </div>
          ))}
          <div className="mt-2 flex items-baseline justify-between border-t border-black/[0.14] pt-3 text-[13px] font-semibold text-ink-900">
            <span>TOTAL PAID</span>
            <span className="font-mono tabular-nums">₹{formatINR(ORDER.amount)}</span>
          </div>
        </div>

        {/* details */}
        <div className="relative px-6 py-5">
          <dl className="space-y-2.5">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-6 text-[11.5px]">
                <dt className="tracking-[0.14em] text-ink-900/45">{label}</dt>
                <dd className="text-right font-mono text-[11px] text-ink-800">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* tear-off + barcode */}
        <div className="relative flex items-center px-2">
          <span className="absolute left-0 top-1/2 size-4 -translate-y-1/2 rounded-full bg-void print:hidden" />
          <div className="mx-4 flex-1 border-t-2 border-dashed border-black/[0.18]" />
          <span className="absolute right-0 top-1/2 size-4 -translate-y-1/2 rounded-full bg-void print:hidden" />
        </div>

        <div className="relative px-6 pb-7 pt-6 text-center">
          <div
            className="mx-auto h-10 w-44"
            style={{ background: BARCODE }}
            aria-hidden
          />
          <p className="mt-2.5 font-mono text-[10px] tracking-[0.34em] text-ink-900/55">{reference}</p>
        </div>

        {/* actions */}
        <div className="relative border-t border-black/[0.07] px-6 py-5">
          <button
            type="button"
            onClick={() => window.print()}
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-ink-900 py-4 text-[11px] font-medium tracking-[0.3em] text-white transition-transform duration-300 hover:scale-[1.015]"
          >
            <Download className="size-3.5" /> DOWNLOAD PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl border border-black/10 py-3.5 text-[10.5px] tracking-[0.3em] text-ink-900/55 transition-colors hover:border-black/25 hover:text-ink-900"
          >
            <X className="size-3.5" /> CLOSE
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}