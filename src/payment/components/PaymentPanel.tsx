import { AnimatePresence, motion } from "framer-motion";
import {
  ACCENTS,
  type Accent,
  type CashBalance,
  type Channel,
  formatINR,
  ORDER,
  type Phase,
  useAnimatedNumber,
} from "../lib/checkout";
import { LockMark } from "./Glyphs";
import StatusRail from "./StatusRail";

const ease = [0.22, 1, 0.36, 1] as const;

type Props = {
  channel: Channel;
  phase: Phase;
  accent: Accent;
  reference: string;
  timeLabel: string;
  // cash
  received?: number;
  balance?: CashBalance;
  canConfirmCash?: boolean;
  settledChange?: number;
  // card
  canPayCard?: boolean;
  cardBrand?: string;
  cardLast4?: string;
  cardKind?: string;
  // actions
  onPay: () => void;
  onConfirmCash: () => void;
  onPayCard: () => void;
  onCancel: () => void;
};

export default function PaymentPanel({
  channel,
  phase,
  accent,
  reference,
  timeLabel,
  received = 0,
  balance,
  canConfirmCash = false,
  canPayCard = false,
  cardBrand = "unknown",
  cardLast4 = "",
  cardKind = "credit",
  onPay,
  onConfirmCash,
  onPayCard,
  onCancel,
}: Props) {
  const rgb = ACCENTS[accent].rgb;
  const live = phase === "initiated" || phase === "verifying" || phase === "pending";
  const idle = phase === "idle";
  const animReceived = useAnimatedNumber(received, 380);
  const animChange = useAnimatedNumber(
    balance?.kind === "over" ? balance.change : 0,
    380,
  );

  return (
    <div className="glass edge-sheen relative overflow-hidden rounded-[28px] p-6">
      <div
        className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full blur-3xl transition-[background] duration-[1200ms]"
        style={{ background: `radial-gradient(circle, rgba(${rgb},0.22), transparent 70%)` }}
      />

      <div className="relative">
        <div className="flex items-center justify-between">
          <p className="text-[10px] tracking-[0.34em] text-white/35">PAYMENT DETAILS</p>
          <span className="font-mono text-[10px] tracking-[0.14em] text-white/30">
            #{reference.slice(0, 6)}
          </span>
        </div>

        <div className="mt-5">
          <p className="text-[10px] tracking-[0.3em] text-white/30">AMOUNT DUE</p>
          <p className="mt-1 flex items-baseline gap-1 font-light tracking-tight text-white">
            <span className="text-2xl text-white/55">₹</span>
            <span className="text-[2.6rem] leading-none">{formatINR(ORDER.amount, false)}</span>
            <span className="text-xl text-white/45">.00</span>
          </p>
        </div>

        <div className="mt-6 space-y-3 border-y border-white/[0.07] py-5">
          {ORDER.items.map((item) => (
            <div key={item.label} className="flex items-center justify-between text-[12px]">
              <span className="text-white/45">{item.label}</span>
              <span className="font-mono text-white/70">₹{formatINR(item.value, false)}</span>
            </div>
          ))}
        </div>

        {channel === "upi" ? (
          <dl className="mt-5 space-y-3.5">
            <Row label="Payee" value={ORDER.payee} />
            <Row label="UPI ID" value={ORDER.payeeVpa} mono />
            <Row label="Settlement" value="Instant · NPCI rails" />
            <Row label="Code valid for" value={timeLabel} mono accentColor={`rgba(${rgb},0.9)`} />
          </dl>
        ) : channel === "card" ? (
          <dl className="mt-5 space-y-3.5">
            <Row label="Payee" value={ORDER.payee} />
            <Row label="Card type" value={cardKind === "debit" ? "Debit card" : "Credit card"} />
            <Row
              label="Card"
              value={cardLast4 ? `${cardBrand.toUpperCase()} •••• ${cardLast4}` : "Awaiting details"}
              mono
            />
            <Row label="Authentication" value="3-D Secure 2.0" />
            <Row label="Settlement" value="T+1 · Tokenised" accentColor={`rgba(${rgb},0.9)`} />
          </dl>
        ) : (
          <div className="mt-5 space-y-3">
            <Row label="Payee" value={ORDER.payee} />
            <Row label="Order" value={`#${ORDER.orderNo} · Table ${ORDER.table}`} mono />
            <Row label="Channel" value="Cash · POS terminal" />

            {/* live ledger */}
            <div
              className="mt-1 overflow-hidden rounded-2xl border px-3.5 py-3 transition-all duration-500"
              style={{
                borderColor:
                  balance?.kind === "exact"
                    ? "rgba(16,185,129,0.4)"
                    : balance?.kind === "over"
                      ? `rgba(${rgb},0.35)`
                      : balance?.kind === "under"
                        ? "rgba(224,106,106,0.3)"
                        : "rgba(255,255,255,0.08)",
                background:
                  balance?.kind === "exact"
                    ? "rgba(16,185,129,0.08)"
                    : balance?.kind === "over"
                      ? `rgba(${rgb},0.06)`
                      : "rgba(255,255,255,0.02)",
              }}
            >
              <div className="flex items-center justify-between text-[12px]">
                <span className="tracking-[0.14em] text-white/40">Due</span>
                <span className="font-mono text-white/75">₹{formatINR(ORDER.amount, false)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[12px]">
                <span className="tracking-[0.14em] text-white/40">Received</span>
                <span className="font-mono text-white">
                  ₹{formatINR(animReceived, false)}
                </span>
              </div>
              <div className="my-2.5 h-px bg-white/[0.07]" />
              <AnimatePresence mode="wait">
                {balance?.kind === "over" ? (
                  <motion.div
                    key="chg"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <span className="tracking-[0.14em]" style={{ color: ACCENTS[accent].soft }}>
                      Change
                    </span>
                    <span
                      className="font-mono text-[15px] tabular-nums"
                      style={{ color: ACCENTS[accent].soft }}
                    >
                      ₹{formatINR(animChange, false)}
                    </span>
                  </motion.div>
                ) : balance?.kind === "under" ? (
                  <motion.div
                    key="rem"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <span className="tracking-[0.14em] text-[#f3b8b8]/80">Remaining</span>
                    <span className="font-mono text-[#f3b8b8]">
                      ₹{formatINR(balance.remaining, false)}
                    </span>
                  </motion.div>
                ) : balance?.kind === "exact" ? (
                  <motion.div
                    key="ex"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <span className="tracking-[0.14em] text-emerald-200/80">Exact cash</span>
                    <span className="font-mono text-emerald-100">₹0 change</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <span className="tracking-[0.14em] text-white/30">Awaiting tender</span>
                    <span className="font-mono text-white/25">—</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        <div className="mt-7">
          <StatusRail phase={phase} accent={accent} channel={channel} />
        </div>

        <div className="mt-7">
          <AnimatePresence mode="wait">
            {live ? (
              <motion.button
                key="cancel"
                type="button"
                onClick={onCancel}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4, ease }}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3.5 text-[11px] tracking-[0.3em] text-white/50 transition-colors hover:border-white/20 hover:text-white/80"
              >
                CANCEL PAYMENT
              </motion.button>
            ) : channel === "card" ? (
              <motion.button
                key="pay-card"
                type="button"
                onClick={onPayCard}
                disabled={!canPayCard || !idle}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                whileHover={canPayCard && idle ? { scale: 1.015, y: -1 } : undefined}
                whileTap={canPayCard && idle ? { scale: 0.98 } : undefined}
                transition={{ duration: 0.4, ease }}
                className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl py-4 text-[11px] tracking-[0.28em] text-black disabled:opacity-35"
                style={{
                  background: canPayCard
                    ? `linear-gradient(135deg, ${ACCENTS[accent].soft}, ${ACCENTS[accent].hex} 55%, ${ACCENTS[accent].soft})`
                    : "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08))",
                  boxShadow: canPayCard
                    ? `0 18px 50px -20px rgba(${rgb},1), inset 0 1px 0 rgba(255,255,255,0.7)`
                    : "none",
                }}
              >
                <span className="relative z-10 font-medium">
                  PAY ₹{formatINR(ORDER.amount)} NOW
                </span>
                <span className="relative z-10 transition-transform duration-300 group-hover:translate-x-1">
                  →
                </span>
                {canPayCard && (
                  <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent transition-transform duration-[900ms] group-hover:translate-x-full" />
                )}
              </motion.button>
            ) : channel === "cash" ? (
              <motion.button
                key="confirm-cash"
                type="button"
                onClick={onConfirmCash}
                disabled={!canConfirmCash || !idle}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                whileHover={canConfirmCash && idle ? { scale: 1.015 } : undefined}
                whileTap={canConfirmCash && idle ? { scale: 0.985 } : undefined}
                transition={{ duration: 0.4, ease }}
                className="group relative w-full overflow-hidden rounded-2xl py-4 text-[11px] tracking-[0.28em] text-black disabled:opacity-35"
                style={{
                  background: canConfirmCash
                    ? `linear-gradient(135deg, ${ACCENTS[accent].soft}, ${ACCENTS[accent].hex} 55%, ${ACCENTS[accent].soft})`
                    : "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08))",
                  boxShadow: canConfirmCash
                    ? `0 18px 50px -20px rgba(${rgb},1), inset 0 1px 0 rgba(255,255,255,0.7)`
                    : "none",
                }}
              >
                <span className="relative z-10 font-medium">
                  {balance?.kind === "over"
                    ? `CONFIRM ₹${formatINR(received, false)} RECEIVED`
                    : balance?.kind === "exact"
                      ? "CONFIRM EXACT CASH"
                      : "CONFIRM CASH PAYMENT"}
                </span>
                {canConfirmCash && (
                  <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent transition-transform duration-[900ms] group-hover:translate-x-full" />
                )}
              </motion.button>
            ) : (
              <motion.button
                key="pay"
                type="button"
                onClick={onPay}
                disabled={!idle}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                whileHover={idle ? { scale: 1.015 } : undefined}
                whileTap={idle ? { scale: 0.985 } : undefined}
                transition={{ duration: 0.4, ease }}
                className="group relative w-full overflow-hidden rounded-2xl py-4 text-[11px] tracking-[0.34em] text-black disabled:opacity-40"
                style={{
                  background: `linear-gradient(135deg, ${ACCENTS[accent].soft}, ${ACCENTS[accent].hex} 55%, ${ACCENTS[accent].soft})`,
                  boxShadow: `0 18px 50px -20px rgba(${rgb},1), inset 0 1px 0 rgba(255,255,255,0.7)`,
                }}
              >
                <span className="relative z-10 font-medium">PAY NOW</span>
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent transition-transform duration-[900ms] group-hover:translate-x-full" />
              </motion.button>
            )}
          </AnimatePresence>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] tracking-[0.16em] text-white/25">
            <LockMark className="h-3 w-3" />
            {channel === "cash"
              ? "PHYSICAL TENDER · DRAWER-SECURED RECORD"
              : channel === "card"
                ? "ENCRYPTED · PCI-DSS LEVEL 1 · 3-D SECURE"
                : "PROTECTED BY UPI 2-FACTOR AUTHENTICATION"}
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  accentColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accentColor?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[11px] tracking-[0.14em] text-white/35">{label}</dt>
      <dd
        className={`text-[12.5px] text-white/85 ${mono ? "font-mono tracking-[0.06em]" : ""}`}
        style={accentColor ? { color: accentColor } : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
