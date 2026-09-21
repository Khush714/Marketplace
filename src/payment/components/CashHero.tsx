import { AnimatePresence, motion } from "framer-motion";
import {
  ACCENTS,
  type Accent,
  type CashBalance,
  formatINR,
  ORDER,
  type Phase,
  useAnimatedNumber,
} from "../lib/checkout";

const ease = [0.22, 1, 0.36, 1] as const;

type Props = {
  phase: Phase;
  accent: Accent;
  received: number;
  balance: CashBalance;
  lastNote: number | null;
  notePulse: number;
  reference: string;
  drawerOpen: boolean;
  caption: string;
};

export default function CashHero({
  phase,
  accent,
  received,
  balance,
  lastNote,
  notePulse,
  reference,
  drawerOpen,
  caption,
}: Props) {
  const rgb = ACCENTS[accent].rgb;
  const settled = phase === "success" || phase === "failed" || phase === "cancelled";
  const verifying = phase === "initiated" || phase === "verifying";
  const animReceived = useAnimatedNumber(received, 380);

  const stage =
    phase === "success"
      ? "success"
      : phase === "failed" || phase === "cancelled"
        ? "fail"
        : verifying
          ? "verify"
          : "cash";

  return (
    <div className="relative [perspective:1600px]">
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
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[34px]">
              <div className="anim-sheen absolute -inset-y-24 left-0 w-40 bg-gradient-to-r from-transparent via-white/12 to-transparent" />
            </div>

            {/* header */}
            <div className="relative mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl border text-[13px] font-semibold tracking-tight"
                  style={{
                    borderColor: `rgba(${rgb},0.3)`,
                    background: `linear-gradient(145deg, rgba(${rgb},0.22), rgba(255,255,255,0.02))`,
                    color: ACCENTS[accent].soft,
                  }}
                >
                  ₹
                </span>
                <div className="leading-tight">
                  <p className="text-[11px] font-medium tracking-[0.28em] text-white/80">
                    CASH PAYMENT
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.12em] text-white/35">
                    ORDER #{ORDER.orderNo} · TABLE {ORDER.table}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] tracking-[0.16em] text-white/55">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: `rgba(${rgb},1)`,
                    boxShadow: `0 0 8px 2px rgba(${rgb},0.7)`,
                  }}
                />
                <span className="font-mono">REF {reference.slice(0, 6)}</span>
              </div>
            </div>

            {/* stage */}
            <div className="relative mx-auto aspect-square w-full max-w-[19rem]">
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
                  {stage === "cash" && (
                    <motion.div
                      key="cash"
                      className="relative flex h-full w-full flex-col"
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.72, filter: "blur(8px)" }}
                      transition={{ duration: 0.55, ease }}
                    >
                      <CashIdleStage
                        rgb={rgb}
                        accent={accent}
                        received={animReceived}
                        balance={balance}
                        lastNote={lastNote}
                        notePulse={notePulse}
                      />
                    </motion.div>
                  )}

                  {stage === "verify" && (
                    <motion.div
                      key="verify"
                      className="flex h-full w-full items-center justify-center"
                      initial={{ opacity: 0, scale: 1.05, filter: "blur(8px)" }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }}
                      transition={{ duration: 0.45, ease }}
                    >
                      <CashVerifyOrb rgb={rgb} amount={received} />
                    </motion.div>
                  )}

                  {stage === "success" && (
                    <motion.div
                      key="success"
                      className="flex h-full w-full items-center justify-center"
                      initial={{ opacity: 0, scale: 0.88 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.55, ease }}
                    >
                      <CashSuccessGlyph drawerOpen={drawerOpen} />
                    </motion.div>
                  )}

                  {stage === "fail" && (
                    <motion.div
                      key="fail"
                      className="flex h-full w-full items-center justify-center"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.5, ease }}
                    >
                      <CashFailGlyph cancelled={phase === "cancelled"} />
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
                    verifying ? "anim-shimmer-text" : "text-white/55"
                  }`}
                >
                  {caption}
                </motion.p>
              </AnimatePresence>
              <p className="mt-1.5 font-mono text-[10px] tracking-[0.18em] text-white/25">
                NO PROCESSING FEE · INSTANT RECORD
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ── idle composition: amount due + note stack + tendered ── */

function CashIdleStage({
  rgb,
  accent,
  received,
  balance,
  lastNote,
  notePulse,
}: {
  rgb: string;
  accent: Accent;
  received: number;
  balance: CashBalance;
  lastNote: number | null;
  notePulse: number;
}) {
  const exact = balance.kind === "exact";
  const over = balance.kind === "over";
  const under = balance.kind === "under";

  return (
    <div className="relative flex h-full w-full flex-col px-4 pb-4 pt-5">
      {/* amount due */}
      <div className="text-center">
        <p className="text-[9px] tracking-[0.34em] text-white/35">AMOUNT DUE</p>
        <p className="mt-1 flex items-baseline justify-center gap-0.5 font-light tracking-tight text-white">
          <span className="text-lg text-white/50">₹</span>
          <span className="text-[2.15rem] leading-none tabular-nums">
            {formatINR(ORDER.amount, false)}
          </span>
          <span className="text-base text-white/40">.00</span>
        </p>
      </div>

      {/* floating note stack */}
      <div className="relative mx-auto mt-3 h-[42%] w-full max-w-[13.5rem]">
        <NoteStack lastNote={lastNote} notePulse={notePulse} accent={accent} />
      </div>

      {/* tendered / change strip */}
      <div className="mt-auto space-y-2">
        <div
          className="relative overflow-hidden rounded-2xl border px-3.5 py-2.5 transition-all duration-500"
          style={{
            borderColor: exact
              ? "rgba(16,185,129,0.45)"
              : over
                ? `rgba(${rgb},0.4)`
                : under
                  ? "rgba(224,106,106,0.35)"
                  : "rgba(255,255,255,0.1)",
            background: exact
              ? "linear-gradient(145deg, rgba(16,185,129,0.16), rgba(255,255,255,0.02))"
              : over
                ? `linear-gradient(145deg, rgba(${rgb},0.14), rgba(255,255,255,0.02))`
                : "rgba(255,255,255,0.03)",
            boxShadow: exact
              ? "0 0 28px -10px rgba(16,185,129,0.7)"
              : over
                ? `0 0 28px -12px rgba(${rgb},0.7)`
                : "none",
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[9px] tracking-[0.28em] text-white/40">CASH RECEIVED</span>
            <span className="font-mono text-[15px] tabular-nums tracking-tight text-white">
              ₹{formatINR(received, false)}
              <span className="text-white/40">.00</span>
            </span>
          </div>

          <AnimatePresence mode="wait">
            {exact && (
              <motion.div
                key="exact"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 flex items-center justify-between border-t border-emerald-300/20 pt-2"
              >
                <span className="text-[9px] tracking-[0.28em] text-emerald-200/70">EXACT CASH</span>
                <span className="text-[11px] tracking-[0.12em] text-emerald-100">
                  No change required
                </span>
              </motion.div>
            )}
            {over && balance.kind === "over" && (
              <motion.div
                key="over"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 flex items-center justify-between border-t border-white/10 pt-2"
              >
                <span className="text-[9px] tracking-[0.28em]" style={{ color: ACCENTS[accent].soft }}>
                  CHANGE
                </span>
                <span
                  className="font-mono text-[15px] tabular-nums tracking-tight"
                  style={{ color: ACCENTS[accent].soft }}
                >
                  ₹{formatINR(balance.change, false)}
                  <span className="opacity-50">.00</span>
                </span>
              </motion.div>
            )}
            {under && balance.kind === "under" && (
              <motion.div
                key="under"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 flex items-center justify-between border-t border-[#e06a6a]/25 pt-2"
              >
                <span className="text-[9px] tracking-[0.28em] text-[#f3b8b8]/80">REMAINING</span>
                <span className="font-mono text-[14px] tabular-nums text-[#f3b8b8]">
                  ₹{formatINR(balance.remaining, false)}
                  <span className="opacity-50">.00</span>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ── stylized banknote stack ── */

function NoteStack({
  lastNote,
  notePulse,
  accent,
}: {
  lastNote: number | null;
  notePulse: number;
  accent: Accent;
}) {
  // three layered notes for depth — values are decorative until a denomination lands
  const layers = [
    { value: lastNote && lastNote >= 500 ? lastNote : 500, offset: 0, z: 30, rot: -6, y: 8 },
    { value: lastNote && lastNote >= 200 && lastNote < 500 ? lastNote : 200, offset: 1, z: 20, rot: 4, y: 18 },
    { value: lastNote && lastNote < 200 ? lastNote : 100, offset: 2, z: 10, rot: -2, y: 28 },
  ];

  return (
    <div className="relative h-full w-full">
      {layers.map((layer, i) => (
        <motion.div
          key={`${layer.value}-${i}`}
          className="absolute left-1/2 w-[88%]"
          style={{ zIndex: layer.z, top: `${layer.y}%` }}
          initial={false}
          animate={{
            x: "-50%",
            rotate: layer.rot,
            y: notePulse > 0 && i === 0 ? [0, -10, 0] : 0,
          }}
          transition={{ duration: 0.55, ease, delay: i * 0.04 }}
        >
          <Banknote value={layer.value} accent={accent} depth={i} />
        </motion.div>
      ))}

      {/* incoming note flash when a denomination is pressed */}
      <AnimatePresence>
        {notePulse > 0 && lastNote != null && (
          <motion.div
            key={notePulse}
            className="pointer-events-none absolute left-1/2 top-0 z-40 w-[70%] -translate-x-1/2"
            initial={{ opacity: 0, y: -40, scale: 0.85, rotate: -12 }}
            animate={{ opacity: [0, 1, 1, 0], y: [-40, 10, 22, 40], scale: [0.85, 1, 1, 0.9], rotate: [-12, -4, 0, 6] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease }}
          >
            <Banknote value={lastNote} accent={accent} depth={0} ghost />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Banknote({
  value,
  accent,
  depth,
  ghost,
}: {
  value: number;
  accent: Accent;
  depth: number;
  ghost?: boolean;
}) {
  const rgb = ACCENTS[accent].rgb;
  const tint =
    value >= 2000
      ? "from-[#1a3a2a] to-[#0d1f18]"
      : value >= 500
        ? "from-[#3a2a14] to-[#1a140a]"
        : value >= 200
          ? "from-[#2a1a32] to-[#140a1a]"
          : "from-[#1a2438] to-[#0a121c]";

  return (
    <div
      className={`relative aspect-[2.1/1] w-full overflow-hidden rounded-[10px] border bg-gradient-to-br ${tint}`}
      style={{
        borderColor: ghost ? `rgba(${rgb},0.55)` : `rgba(${rgb},0.${28 - depth * 6})`,
        boxShadow: ghost
          ? `0 12px 40px -8px rgba(${rgb},0.7), 0 0 0 1px rgba(${rgb},0.3)`
          : `0 ${10 + depth * 4}px ${24 + depth * 6}px -10px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.12)`,
        opacity: ghost ? 0.95 : 1 - depth * 0.08,
      }}
    >
      {/* guilloche-ish rings */}
      <div
        className="absolute -left-6 -top-6 h-24 w-24 rounded-full border opacity-30"
        style={{ borderColor: `rgba(${rgb},0.5)` }}
      />
      <div
        className="absolute -bottom-8 -right-4 h-28 w-28 rounded-full border opacity-20"
        style={{ borderColor: `rgba(${rgb},0.45)` }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border opacity-25"
        style={{ borderColor: `rgba(${rgb},0.4)` }}
      />

      {/* metallic edge band */}
      <div
        className="absolute inset-y-0 left-0 w-1.5"
        style={{
          background: `linear-gradient(to bottom, rgba(${rgb},0.15), rgba(${rgb},0.85), rgba(${rgb},0.15))`,
        }}
      />
      <div
        className="absolute inset-y-0 right-0 w-1.5"
        style={{
          background: `linear-gradient(to bottom, rgba(${rgb},0.15), rgba(${rgb},0.7), rgba(${rgb},0.15))`,
        }}
      />

      <div className="relative flex h-full flex-col justify-between p-2.5 pl-4">
        <div className="flex items-start justify-between">
          <span
            className="font-mono text-[11px] tracking-[0.14em]"
            style={{ color: ACCENTS[accent].soft }}
          >
            ₹{value}
          </span>
          <span className="text-[7px] tracking-[0.28em] text-white/30">INDIA</span>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-[8px] tracking-[0.22em] text-white/25">RESERVE BANK</span>
          <span
            className="text-[1.35rem] font-light leading-none tracking-tight"
            style={{ color: ACCENTS[accent].soft }}
          >
            ₹{value}
          </span>
        </div>
      </div>

      {/* glass sheen */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0)_40%)] opacity-50" />
    </div>
  );
}

/* ── verify / success / fail glyphs ── */

function CashVerifyOrb({ rgb, amount }: { rgb: string; amount: number }) {
  return (
    <div className="relative flex h-[78%] w-[78%] flex-col items-center justify-center">
      <div
        className="anim-breathe absolute inset-[8%] rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, rgba(${rgb},0.45), transparent 70%)` }}
      />
      <div
        className="absolute inset-[18%] rounded-full border"
        style={{
          borderColor: `rgba(${rgb},0.35)`,
          boxShadow: `0 0 40px -8px rgba(${rgb},0.7), inset 0 0 30px rgba(${rgb},0.12)`,
        }}
      />
      <div
        className="anim-spin-med absolute inset-[12%] rounded-full"
        style={{
          background: `conic-gradient(from 0deg, rgba(${rgb},0) 0deg, rgba(${rgb},0) 220deg, rgba(${rgb},0.85) 340deg, rgba(255,255,255,0.9) 360deg)`,
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 0)",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 0)",
        }}
      />
      <p className="relative text-[9px] tracking-[0.34em] text-white/45">CASH RECEIVED</p>
      <p className="relative mt-1 font-light tracking-tight text-white">
        <span className="text-lg text-white/50">₹</span>
        <span className="text-[2rem] leading-none tabular-nums">{formatINR(amount, false)}</span>
      </p>
      <span
        className="relative mt-3 h-2 w-2 rounded-full"
        style={{ background: "#fff", boxShadow: `0 0 20px 6px rgba(${rgb},0.85)` }}
      />
    </div>
  );
}

