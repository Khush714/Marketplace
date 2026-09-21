import { useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  ACCENTS,
  type Accent,
  type CardBrand,
  type CardDetails,
  type CardField,
  type CardKind,
  formatINR,
  ORDER,
  type Phase,
} from "../lib/checkout";

const ease = [0.22, 1, 0.36, 1] as const;

type Props = {
  phase: Phase;
  accent: Accent;
  card: CardDetails;
  brand: CardBrand;
  focus: CardField;
  cardKind: CardKind;
  reference: string;
  caption: string;
};

export default function CardHero({
  phase,
  accent,
  card,
  brand,
  focus,
  cardKind,
  reference,
  caption,
}: Props) {
  const rgb = ACCENTS[accent].rgb;
  const settled = phase === "success" || phase === "failed" || phase === "cancelled";
  const processing = phase === "initiated" || phase === "verifying" || phase === "pending";
  const flipped = focus === "cvv" && phase === "idle";

  /* ── parallax (tiny: ±4° / ±6°) ── */
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotX = useSpring(useTransform(my, [-0.5, 0.5], [4, -4]), { stiffness: 120, damping: 18 });
  const rotY = useSpring(useTransform(mx, [-0.5, 0.5], [-6, 6]), { stiffness: 120, damping: 18 });
  const glareX = useTransform(mx, [-0.5, 0.5], ["20%", "80%"]);
  const glareY = useTransform(my, [-0.5, 0.5], ["10%", "90%"]);
  const stageRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (processing || settled) return;
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      mx.set((e.clientX - r.left) / r.width - 0.5);
      my.set((e.clientY - r.top) / r.height - 0.5);
    },
    [mx, my, processing, settled],
  );
  const onLeave = useCallback(() => {
    mx.set(0);
    my.set(0);
  }, [mx, my]);

  useEffect(() => {
    if (processing || settled) {
      mx.set(0);
      my.set(0);
    }
  }, [processing, settled, mx, my]);

  return (
    <div className="relative [perspective:1600px]">
      <div
        className="anim-breathe pointer-events-none absolute -inset-10 rounded-[60px] blur-[60px] transition-[background] duration-[1200ms]"
        style={{
          background: `radial-gradient(circle at 50% 45%, rgba(${rgb},0.34), rgba(${rgb},0.06) 46%, transparent 72%)`,
        }}
      />

      <motion.div layout transition={{ duration: 0.8, ease }}>
        <div className={`transition-transform duration-700 ${settled ? "scale-[0.975]" : ""}`}>
          <div
            className="glass edge-sheen relative overflow-hidden rounded-[34px] p-5 transition-[box-shadow,border-color] duration-[1200ms] sm:p-6"
            style={{
              borderColor: `rgba(${rgb},0.22)`,
              boxShadow: `0 0 0 1px rgba(${rgb},0.07), 0 30px 80px -40px rgba(${rgb},0.55), 0 40px 90px -40px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.08)`,
            }}
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[34px]">
              <div className="anim-sheen absolute -inset-y-24 left-0 w-40 bg-gradient-to-r from-transparent via-white/12 to-transparent" />
            </div>

            {/* header */}
            <div className="relative mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl border"
                  style={{
                    borderColor: `rgba(${rgb},0.3)`,
                    background: `linear-gradient(145deg, rgba(${rgb},0.22), rgba(255,255,255,0.02))`,
                    color: ACCENTS[accent].soft,
                  }}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                    <path d="M2.5 10h19" />
                    <path d="M6 15h4" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="leading-tight">
                  <p className="flex items-center gap-2 text-[11px] font-medium tracking-[0.28em] text-white/80">
                    CARD PAYMENT
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={cardKind}
                        initial={{ opacity: 0, y: -3 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 3 }}
                        transition={{ duration: 0.25 }}
                        className="rounded-full border px-1.5 py-px text-[8px] tracking-[0.2em]"
                        style={{
                          borderColor: `rgba(${rgb},0.4)`,
                          color: ACCENTS[accent].soft,
                          background: `rgba(${rgb},0.1)`,
                        }}
                      >
                        {cardKind.toUpperCase()}
                      </motion.span>
                    </AnimatePresence>
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.12em] text-white/35">
                    REF {reference.slice(0, 8)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] tracking-[0.16em] text-white/55">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: `rgba(${rgb},1)`, boxShadow: `0 0 8px 2px rgba(${rgb},0.7)` }}
                />
                <span className="font-mono">3-D SECURE</span>
              </div>
            </div>

            {/* stage */}
            <div
              ref={stageRef}
              onPointerMove={onMove}
              onPointerLeave={onLeave}
              className="relative mx-auto aspect-square w-full max-w-[19rem]"
            >
              <div
                className="absolute inset-0 rounded-[26px] border transition-colors duration-[1200ms]"
                style={{
                  borderColor: `rgba(${rgb},0.18)`,
                  background:
                    "linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01) 45%, rgba(0,0,0,0.25))",
                  boxShadow: "inset 0 2px 20px rgba(0,0,0,0.55)",
                }}
              />
              <Brackets rgb={rgb} />

              <div className="absolute inset-[14px] flex flex-col items-center justify-center overflow-hidden rounded-[18px] [perspective:1200px]">
                {/* the card */}
                <motion.div
                  className="relative w-[92%]"
                  animate={{
                    scale: processing ? 0.86 : settled ? 0.9 : 1,
                    y: processing ? -26 : settled ? -22 : 0,
                  }}
                  transition={{ duration: 0.9, ease }}
                  style={{ rotateX: rotX, rotateY: rotY, transformStyle: "preserve-3d" }}
                >
                  <motion.div
                    className={processing || settled ? "" : "anim-float"}
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    <motion.div
                      className="relative aspect-[1.586/1] w-full"
                      animate={{ rotateY: flipped ? 180 : 0 }}
                      transition={{ duration: 0.75, ease }}
                      style={{ transformStyle: "preserve-3d" }}
                    >
                      <CardFace
                        side="front"
                        card={card}
                        brand={brand}
                        accent={accent}
                        phase={phase}
                        focus={focus}
                        cardKind={cardKind}
                        glareX={glareX}
                        glareY={glareY}
                      />
                      <CardFace
                        side="back"
                        card={card}
                        brand={brand}
                        accent={accent}
                        phase={phase}
                        focus={focus}
                        cardKind={cardKind}
                        glareX={glareX}
                        glareY={glareY}
                      />
                    </motion.div>
                  </motion.div>

                  {/* ground shadow */}
                  <div
                    className="pointer-events-none absolute inset-x-6 -bottom-5 h-6 rounded-full blur-xl transition-opacity duration-700"
                    style={{ background: `rgba(${rgb},0.35)`, opacity: processing ? 0.5 : 0.8 }}
                  />
                </motion.div>

                {/* processing indicator beneath the card */}
                <AnimatePresence>
                  {processing && (
                    <motion.div
                      key="loader"
                      initial={{ opacity: 0, y: 10, scale: 0.8 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.5, ease }}
                      className="absolute bottom-7 flex flex-col items-center"
                    >
                      <div className="relative h-11 w-11">
                        <div
                          className="anim-spin-med absolute inset-0 rounded-full"
                          style={{
                            background: `conic-gradient(from 0deg, rgba(${rgb},0) 0deg, rgba(${rgb},0) 210deg, rgba(${rgb},0.9) 340deg, #fff 360deg)`,
                            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0)",
                            mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0)",
                          }}
                        />
                        <div
                          className="anim-spin-rev absolute inset-[7px] rounded-full"
                          style={{
                            background: `conic-gradient(from 180deg, rgba(255,255,255,0) 0deg, rgba(${rgb},0.6) 130deg, rgba(255,255,255,0) 220deg)`,
                            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 0)",
                            mask: "radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 0)",
                          }}
                        />
                        <span
                          className="anim-breathe absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                          style={{ boxShadow: `0 0 14px 4px rgba(${rgb},0.8)` }}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* success / fail glyph beneath the card */}
                <AnimatePresence>
                  {phase === "success" && (
                    <motion.div
                      key="ok"
                      initial={{ opacity: 0, scale: 0.6, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ duration: 0.55, ease, delay: 0.25 }}
                      className="absolute bottom-6 flex items-center justify-center"
                    >
                      <span className="anim-pulse-ring absolute h-14 w-14 rounded-full border border-emerald-300/50" />
                      <span
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300/40"
                        style={{
                          background:
                            "radial-gradient(circle at 35% 25%, rgba(167,243,208,0.35), rgba(16,185,129,0.22) 45%, rgba(4,60,45,0.5))",
                          boxShadow: "0 0 40px -6px rgba(16,185,129,0.7)",
                        }}
                      >
                        <svg viewBox="0 0 48 48" className="h-6 w-6" fill="none">
                          <path
                            d="M13 25.5 20.5 33 35 16"
                            stroke="#ecfdf5"
                            strokeWidth="3.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="anim-draw-check"
                          />
                        </svg>
                      </span>
                      {Array.from({ length: 10 }).map((_, i) => {
                        const a = (i / 10) * Math.PI * 2;
                        const d = 48 + (i % 3) * 14;
                        return (
                          <span
                            key={i}
                            className="anim-particle absolute h-1 w-1 rounded-full bg-emerald-200"
                            style={
                              {
                                "--px": `${Math.cos(a) * d}px`,
                                "--py": `${Math.sin(a) * d}px`,
                                animationDelay: `${0.3 + (i % 4) * 0.05}s`,
                                boxShadow: "0 0 10px 2px rgba(52,211,153,0.8)",
                              } as React.CSSProperties
                            }
                          />
                        );
                      })}
                    </motion.div>
                  )}
                  {(phase === "failed" || phase === "cancelled") && (
                    <motion.div
                      key="fail"
                      initial={{ opacity: 0, scale: 0.6, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0, x: [0, -5, 5, -3, 3, 0] }}
                      transition={{ duration: 0.6, ease }}
                      className="absolute bottom-6 flex h-12 w-12 items-center justify-center rounded-full border border-[#e06a6a]/35"
                      style={{
                        background:
                          "radial-gradient(circle at 35% 25%, rgba(243,184,184,0.22), rgba(224,106,106,0.14) 45%, rgba(40,16,16,0.45))",
                        boxShadow: "0 0 34px -10px rgba(224,106,106,0.5)",
                      }}
                    >
                      <svg viewBox="0 0 48 48" className="h-6 w-6" fill="none">
                        <motion.path d="M16 16 32 32" stroke="#f3b8b8" strokeWidth="3.4" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.1 }} />
                        <motion.path d="M32 16 16 32" stroke="#f3b8b8" strokeWidth="3.4" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.28 }} />
                      </svg>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {phase === "success" && (
                <div className="anim-flash pointer-events-none absolute -inset-6 rounded-[32px] bg-white blur-2xl" />
              )}
            </div>

            {/* caption */}
            <div className="relative mt-5 h-10 text-center">
              <AnimatePresence mode="wait">
                <motion.p
                  key={caption}
                  initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
                  transition={{ duration: 0.45, ease }}
                  className={`text-[12.5px] tracking-[0.2em] uppercase ${
                    processing ? "anim-shimmer-text" : "text-white/55"
                  }`}
                >
                  {caption}
                </motion.p>
              </AnimatePresence>
              <p className="mt-1.5 font-mono text-[10px] tracking-[0.18em] text-white/25">
                PCI-DSS · TOKENISED · 3-D SECURE 2.0
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ── card faces ─────────────────────────────────────────── */

