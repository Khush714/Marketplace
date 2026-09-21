import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Environment from "./components/Environment";
import HeroModule from "./components/HeroModule";
import CashHero from "./components/CashHero";
import CardHero from "./components/CardHero";
import MethodDeck from "./components/MethodDeck";
import CashPad from "./components/CashPad";
import CardForm from "./components/CardForm";
import PaymentPanel from "./components/PaymentPanel";
import Receipt from "./components/Receipt";
import ResultStage from "./components/ResultStage";
import {
  ACCENTS,
  buildUpiPayload,
  configureOrder,
  type Channel,
  clock,
  ORDER,
  type OrderLine,
  type Outcome,
  type Phase,
  useCheckout,
} from "./lib/checkout";

const ease = [0.22, 1, 0.36, 1] as const;

const UPI_CAPTIONS: Record<Phase, string> = {
  idle: "Scan with any UPI app",
  initiated: "Opening secure handoff",
  verifying: "Verifying payment",
  pending: "Confirmation pending",
  success: "Payment received securely",
  failed: "Could not verify payment",
  expired: "Request window closed",
  cancelled: "Request cancelled",
};

const CASH_CAPTIONS: Record<Phase, string> = {
  idle: "Enter cash received",
  initiated: "Locking tender amount",
  verifying: "Recording cash payment",
  pending: "Awaiting till confirmation",
  success: "Cash payment complete",
  failed: "Could not record payment",
  expired: "Session closed",
  cancelled: "Tender cancelled",
};

const CARD_CAPTIONS: Record<Phase, string> = {
  idle: "Enter your card details",
  initiated: "Contacting your bank",
  verifying: "Processing secure transaction",
  pending: "Awaiting issuer response",
  success: "Payment processed securely",
  failed: "Transaction declined",
  expired: "Session closed",
  cancelled: "Authorisation cancelled",
};

