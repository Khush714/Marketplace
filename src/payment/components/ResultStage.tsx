import { motion } from "framer-motion";
import {
  ACCENTS,
  type Accent,
  type Channel,
  formatINR,
  ORDER,
  type Phase,
  useCountUp,
} from "../lib/checkout";

const ease = [0.22, 1, 0.36, 1] as const;

type Copy = { title: string; body: string; primary: string; secondary?: string };

const UPI_COPY: Record<string, Copy> = {
  success: {
    title: "Payment Successful",
    body: "Payment verified securely over UPI. A receipt has been sent to your registered email.",
    primary: "MAKE ANOTHER PAYMENT",
    secondary: "DOWNLOAD RECEIPT",
  },
  failed: {
    title: "Payment could not be verified",
    body: "Your bank did not confirm this transaction. No amount has been debited from your account.",
    primary: "TRY AGAIN",
    secondary: "CHOOSE ANOTHER METHOD",
  },
  expired: {
    title: "This payment request expired",
    body: "For your security the QR code is only valid for a short window. Generate a fresh code to continue.",
    primary: "GENERATE NEW QR",
  },
  cancelled: {
    title: "Payment cancelled",
    body: "You cancelled the request before it was confirmed. Nothing was debited.",
    primary: "RESUME PAYMENT",
  },
};

const CASH_COPY: Record<string, Copy> = {
  success: {
    title: "Cash Payment Successful",
    body: "Tender recorded securely. Cash drawer unlocked for change and the receipt is ready to print.",
    primary: "NEW TRANSACTION",
    secondary: "PRINT RECEIPT",
  },
  failed: {
    title: "Cash payment not recorded",
    body: "The terminal could not lock this tender. Re-count the cash and try again — nothing was written to the ledger.",
    primary: "TRY AGAIN",
    secondary: "SWITCH TO UPI",
  },
  cancelled: {
    title: "Cash payment cancelled",
    body: "You cancelled before confirmation. Return any notes already taken and restart when ready.",
    primary: "RESUME PAYMENT",
  },
  expired: {
    title: "Session timed out",
    body: "This cash session was closed for security. Start a fresh tender to continue.",
    primary: "NEW TRANSACTION",
  },
};

const CARD_COPY: Record<string, Copy> = {
  success: {
    title: "Payment Successful",
    body: "Your payment was processed securely. The charge will appear on your statement as CODEXR.",
    primary: "MAKE ANOTHER PAYMENT",
    secondary: "DOWNLOAD RECEIPT",
  },
  failed: {
    title: "Payment declined",
    body: "Your bank declined this transaction. No amount has been charged — you can retry or use a different card.",
    primary: "RETRY PAYMENT",
    secondary: "PAY WITH UPI INSTEAD",
  },
  cancelled: {
    title: "Payment cancelled",
    body: "You cancelled before authorisation completed. Your card has not been charged.",
    primary: "RESUME PAYMENT",
  },
  expired: {
    title: "Session timed out",
    body: "This secure session was closed. Start again to continue.",
    primary: "START AGAIN",
  },
};

type Props = {
  channel: Channel;
  phase: Phase;
  accent: Accent;
  reference: string;
  method: string;
  settledReceived?: number;
  settledChange?: number;
  drawerOpen?: boolean;
  onPrimary: () => void;
  onSecondary?: () => void;
  /** Present on real orders: turn the success screen into a countdown to tracking. */
  redirect?: { code: string; in: number } | null;
};