type FaceProps = {
  side: "front" | "back";
  card: CardDetails;
  brand: CardBrand;
  accent: Accent;
  phase: Phase;
  focus: CardField;
  cardKind: CardKind;
  glareX: ReturnType<typeof useTransform<number, string>>;
  glareY: ReturnType<typeof useTransform<number, string>>;
};

function CardFace({ side, card, brand, accent, phase, focus, cardKind, glareX, glareY }: FaceProps) {
  const rgb = ACCENTS[accent].rgb;
  const success = phase === "success";
  const failed = phase === "failed" || phase === "cancelled";

  const surface = success
    ? "linear-gradient(135deg, #0b2a20 0%, #10382b 40%, #071b15 100%)"
    : failed
      ? "linear-gradient(135deg, #2a1414 0%, #1a0d0d 60%, #120808 100%)"
      : "linear-gradient(135deg, #1c1c20 0%, #0e0e11 45%, #17171b 100%)";

  const numberDisplay = card.number || "•••• •••• •••• ••••";
  const nameDisplay = card.name || "CARDHOLDER NAME";
  const expiryDisplay = card.expiry || "MM / YY";
  const cvvDisplay = card.cvv ? "•".repeat(card.cvv.length) : "•••";

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[16px] border transition-[border-color,box-shadow] duration-[900ms]"
      style={{
        background: surface,
        borderColor: `rgba(${rgb},0.45)`,
        boxShadow: `0 0 0 1px rgba(${rgb},0.1), 0 28px 60px -22px rgba(0,0,0,0.95), 0 0 50px -12px rgba(${rgb},0.55), inset 0 1px 0 rgba(255,255,255,0.14)`,
        transform: side === "back" ? "rotateY(180deg)" : "rotateY(0deg)",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
      }}
    >
      {/* metallic edge + ambient tint */}
      <div
        className="pointer-events-none absolute inset-0 transition-[background] duration-[900ms]"
        style={{
          background: `radial-gradient(120% 80% at 90% 0%, rgba(${rgb},0.22), transparent 55%), radial-gradient(80% 60% at 0% 100%, rgba(${rgb},0.12), transparent 60%)`,
        }}
      />
      {/* fine texture lines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgba(255,255,255,0.4) 0px, rgba(255,255,255,0.4) 1px, transparent 1px, transparent 7px)",
        }}
      />
      {/* moving glare (parallax-linked) */}
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-60 mix-blend-soft-light"
        style={{
          background: useTransform(
            [glareX, glareY],
            ([x, y]) =>
              `radial-gradient(60% 45% at ${x} ${y}, rgba(255,255,255,0.55), rgba(255,255,255,0) 70%)`,
          ),
        }}
      />

      {side === "front" ? (
        <div className="relative flex h-full flex-col justify-between p-4 sm:p-[18px]">
          <div className="flex items-start justify-between">
            <span
              className="font-mono text-[9px] tracking-[0.3em]"
              style={{ color: `rgba(${rgb},0.9)` }}
            >
              {success
                ? "APPROVED"
                : failed
                  ? "DECLINED"
                  : `CODEXR ${cardKind === "debit" ? "DEBIT" : "CREDIT"}`}
            </span>
            <Contactless rgb={rgb} />
          </div>

          <div className="flex items-center gap-3">
            <Chip rgb={rgb} />
          </div>

          <div>
            <p
              className={`font-mono text-[15px] tracking-[0.18em] transition-colors duration-300 sm:text-[16px] ${
                focus === "number" ? "text-white" : "text-white/85"
              }`}
              style={focus === "number" ? { textShadow: `0 0 14px rgba(${rgb},0.6)` } : undefined}
            >
              {numberDisplay}
            </p>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-[7px] tracking-[0.3em] text-white/35">CARDHOLDER</p>
                <p
                  className={`mt-0.5 truncate font-mono text-[10.5px] tracking-[0.14em] transition-colors ${
                    focus === "name" ? "text-white" : "text-white/80"
                  }`}
                  style={{ maxWidth: "9.5rem" }}
                >
                  {nameDisplay}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[7px] tracking-[0.3em] text-white/35">EXPIRES</p>
                <p
                  className={`mt-0.5 font-mono text-[10.5px] tracking-[0.14em] transition-colors ${
                    focus === "expiry" ? "text-white" : "text-white/80"
                  }`}
                >
                  {expiryDisplay}
                </p>
              </div>
              <BrandMark brand={brand} rgb={rgb} />
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex h-full flex-col">
          <div className="mt-5 h-9 w-full bg-gradient-to-r from-black via-[#0a0a0a] to-black" />
          <div className="px-4 pt-4 sm:px-[18px]">
            <div className="flex items-center gap-2">
              <div
                className="h-8 flex-1 rounded-[4px]"
                style={{
                  background:
                    "repeating-linear-gradient(0deg, rgba(255,255,255,0.75) 0px, rgba(255,255,255,0.75) 1px, rgba(230,230,230,0.6) 1px, rgba(230,230,230,0.6) 4px)",
                }}
              />
              <div
                className="flex h-8 w-16 items-center justify-center rounded-[4px] bg-[#f4f4f2] font-mono text-[12px] tracking-[0.3em] text-[#111]"
                style={
                  focus === "cvv" ? { boxShadow: `0 0 0 2px rgba(${rgb},0.8), 0 0 18px rgba(${rgb},0.6)` } : undefined
                }
              >
                {cvvDisplay}
              </div>
            </div>
            <p className="mt-2 text-right text-[7px] tracking-[0.3em] text-white/35">CVV</p>
          </div>
          <div className="mt-auto flex items-center justify-between px-4 pb-4 sm:px-[18px]">
            <p className="text-[7px] leading-relaxed tracking-[0.18em] text-white/25">
              AUTHORISED SIGNATURE · NOT VALID UNLESS SIGNED
            </p>
            <BrandMark brand={brand} rgb={rgb} muted />
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ rgb }: { rgb: string }) {
  return (
    <div
      className="relative h-8 w-11 overflow-hidden rounded-[6px] border"
      style={{
        borderColor: `rgba(${rgb},0.55)`,
        background: `linear-gradient(135deg, #f0c48a 0%, #b8823f 40%, #e8b76b 70%, #a8752f 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.5), 0 2px 6px rgba(0,0,0,0.5)`,
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-px bg-black/35" />
      <div className="absolute inset-y-0 left-1/3 w-px bg-black/35" />
      <div className="absolute inset-y-0 right-1/3 w-px bg-black/35" />
      <div className="absolute left-1/3 right-1/3 top-[22%] bottom-[22%] rounded-[3px] border border-black/35" />
    </div>
  );
}

function Contactless({ rgb }: { rgb: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={`rgba(${rgb},0.85)`} strokeWidth="1.5" strokeLinecap="round">
      <path d="M8.5 8.5a5 5 0 0 1 0 7" />
      <path d="M11.5 6a9 9 0 0 1 0 12" />
      <path d="M14.5 3.5a13 13 0 0 1 0 17" />
      <path d="M5.5 11a1.5 1.5 0 0 1 0 2" />
    </svg>
  );
}

function BrandMark({ brand, rgb, muted }: { brand: CardBrand; rgb: string; muted?: boolean }) {
  const op = muted ? 0.45 : 1;
  if (brand === "visa")
    return (
      <span className="text-[15px] font-bold italic tracking-tight text-white" style={{ opacity: op }}>
        VISA
      </span>
    );
  if (brand === "mastercard")
    return (
      <span className="relative flex h-5 w-8" style={{ opacity: op }}>
        <span className="absolute left-0 h-5 w-5 rounded-full bg-[#eb5b2a]/90" />
        <span className="absolute right-0 h-5 w-5 rounded-full bg-[#f5b43c]/85 mix-blend-screen" />
      </span>
    );
  if (brand === "amex")
    return (
      <span className="rounded-[3px] border border-white/40 px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.18em] text-white" style={{ opacity: op }}>
        AMEX
      </span>
    );
  if (brand === "rupay")
    return (
      <span className="text-[12px] font-semibold tracking-tight text-white" style={{ opacity: op }}>
        Ru<span style={{ color: `rgba(${rgb},1)` }}>Pay</span>
      </span>
    );
  return (
    <span className="h-5 w-8 rounded-[4px] border border-dashed border-white/20" style={{ opacity: op }} />
  );
}

function Brackets({ rgb }: { rgb: string }) {
  const base = "absolute h-6 w-6 transition-colors duration-[1200ms]";
  const style = { borderColor: `rgba(${rgb},0.6)` };
  return (
    <div className="pointer-events-none absolute inset-1">
      <span className={`${base} left-0 top-0 rounded-tl-[14px] border-l border-t`} style={style} />
      <span className={`${base} right-0 top-0 rounded-tr-[14px] border-r border-t`} style={style} />
      <span className={`${base} bottom-0 left-0 rounded-bl-[14px] border-b border-l`} style={style} />
      <span className={`${base} bottom-0 right-0 rounded-br-[14px] border-b border-r`} style={style} />
    </div>
  );
}

export function cardAmountLabel() {
  return `₹${formatINR(ORDER.amount)}`;
}