export default function App({
  amountCents,
  payee,
  lines,
  simulation = true,
  redirect,
  onSettled,
  onViewOrder,
  onExit,
}: {
  amountCents?: number;
  payee?: string;
  lines?: OrderLine[];
  /** false = real checkout: outcomes pinned to success, SIMULATE controls hidden. */
  simulation?: boolean;
  /** When a real order is placed: success shows a countdown + VIEW ORDER instead of another payment. */
  redirect?: { code: string; in: number } | null;
  onSettled?: (result: { phase: Phase; channel: Channel }) => void;
  /** Navigate to the placed order immediately (skip the countdown). */
  onViewOrder?: () => void;
  /** Close the host checkout (used for Escape when idle / on the success screen). */
  onExit?: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>(simulation ? "auto" : "success");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const checkout = useCheckout(outcome);
  const {
    channel,
    setChannel,
    phase,
    accent,
    isTerminal,
    isLive,
    // upi
    upiMethod,
    appLabel,
    vpa,
    setVpa,
    reference,
    secondsLeft,
    startUpi,
    expire,
    // cash
    received,
    balance,
    lastNote,
    notePulse,
    canConfirmCash,
    addDenomination,
    setExact,
    setCashAmount,
    clearCash,
    confirmCash,
    settledReceived,
    settledChange,
    drawerOpen,
    // card
    card,
    updateCard,
    cardFocus,
    setCardFocus,
    cardKind,
    setCardKind,
    cardValidation,
    canPayCard,
    startCard,
    // shared
    cancel,
    reset,
    retry,
  } = checkout;

  const payload = useMemo(() => buildUpiPayload(reference), [reference]);
  const timeLabel = clock(secondsLeft);
  const captions =
    channel === "cash" ? CASH_CAPTIONS : channel === "card" ? CARD_CAPTIONS : UPI_CAPTIONS;
  const cardLast4 = card.number.replace(/\D/g, "").slice(-4);

  // wire a real bill into the shared ORDER/AMOUNT values
  useEffect(() => {
    if (amountCents == null) return;
    configureOrder({ amountCents, payee, lines });
  }, [amountCents, payee, lines]);

  // notify the host once per terminal outcome (success / failed / expired / cancelled)
  const settledRef = useRef(false);
  useEffect(() => {
    if (!isTerminal) {
      settledRef.current = false;
      return;
    }
    if (settledRef.current) return;
    settledRef.current = true;
    onSettled?.({ phase, channel });
  }, [isTerminal, phase, channel, onSettled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (receiptOpen) setReceiptOpen(false);
      else if (isLive) cancel();
      else onExit?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLive, cancel, receiptOpen, onExit]);

  const methodLabel =
    channel === "cash"
      ? settledChange > 0
        ? `Cash · ₹${settledReceived} tendered`
        : "Cash · exact"
      : channel === "card"
        ? `${cardKind === "debit" ? "Debit" : "Credit"} · ${cardValidation.brand.toUpperCase()} •••• ${cardLast4 || "0000"}`
        : upiMethod === "app"
        ? (appLabel ?? "UPI app")
        : upiMethod === "upi-id"
          ? `UPI ID · ${vpa}`
          : "QR scan";

  const channelLocked = isLive || phase === "success";

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <Environment accent={accent} />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 sm:py-8">
        <Header
          phase={phase}
          accentRgb={ACCENTS[accent].rgb}
          channel={channel}
          onChannel={setChannel}
          channelLocked={channelLocked}
        />

        <main className="flex flex-1 items-center py-8">
          <motion.div
            layout
            transition={{ duration: 0.9, ease }}
            className={`w-full ${
              isTerminal
                ? "flex flex-col items-center gap-10"
                : "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-10"
            }`}
          >
            {/* ── hero column ── */}
            <motion.div
              layout
              transition={{ duration: 0.9, ease }}
              className={isTerminal ? "w-full max-w-[24rem]" : "w-full"}
            >
              <AnimatePresence>
                {!isTerminal && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8, height: 0 }}
                    transition={{ duration: 0.5, ease }}
                    className="mb-6 flex items-end justify-between"
                  >
                    <div>
                      <p className="text-[10px] tracking-[0.42em] text-white/30">STEP 03</p>
                      <h1 className="mt-2 text-[2rem] font-light leading-none tracking-tight text-white sm:text-[2.4rem]">
                        Payment
                      </h1>
                    </div>
                    <p className="hidden text-right text-[11px] leading-relaxed text-white/35 sm:block">
                      {channel === "cash" ? (
                        <>
                          Physical tender
                          <br />
                          <span className="text-white/60">Instant till record</span>
                        </>
                      ) : channel === "card" ? (
                        <>
                          Secure payment
                          <br />
                          <span className="text-white/60">Encrypted transaction</span>
                        </>
                      ) : (
                        <>
                          Instant settlement
                          <br />
                          <span className="text-white/60">Zero convenience fee</span>
                        </>
                      )}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className={isTerminal ? "" : "mx-auto max-w-[26rem] lg:mx-0"}>
                <AnimatePresence mode="wait">
                  {channel === "cash" ? (
                    <motion.div
                      key="cash-hero"
                      initial={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
                      transition={{ duration: 0.5, ease }}
                    >
                      <CashHero
                        phase={phase}
                        accent={accent}
                        received={received}
                        balance={balance}
                        lastNote={lastNote}
                        notePulse={notePulse}
                        reference={reference}
                        drawerOpen={drawerOpen}
                        caption={captions[phase]}
                      />
                    </motion.div>
                  ) : channel === "card" ? (
                    <motion.div
                      key="card-hero"
                      initial={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
                      transition={{ duration: 0.5, ease }}
                    >
                      <CardHero
                        phase={phase}
                        accent={accent}
                        card={card}
                        brand={cardValidation.brand}
                        focus={cardFocus}
                        cardKind={cardKind}
                        reference={reference}
                        caption={captions[phase]}
                      />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="upi-hero"
                      initial={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
                      transition={{ duration: 0.5, ease }}
                    >
                      <HeroModule
                        phase={phase}
                        accent={accent}
                        payload={payload}
                        reference={reference}
                        timeLabel={timeLabel}
                        caption={captions[phase]}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <AnimatePresence>
                {!isTerminal && (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ duration: 0.6, ease }}
                    className="mx-auto mt-8 max-w-[26rem] lg:mx-0 lg:max-w-none"
                  >
                    <AnimatePresence mode="wait">
                      {channel === "cash" ? (
                        <motion.div
                          key="cash-pad"
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.4, ease }}
                        >
                          <CashPad
                            accent={accent}
                            disabled={phase !== "idle"}
                            received={received}
                            balance={balance}
                            onAdd={addDenomination}
                            onExact={setExact}
                            onClear={clearCash}
                            onSetAmount={setCashAmount}
                          />
                        </motion.div>
                      ) : channel === "card" ? (
                        <motion.div
                          key="card-form"
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.4, ease }}
                        >
                          <CardForm
                            accent={accent}
                            disabled={phase !== "idle"}
                            card={card}
                            focus={cardFocus}
                            brand={cardValidation.brand}
                            cardKind={cardKind}
                            onKind={setCardKind}
                            onChange={updateCard}
                            onFocus={setCardFocus}
                            onSubmit={startCard}
                          />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="upi-deck"
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.4, ease }}
                        >
                          <MethodDeck
                            accent={accent}
                            disabled={phase !== "idle"}
                            vpa={vpa}
                            onVpa={setVpa}
                            onApp={(label) => startUpi("app", label)}
                            onVpaPay={() => startUpi("upi-id")}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* ── side panel / result ── */}
            <AnimatePresence mode="wait">
              {isTerminal ? (
                <ResultStage
                  key="result"
                  channel={channel}
                  phase={phase}
                  accent={accent}
                  reference={reference}
                  method={methodLabel}
                  settledReceived={settledReceived}
                  settledChange={settledChange}
                  drawerOpen={drawerOpen}
                  redirect={redirect ?? undefined}
                  onPrimary={phase === "failed" ? retry : redirect ? (onViewOrder ?? reset) : reset}
                  onSecondary={phase === "success" ? () => setReceiptOpen(true) : reset}
                />
              ) : (
                <motion.div
                  key="panel"
                  initial={{ opacity: 0, x: 24, filter: "blur(8px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, x: 24, filter: "blur(8px)" }}
                  transition={{ duration: 0.6, ease }}
                  className="mx-auto w-full max-w-[26rem] lg:mx-0 lg:sticky lg:top-8"
                >
                  <PaymentPanel
                    channel={channel}
                    phase={phase}
                    accent={accent}
                    reference={reference}
                    timeLabel={timeLabel}
                    received={received}
                    balance={balance}
                    canConfirmCash={canConfirmCash}
                    canPayCard={canPayCard}
                    cardBrand={cardValidation.brand}
                    cardLast4={cardLast4}
                    cardKind={cardKind}
                    onPay={() => startUpi("qr")}
                    onConfirmCash={confirmCash}
                    onPayCard={startCard}
                    onCancel={cancel}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </main>

        <Footer
          channel={channel}
          outcome={outcome}
          onOutcome={setOutcome}
          onExpire={expire}
          disabled={phase !== "idle"}
          simulation={simulation}
        />

        {receiptOpen && phase === "success" && (
          <Receipt
            channel={channel}
            accent={accent}
            reference={reference}
            method={methodLabel}
            settledReceived={settledReceived}
            settledChange={settledChange}
            onClose={() => setReceiptOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function Header({
  phase,
  accentRgb,
  channel,
  onChannel,
  channelLocked,
}: {
  phase: Phase;
  accentRgb: string;
  channel: Channel;
  onChannel: (c: Channel) => void;
  channelLocked: boolean;
}) {
  const steps = ["CART", "SHIPPING", "PAYMENT"];
  const channels: { id: Channel; label: string }[] = [
    { id: "card", label: "CARD" },
    { id: "upi", label: "UPI" },
    { id: "cash", label: "CASH" },
  ];

  return (
    <header className="flex flex-col gap-4 border-b border-white/[0.07] pb-5">
      <div className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/15 bg-white/[0.05] text-[13px] font-semibold tracking-tight text-white"
            style={{ boxShadow: `0 0 26px -8px rgba(${accentRgb},0.9)` }}
          >
            C
          </span>
          <span className="text-[13px] font-medium tracking-[0.42em] text-white/85">CODEXR</span>
        </div>

        <nav className="hidden items-center gap-5 sm:flex">
          {steps.map((s, i) => {
            const active = i === 2;
            return (
              <span key={s} className="flex items-center gap-5">
                <span
                  className={`flex items-center gap-1.5 text-[10px] tracking-[0.28em] transition-colors ${
                    active ? "text-white" : "text-white/25"
                  }`}
                >
                  {!active && <span className="text-emerald-300/50">✓</span>}
                  {s}
                </span>
                {i < steps.length - 1 && <span className="h-px w-6 bg-white/10" />}
              </span>
            );
          })}
          <span
            className="ml-1 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.16em]"
            style={{
              borderColor: `rgba(${accentRgb},0.35)`,
              color: `rgba(${accentRgb},0.95)`,
              background: `rgba(${accentRgb},0.08)`,
            }}
          >
            03
          </span>
        </nav>

        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: `rgba(${accentRgb},1)`,
              boxShadow: `0 0 10px 2px rgba(${accentRgb},0.8)`,
              animation: "dotPulse 1.8s ease-in-out infinite",
            }}
          />
          <span className="font-mono text-[10px] tracking-[0.2em] text-white/45">
            {phase.toUpperCase()}
          </span>
        </div>
      </div>

      {/* channel switcher */}
      <div className="flex items-center justify-between gap-4">
        <div
          className={`glass-soft inline-flex items-center gap-0.5 rounded-full p-1 ${
            channelLocked ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {channels.map((c) => {
            const active = c.id === channel;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChannel(c.id)}
                className={`relative rounded-full px-4 py-1.5 text-[10px] tracking-[0.28em] transition-colors ${
                  active ? "text-black" : "text-white/40 hover:text-white/75"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="channel-pill"
                    transition={{ duration: 0.45, ease }}
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, rgba(${accentRgb},0.95), rgba(255,255,255,0.92))`,
                      boxShadow: `0 4px 18px -6px rgba(${accentRgb},0.9)`,
                    }}
                  />
                )}
                <span className="relative z-10">{c.label}</span>
              </button>
            );
          })}
        </div>

        <p className="hidden font-mono text-[10px] tracking-[0.18em] text-white/25 md:block">
          {channel === "cash"
            ? "POS · PHYSICAL TENDER"
            : channel === "card"
              ? "VISA · MASTERCARD · RUPAY · AMEX"
              : "NPCI · QR · APP · VPA"}
        </p>
      </div>
    </header>
  );
}

function Footer({
  channel,
  outcome,
  onOutcome,
  onExpire,
  disabled,
  simulation,
}: {
  channel: Channel;
  outcome: Outcome;
  onOutcome: (o: Outcome) => void;
  onExpire: () => void;
  disabled: boolean;
  simulation: boolean;
}) {
  const options: Outcome[] = ["auto", "success", "pending", "failed"];
  return (
    <footer className="flex flex-col items-center justify-between gap-4 border-t border-white/[0.07] pt-5 sm:flex-row">
      <p className="font-mono text-[10px] tracking-[0.18em] text-white/25">
        ₹{ORDER.amount}.00 · {ORDER.payee} · {ORDER.merchantCity}
        {channel === "cash" ? ` · T${ORDER.table}` : ""}
      </p>

      <div className="flex items-center gap-3">
        {simulation && channel !== "cash" && (
          <>
            <span className="text-[9px] tracking-[0.3em] text-white/25">SIMULATE</span>
            <div className="glass-soft flex items-center gap-0.5 rounded-full p-1">
              {options.map((o) => {
                const active = o === outcome;
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => onOutcome(o)}
                    className={`relative rounded-full px-3 py-1.5 text-[9.5px] tracking-[0.2em] transition-colors ${
                      active ? "text-black" : "text-white/40 hover:text-white/75"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="outcome-pill"
                        transition={{ duration: 0.45, ease }}
                        className="absolute inset-0 rounded-full bg-white/90"
                      />
                    )}
                    <span className="relative z-10">{o.toUpperCase()}</span>
                  </button>
                );
              })}
            </div>
            {channel === "upi" && (
            <button
              type="button"
              onClick={onExpire}
              disabled={disabled}
              className="rounded-full border border-white/10 px-3 py-1.5 text-[9.5px] tracking-[0.2em] text-white/35 transition-colors hover:border-white/25 hover:text-white/70 disabled:opacity-30"
            >
              EXPIRE
            </button>
            )}
          </>
        )}
        {channel === "cash" && (
          <span className="text-[9px] tracking-[0.28em] text-white/25">
            DENOMINATION PAD · CHANGE ENGINE · DRAWER
          </span>
        )}
      </div>
    </footer>
  );
}