export default function ResultStage({
  channel,
  phase,
  accent,
  reference,
  method,
  settledReceived = 0,
  settledChange = 0,
  drawerOpen = false,
  onPrimary,
  onSecondary,
  redirect,
}: Props) {
  const dictionary = channel === "cash" ? CASH_COPY : channel === "card" ? CARD_COPY : UPI_COPY;
  const copy = dictionary[phase] ?? dictionary.failed;
  const rgb = ACCENTS[accent].rgb;
  const isSuccess = phase === "success";
  const amount = useCountUp(ORDER.amount, isSuccess, 950);
  const receivedAnim = useCountUp(settledReceived, isSuccess && channel === "cash", 800);
  const changeAnim = useCountUp(settledChange, isSuccess && channel === "cash" && settledChange > 0, 900);

  return (
    <motion.div
      initial={{ opacity: 0, y: 26, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -18, filter: "blur(8px)" }}
      transition={{ duration: 0.8, ease, delay: 0.15 }}
      className="mx-auto w-full max-w-md text-center"
    >
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease, delay: 0.3 }}
        className="text-[10px] tracking-[0.42em]"
        style={{ color: `rgba(${rgb},0.75)` }}
      >
        {isSuccess
          ? channel === "cash"
            ? "CASH RECORDED"
            : channel === "card"
              ? "AUTHORISED · SETTLED"
              : "TRANSACTION COMPLETE"
          : phase.toUpperCase()}
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease, delay: 0.38 }}
        className="mt-3 text-[1.7rem] font-light leading-tight tracking-tight text-white text-balance"
      >
        {copy.title}
      </motion.h2>

      {isSuccess && (
        <motion.p
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease, delay: 0.45 }}
          className="mt-4 font-light tracking-tight text-white"
        >
          <span className="text-xl text-white/50">₹</span>
          <span className="text-[3rem] leading-none tabular-nums">{formatINR(amount)}</span>
        </motion.p>
      )}

      {/* cash tender summary */}
      {isSuccess && channel === "cash" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease, delay: 0.52 }}
          className="mx-auto mt-5 flex max-w-xs items-stretch justify-center gap-3"
        >
          <MiniStat label="Cash received" value={`₹${formatINR(receivedAnim, false)}`} />
          <div className="w-px bg-white/10" />
          <MiniStat
            label={settledChange > 0 ? "Change returned" : "Change"}
            value={settledChange > 0 ? `₹${formatINR(changeAnim, false)}` : "Exact"}
            accent={settledChange > 0 ? ACCENTS[accent].soft : "rgba(167,243,208,0.9)"}
          />
        </motion.div>
      )}

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, ease, delay: 0.55 }}
        className="mx-auto mt-4 max-w-sm text-[12.5px] leading-relaxed text-white/45 text-balance"
      >
        {copy.body}
        {isSuccess && channel === "cash" && drawerOpen ? " Cash drawer is open." : ""}
      </motion.p>

      {isSuccess && redirect && (
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease, delay: 0.6 }}
          className="glass-soft mx-auto mt-5 flex w-fit items-center gap-2.5 rounded-full px-4 py-2 text-[11px] tracking-[0.16em]"
        >
          <span className="relative grid size-4 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full opacity-40" style={{ backgroundColor: `rgba(${rgb},0.9)` }} />
            <span className="relative size-1.5 rounded-full" style={{ backgroundColor: `rgba(${rgb},0.9)` }} />
          </span>
          <span className="uppercase" style={{ color: `rgba(${rgb},0.9)` }}>
            Order placed
          </span>
          <span className="font-mono text-white/80">{redirect.code}</span>
          <span className="text-white/30">·</span>
          <span className="font-mono tabular-nums text-white/90">tracking in {redirect.in}s</span>
        </motion.p>
      )}

      <motion.dl
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease, delay: 0.62 }}
        className="glass-soft mx-auto mt-7 w-full rounded-2xl px-5 py-4 text-left"
      >
        {(channel === "cash"
          ? [
              ["Receipt no.", reference],
              ["Paid to", ORDER.payee],
              ["Order", `#${ORDER.orderNo} · Table ${ORDER.table}`],
              ["Method", "Cash tender"],
              [
                "Status",
                isSuccess
                  ? drawerOpen
                    ? "Recorded · drawer open"
                    : "Credited to till"
                  : phase === "cancelled"
                    ? "Cancelled"
                    : "Not recorded",
              ],
            ]
          : channel === "card"
            ? [
                ["Auth code", reference.slice(0, 6)],
                ["Paid to", ORDER.payee],
                ["Card", method],
                [
                  "Status",
                  isSuccess ? "Approved · captured" : phase === "failed" ? "Declined by issuer" : "Not charged",
                ],
              ]
          : [
              ["UTR reference", reference],
              ["Paid to", `${ORDER.payee} · ${ORDER.payeeVpa}`],
              ["Method", method],
              [
                "Status",
                isSuccess
                  ? "Credited to merchant"
                  : phase === "expired"
                    ? "Request expired"
                    : "Not debited",
              ],
            ]
        ).map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between border-b border-white/[0.06] py-2 text-[11.5px] last:border-0"
          >
            <dt className="tracking-[0.12em] text-white/35">{label}</dt>
            <dd className="font-mono text-[11px] tracking-[0.04em] text-white/75">{value}</dd>
          </div>
        ))}
      </motion.dl>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease, delay: 0.72 }}
        className="mt-7 flex flex-col items-center gap-3"
      >
        <button
          type="button"
          onClick={onPrimary}
          className="group relative w-full overflow-hidden rounded-2xl py-3.5 text-[11px] font-medium tracking-[0.3em] text-black transition-transform duration-300 hover:scale-[1.015]"
          style={{
            background: `linear-gradient(135deg, ${ACCENTS[accent].soft}, ${ACCENTS[accent].hex} 55%, ${ACCENTS[accent].soft})`,
            boxShadow: `0 18px 50px -22px rgba(${rgb},1), inset 0 1px 0 rgba(255,255,255,0.7)`,
          }}
        >
          <span className="relative z-10">{redirect ? "VIEW ORDER" : copy.primary}</span>
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent transition-transform duration-[900ms] group-hover:translate-x-full" />
        </button>
        {copy.secondary && (
          <button
            type="button"
            onClick={onSecondary ?? onPrimary}
            className="text-[10.5px] tracking-[0.28em] text-white/35 transition-colors hover:text-white/70"
          >
            {copy.secondary}
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex-1 text-center">
      <p className="text-[9px] tracking-[0.22em] text-white/35">{label}</p>
      <p
        className="mt-1 font-mono text-[1.05rem] tabular-nums tracking-tight text-white"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
