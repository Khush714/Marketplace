import { AnimatePresence, motion } from "framer-motion";
import { ACCENTS, type Accent, type Phase } from "../lib/checkout";
import QrArt from "./QrArt";
import { LockMark, UpiMark } from "./Glyphs";

type Props = {
  phase: Phase;
  accent: Accent;
  payload: string;
  reference: string;
  timeLabel: string;
  caption: string;
};

const stageKey = (phase: Phase) => {
  if (phase === "success") return "success";
  if (phase === "failed" || phase === "cancelled") return "fail";
  if (phase === "verifying" || phase === "pending") return "verify";
  return "qr";
};

const ease = [0.22, 1, 0.36, 1] as const;

export default function HeroModule({
  phase,
  accent,
  payload,
  reference,
  timeLabel,
  caption,
}: Props) {
  const rgb = ACCENTS[accent].rgb;
  const key = stageKey(phase);
  const initiating = phase === "initiated";
  const expired = phase === "expired";
  const settled =
    phase === "success" || phase === "failed" || phase === "cancelled";

  return (
    <div className="relative [perspective:1600px]">
      {/* breathing halo */}
      <div
        className="anim-breathe pointer-events-none absolute -inset-10 rounded-[60px] blur-[60px] transition-[background] duration-[1200ms]"
        style={{
          background: `radial-gradient(circle at 50% 45%, rgba(${rgb},0.34), rgba(${rgb},0.06) 46%, transparent 72%)`,
        }}
      />

      <motion.div layout transition={{ duration: 0.8, ease }}>
        <div
          className={`transition-transform duration-700 ${settled ? "scale-[0.975]" : "anim-float"}`}
        >
          <div
            className="glass edge-sheen relative overflow-hidden rounded-[34px] p-5 transition-[box-shadow,border-color] duration-[1200ms] sm:p-6"
            style={{
              borderColor: `rgba(${rgb},0.22)`,
              boxShadow: `0 0 0 1px rgba(${rgb},0.07), 0 30px 80px -40px rgba(${rgb},0.55), 0 40px 90px -40px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.08)`,
            }}
          >
            {/* moving glass reflection */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[34px]">
              <div className="anim-sheen absolute -inset-y-24 left-0 w-40 bg-gradient-to-r from-transparent via-white/12 to-transparent" />
            </div>

            {/* header */}
            <div className="relative mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl border text-[10px]"
                  style={{
                    borderColor: `rgba(${rgb},0.3)`,
                    background: `linear-gradient(145deg, rgba(${rgb},0.22), rgba(255,255,255,0.02))`,
                    color: ACCENTS[accent].soft,
                  }}
                >
                  <UpiMark className="h-3" />
                </span>
                <div className="leading-tight">
                  <p className="text-[11px] font-medium tracking-[0.28em] text-white/80">
                    UPI PAYMENT
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.12em] text-white/35">
                    REF {reference}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] tracking-[0.16em] text-white/55">
                <LockMark className="h-3 w-3" />
                <span className="font-mono">{timeLabel}</span>
              </div>
            </div>

            {/* stage */}
            <div className="relative mx-auto aspect-square w-full max-w-[19rem]">
              {/* inner recess */}
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

              <div className="absolute inset-[14px] overflow-hidden rounded-[18px]">
                <AnimatePresence mode="wait">
                  {key === "qr" && (
                    <motion.div
                      key="qr"
                      className="relative h-full w-full"
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{
                        opacity: 1,
                        scale: initiating ? 0.84 : 1,
                        filter: expired ? "grayscale(1) blur(1.5px)" : "none",
                      }}
                      exit={{ opacity: 0, scale: 0.6, filter: "blur(8px)" }}
                      transition={{ duration: initiating ? 0.9 : 0.55, ease }}
                    >
                      <div className="relative h-full w-full overflow-hidden rounded-[12px] bg-[#f7f7f5] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)]">
                        <QrArt payload={payload} />

                        {/* centre chip */}
                        <div className="absolute left-1/2 top-1/2 flex h-[19%] w-[19%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[6px] bg-[#f7f7f5] p-[3%]">
                          <span className="flex h-full w-full items-center justify-center rounded-[4px] bg-gradient-to-br from-[#0b0b0c] to-[#26262a] text-[#ffd79a]">
                            <UpiMark className="h-[42%]" />
                          </span>
                        </div>

                        {/* scanning beam — environment moves, code never does */}
                        {!expired && (
                          <div className="pointer-events-none absolute inset-0 overflow-hidden">
                            <div className="anim-beam absolute inset-x-0 top-0 h-[30%]">
                              <div
                                className="absolute inset-x-0 bottom-0 h-full"
                                style={{
                                  background: `linear-gradient(to bottom, rgba(${rgb},0) 0%, rgba(${rgb},0.18) 70%, rgba(${rgb},0.34) 100%)`,
                                }}
                              />
                              <div
                                className="absolute inset-x-0 bottom-0 h-[2px] blur-[0.5px]"
                                style={{
                                  background: `linear-gradient(to right, transparent, rgba(255,240,220,0.95), rgba(${rgb},1), rgba(255,240,220,0.95), transparent)`,
                                  boxShadow: `0 0 18px 2px rgba(${rgb},0.85)`,
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* glass reflection over the code */}
                        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0)_38%)] opacity-40 mix-blend-overlay" />
                      </div>

                      {initiating && <SignalBurst rgb={rgb} />}

                      {expired && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-[12px] bg-black/55 backdrop-blur-[2px]">
                          <span className="rounded-full border border-white/15 bg-black/60 px-3 py-1 text-[10px] tracking-[0.24em] text-white/70">
                            QR EXPIRED
                          </span>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {key === "verify" && (
                    <motion.div
                      key="verify"
                      className="flex h-full w-full items-center justify-center"
                      initial={{
                        opacity: 0,
                        scale: 1.12,
                        filter: "blur(10px)",
                      }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.9, filter: "blur(8px)" }}
                      transition={{ duration: 0.6, ease }}
                    >
                      <VerifyOrb rgb={rgb} pending={phase === "pending"} />
                    </motion.div>
                  )}

                  {key === "success" && (
                    <motion.div
                      key="success"
                      className="flex h-full w-full items-center justify-center"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.6, ease }}
                    >
                      <SuccessGlyph />
                    </motion.div>
                  )}

                  {key === "fail" && (
                    <motion.div
                      key="fail"
                      className="flex h-full w-full items-center justify-center"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      transition={{ duration: 0.55, ease }}
                    >
                      <FailGlyph cancelled={phase === "cancelled"} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* white flash at the moment of settlement */}
              {phase === "success" && (
                <div
                  key="flash"
                  className="anim-flash pointer-events-none absolute -inset-6 rounded-[32px] bg-white blur-2xl"
                />
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
                    phase === "verifying" || phase === "pending"
                      ? "anim-shimmer-text"
                      : "text-white/55"
                  }`}
                >
                  {caption}
                </motion.p>
              </AnimatePresence>
              <p className="mt-1.5 font-mono text-[10px] tracking-[0.18em] text-white/25">
                256-BIT ENCRYPTED · NPCI SECURED
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Brackets({ rgb }: { rgb: string }) {
  const base = "absolute h-6 w-6 transition-colors duration-[1200ms]";
  const style = { borderColor: `rgba(${rgb},0.6)` };
  return (
    <div className="pointer-events-none absolute inset-1">
      <span
        className={`${base} left-0 top-0 rounded-tl-[14px] border-l border-t`}
        style={style}
      />
      <span
        className={`${base} right-0 top-0 rounded-tr-[14px] border-r border-t`}
        style={style}
      />
      <span
        className={`${base} bottom-0 left-0 rounded-bl-[14px] border-b border-l`}
        style={style}
      />
      <span
        className={`${base} bottom-0 right-0 rounded-br-[14px] border-b border-r`}
        style={style}
      />
    </div>
  );
}

/** Abstract "transaction leaving the code" pulse shown at initiation. */
function SignalBurst({ rgb }: { rgb: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
      <span
        className="absolute bottom-6 h-2 w-2 rounded-full"
        style={{
          background: `rgba(${rgb},1)`,
          boxShadow: `0 0 22px 6px rgba(${rgb},0.75)`,
          animation: "travelUp 1.1s cubic-bezier(0.4,0,0.2,1) forwards",
        }}
      />
      <span
        className="absolute bottom-6 h-2 w-2 rounded-full"
        style={{
          background: `rgba(255,255,255,0.9)`,
          boxShadow: `0 0 18px 5px rgba(${rgb},0.6)`,
          animation: "travelUp 1.1s cubic-bezier(0.4,0,0.2,1) 0.22s forwards",
        }}
      />
    </div>
  );
}

function VerifyOrb({ rgb, pending }: { rgb: string; pending: boolean }) {
  return (
    <div className="relative flex h-[70%] w-[70%] items-center justify-center">
      {/* outer dashed ring */}
      <div
        className="anim-spin-slow absolute inset-0 rounded-full border border-dashed"
        style={{ borderColor: `rgba(${rgb},0.35)` }}
      />
      {/* conic sweep */}
      <div
        className={`absolute inset-[12%] rounded-full ${pending ? "anim-spin-slow" : "anim-spin-med"}`}
        style={{
          background: `conic-gradient(from 0deg, rgba(${rgb},0) 0deg, rgba(${rgb},0) 200deg, rgba(${rgb},0.85) 340deg, rgba(255,255,255,0.95) 360deg)`,
          WebkitMask:
            "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)",
          filter: `drop-shadow(0 0 10px rgba(${rgb},0.6))`,
        }}
      />
      {/* reverse ring */}
      <div
        className="anim-spin-rev absolute inset-[26%] rounded-full"
        style={{
          background: `conic-gradient(from 180deg, rgba(255,255,255,0) 0deg, rgba(${rgb},0.55) 120deg, rgba(255,255,255,0) 220deg)`,
          WebkitMask:
            "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0)",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0)",
        }}
      />
      {/* orbiting satellite */}
      <div className="anim-orbit absolute inset-[6%]">
        <span
          className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
          style={{
            background: "#fff",
            boxShadow: `0 0 12px 3px rgba(${rgb},0.9)`,
          }}
        />
      </div>
      {/* core */}
      <div
        className="anim-breathe absolute inset-[38%] rounded-full blur-[6px]"
        style={{
          background: `radial-gradient(circle, rgba(${rgb},0.9), transparent 70%)`,
        }}
      />
      <span
        className="relative h-3 w-3 rounded-full"
        style={{
          background: "#fff",
          boxShadow: `0 0 26px 8px rgba(${rgb},0.8)`,
        }}
      />
      {pending && (
        <span className="absolute -bottom-2 font-mono text-[9px] tracking-[0.3em] text-white/40">
          PENDING
        </span>
      )}
    </div>
  );
}

function SuccessGlyph() {
  const particles = Array.from({ length: 14 });
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <span className="anim-pulse-ring absolute h-[58%] w-[58%] rounded-full border border-emerald-300/50" />
      <span
        className="anim-pulse-ring absolute h-[58%] w-[58%] rounded-full border border-emerald-300/30"
        style={{ animationDelay: "0.9s" }}
      />
      <div className="absolute h-[52%] w-[52%] rounded-full bg-emerald-400/20 blur-2xl" />

      <div
        className="relative flex h-[46%] w-[46%] items-center justify-center rounded-full border border-emerald-300/40"
        style={{
          background:
            "radial-gradient(circle at 35% 25%, rgba(167,243,208,0.35), rgba(16,185,129,0.22) 45%, rgba(4,60,45,0.5))",
          boxShadow:
            "0 0 50px -6px rgba(16,185,129,0.65), inset 0 1px 0 rgba(255,255,255,0.35)",
        }}
      >
        <svg
          viewBox="0 0 48 48"
          className="h-1/2 w-1/2"
          fill="none"
          aria-hidden
        >
          <path
            d="M13 25.5 20.5 33 35 16"
            stroke="#ecfdf5"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="anim-draw-check"
            style={{ filter: "drop-shadow(0 0 6px rgba(52,211,153,0.9))" }}
          />
        </svg>
      </div>

      {particles.map((_, i) => {
        const angle = (i / particles.length) * Math.PI * 2;
        const dist = 70 + (i % 3) * 22;
        return (
          <span
            key={i}
            className="anim-particle absolute h-1 w-1 rounded-full bg-emerald-200"
            style={
              {
                "--px": `${Math.cos(angle) * dist}px`,
                "--py": `${Math.sin(angle) * dist}px`,
                animationDelay: `${0.2 + (i % 5) * 0.05}s`,
                boxShadow: "0 0 10px 2px rgba(52,211,153,0.8)",
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

function FailGlyph({ cancelled }: { cancelled: boolean }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="absolute h-[50%] w-[50%] rounded-full bg-[#e06a6a]/12 blur-2xl" />
      <div
        className="relative flex h-[46%] w-[46%] items-center justify-center rounded-full border border-[#e06a6a]/35"
        style={{
          background:
            "radial-gradient(circle at 35% 25%, rgba(243,184,184,0.22), rgba(224,106,106,0.14) 45%, rgba(40,16,16,0.45))",
          boxShadow:
            "0 0 40px -10px rgba(224,106,106,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
      >
        <svg
          viewBox="0 0 48 48"
          className="h-1/2 w-1/2"
          fill="none"
          aria-hidden
        >
          {cancelled ? (
            <motion.path
              d="M24 13v14"
              stroke="#f3b8b8"
              strokeWidth="3"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, ease }}
            />
          ) : (
            <>
              <motion.path
                d="M16 16 32 32"
                stroke="#f3b8b8"
                strokeWidth="3"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, ease, delay: 0.1 }}
              />
              <motion.path
                d="M32 16 16 32"
                stroke="#f3b8b8"
                strokeWidth="3"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, ease, delay: 0.28 }}
              />
            </>
          )}
          {cancelled && <circle cx="24" cy="34" r="2" fill="#f3b8b8" />}
        </svg>
      </div>
    </div>
  );
}