function CashSuccessGlyph({ drawerOpen }: { drawerOpen: boolean }) {
  const particles = Array.from({ length: 12 });
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
      <span className="anim-pulse-ring absolute h-[52%] w-[52%] rounded-full border border-emerald-300/50" />
      <span
        className="anim-pulse-ring absolute h-[52%] w-[52%] rounded-full border border-emerald-300/30"
        style={{ animationDelay: "0.85s" }}
      />
      <div className="absolute h-[46%] w-[46%] rounded-full bg-emerald-400/20 blur-2xl" />

      <div
        className="relative flex h-[42%] w-[42%] items-center justify-center rounded-full border border-emerald-300/40"
        style={{
          background:
            "radial-gradient(circle at 35% 25%, rgba(167,243,208,0.35), rgba(16,185,129,0.22) 45%, rgba(4,60,45,0.5))",
          boxShadow: "0 0 50px -6px rgba(16,185,129,0.65), inset 0 1px 0 rgba(255,255,255,0.35)",
        }}
      >
        <svg viewBox="0 0 48 48" className="h-1/2 w-1/2" fill="none" aria-hidden>
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
        const dist = 64 + (i % 3) * 20;
        return (
          <span
            key={i}
            className="anim-particle absolute h-1 w-1 rounded-full bg-emerald-200"
            style={
              {
                "--px": `${Math.cos(angle) * dist}px`,
                "--py": `${Math.sin(angle) * dist}px`,
                animationDelay: `${0.18 + (i % 5) * 0.05}s`,
                boxShadow: "0 0 10px 2px rgba(52,211,153,0.8)",
              } as React.CSSProperties
            }
          />
        );
      })}

      <AnimatePresence>
        {drawerOpen && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-5 font-mono text-[9px] tracking-[0.28em] text-emerald-200/70"
          >
            CASH DRAWER OPENED
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function CashFailGlyph({ cancelled }: { cancelled: boolean }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="absolute h-[50%] w-[50%] rounded-full bg-[#e06a6a]/12 blur-2xl" />
      <div
        className="relative flex h-[46%] w-[46%] items-center justify-center rounded-full border border-[#e06a6a]/35"
        style={{
          background:
            "radial-gradient(circle at 35% 25%, rgba(243,184,184,0.22), rgba(224,106,106,0.14) 45%, rgba(40,16,16,0.45))",
          boxShadow: "0 0 40px -10px rgba(224,106,106,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
      >
        <svg viewBox="0 0 48 48" className="h-1/2 w-1/2" fill="none" aria-hidden>
          {cancelled ? (
            <>
              <motion.path
                d="M24 13v14"
                stroke="#f3b8b8"
                strokeWidth="3"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, ease }}
              />
              <circle cx="24" cy="34" r="2" fill="#f3b8b8" />
            </>
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
        </svg>
      </div>
    </div>
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
